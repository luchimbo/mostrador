// Arma y emite la factura electrónica en Contabilium a partir de la venta en curso.
import { config } from "./config.js";
import { clasificarDocumento, formatearDocumento, tipoFactura } from "./documento.js";
import { combinarDescuentos, esContado, repartirTotal, round2 } from "./pricing.js";
import { importeContabilium } from "./cobranza.js";

// Venta en efectivo sin factura: Ventas → Facturación con tipo de comprobante Cotización.
export const TIPO_COTIZACION = "COT";

// Valores de prueba. El backend real resuelve la condición y destino en la cuenta.
const CONDICION_VENTA = {
  mercadopago: "MercadoPago",
  otros: "Otro",
  efectivo: "Efectivo",
  transferencia: "Efectivo",
  debito: "MercadoPago",
  credito: "MercadoPago",
};

export function normalizarCondicionIva(valor) {
  const v = String(valor || "").toUpperCase();
  if (v === "RI" || v.includes("INSCRIPTO")) return "RI";
  if (v === "MO" || v.includes("MONOTRIBUT")) return "MO";
  if (v === "EX" || v.includes("EXENTO")) return "EX";
  return "CF";
}

async function resolverCliente(backend, datos, { sinFactura = false } = {}) {
  // Sin factura el documento es opcional: se usa el cliente "Consumidor Final" genérico.
  if (sinFactura && !String(datos.documento || "").replace(/\D/g, "")) {
    const id = config.contabilium.idClienteConsumidorFinal;
    if (!id && !config.facturacionSimulada) throw new Error("Falta configurar CONTABILIUM_ID_CLIENTE_CF en el archivo .env para ventas sin documento.");
    return { id, nombre: "Consumidor Final", condicionIva: "CF", documentoTexto: "" };
  }
  const doc = clasificarDocumento(datos.documento);

  if (!["CF", "RI", "MO", "EX"].includes(datos.condicionIva)) throw new Error("Elegí la condición frente al IVA del cliente.");
  const condicionIva = datos.condicionIva;
  if (["RI", "MO"].includes(condicionIva) && doc.tipo !== "CUIT") throw new Error("Para facturar a un Responsable Inscripto o Monotributista, ingresá su CUIT.");

  const existente = await backend.buscarClientePorDocumento(doc.documento);
  if (existente) {
    const registrada = normalizarCondicionIva(existente.CondicionIva);
    if (registrada !== condicionIva) {
      const etiquetas = { CF: "Consumidor Final", RI: "Responsable Inscripto", MO: "Monotributista", EX: "Exento" };
      throw new Error(`El cliente está registrado como ${etiquetas[registrada]}. Seleccioná esa condición o corregí sus datos en Contabilium.`);
    }
    return {
      id: existente.Id ?? existente.id,
      nombre: existente.RazonSocial || existente.NombreFantasia || datos.nombre || "",
      condicionIva,
      documentoTexto: formatearDocumento(doc),
    };
  }

  // Cliente nuevo. Con CUIT necesitamos razón social y condición frente al IVA.
  if (doc.tipo === "CUIT" && !String(datos.nombre || "").trim()) {
    return { necesitaDatos: true, documentoTexto: formatearDocumento(doc) };
  }
  const nombre = (datos.nombre || "").trim() || "Consumidor Final";
  const id = await backend.crearCliente({
    razonSocial: nombre,
    tipoDoc: doc.tipo,
    documento: doc.documento,
    condicionIva,
    email: datos.email,
  });
  return { id, nombre, condicionIva, documentoTexto: formatearDocumento(doc) };
}

export function armarComprobante({ lines, metodoPago, transferencia = false, totales, idCliente, tipoFc, settings, cobro }) {
  if (!["FCA", "FCB", TIPO_COTIZACION].includes(tipoFc)) throw new Error("Tipo de comprobante inválido para Contabilium.");
  const pctContado = esContado(metodoPago, { transferencia }) ? settings.descuentoContadoPct : 0;
  // Con total ajustado, cada línea lleva el precio final que le toca y sin bonificación.
  const ajustadas = totales?.ajuste ? repartirTotal(lines, pctContado, totales.totalAPagar) : null;
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
  return {
    IdCliente: idCliente,
    TipoFc: tipoFc,
    PuntoVenta: config.contabilium.puntoVenta,
    Inventario: cobro?.inventario ?? config.contabilium.inventario,
    IDMoneda: cobro?.idMoneda ?? null,
    Modo: "E",
    CondicionVenta: cobro?.condicionVenta ?? CONDICION_VENTA[metodoPago],
    TipoConcepto: 1, // productos
    FechaEmision: `${hoy}T00:00:00`,
    FechaVencimiento: `${hoy}T00:00:00`,
    Observaciones: tipoFc === TIPO_COTIZACION ? "Venta en mostrador sin factura" : "Venta en mostrador",
    Items: lines.map((l, i) => ({
      IdConcepto: Number(l.productId) || null,
      Codigo: l.codigo || "",
      Concepto: l.nombreFactura || l.nombre,
      Cantidad: l.cantidad,
      PrecioUnitario: round2((ajustadas ? ajustadas[i] / l.cantidad : l.precioFinal) / (1 + l.iva / 100)), // neto sin IVA
      Iva: l.iva,
      Bonificacion: ajustadas ? 0 : combinarDescuentos(l.descuentoPct, pctContado),
    })),
    Pagos: null,
  };
}

// Devuelve { necesitaDatos } si falta información del cliente, o la factura emitida.
export async function facturar({ backend, snapshot, datosCliente, settings }) {
  if (!snapshot.lines.length) throw new Error("No hay productos en la venta.");
  if (!snapshot.metodoPago) throw new Error("Elegí el medio de pago.");
  const sinFactura = Boolean(snapshot.sinFactura);
  if (sinFactura && snapshot.metodoPago !== "efectivo") throw new Error("La venta sin factura es solo para Efectivo.");
  if (!config.facturacionSimulada && !config.contabilium.puntoVenta) {
    throw new Error("Falta configurar CONTABILIUM_PUNTO_VENTA en el archivo .env");
  }

  // Validar modalidad de cobranza y depósito antes de crear comprobantes.
  const cobro = backend.obtenerConfiguracionFacturacion
    ? await backend.obtenerConfiguracionFacturacion(snapshot.metodoPago)
    : undefined;
  const cliente = await resolverCliente(backend, datosCliente, { sinFactura });
  if (cliente.necesitaDatos) return cliente;

  const tipoFc = sinFactura ? TIPO_COTIZACION : tipoFactura(cliente.condicionIva);
  const payload = armarComprobante({
    lines: snapshot.lines,
    metodoPago: snapshot.metodoPago,
    transferencia: snapshot.metodoPago === "mercadopago" && Boolean(snapshot.transferencia),
    totales: snapshot.totales,
    idCliente: cliente.id,
    tipoFc,
    settings,
    cobro,
  });

  if (sinFactura) return registrarCotizacion({ backend, snapshot, payload, cliente });

  const res = cobro?.automatico
    ? await backend.emitirFacturaCobrada(payload)
    : await backend.emitirFactura(payload);
  if (!res.cae) {
    const err = new Error(
      `ARCA no autorizó la factura${res.errores ? `: ${res.errores}` : ""}. ` +
        (res.idComprobante ? `Comprobante creado: ${res.idComprobante}. ` : "") +
        "Revisá en Contabilium si quedó un borrador antes de volver a intentar.",
    );
    err.idComprobante = res.idComprobante;
    throw err;
  }
  let totalEmitido = snapshot.totales.totalAPagar;
  if (res.total !== undefined && res.total !== null) {
    try { const confirmado = importeContabilium(res.total); if (Number.isFinite(confirmado) && confirmado > 0) totalEmitido = round2(confirmado); } catch { /* El saldo se verifica antes de cobrar. */ }
  }
  return {
    tipo: tipoFc === "FCA" ? "Factura A" : "Factura B",
    numero: res.numero,
    cae: res.cae,
    url: res.url,
    idComprobante: res.idComprobante,
    total: totalEmitido,
    cliente: { nombre: cliente.nombre, documento: cliente.documentoTexto },
    advertencia: res.errores || res.observaciones || null,
    cobranza: cobro?.automatico
      ? { estado: res.errores ? "revisar" : "registrada", modalidad: "automatica" }
      : { estado: "pendiente", modalidad: "manual" },
    condicionVenta: payload.CondicionVenta,
    metodoPago: snapshot.metodoPago,
    prueba: config.facturacionSimulada,
  };
}

// La cotización no va a ARCA: se crea el comprobante y queda con cobranza manual, igual que Efectivo.
async function registrarCotizacion({ backend, snapshot, payload, cliente }) {
  const res = await backend.emitirCotizacion(payload);
  let total = snapshot.totales.totalAPagar;
  if (res.total !== undefined && res.total !== null) {
    try { const confirmado = importeContabilium(res.total); if (Number.isFinite(confirmado) && confirmado > 0) total = round2(confirmado); } catch { /* El saldo se verifica antes de cobrar. */ }
  }
  return {
    tipo: "Cotización",
    tipoFc: TIPO_COTIZACION,
    cotizacion: true,
    numero: res.numero || `ID ${res.idComprobante}`,
    cae: null,
    url: res.url || "",
    idComprobante: res.idComprobante,
    total,
    cliente: { nombre: cliente.nombre, documento: cliente.documentoTexto },
    advertencia: null,
    cobranza: { estado: "pendiente", modalidad: "manual" },
    condicionVenta: payload.CondicionVenta,
    metodoPago: snapshot.metodoPago,
    prueba: config.facturacionSimulada,
  };
}
