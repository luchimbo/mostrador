import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { Server } from "socket.io";
import { config, ROOT } from "./config.js";
import * as contabilium from "./contabilium.js";
import { facturar } from "./invoice.js";
import * as mock from "./mock.js";
import { Sale } from "./sale.js";
import { appendLog, getSettings, readJson, readLog, saveSettings, writeJson } from "./store.js";
import { actualizarPreciosTienda, combinarConTienda, estadoTienda, sincronizarTienda, tiendaSinContabilium } from "./tiendanube.js";
import { productosEnReposo } from "../shared/display.js";
import { incluirProductosPrueba } from "./catalog.js";
import { comprobanteEmitido, registrarCobranza } from "./cobranza.js";
import { filasReporte, generarReporteExcel } from "./reporte.js";

const backend = config.mode === "real" ? contabilium : mock;
const facturador = config.facturacionSimulada ? mock : contabilium;

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
    writeJson("catalogo.json", catalogo);
    if (reglasPendientes) {
      reglas = mock.reglasInicialesReales([...productsById.values()]);
      writeJson("reglas.json", reglas);
      reglasPendientes = false;
    }
    errorCatalogo = null;
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
  if (!reglasPendientes) writeJson("reglas.json", reglas);
}
let destacados = readJson("destacados.json", config.mode === "mock" ? ["102", "202", "301", "502", "701"] : []);

// ---------- Venta en curso ----------
const sale = new Sale();
const recuperada = readJson("factura-en-cobranza.json", null);
if (comprobanteEmitido(recuperada) && recuperada.cobranza?.modalidad === "manual") {
  sale.factura = recuperada;
  sale.cliente = recuperada.cliente;
  sale.fase = "cobranza";
  sale.lines = recuperada.lineas || [];
  sale.metodoPago = recuperada.metodoPago;
  sale.inicio = recuperada.inicio;
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
  timerGracias = setTimeout(() => { if (sale.fase === "gracias") { sale.reset(); broadcast(); } }, 45_000);
}

function guardarFacturaEnCobranza(factura = sale.factura) {
  writeJson("factura-en-cobranza.json", { ...factura, lineas: sale.lines, inicio: sale.inicio });
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
  const settings = getSettings();
  return {
    ...sale.snapshot(productsById, reglas, settings),
    modo: config.mode,
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
    opinionUrl: settings.opinionUrl,
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

function broadcast() {
  io.emit("estado", estado());
}

function producto(id) {
  const p = productsById.get(String(id));
  if (!p) throw new Error("Producto no encontrado en el catálogo.");
  return p;
}

async function accionFacturar(datosCliente) {
  if (sale.fase === "facturando") throw new Error("Ya se está emitiendo una factura.");
  if (comprobanteEmitido(sale.factura)) throw new Error("Esta venta ya tiene un comprobante emitido. Iniciá una nueva venta.");
  if (sale.comprobantePendiente) throw new Error(`Revisá el comprobante ${sale.comprobantePendiente} en Contabilium antes de iniciar otra emisión.`);
  const settings = getSettings();
  const snapshot = sale.snapshot(productsById, reglas, settings);
  sale.fase = "facturando";
  sale.error = null;
  broadcast();
  try {
    const res = await facturar({ backend: facturador, snapshot, datosCliente, settings });
    if (res.necesitaDatos) {
      sale.fase = "venta";
      return res;
    }
    sale.factura = res;
    sale.cliente = res.cliente;
    if (res.cobranza?.modalidad === "manual") guardarFacturaEnCobranza(res);
    appendLog("ventas.jsonl", {
      fecha: new Date().toISOString(),
      inicio: sale.inicio,
      numero: res.numero,
      idComprobante: res.idComprobante,
      cae: res.cae,
      cliente: res.cliente,
      url: res.url,
      cobranza: res.cobranza,
      total: res.total,
      ajusteTotal: snapshot.totales.ajuste || 0,
      metodoPago: snapshot.metodoPago,
      transferencia: snapshot.metodoPago === "mercadopago" && snapshot.transferencia,
      tipo: res.tipo,
      condicionVenta: res.condicionVenta,
      prueba: res.prueba,
      factura: res,
      venta: { lines: sale.lines, inicio: sale.inicio },
      lineas: snapshot.lines.map((l) => ({ productId: l.productId, nombre: l.nombre, cantidad: l.cantidad, total: l.total, reglaId: l.reglaId })),
      sugerenciasMostradas: [...sale.sugerenciasMostradas],
    });
    if (res.cobranza?.modalidad === "manual") sale.fase = "cobranza";
    else finalizarVenta();
    return { ok: true, factura: res };
  } catch (err) {
    sale.fase = comprobanteEmitido(sale.factura) ? "cobranza" : "venta";
    sale.error = err.message;
    if (err.idComprobante) {
      sale.comprobantePendiente = err.idComprobante;
      appendLog("facturas-pendientes.jsonl", {
        fecha: new Date().toISOString(), idComprobante: err.idComprobante,
        error: err.message, total: snapshot.totales.totalAPagar, metodoPago: snapshot.metodoPago,
      });
    }
    throw err;
  }
}

async function accionCobrar({ pagos }) {
  if (sale.fase !== "cobranza" || !sale.factura) throw new Error("No hay una factura pendiente de cobranza en esta venta.");
  sale.fase = "cobrando";
  sale.error = null;
  broadcast();
  try {
    const cobranza = await registrarCobranza({ factura: sale.factura, pagos, destinos: destinosCobranza(), backend: facturador,
      antesDeEnviar: () => {
        // Persistir el intento antes de mover dinero para no repetirlo tras un reinicio.
        guardarFacturaEnCobranza({ ...sale.factura, cobranza: { ...sale.factura.cobranza, estado: "revisar" } });
      },
    });
    sale.factura.cobranza = cobranza;
    appendLog("cobranzas.jsonl", { idComprobante: sale.factura.idComprobante, ...cobranza });
    writeJson("factura-en-cobranza.json", null);
    finalizarVenta();
    return { cobranza };
  } catch (err) {
    if (err.cobranzaIncierta || sale.factura.cobranza.estado === "registrada") {
      sale.factura.cobranza.estado = "revisar";
      appendLog("cobranzas.jsonl", { idComprobante: sale.factura.idComprobante, ...sale.factura.cobranza });
    }
    guardarFacturaEnCobranza();
    sale.fase = "cobranza";
    sale.error = err.message;
    throw err;
  }
}

const ACCIONES = {
  agregar: ({ productId, reglaId }) => sale.agregar(producto(productId), { reglaId }),
  cantidad: ({ lineId, cantidad }) => sale.cambiarCantidad(lineId, Number(cantidad)),
  quitar: ({ lineId }) => sale.quitar(lineId),
  metodoPago: ({ metodo }) => sale.setMetodoPago(metodo),
  sinFactura: ({ valor }) => sale.setSinFactura(valor),
  transferencia: ({ valor }) => sale.setTransferencia(valor),
  ajustarTotal: ({ total }) => sale.ajustarTotal(total, getSettings()),
  cancelar: () => {
    if (["facturando", "cobrando"].includes(sale.fase)) throw new Error("Esperá a que termine la operación en curso.");
    writeJson("factura-en-cobranza.json", null);
    sale.reset();
  },
  facturar: (datos) => accionFacturar(datos),
  cobrar: (datos) => accionCobrar(datos),
};

io.on("connection", (socket) => {
  socket.emit("estado", estado());
  socket.on("accion", async (msg, ack = () => {}) => {
    const fn = ACCIONES[msg?.tipo];
    try {
      if (!fn) throw new Error(`Acción desconocida: ${msg?.tipo}`);
      if (["cantidad", "quitar", "metodoPago", "sinFactura", "transferencia", "ajustarTotal"].includes(msg.tipo) && ["facturando", "cobranza", "cobrando"].includes(sale.fase)) throw new Error("Terminá la factura y cobranza antes de modificar la venta.");
      const res = await fn(msg);
      ack({ ok: true, ...(res || {}) });
    } catch (err) {
      ack({ ok: false, error: err.message });
    } finally {
      broadcast();
    }
  });
});

// ---------- API REST para el panel de administración ----------
app.use(express.json());

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
app.get("/api/tienda/faltantes", (_req, res) => res.json(tiendaSinContabilium(catalogo.productos)));

app.get("/api/reglas", (_req, res) => res.json(reglas));
app.put("/api/reglas", (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: "Se esperaba una lista de reglas." });
  reglas = req.body;
  writeJson("reglas.json", reglas);
  broadcast();
  res.json(reglas);
});

app.get("/api/destacados", (_req, res) => res.json(destacados));
app.put("/api/destacados", (req, res) => {
  destacados = Array.isArray(req.body) ? req.body.map(String) : [];
  writeJson("destacados.json", destacados);
  broadcast();
  res.json(destacados);
});

app.get("/api/ajustes", (_req, res) => res.json(getSettings()));
app.put("/api/ajustes", (req, res) => {
  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") return res.status(400).json({ error: "Se esperaba un objeto de ajustes." });
  try {
    const next = saveSettings(req.body || {});
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

app.get("/api/metricas", (_req, res) => {
  const ventas = readLog("ventas.jsonl").filter((v) => !v.prueba || config.facturacionSimulada);
  const porRegla = {};
  for (const regla of reglas) porRegla[regla.id] = { nombre: regla.nombre, mostradas: 0, aceptadas: 0, ingresos: 0 };
  for (const v of ventas) {
    for (const key of v.sugerenciasMostradas || []) {
      const [reglaId] = key.split(":");
      if (porRegla[reglaId]) porRegla[reglaId].mostradas++;
    }
    for (const l of v.lineas) {
      if (l.reglaId && porRegla[l.reglaId]) {
        porRegla[l.reglaId].aceptadas++;
        porRegla[l.reglaId].ingresos += l.total;
      }
    }
  }
  res.json({
    ventas: ventas.length,
    facturado: ventas.reduce((a, v) => a + v.total, 0),
    porRegla: Object.entries(porRegla).map(([id, m]) => ({ id, ...m })),
  });
});

app.get("/api/facturas", (_req, res) => {
  const cobranzas = new Map(readLog("cobranzas.jsonl").map(c => [String(c.idComprobante), c]));
  res.json(readLog("ventas.jsonl").filter((v) => !v.prueba || config.facturacionSimulada).slice(-500).reverse().map((v) => ({
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

// El informe se guarda en la carpeta "informes" del mostrador (no se sube a GitHub).
app.post("/api/reporte", async (req, res) => {
  try {
    const { desde, hasta } = req.body || {};
    const ventas = readLog("ventas.jsonl").filter((v) => !v.prueba || config.facturacionSimulada);
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

app.post("/api/facturas/:id/retomar", (req, res) => {
  if (sale.fase !== "idle") return res.status(409).json({ error: "Terminá la venta actual antes de retomar una cobranza." });
  const v = readLog("ventas.jsonl").find(v => String(v.idComprobante) === req.params.id && comprobanteEmitido(v.factura) && (!v.prueba || config.facturacionSimulada));
  const registro = readLog("cobranzas.jsonl").filter(c => String(c.idComprobante) === req.params.id).at(-1);
  const cobranza = registro || v?.cobranza;
  if (!v || cobranza?.modalidad !== "manual" || cobranza.estado !== "pendiente") return res.status(409).json({ error: "La factura no tiene una cobranza manual pendiente disponible." });
  sale.factura = { ...v.factura, cobranza };
  sale.lines = v.venta?.lines || [];
  sale.inicio = v.venta?.inicio;
  sale.metodoPago = v.metodoPago;
  sale.cliente = v.cliente;
  sale.fase = "cobranza";
  guardarFacturaEnCobranza();
  broadcast();
  res.json({ ok: true });
});

// ---------- Frontend ----------
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

server.listen(config.port, () => {
  console.log(`Mostrador PC MIDI en http://localhost:${config.port}  (catálogo: ${config.mode === "real" ? "Contabilium" : "de prueba"} · facturas: ${config.facturacionSimulada ? "SIMULADAS" : "REALES"})`);
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
