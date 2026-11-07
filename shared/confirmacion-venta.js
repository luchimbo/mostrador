// Identifica el detalle que el vendedor revisó antes de emitir el comprobante.
export function detalleConfirmado({ lines, totales, metodoPago, sinFactura, transferencia }) {
  return JSON.stringify([
    lines.map(({ lineId, productId, nombre, cantidad, precioFinal, iva, descuentoPct, total }) => (
      [lineId, productId, nombre, cantidad, precioFinal, iva, descuentoPct, total]
    )),
    totales.descuentoContado,
    totales.totalAPagar,
    metodoPago,
    sinFactura,
    transferencia,
  ]);
}
