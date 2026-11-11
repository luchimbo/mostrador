import { analizarRecomendaciones } from './recomendaciones-informe.js';
import { exportarComercial } from './comercial-excel.js';
import { informeComercial, compararComercial } from './comercial.js';
import { capturarCarrito, recuperarCarrito } from './carritos.js';
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import express from "express";
import QRCode from "qrcode";
import { Server } from "socket.io";
import { config, ROOT } from "./config.js";
import * as contabilium from "./contabilium.js";
import { facturar } from "./invoice.js";
import * as mock from "./mock.js";
import { Sale } from "./sale.js";
import { registrarMensajes } from "./mensajes.js";
import { claveCorrecta, COOKIE, crearLimite, crearSesion, DURACION_MS, leerCookie, sesionValida } from "./sesion.js";
import { almacenamiento, appendLog, getSettings, guardarCopia, readJson, readLog, saveSettings, writeJson } from "./store.js";
import { actualizarPreciosTienda, combinarConTienda, estadoTienda, sincronizarTienda, tiendaSinContabilium } from "./tiendanube.js";
import { productosEnReposo } from "../shared/display.js";
import { detalleConfirmado } from "../shared/confirmacion-venta.js";
import { incluirProductosPrueba } from "./catalog.js";
import { createOnlinePublisher } from "./online-publisher.js";
import { createReviewsPublisher } from "./reviews-publisher.js";
import { importCsv, newestReviewsFirst, normalizeReview, reviewKey } from "../shared/reviews.js";
import { comprobanteEmitido, importeContabilium, registrarCobranza } from "./cobranza.js";
import { estadisticas, filasReporte, generarReporteExcel, sinProductosPrueba } from "./reporte.js";
import { migrarReglas } from "../shared/recommendations.js";

const backend = config.mode === "real" ? contabilium : mock;
const facturador = config.facturacionSimulada ? mock : contabilium;
if (config.facturacionSimulada) {
  const comprobantes = "comprobantes-simulados.json";
  const ultimoId = (await readLog("ventas.jsonl")).reduce((max, venta) => {
    const id = Number(venta.idComprobante);
    return venta.prueba && Number.isSafeInteger(id) ? Math.max(max, id) : max;
  }, 0);
  mock.configurarComprobantesPrueba(readJson(comprobantes, []), registros => writeJson(comprobantes, registros), ultimoId);
}

// ---------- Catálogo (copia local, se refresca periódicamente) ----------
let catalogo = readJson("catalogo.json", { productos: [], actualizado: null });
let productsById = indexar(catalogo.productos);
let errorCatalogo = null;
let errorTienda = null;

// Catálogo del mostrador: productos de Contabilium publicados en la tienda, con precio, categoría y foto de la tienda.
function indexar(productos) {
  const visibles = incluirProductosPrueba(combinarConTienda(productos), productos, config.productosPruebaIds);
  return new Map(visibles.map((p) => [String(p.id), p]));
}

// Si ya hay una lectura de la tienda en curso, se espera esa en lugar de empezar otra.
// completa: las ~300 páginas de producto (categorías, fotos, productos nuevos). Esas páginas pueden
// venir del caché de Cloudflare con precios de hasta 24 h, así que después se leen los precios del listado.
let leyendoTienda = null;
function actualizarTienda({ completa = false } = {}) {
  leyendoTienda ??= (async () => {
    try {
      if (completa) await sincronizarTienda();
      await actualizarPreciosTienda();
      productsById = indexar(catalogo.productos);
      onlinePublisher.schedule();
      errorTienda = null;
    } catch (err) {
      errorTienda = err.message;
      console.error("[tiendanube] error:", err.message);
    } finally {
      leyendoTienda = null;
    }
    broadcast();
  })();
  return leyendoTienda;
}

async function actualizarCatalogo() {
  try {
    const productos = await backend.descargarCatalogo();
    catalogo = { productos, actualizado: new Date().toISOString() };
    productsById = indexar(productos);
    guardarCopia("catalogo.json", catalogo);
    if (reglasPendientes) await encolarGuardadoReglas(async () => {
      if (!reglasPendientes) return;
      const iniciales = migrarReglas(mock.reglasInicialesReales([...productsById.values()]), getSettings().descuentoGeneralPct);
      await persistirReglas(iniciales);
    });
    errorCatalogo = null;
    onlinePublisher.schedule();
    console.log(`[catálogo] ${productos.length} productos`);
  } catch (err) {
    errorCatalogo = err.message;
    console.error("[catálogo] error:", err.message);
  }
  broadcast();
}

// ---------- Reglas y destacados ----------
// En modo real, la primera vez se precargan las reglas de ejemplo traducidas a productos reales.
let reglas = readJson("reglas.json", null);
let reglasPendientes = !reglas && config.mode === "real";
if (!reglas) {
  reglas = config.mode === "mock" ? mock.REGLAS_DEMO : [];
  if (!reglasPendientes) await writeJson("reglas.json", reglas);
}
if (reglas.some((r) => !r.descuentosPorProducto)) {
  reglas = migrarReglas(reglas, getSettings().descuentoGeneralPct);
  await writeJson("reglas.json", reglas);
}
let destacados = readJson("destacados.json", config.mode === "mock" ? ["102", "202", "301", "502", "701"] : []);
let colaReglas = Promise.resolve();

function encolarGuardadoReglas(guardar) {
  const siguiente = colaReglas.then(guardar);
  colaReglas = siguiente.catch(() => {});
  return siguiente;
}

async function persistirReglas(nuevas) {
  await writeJson("reglas.json", nuevas);
  reglas = nuevas;
  reglasPendientes = false;
}

const onlinePublisher = createOnlinePublisher({ connection: config.onlineCrossSelling, read: readJson, write: writeJson,
  source: () => ({ products: [...productsById.values()], rules: reglas, settings: getSettings() }) });

// Sin catálogo cargado todavía no se puede descartar ningún SKU.
const reviewsPublisher = createReviewsPublisher({ connection: config.onlineCrossSelling, read: readJson, write: writeJson,
  knownSkus: () => { const skus = codigosCatalogo(); return skus.size ? skus : null; } });

// ---------- Venta en curso ----------
let colaEventos=Promise.resolve();
const registrarEvento = evento => {
 const registro={...evento,fecha:new Date().toISOString(),canal:'mostrador',reglaNombre:evento.reglaNombre||reglas.find(r=>r.id===evento.reglaId)?.nombre||'Regla histórica'};
 colaEventos=colaEventos.catch(()=>{}).then(()=>appendLog('recomendaciones-eventos.jsonl',registro));
 colaEventos.catch(e=>console.error('[recomendaciones] No se pudo guardar evento:',e.message));
};
const sale = new Sale(registrarEvento);
const VENTA_ACTIVA = config.mode === "real" && config.facturacionSimulada ? "venta-activa-simulada.json" : "venta-activa.json";
const activa = readJson(VENTA_ACTIVA, undefined, { estricto: true });
if (activa) {
  sale.restaurar(activa);
  sale.recuperada = true;
  if (["facturando", "cobrando"].includes(sale.fase)) {
    sale.fase = sale.operacion ? "revision" : sale.factura ? "cobranza" : "venta";
    if (sale.fase === "revision") sale.error = "Verificá el resultado de la operación en Contabilium.";
  }
} else if (activa === undefined) {
  const anterior = readJson("factura-en-cobranza.json", null);
  if (comprobanteEmitido(anterior) && anterior.cobranza?.modalidad === "manual"
      && (config.mode === "mock" || Boolean(anterior.prueba) === config.facturacionSimulada)) {
    sale.restaurar({
      factura: anterior, cliente: anterior.cliente, lines: anterior.lineas || [],
      metodoPago: anterior.metodoPago, inicio: anterior.inicio, recuperada: true,
      fase: anterior.cobranza.estado === "pendiente" ? "cobranza" : "revision",
    });
    if (sale.fase === "revision") sale.operacion = { clase: "cobro", uid: crypto.randomUUID() };
    await writeJson(VENTA_ACTIVA, sale.persistible());
  }
}
let colaVenta = Promise.resolve();

function encolarVenta(trabajo) {
  const pendiente = colaVenta.then(trabajo);
  colaVenta = pendiente.catch(() => {});
  return pendiente;
}

function guardarVenta(venta = sale) {
  const cerrada = ["idle", "gracias"].includes(venta.fase);
  return writeJson(VENTA_ACTIVA, cerrada ? null : venta.persistible());
}

async function editarVenta(editar) {
  const eventos = [];
  const borrador = new Sale(evento => eventos.push(evento));
  borrador.restaurar(sale.persistible());
  const resultado = editar(borrador);
  borrador.actualizarProductos(productsById);
  await guardarVenta(borrador);
  sale.restaurar(borrador.persistible());
  eventos.forEach(registrarEvento);
  return resultado;
}

let timerGracias = null;

function destinosCobranza() {
  return readJson("destinos-cobranza.json", config.facturacionSimulada ? [
    { key: "almagro", nombre: "Almagro (prueba)", idCaja: 1, medios: ["efectivo"] },
    { key: "bbva-pesos", nombre: "BBVA (prueba)", idBanco: 2, medios: ["transferencia"] },
    { key: "mercadopago", nombre: "MercadoPago (prueba)", idBanco: 3, medios: ["mercadopago", "transferencia"] },
  ] : []);
}

function finalizarVenta() {
  sale.fase = "gracias";
  clearTimeout(timerGracias);
  timerGracias = setTimeout(() => {
    void encolarVenta(() => {
      if (sale.fase === "gracias") {
        sale.reset();
        broadcast();
      }
    });
  }, 45_000);
}

// Si no se eligieron destacados, se muestra el producto más caro con foto de cada categoría.
function productosDestacados() {
  const elegidos = destacados.map((id) => productsById.get(String(id))).filter(Boolean);
  if (elegidos.length) return elegidos;
  const porCategoria = new Map();
  for (const p of productsById.values()) {
    if (p.productoPrueba || !p.imagen || p.stock === 0) continue;
    const actual = porCategoria.get(p.rubro);
    if (!actual || p.precioFinal > actual.precioFinal) porCategoria.set(p.rubro, p);
  }
  return [...porCategoria.values()];
}

function estado() {
  sale.actualizarProductos(productsById);
  const settings = getSettings();
  return {
    ...sale.snapshot(productsById, reglas, settings),
    modo: config.mode,
    preview: config.preview,
    facturacionSimulada: config.facturacionSimulada,
    destinosCobranza: destinosCobranza().map(({ key, nombre, medios }) => ({ key, nombre, medios })),
    destacados: productosDestacados(),
    segundosPorSlide: settings.segundosPorSlide,
    reposo: {
      productos: productosEnReposo([...productsById.values()], destacados, settings),
      videos: settings.videosReposo.map((v) => ({ ...v, producto: productsById.get(String(v.productId)) || null })),
      segundosPorVideo: settings.segundosPorVideo,
      productosEntreVideos: settings.productosEntreVideos,
    },
    opinionUrl: settings.mostrarOpinion ? settings.opinionUrl : "",
    catalogo: {
      cantidad: productsById.size,
      actualizado: catalogo.actualizado,
      error: errorCatalogo,
      enContabilium: catalogo.productos.length,
      conImagen: [...productsById.values()].filter((p) => p.imagen).length,
      tienda: { ...estadoTienda(), error: errorTienda },
    },
  };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- Acceso ----------
// En Railway el mostrador queda abierto a internet: sin contraseña cualquiera podría facturar.
const enRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);
if (enRailway && !config.claveAcceso) throw new Error("Falta CLAVE_ACCESO: en Railway el mostrador necesita contraseña.");
// Railway atiende detrás de un proxy: la dirección y el https reales llegan en sus cabeceras.
if (enRailway) app.set("trust proxy", 1);

const conSesion = (cookies) => !config.claveAcceso || sesionValida(config.claveAcceso, leerCookie(cookies));
io.use((socket, next) => (conSesion(socket.handshake.headers.cookie) ? next() : next(new Error("sin-sesion"))));

function broadcast() {
  io.emit("estado", estado());
}

function producto(id) {
  const p = productsById.get(String(id));
  if (!p) throw new Error("Producto no encontrado en el catálogo.");
  return p;
}

function detalleVenta(snapshot) {
  return {
    fecha: new Date().toISOString(), inicio: sale.inicio, sessionId: sale.sessionId,
    metodoPago: snapshot.metodoPago,
    transferencia: snapshot.metodoPago === "mercadopago" && snapshot.transferencia,
    venta: { lines: structuredClone(sale.lines), inicio: sale.inicio },
    lineas: snapshot.lines.map((l) => ({
      productId: l.productId, nombre: l.nombre, cantidad: l.cantidad, total: l.total,
      reglaId: l.reglaId, crossSelling: l.crossSelling, bruto: l.bruto, iva: l.iva,
      costo: productsById.get(String(l.productId))?.costo ?? null,
      reglaNombre: reglas.find(r => r.id === l.reglaId)?.nombre ?? null,
    })),
    sugerenciasMostradas: [...sale.sugerenciasMostradas],
  };
}

const mismoId = (a, b) => a != null && b != null && String(a) === String(b);
const mismoImporte = (a, b) => Math.round(a * 100) === Math.round(b * 100);

async function registrarVentaEmitida() {
  const { factura, operacion } = sale;
  const existente = (await readLog("ventas.jsonl", { estricto: true }))
    .find(v => mismoId(v.idComprobante, factura.idComprobante));
  if (existente) {
    if (existente.sessionId !== sale.sessionId) throw new Error("El comprobante ya está vinculado a otra venta.");
    return;
  }
  const cobranza = factura.cobranza?.estado === "registrada" && operacion.fechaCobro
    ? { ...factura.cobranza, fecha: operacion.fechaCobro } : factura.cobranza;
  await appendLog("ventas.jsonl", {
    ...operacion.detalle, numero: factura.numero, idComprobante: factura.idComprobante,
    cae: factura.cae, cliente: factura.cliente, url: factura.url, cobranza, total: factura.total,
    tipo: factura.tipo, condicionVenta: factura.condicionVenta, prueba: factura.prueba, factura,
  }, operacion.uid);
}

async function concluirOperacion(fase) {
  const anterior = sale.persistible();
  sale.fase = fase;
  sale.error = null;
  sale.operacion = null;
  sale.comprobantePendiente = null;
  try {
    await guardarVenta();
  } catch (error) {
    sale.restaurar(anterior);
    throw error;
  }
  if (fase === "gracias") finalizarVenta();
}

async function marcarRevision(error) {
  sale.fase = "revision";
  sale.error = error.message;
  try {
    await guardarVenta();
  } catch (fallo) {
    console.error("[venta activa] No se pudo guardar la revisión:", fallo.message);
  }
}

async function accionFacturar(datosCliente) {
  if (sale.fase !== "venta") throw new Error("La venta actual no está disponible para emitir.");
  sale.actualizarProductos(productsById);
  if (sale.lines.some(l => l.noDisponible)) throw new Error("Quitá o reemplazá los productos que ya no están en el catálogo.");
  const settings = getSettings();
  const snapshot = sale.snapshot(productsById, reglas, settings);
  if (datosCliente.confirmacion !== detalleConfirmado(snapshot)) {
    throw new Error("Revisá el detalle de la venta y confirmalo antes de emitir el comprobante.");
  }
  const anterior = sale.persistible();
  sale.fase = "facturando";
  sale.error = null;
  broadcast();
  let enviado = false;
  try {
    const factura = await facturar({
      backend: facturador, snapshot, datosCliente, settings,
      antesDeEmitir: async (esperado) => {
        sale.totalesEmitidos = snapshot.totales;
        sale.operacion = { clase: "emision", uid: crypto.randomUUID(), esperado, detalle: detalleVenta(snapshot) };
        await guardarVenta();
        enviado = true;
      },
    });
    if (factura.necesitaDatos) {
      sale.restaurar(anterior);
      return factura;
    }
    sale.factura = factura;
    sale.cliente = factura.cliente;
    sale.operacion.esperado.total = factura.total;
    if (factura.cobranza?.estado === "registrada") sale.operacion.fechaCobro = new Date().toISOString();
    await guardarVenta();
    await registrarVentaEmitida();
    if (factura.cobranza?.estado === "revisar") {
      await marcarRevision(new Error("Verificá el saldo del comprobante en Contabilium."));
    } else {
      await concluirOperacion(factura.cobranza?.modalidad === "manual" ? "cobranza" : "gracias");
    }
    return { factura };
  } catch (error) {
    if (enviado) {
      sale.comprobantePendiente = error.idComprobante ?? sale.factura?.idComprobante ?? null;
      await marcarRevision(error);
    } else sale.restaurar(anterior);
    throw error;
  }
}

async function registrarCobroLocal(cobranza) {
  const id = sale.factura.idComprobante;
  const existente = (await readLog("cobranzas.jsonl", { estricto: true }))
    .find(c => mismoId(c.idComprobante, id) && c.estado === "registrada");
  if (!existente) await appendLog("cobranzas.jsonl", { idComprobante: id, ...cobranza }, sale.operacion.uid);
  sale.factura.cobranza = existente || cobranza;
}

async function accionCobrar({ pagos }) {
  if (sale.fase !== "cobranza" || !sale.factura) throw new Error("No hay una factura pendiente de cobranza en esta venta.");
  const anterior = sale.persistible();
  sale.fase = "cobrando";
  sale.error = null;
  broadcast();
  let enviado = false;
  try {
    const cobranza = await registrarCobranza({
      factura: sale.factura, pagos, destinos: destinosCobranza(), backend: facturador,
      antesDeEnviar: async () => {
        sale.operacion = { clase: "cobro", uid: crypto.randomUUID() };
        await guardarVenta();
        enviado = true;
      },
    });
    sale.operacion.cobranzaConfirmada = cobranza;
    await guardarVenta();
    await registrarCobroLocal(cobranza);
    await concluirOperacion("gracias");
    return { cobranza };
  } catch (error) {
    if (enviado || error.revisarSaldo) {
      sale.operacion ??= { clase: "cobro", uid: crypto.randomUUID() };
      await marcarRevision(error);
    } else sale.restaurar(anterior);
    throw error;
  }
}

async function verificarOperacion({ id: ingresado }) {
  if (sale.fase !== "revision" || !sale.operacion) throw new Error("No hay una operación para verificar.");
  const { operacion } = sale;
  const id = Number(sale.factura?.idComprobante ?? sale.comprobantePendiente ?? ingresado);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Ingresá el ID del comprobante de Contabilium.");
  const actual = await facturador.consultarComprobante(id);
  if (!actual) throw new Error("No se encontró el comprobante en Contabilium.");
  const cae = actual.Cae || actual.CAE;
  const tipo = actual.TipoFc ?? actual.Tipo;
  const total = importeContabilium(actual.ImporteTotalNeto);
  const saldo = importeContabilium(actual.Saldo);
  if (operacion.clase === "cobro") {
    const factura = sale.factura;
    const coincide = factura.cotizacion ? tipo === (factura.tipoFc || "COT") && !cae : mismoId(cae, factura.cae);
    if (!coincide || !mismoImporte(total, factura.total)) throw new Error("El comprobante no coincide con la cobranza del mostrador.");
    if (saldo !== 0) throw new Error(`Saldo en Contabilium: ${saldo.toFixed(2)}. Revisá allí la cobranza.`);
    await registrarCobroLocal(operacion.cobranzaConfirmada || { estado: "registrada", modalidad: "manual" });
    return concluirOperacion("gracias");
  }
  const esperado = operacion.esperado;
  const cliente = actual.IdCliente ?? actual.IDCliente ?? actual.Cliente?.Id;
  const cotizacion = esperado.tipoFc === "COT";
  if (!mismoId(cliente, esperado.clienteId) || tipo !== esperado.tipoFc || !mismoImporte(total, esperado.total)
      || (cotizacion ? Boolean(cae) : !cae) || (sale.factura?.cae && !mismoId(cae, sale.factura.cae))) {
    throw new Error("Cliente, tipo, total o autorización del comprobante no coinciden con la venta confirmada.");
  }
  const existente = (await readLog("ventas.jsonl", { estricto: true })).find(v => mismoId(v.idComprobante, id));
  if (existente && existente.sessionId !== sale.sessionId) throw new Error("El comprobante ya está vinculado a otra venta.");
  const modalidad = esperado.modalidad;
  const pendiente = modalidad === "manual" && mismoImporte(saldo, total);
  if (saldo !== 0 && !pendiente) throw new Error(`Saldo en Contabilium: ${saldo.toFixed(2)}. Revisá allí la cobranza.`);
  sale.factura = {
    tipo: cotizacion ? "Cotización" : esperado.tipoFc === "FCA" ? "Factura A" : "Factura B",
    numero: actual.Numero ?? actual.numero ?? actual.NumeroComprobante ?? `ID ${id}`,
    url: actual.LinkPublico ?? actual.Url ?? "",
    tipoFc: esperado.tipoFc, cotizacion, cae, total, idComprobante: id,
    cliente: esperado.cliente, condicionVenta: esperado.condicionVenta,
    metodoPago: sale.metodoPago, prueba: config.facturacionSimulada,
    ...sale.factura, cobranza: { modalidad, estado: pendiente ? "pendiente" : "registrada" },
  };
  sale.cliente = sale.factura.cliente;
  await guardarVenta();
  await registrarVentaEmitida();
  if (!pendiente && existente && existente.cobranza?.estado !== "registrada") {
    await registrarCobroLocal({ modalidad, estado: "registrada" });
  }
  await concluirOperacion(pendiente ? "cobranza" : "gracias");
}

const ACCIONES = {
  agregar: ({ productId, reglaId }, venta) => venta.agregar(producto(productId), { reglaId }),
  cantidad: ({ lineId, cantidad }, venta) => venta.cambiarCantidad(lineId, Number(cantidad)),
  quitar: ({ lineId }, venta) => venta.quitar(lineId),
  crossSelling: ({ lineId, valor }, venta) => venta.marcarCrossSelling(lineId, valor),
  metodoPago: ({ metodo }, venta) => venta.setMetodoPago(metodo),
  sinFactura: ({ valor }, venta) => venta.setSinFactura(valor),
  transferencia: ({ valor }, venta) => venta.setTransferencia(valor),
  cancelar: (_datos, venta) => venta.reset(),
  verificarOperacion,
  facturar: accionFacturar,
  cobrar: accionCobrar,
};

io.on("connection", (socket) => {
  registrarMensajes(io, socket);
  socket.emit("estado", estado());
  socket.on("accion", async (msg, ack = () => {}) => {
    const fn = ACCIONES[msg?.tipo];
    try {
      if (socket.handshake.auth.soloLectura) throw new Error("La vista de supervisión es de solo lectura.");
      if (!Object.hasOwn(ACCIONES, msg?.tipo)) throw new Error(`Acción desconocida: ${msg?.tipo}`);
      if (["facturando", "cobrando"].includes(sale.fase)) throw new Error("Esperá a que termine la operación en curso.");
      const res = await encolarVenta(() => {
        if (sale.fase === "revision" && msg.tipo !== "verificarOperacion") throw new Error("Verificá la operación en Contabilium antes de continuar.");
        if (["facturando", "cobranza", "cobrando"].includes(sale.fase)
            && !["cobrar", "cancelar"].includes(msg.tipo)) throw new Error("Terminá la factura y cobranza antes de modificar la venta.");
        if (["facturar", "cobrar", "verificarOperacion"].includes(msg.tipo)) return fn(msg);
        return editarVenta(venta => fn(msg, venta));
      });
      broadcast();
      ack({ ok: true, ...(res || {}) });
    } catch (err) {
      broadcast();
      ack({ ok: false, error: err.message });
    }
  });
});

// ---------- API REST para el panel de administración ----------
app.use(express.json({ limit: "3mb" })); // El import de reseñas por CSV puede pasar los 100 kb.

const intentos = crearLimite();
app.get("/api/sesion", (req, res) => res.json({ ok: conSesion(req.headers.cookie), requerida: Boolean(config.claveAcceso) }));
app.post("/api/login", (req, res) => {
  if (!config.claveAcceso) return res.json({ ok: true });
  if (intentos.bloqueado(req.ip)) return res.status(429).json({ error: "Demasiados intentos. Esperá 15 minutos y volvé a probar." });
  if (!claveCorrecta(config.claveAcceso, req.body?.clave)) {
    intentos.fallo(req.ip);
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }
  intentos.acierto(req.ip);
  res.cookie(COOKIE, crearSesion(config.claveAcceso), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: DURACION_MS });
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => (conSesion(req.headers.cookie) ? next() : res.status(401).json({ error: "Iniciá sesión para continuar." })));

app.get("/api/catalogo", (_req, res) => res.json({ ...catalogo, productos: [...productsById.values()] }));
app.post("/api/catalogo/actualizar", async (_req, res) => {
  await actualizarCatalogo();
  res.json({ ok: !errorCatalogo, error: errorCatalogo, cantidad: productsById.size });
});

// Botón del vendedor: precios de la tienda (Tiendanube) y productos de Contabilium.
app.post("/api/precios/actualizar", async (_req, res) => {
  await Promise.all([actualizarCatalogo(), actualizarTienda()]);
  const error = [errorCatalogo, errorTienda && `Tienda online: ${errorTienda}`].filter(Boolean).join(" · ") || null;
  res.json({ ok: !error, error, ...estadoTienda() });
});

app.post("/api/tienda/actualizar", async (_req, res) => {
  await actualizarTienda({ completa: true });
  res.json({ ok: !errorTienda, error: errorTienda, ...estadoTienda() });
});
app.get("/api/tienda/estado", (_req, res) => res.json({ ...estadoTienda(), error: errorTienda }));
app.get("/api/tienda/faltantes",(_req, res) => res.json(tiendaSinContabilium(catalogo.productos)));

app.get("/api/reglas", (_req, res) => res.json(reglas));
app.get("/api/crossselling-online", (_req, res) => res.json(onlinePublisher.status()));
app.post("/api/crossselling-online/publicar", async (_req, res) => {
  try { res.json(await onlinePublisher.publish()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
app.post("/api/crossselling-online/estado", async (_req, res) => {
  try { res.json(await onlinePublisher.remoteStatus()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
app.get("/api/crossselling-online/modulo", async (_req, res) => {
  try { res.json(await onlinePublisher.moduleStatus()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
app.put("/api/crossselling-online/modulo", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Indicá enabled: true o false." });
  try { res.json(await onlinePublisher.setModule(req.body.enabled)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
// Reseñas de productos para la tienda online (se cargan acá, se publican a Logitrack).
const codigosCatalogo = () => new Set([...productsById.values()].map((p) => String(p.codigo || "").trim().toUpperCase()));
const reseniaError = (res, err) => res.status(400).json({ error: err.message });
// Hay miles de opiniones: la lista se filtra en el servidor y devuelve sólo la primera tanda.
const sinTildes = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
app.get("/api/resenas", (req, res) => {
  const estado = String(req.query.estado || ""), tokens = sinTildes(req.query.q).split(/\s+/).filter(Boolean);
  const limite = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const nombres = new Map([...productsById.values()].map((p) => [String(p.codigo || "").trim().toUpperCase(), p.nombre]));
  const coinciden = reviewsPublisher.list().filter((r) => (!estado || r.estado === estado) &&
    (!tokens.length || tokens.every((t) => sinTildes(`${r.sku} ${nombres.get(r.sku) || ""} ${r.autor} ${r.texto}`).includes(t))));
  res.json({ ...reviewsPublisher.status(), coinciden: coinciden.length,
    reviews: newestReviewsFirst(coinciden).slice(0, limite).map((r) => ({ ...r, producto: nombres.get(r.sku) || "" })) });
});
app.post("/api/resenas", async (req, res) => {
  try {
    const review = { ...normalizeReview(req.body || {}), id: crypto.randomUUID() };
    if (!codigosCatalogo().has(review.sku)) throw new Error("Ese SKU no está en el catálogo");
    await reviewsPublisher.mutate((all) => {
      if (all.some((r) => reviewKey(r) === reviewKey(review))) throw new Error("Esa opinión ya está cargada");
      return { reviews: [review, ...all], result: review };
    });
    res.status(201).json(review);
  } catch (err) { reseniaError(res, err); }
});
// Va antes que /:id: si no, «modulo» se tomaría como el id de una opinión.
app.put("/api/resenas/modulo", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Indicá enabled: true o false." });
  try { res.json(await reviewsPublisher.setEnabled(req.body.enabled)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
app.put("/api/resenas/visualizacion", async (req, res) => {
  if (![1, 4].includes(req.body?.minRating) || typeof req.body?.showMeliLink !== "boolean") return res.status(400).json({ error: "Opciones de visualización inválidas." });
  try { res.json(await reviewsPublisher.setDisplayOptions(req.body)); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
app.put("/api/resenas/:id", async (req, res) => {
  try {
    const updated = await reviewsPublisher.mutate((all) => {
      const current = all.find((r) => r.id === req.params.id);
      if (!current) throw new Error("No existe esa reseña");
      const next = normalizeReview({ ...current, ...req.body, id: current.id });
      if (!codigosCatalogo().has(next.sku)) throw new Error("Ese SKU no está en el catálogo");
      return { reviews: all.map((r) => (r.id === next.id ? next : r)), result: next };
    });
    res.json(updated);
  } catch (err) { reseniaError(res, err); }
});
app.delete("/api/resenas/:id", async (req, res) => {
  try {
    await reviewsPublisher.mutate((all) => {
      if (!all.some((r) => r.id === req.params.id)) throw new Error("No existe esa reseña");
      return { reviews: all.filter((r) => r.id !== req.params.id), result: null };
    });
    res.json({ ok: true });
  } catch (err) { reseniaError(res, err); }
});
// Con confirmar=false sólo muestra qué se importaría; con true carga lo válido como «pendiente».
app.post("/api/resenas/importar", async (req, res) => {
  try {
    const { valid, errors } = importCsv(req.body?.csv);
    const known = codigosCatalogo();
    const dentro = valid.filter((r) => known.has(r.sku));
    const confirmar = req.body?.confirmar === true;
    let nuevas = [];
    if (confirmar) {
      await reviewsPublisher.mutate((all) => {
        const keys = new Set(all.map(reviewKey));
        nuevas = dentro.filter((r) => !keys.has(reviewKey(r)) && keys.add(reviewKey(r)))
          .map((r) => ({ ...r, id: crypto.randomUUID(), estado: "pendiente" }));
        return { reviews: [...nuevas, ...all], result: null };
      });
    }
    res.json({ confirmado: confirmar, importables: dentro.length, importadas: nuevas.length, repetidas: confirmar ? dentro.length - nuevas.length : 0,
      skuDesconocidos: [...new Set(valid.filter((r) => !known.has(r.sku)).map((r) => r.sku))],
      errores: errors.slice(0, 50), totalErrores: errors.length });
  } catch (err) { reseniaError(res, err); }
});
// La búsqueda tarda minutos: arranca en segundo plano y la pantalla consulta el avance en GET /api/resenas.
app.post("/api/resenas/mercadolibre", (_req, res) => {
  if (!reviewsPublisher.status().configured) return res.status(502).json({ error: "Configurá la conexión con Logitrack en el servidor" });
  reviewsPublisher.startImportMeli();
  res.status(202).json({ importando: true });
});
app.post("/api/resenas/aprobar-pendientes", async (req, res) => {
  try { res.json({ aprobadas: await reviewsPublisher.approvePending(typeof req.body?.origen === "string" ? req.body.origen : undefined) }); }
  catch (err) { reseniaError(res, err); }
});
app.post("/api/resenas/publicar", async (_req, res) => {
  try { res.json(await reviewsPublisher.publish()); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
app.post("/api/resenas/estado", async (_req, res) => {
  try { res.json({ ...reviewsPublisher.status(), remote: await reviewsPublisher.remoteStatus() }); }
  catch (err) { res.status(502).json({ error: err.message }); }
});
function descuentosValidos(regla) {
  const descuentos = regla?.descuentosPorProducto;
  if (!Array.isArray(regla?.sugeridos) || !descuentos || typeof descuentos !== "object" || Array.isArray(descuentos)) return false;
  const sugeridos = new Set(regla.sugeridos.map(String));
  return Object.entries(descuentos).every(([id, pct]) => sugeridos.has(id) && Number.isFinite(pct) && pct >= 0 && pct <= 100);
}

async function responderGuardadoReglas(nuevas, res) {
  await persistirReglas(nuevas);
  onlinePublisher.schedule();
  broadcast();
  res.json(reglas);
}

app.put("/api/reglas", async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: "Se esperaba una lista de reglas." });
  if (!req.body.every(descuentosValidos)) return res.status(400).json({ error: "Descuentos por producto inválidos." });
  await encolarGuardadoReglas(() => responderGuardadoReglas(req.body, res));
});

app.put("/api/reglas/:id", async (req, res) => {
  const { original, regla } = req.body ?? {};
  const { id } = req.params;
  if (original?.id == null || String(original.id) !== id || regla?.id !== original.id ||
      typeof regla.nombre !== "string" || typeof regla.activa !== "boolean" ||
      !["rubro", "subrubro", "producto", "nombre"].includes(regla.disparador?.tipo) ||
      !["string", "number"].includes(typeof regla.disparador.valor) ||
      (regla.disparador.excluir != null && typeof regla.disparador.excluir !== "string") ||
      (regla.mensaje != null && typeof regla.mensaje !== "string")) {
    return res.status(400).json({ error: "Los datos de la regla son inválidos." });
  }
  if (!descuentosValidos(regla)) return res.status(400).json({ error: "Descuentos por producto inválidos." });
  await encolarGuardadoReglas(async () => {
    const actual = reglas.find((r) => String(r.id) === id);
    if (!actual) return res.status(404).json({ error: "La regla ya no existe." });
    if (!isDeepStrictEqual(actual, original)) {
      return res.status(409).json({ error: "Otra sesión cambió la regla. Recargala antes de volver a editarla." });
    }
    await responderGuardadoReglas(reglas.map((r) => r === actual ? regla : r), res);
  });
});

app.get("/api/destacados", (_req, res) => res.json(destacados));
app.put("/api/destacados", async (req, res) => {
  const nuevos = Array.isArray(req.body) ? req.body.map(String) : [];
  await writeJson("destacados.json", nuevos);
  destacados = nuevos;
  broadcast();
  res.json(destacados);
});

app.get("/api/ajustes", (_req, res) => res.json(getSettings()));
app.put("/api/ajustes", async (req, res) => {
  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") return res.status(400).json({ error: "Se esperaba un objeto de ajustes." });
  try {
    const next = await saveSettings(req.body || {});
    onlinePublisher.schedule();
    broadcast();
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/opinion/qr", async (_req, res) => {
  const url = getSettings().opinionUrl;
  if (!url) return res.status(404).end();
  res.set("Cache-Control", "no-store");
  res.type("png").send(await QRCode.toBuffer(url, { margin: 4, scale: 8 }));
});

app.get("/api/metricas", async (_req, res) => {
  const ventas = (await readLog("ventas.jsonl")).filter((v) => !v.prueba || config.facturacionSimulada);
  const porRegla = {};
  for (const regla of reglas) porRegla[regla.id] = { nombre: regla.nombre, mostradas: 0, aceptadas: 0, ventas: 0, ingresos: 0 };
  for (const v of ventas) {
    for (const key of v.sugerenciasMostradas || []) {
      const [reglaId] = key.split(":");
      if (porRegla[reglaId]) porRegla[reglaId].mostradas++;
    }
    const reglasDeLaVenta = new Set();
    for (const l of v.lineas) {
      if (l.reglaId && porRegla[l.reglaId]) {
        porRegla[l.reglaId].aceptadas++;
        porRegla[l.reglaId].ingresos += l.total;
        reglasDeLaVenta.add(l.reglaId);
      }
    }
    for (const id of reglasDeLaVenta) porRegla[id].ventas++;
  }
  res.json({
    ventas: ventas.length,
    facturado: ventas.reduce((a, v) => a + v.total, 0),
    porRegla: Object.entries(porRegla).map(([id, m]) => ({ id, ...m })),
  });
});

app.get("/api/facturas", async (_req, res) => {
  const cobranzas = new Map((await readLog("cobranzas.jsonl")).map(c => [String(c.idComprobante), c]));
  res.json((await readLog("ventas.jsonl")).filter((v) => !v.prueba || config.facturacionSimulada).slice(-500).reverse().map((v) => ({
    fecha: v.fecha, numero: v.numero, idComprobante: v.idComprobante, tipo: v.tipo || v.factura?.tipo,
    cliente: v.cliente, total: v.total, metodoPago: v.metodoPago,
    url: v.url, cobranza: cobranzas.get(String(v.idComprobante)) || v.cobranza, prueba: v.prueba,
    condicionVenta: v.condicionVenta,
  })));
});

// Fechas del informe en hora de Argentina (UTC-3): "hasta" incluye el día completo.
const inicioDiaAR = (fecha, dias = 0) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) return undefined;
  const d = new Date(`${fecha}T03:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString();
};

// Cross-selling de la tienda online (Logitrack). Si falla, el informe local sigue funcionando.
const hoyAR = () => new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 10);
app.get("/api/estadisticas/online", async (req, res) => {
  try { res.json({ configurado: onlinePublisher.status().configured, datos: await onlinePublisher.report(req.query.desde, req.query.hasta) }); }
  catch (err) { res.json({ configurado: true, error: err.message, datos: null }); }
});
app.get("/api/metricas/online", async (_req, res) => {
  try { res.json({ datos: await onlinePublisher.report("2026-01-01", hoyAR()) }); }
  catch (err) { res.json({ error: err.message, datos: null }); }
});

app.get("/api/estadisticas", async (req, res) => {
  const { desde, hasta } = req.query;
  const ventas = sinProductosPrueba((await readLog("ventas.jsonl")).filter((v) => !v.prueba || config.facturacionSimulada), config.productosPruebaIds);
  res.json(estadisticas(ventas, { desde: inicioDiaAR(desde), hasta: inicioDiaAR(hasta, 1) }));
});

// El informe se guarda en la carpeta "informes" del mostrador (no se sube a GitHub).
app.post("/api/reporte", async (req, res) => {
  try {
    const { desde, hasta } = req.body || {};
    const ventas = sinProductosPrueba((await readLog("ventas.jsonl")).filter((v) => !v.prueba || config.facturacionSimulada), config.productosPruebaIds);
    const filas = filasReporte(ventas, { desde: inicioDiaAR(desde), hasta: inicioDiaAR(hasta, 1) });
    const ahora = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const rango = [desde, hasta].filter((f) => inicioDiaAR(f));
    const nombre = `informe-ventas_${rango.length ? rango.join("_al_") : "completo"}_${ahora}.xlsx`;
    const carpeta = path.join(ROOT, "informes");
    fs.mkdirSync(carpeta, { recursive: true });
    const archivo = path.join(carpeta, nombre);
    fs.writeFileSync(archivo, Buffer.from(await generarReporteExcel(filas)));
    res.json({ archivo, ventas: filas.length });
  } catch (err) {
    res.status(500).json({ error: `No se pudo guardar el informe: ${err.message}` });
  }
});

app.post("/api/facturas/:id/retomar", (req, res, next) => encolarVenta(async () => {
  if (sale.fase !== "idle") return res.status(409).json({ error: "Terminá la venta actual antes de retomar una cobranza." });
  const v = (await readLog("ventas.jsonl")).find(v => String(v.idComprobante) === req.params.id && comprobanteEmitido(v.factura) && (config.mode === "mock" || Boolean(v.prueba) === config.facturacionSimulada));
  const registro = (await readLog("cobranzas.jsonl")).filter(c => String(c.idComprobante) === req.params.id).at(-1);
  const cobranza = registro || v?.cobranza;
  if (!v || cobranza?.modalidad !== "manual" || cobranza.estado !== "pendiente") return res.status(409).json({ error: "La factura no tiene una cobranza manual pendiente disponible." });
  await editarVenta(venta => {
    venta.factura = { ...v.factura, cobranza };
    venta.restaurar({
      sessionId: v.sessionId || sale.sessionId, lines: v.venta?.lines || [], inicio: v.venta?.inicio,
      metodoPago: v.metodoPago, cliente: v.cliente, fase: "cobranza",
    });
  });
  broadcast();
  res.json({ ok: true });
}).catch(next));

// Informes comerciales: únicamente datos verificables del mostrador.
app.get('/api/comercial', async (req,res,next) => {try {
 const ventas=sinProductosPrueba(await readLog('ventas.jsonl'),config.productosPruebaIds);
 const cobros=await readLog('cobranzas.jsonl'),productos=[...productsById.values()],opciones={...readJson('reposicion.json',{}),stockActualizado:catalogo.actualizado,incluirPruebas:config.preview};
 if([req.query.desde,req.query.hasta].some(f=>f&&(!/^\d{4}-\d{2}-\d{2}$/.test(f)||!Number.isFinite(Date.parse(f))))||req.query.desde&&req.query.hasta&&req.query.desde>req.query.hasta)return res.status(400).json({error:'Elegí un rango de fechas válido.'});
 const actual=informeComercial(ventas,cobros,productos,{desde:req.query.desde,hasta:req.query.hasta},opciones);
 if(req.query.desde&&req.query.hasta){const inicio=Date.parse(req.query.desde),fin=Date.parse(req.query.hasta),duracion=fin-inicio+86400000;if(Number.isFinite(duracion)&&duracion>0){const iso=t=>new Date(t).toISOString().slice(0,10);actual.comparacion=compararComercial(actual,informeComercial(ventas,cobros,productos,{desde:iso(inicio-duracion),hasta:iso(inicio-86400000)},opciones));}}
 if(req.query.formato==='xlsx'){res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition','attachment; filename=analisis-comercial.xlsx');return res.send(Buffer.from(await exportarComercial(actual)));}
 await colaEventos;
 actual.recomendaciones=analizarRecomendaciones(await readLog('recomendaciones-eventos.jsonl'),ventas.map(v=>({...v,cobranza:cobros.filter(c=>String(c.idComprobante)===String(v.idComprobante)).at(-1)||v.cobranza})),actual.periodo);
 res.json(actual);
} catch(e){next(e);}});
app.post('/api/comercial/actualizar',async (_req,res,next)=>{try{await actualizarCatalogo();res.json({ok:!errorCatalogo,error:errorCatalogo});}catch(e){next(e);}});
app.put('/api/comercial/reposicion',async(req,res,next)=>{try{const {ventana,objetivo}=req.body;if(!Number.isInteger(ventana)||ventana<1||ventana>365||!Number.isInteger(objetivo)||objetivo<1||objetivo>365)return res.status(400).json({error:'Ingresá días entre 1 y 365.'});await writeJson('reposicion.json',{ventana,objetivo});res.json({ok:true});}catch(e){next(e);}});
app.get('/api/carritos',(_req,res)=>res.json(readJson('carritos.json',[])));
let colaCarritos=Promise.resolve();
app.use('/api/carritos', (req,res,next)=>{if(req.method==='GET')return next();const trabajo=colaCarritos.then(()=>new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);next();}));colaCarritos=trabajo.catch(()=>{});});
app.post('/api/carritos',async(req,res,next)=>{try{const c=capturarCarrito(sale,req.body.referencia);await writeJson('carritos.json',[...readJson('carritos.json',[]),c]);res.json(c);}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/carritos/:id',async(req,res,next)=>{try{const referencia=String(req.body.referencia||'').trim();if(!referencia||referencia.length>120)return res.status(400).json({error:'Referencia inválida.'});const lista=readJson('carritos.json',[]);const c=lista.find(c=>c.id===req.params.id);if(!c)return res.sendStatus(404);c.referencia=referencia;await writeJson('carritos.json',lista);res.json(c);}catch(e){next(e);}});
app.delete('/api/carritos/:id',async(req,res,next)=>{try{await writeJson('carritos.json',readJson('carritos.json',[]).filter(c=>c.id!==req.params.id));res.json({ok:true});}catch(e){next(e);}});
app.post('/api/carritos/:id/recuperar', (req, res) => encolarVenta(async () => {
  const carrito = readJson('carritos.json', []).find(c => c.id === req.params.id);
  if (!carrito) return res.sendStatus(404);
  if (!["idle", "venta", "gracias"].includes(sale.fase)) return res.status(409).json({ error: "Terminá la operación actual antes de recuperar un carrito." });
  const cambios = await editarVenta(venta => recuperarCarrito(venta, carrito, productsById, req.body.reemplazar === true));
  broadcast();
  res.json({ ok: true, cambios });
}).catch(e => res.status(400).json({ error: e.message })));

// ---------- Frontend ----------
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

server.listen(config.port, config.preview ? "127.0.0.1" : "0.0.0.0", () => {
  console.log(`Mostrador PC MIDI en http://localhost:${config.port}  (catálogo: ${config.mode === "real" ? "Contabilium" : "de prueba"} · facturas: ${config.facturacionSimulada ? "SIMULADAS" : "REALES"} · datos: ${almacenamiento} · acceso: ${config.claveAcceso ? "con contraseña" : "SIN contraseña"})`);
  console.log(`  Vendedor: http://localhost:${config.port}/vendedor`);
  console.log(`  Cliente:  http://localhost:${config.port}/cliente`);
  console.log(`  Ajustes:  http://localhost:${config.port}/admin`);
});

actualizarCatalogo();
setInterval(actualizarCatalogo, config.catalogRefreshMinutes * 60_000);

// Tienda online: precios al arrancar y cada 30 min; lectura completa (categorías y fotos) una vez por día.
const intervaloCompleto = config.tiendaRefreshMinutes * 60_000;
const ultimaCompleta = Date.parse(estadoTienda().completo || 0) || 0;
actualizarTienda({ completa: Date.now() - ultimaCompleta > intervaloCompleto });
setInterval(() => actualizarTienda(), config.preciosRefreshMinutes * 60_000);
setInterval(() => actualizarTienda({ completa: true }), intervaloCompleto);

// Opiniones de Mercado Libre: una vez por semana. La fecha de la última búsqueda queda guardada en la base,
// así que reiniciar o redesplegar el servidor no la repite: se revisa al arrancar (con el catálogo ya cargado) y cada hora.
if (config.mode === "real" && reviewsPublisher.status().configured) {
  const buscarSiToca = () => {
    if (reviewsPublisher.meliDue()) reviewsPublisher.importMeli().catch((err) => console.error("[reseñas] Mercado Libre:", err.message));
  };
  setTimeout(buscarSiToca, 2 * 60_000);
  setInterval(buscarSiToca, 60 * 60_000);
}
