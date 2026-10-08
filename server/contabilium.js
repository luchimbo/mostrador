// Cliente de la API REST de Contabilium (Argentina: https://rest.contabilium.com).
// Auth: OAuth2 client_credentials en POST /token. Las rutas de negocio van bajo /api.
//
// Endpoints usados (ver README, sección "Pendiente de verificar con cuenta real"):
//   GET  /api/conceptos/search      catálogo
//   GET  /api/conceptos/rubros      rubros
//   GET  /api/clientes/search       buscar cliente por documento
//   POST /api/clientes              alta de cliente  (*a verificar*)
//   POST /api/comprobantes/crear + GET /api/comprobantes/emitirFE   factura sin cobranza
//   GET  /api/usuarios/obtenerinfo, /api/puntosdeventa/search   diagnóstico
import { config } from "./config.js";
import { clasificarDocumento, validarCuit } from "./documento.js";

const { baseUrl, clientId, clientSecret } = config.contabilium;

let token = null;
let tokenExpira = 0;

async function obtenerToken(forzar = false) {
  if (!forzar && token && Date.now() < tokenExpira - 5 * 60_000) return token;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan CONTABILIUM_CLIENT_ID / CONTABILIUM_CLIENT_SECRET en el archivo .env");
  }
  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 400 || res.status === 401
        ? "Credenciales de Contabilium inválidas (revisá email de API y API Key)."
        : `Error autenticando con Contabilium (HTTP ${res.status}).`,
    );
  }
  const data = await res.json();
  token = data.access_token;
  tokenExpira = Date.now() + (Number(data.expires_in) || 86_399) * 1000;
  return token;
}

async function request(method, ruta, { params, body } = {}, reintentos = { auth: true, rate: true }) {
  const url = new URL(`${baseUrl}/api${ruta}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await obtenerToken()}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && reintentos.auth) {
    await obtenerToken(true);
    return request(method, ruta, { params, body }, { ...reintentos, auth: false });
  }
  // Solo reintentamos GET ante 429: un POST de factura nunca se repite a ciegas.
  if (res.status === 429 && reintentos.rate && method === "GET") {
    await new Promise((r) => setTimeout(r, 3000));
    return request(method, ruta, { params, body }, { ...reintentos, rate: false });
  }

  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    if (/<html|<!DOCTYPE/i.test(text)) data = "(respuesta HTML)";
  }
  if (!res.ok) {
    const msg = typeof data === "object" ? data.Description || data.Message || JSON.stringify(data) : data;
    if (res.status === 403) throw new Error("Contabilium negó el acceso (403): ¿el plan incluye API?");
    throw new Error(`Contabilium ${method} ${ruta} (HTTP ${res.status}): ${msg}`);
  }
  return data;
}

export const get = (ruta, params) => request("GET", ruta, { params });
export const post = (ruta, body) => request("POST", ruta, { body });
export const consultarComprobante = (id) => get("/comprobantes/", { id });
export const cobrarComprobante = (payload) => request("POST", "/comprobantes/cobrar", { body: payload }, { auth: false, rate: false });

function itemsDe(res) {
  if (Array.isArray(res)) return res;
  return res?.Items || res?.items || [];
}

const num = (v) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// El costo interno puede estar en dólares (IDMoneda). El precio neto en pesos se calcula
// como costo × (1 + rentabilidad), así que el costo en pesos sale de deshacer esa cuenta.
export function costoEnPesos(c, precioNeto) {
  const rentabilidad = num(c.Rentabilidad);
  if (rentabilidad > 0 && precioNeto > 0) return Math.round((precioNeto / (1 + rentabilidad / 100)) * 100) / 100;
  return num(c.CostoInterno ?? c.costoInterno);
}

// Normaliza un concepto de Contabilium al formato interno del mostrador.
export function mapearConcepto(c, rubros) {
  const iva = num(c.Iva ?? c.iva ?? 21);
  const precioNeto = num(c.Precio ?? c.precio);
  const precioFinal = num(c.PrecioFinal ?? c.precioFinal) || precioNeto * (1 + iva / 100);
  return {
    id: String(c.Id ?? c.id),
    codigo: c.Codigo || c.codigo || "",
    nombre: (c.Nombre || c.nombre || "Sin nombre").trim(),
    rubro: rubros.get(Number(c.IdRubro ?? c.idRubro)) || c.Rubro || "Sin rubro",
    precioFinal: Math.round(precioFinal * 100) / 100,
    iva,
    costo: costoEnPesos(c, precioNeto),
    stock: c.StockTotal ?? c.StockActual ?? c.Stock ?? null,
    imagen: c.Foto || c.foto || c.Imagen || null,
    activo: c.Estado ? String(c.Estado).toLowerCase() !== "inactivo" : true,
  };
}

export async function descargarCatalogo() {
  const rubrosRaw = await get("/conceptos/rubros").catch(() => []);
  const rubros = new Map(itemsDe(rubrosRaw).map((r) => [Number(r.Id), r.Nombre]));
  const todos = [];
  for (let page = 1; page <= 20; page++) {
    const res = await get("/conceptos/search", { page, pageSize: 50 });
    const items = itemsDe(res);
    todos.push(...items);
    const totalPages = Number(res?.TotalPage ?? res?.totalPage);
    if (items.length < 50 || (totalPages && page >= totalPages)) break;
  }
  return todos.map((c) => mapearConcepto(c, rubros)).filter((p) => p.activo && p.precioFinal > 0);
}

export function encontrarClientePorDocumento(clientes, entrada) {
  const { tipo, documento } = clasificarDocumento(entrada);
  const limpio = (s) => String(s || "").replace(/\D/g, "");
  const unicos = [...new Map(clientes.map((c) => [String(c.Id ?? c.id), c])).values()];
  let coincidencias = unicos.filter((c) => limpio(c.NroDoc ?? c.nroDoc) === documento);
  // Contabilium puede guardar el CUIL completo de una persona aunque se busque por DNI.
  // Se comprueban el prefijo personal, los ocho dígitos del DNI y el verificador.
  if (!coincidencias.length && tipo === "DNI") {
    coincidencias = unicos.filter((c) => {
      const nro = limpio(c.NroDoc ?? c.nroDoc);
      return /^(20|23|24|27)/.test(nro) && validarCuit(nro) && nro.slice(2, 10) === documento.padStart(8, "0");
    });
  }
  if (coincidencias.length > 1) throw new Error("Hay más de un cliente con ese documento en Contabilium. Revisá los registros antes de facturar.");
  return coincidencias[0] || null;
}

export async function buscarClientePorDocumento(entrada, consultar = get) {
  const { documento } = clasificarDocumento(entrada);
  const clientes = [];
  for (let page = 1; page <= 100; page++) {
    const res = await consultar("/clientes/search", { filtro: documento, page, pageSize: 50 });
    const items = itemsDe(res);
    clientes.push(...items);
    const totalPages = Number(res?.TotalPage ?? res?.totalPage);
    if ((totalPages && page >= totalPages) || (!totalPages && items.length < 50)) {
      return encontrarClientePorDocumento(clientes, documento);
    }
  }
  throw new Error("La búsqueda de clientes devolvió demasiados resultados. No se creó ningún cliente; revisá el documento ingresado.");
}

export async function crearCliente({ razonSocial, tipoDoc, documento, condicionIva, email }) {
  const res = await post("/clientes", {
    RazonSocial: razonSocial,
    TipoDoc: tipoDoc,
    NroDoc: documento,
    CondicionIva: condicionIva, // RI | MO | EX | CF
    Email: email || "",
    Personeria: tipoDoc === "CUIT" && documento.startsWith("3") ? "J" : "F",
  });
  const id = typeof res === "number" ? res : Number(res?.Id ?? res?.id ?? res);
  if (!id) throw new Error("Contabilium no devolvió el ID del cliente creado.");
  return id;
}

const CONDICIONES_COBRO = { mercadopago: "MercadoPago", efectivo: "Efectivo", otros: "Otro", transferencia: "Efectivo", debito: "MercadoPago", credito: "MercadoPago" };
const activo = (v) => v === true || v === 1 || /^(si|sí|true)$/i.test(String(v));

export function configurarCondicionVenta(metodo, condiciones, ajustes = {}) {
  const nombre = ajustes.condicionVenta || CONDICIONES_COBRO[metodo];
  const coincidencias = condiciones.filter((c) => activo(c.Activa) && c.Nombre === nombre);
  if (coincidencias.length !== 1) throw new Error(`Revisá la condición de venta "${nombre}" en Contabilium. No se creó ningún comprobante.`);
  const condicion = coincidencias[0];
  const automatico = ["mercadopago", "debito", "credito"].includes(metodo);
  if (activo(condicion.CobranzaAutomatica) !== automatico) {
    throw new Error(`La condición "${nombre}" debe tener cobranza ${automatico ? "automática" : "manual"} para esta venta. No se creó ningún comprobante.`);
  }
  if (automatico && (!condicion.IdBanco || condicion.IdCaja || !condicion.FormaDePago)) {
    throw new Error(`Revisá la cuenta y forma de cobro de MercadoPago en Contabilium. No se creó ningún comprobante.`);
  }
  return { condicionVenta: condicion.Nombre, automatico };
}

export async function obtenerConfiguracionFacturacion(metodo) {
  const [condiciones, depositos] = await Promise.all([get("/usuarios/condicionesVenta"), get("/inventarios/getDepositos")]);
  const factura = configurarCondicionVenta(metodo, itemsDe(condiciones), { condicionVenta: config.contabilium.condicionesVenta[metodo] });
  const inventario = config.contabilium.inventario;
  if (!itemsDe(depositos).some((d) => Number(d.Id) === inventario && activo(d.Activo))) {
    throw new Error("Falta configurar un depósito activo (CONTABILIUM_INVENTARIO). No se creó ningún comprobante.");
  }
  return { ...factura, inventario };
}

// El destino y la forma de cobro se toman de la condición MercadoPago de la cuenta.
// Pagos null evita enviar un segundo pago además de la cobranza automática.
export async function emitirFacturaCobrada(payload, enviar = post) {
  const res = await enviar("/comprobantes/emitirFECobrada", { ...payload, Pagos: null });
  return {
    idComprobante: res?.idComprobante ?? res?.IdComprobante ?? null,
    cae: res?.cae ?? res?.Cae ?? res?.CAE ?? "",
    numero: res?.numero ?? res?.Numero ?? "",
    url: res?.url ?? res?.Url ?? res?.LinkPublico ?? "",
    errores: res?.errores ?? res?.Errores ?? res?.Error ?? "",
    total: res?.Total ?? res?.total,
  };
}

// Crear borrador y emitir sin registrar una cobranza. Aunque emitirFE es GET,
// tiene efecto fiscal: no reintentar automáticamente ante errores o rate limits.
export async function emitirFactura(payload, api = {
  crear: (p) => post("/comprobantes/crear", p),
  emitir: (id) => request("GET", "/comprobantes/emitirFE", { params: { id } }, { auth: false, rate: false }),
}) {
  const creado = await api.crear({ ...payload, Pagos: null });
  const idComprobante = Number(typeof creado === "object" ? creado?.Id ?? creado?.id ?? creado?.idComprobante ?? creado?.IdComprobante : creado);
  if (!Number.isSafeInteger(idComprobante) || idComprobante <= 0) {
    throw new Error("Contabilium no devolvió el ID del borrador. Revisá los comprobantes antes de volver a intentar.");
  }
  let res;
  try {
    res = await api.emitir(idComprobante);
  } catch (err) {
    const error = new Error(`No se pudo confirmar la emisión del comprobante ${idComprobante}: ${err.message}. Revisalo en Contabilium antes de volver a intentar.`);
    error.idComprobante = idComprobante;
    throw error;
  }
  return {
    idComprobante,
    cae: res?.cae ?? res?.Cae ?? res?.CAE ?? "",
    numero: res?.numero ?? res?.Numero ?? "",
    vencimientoCae: res?.fechaVto ?? res?.FechaVto ?? null,
    url: res?.url ?? res?.Url ?? res?.LinkPublico ?? "",
    errores: res?.Error ?? res?.errores ?? res?.Errores ?? "",
    observaciones: res?.ObservacionesAFIP || "",
    total: res?.Total ?? res?.total,
    cobranza: { estado: "pendiente", modalidad: "manual" },
  };
}
