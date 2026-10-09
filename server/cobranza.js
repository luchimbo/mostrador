import { round2 } from "./pricing.js";

// Una factura queda emitida con CAE; una cotización (venta sin factura) no pasa por ARCA.
export const comprobanteEmitido = (f) => Boolean(f?.idComprobante && (f.cae || f.cotizacion));

export function importeContabilium(valor) {
  if (typeof valor === "number") return valor;
  const texto = String(valor ?? "").trim();
  if (!texto) throw new Error("Contabilium no informó el saldo de la factura.");
  const n = Number(texto.includes(",") ? texto.replaceAll(".", "").replace(",", ".") : texto);
  if (!Number.isFinite(n)) throw new Error("El importe informado por Contabilium no es válido.");
  return n;
}

export function armarCobranza(factura, pagos, destinos) {
  if (!comprobanteEmitido(factura) || factura.cobranza?.modalidad !== "manual") throw new Error("Esta factura no admite cobranza manual desde el mostrador.");
  if (factura.cobranza.estado !== "pendiente") throw new Error("Esta cobranza ya fue registrada o requiere revisión.");
  if (!Array.isArray(pagos) || !pagos.length || pagos.length > 10) throw new Error("Agregá los medios utilizados para cobrar.");
  const permitidos = factura.metodoPago === "efectivo" ? ["efectivo", "transferencia"] : ["efectivo", "transferencia", "mercadopago"];
  const detalle = pagos.map((p) => {
    if (!permitidos.includes(p.medio)) throw new Error("Para combinar tarjeta con otros medios, elegí la condición Otros antes de facturar.");
    const destino = destinos.find((d) => d.key === p.destino && d.medios.includes(p.medio));
    if (!destino || (!!destino.idCaja === !!destino.idBanco) || !Number.isSafeInteger(destino.idCaja || destino.idBanco) || (destino.idCaja || destino.idBanco) <= 0) throw new Error("Elegí una caja o cuenta válida para cada medio.");
    const importe = Number(p.importe);
    if (!Number.isFinite(importe) || importe <= 0 || Math.abs(round2(importe) - importe) > 0.000001) throw new Error("Ingresá importes positivos con hasta dos decimales.");
    return { FormaDePago: p.medio === "efectivo" ? "Efectivo" : destino.formaDePago || "Transferencia", IDCaja: destino.idCaja || null, IDBanco: destino.idBanco || null, Importe: importe, NroReferencia: String(p.referencia || "").slice(0, 100) };
  });
  const centavos = detalle.reduce((sum, p) => sum + Math.round(p.Importe * 100), 0);
  if (centavos !== Math.round(factura.total * 100)) throw new Error("La suma de los medios de cobro debe coincidir con el total de la factura.");
  return { Id: factura.idComprobante, ImporteTotalNeto: factura.total.toFixed(2), Saldo: "0", Pagos: detalle };
}

export async function registrarCobranza({ factura, pagos, destinos, backend, antesDeEnviar = () => {} }) {
  const payload = armarCobranza(factura, pagos, destinos);
  const actual = await backend.consultarComprobante(factura.idComprobante);
  if (factura.cotizacion) {
    const tipo = actual?.TipoFc ?? actual?.Tipo;
    if (!actual || (tipo && tipo !== factura.tipoFc) || actual.Cae || actual.CAE) throw new Error("El comprobante de Contabilium no coincide con la cotización registrada. Revisalo antes de cobrar.");
  } else if (String(actual.Cae || actual.CAE || "") !== String(factura.cae)) throw new Error("La factura de Contabilium no coincide con la emitida. Revisala antes de cobrar.");
  const total = importeContabilium(actual.ImporteTotalNeto);
  const saldo = importeContabilium(actual.Saldo);
  if (Math.round(total * 100) !== Math.round(factura.total * 100)) throw new Error("El total de Contabilium difiere del mostrador. Revisá la factura antes de cobrar.");
  if (Math.round(saldo * 100) !== Math.round(total * 100)) throw new Error("La factura ya tiene una cobranza total o parcial en Contabilium. Revisala allí para evitar reemplazar el recibo.");
  await antesDeEnviar();
  try {
    await backend.cobrarComprobante(payload);
  } catch (err) {
    const error = new Error(`No se pudo confirmar el cobro: ${err.message}. Revisá la cobranza en Contabilium antes de volver a intentar.`);
    error.cobranzaIncierta = true;
    throw error;
  }
  return { estado: "registrada", modalidad: "manual", fecha: new Date().toISOString(), pagos: payload.Pagos };
}
