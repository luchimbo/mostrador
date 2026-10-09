import assert from "node:assert/strict";
import { test } from "node:test";
import { armarComprobante } from "./invoice.js";
import { repartirTotal } from "./pricing.js";
import { Sale } from "./sale.js";
import { DEFAULT_SETTINGS } from "./store.js";

const settings = { ...DEFAULT_SETTINGS, descuentoContadoPct: 5 };
const teclado = { id: "1", codigo: "A1", nombre: "Teclado", precioFinal: 315789.47, iva: 21 };
const pedal = { id: "2", codigo: "A2", nombre: "Pedal", precioFinal: 12345.67, iva: 10.5 };

function ventaEnEfectivo() {
  const sale = new Sale();
  sale.agregar(teclado);
  sale.agregar(pedal);
  sale.agregar(pedal);
  sale.setMetodoPago("efectivo");
  return sale;
}

test("Total ajustado: redondea el total a pagar y se borra al cambiar la venta", () => {
  const sale = ventaEnEfectivo();
  const sinAjuste = sale.totales(settings).totalAPagar;
  sale.ajustarTotal(320000, settings);
  const t = sale.totales(settings);
  assert.equal(t.totalAPagar, 320000);
  assert.equal(t.totalSinAjuste, sinAjuste);
  assert.equal(t.ajuste, Math.round((320000 - sinAjuste) * 100) / 100);
  sale.cambiarCantidad(sale.lines[1].lineId, 1);
  assert.equal(sale.totalAjustado, null);
});

test("Total ajustado: no puede superar el total ni ser cero", () => {
  const sale = ventaEnEfectivo();
  assert.throws(() => sale.ajustarTotal(999999999, settings), /no puede superar/);
  assert.throws(() => sale.ajustarTotal(0, settings), /válido/);
  sale.ajustarTotal(320000, settings);
  sale.ajustarTotal("", settings);
  assert.equal(sale.totalAjustado, null);
});

test("Total ajustado: la factura suma exactamente el total escrito", () => {
  const sale = ventaEnEfectivo();
  sale.ajustarTotal(320000, settings);
  const snap = sale.snapshot(new Map(), [], settings);
  assert.equal(repartirTotal(snap.lines, 5, 320000).reduce((a, b) => a + b, 0).toFixed(2), "320000.00");
  const { Items } = armarComprobante({ lines: snap.lines, metodoPago: "efectivo", totales: snap.totales, idCliente: 1, tipoFc: "FCB", settings });
  const total = Items.reduce((a, i) => a + i.Cantidad * i.PrecioUnitario * (1 + i.Iva / 100) * (1 - i.Bonificacion / 100), 0);
  assert.ok(Math.abs(total - 320000) < 0.05, `total facturado ${total}`);
  assert.ok(Items.every((i) => i.Bonificacion === 0));
});

test("Transferencia por MercadoPago: condición MercadoPago con descuento de contado", () => {
  const sale = new Sale();
  sale.agregar(teclado);
  sale.setMetodoPago("mercadopago");
  const tarjeta = sale.totales(settings);
  assert.equal(tarjeta.aplicaContado, false);
  sale.setTransferencia(true);
  const transferencia = sale.totales(settings);
  assert.equal(transferencia.aplicaContado, true);
  assert.equal(transferencia.totalAPagar, transferencia.totalContado);
  const snap = sale.snapshot(new Map(), [], settings);
  const { Items, CondicionVenta } = armarComprobante({ lines: snap.lines, metodoPago: "mercadopago", transferencia: true, totales: snap.totales, idCliente: 1, tipoFc: "FCB", settings });
  assert.equal(CondicionVenta, "MercadoPago");
  assert.equal(Items[0].Bonificacion, 5);
  sale.setMetodoPago("efectivo");
  assert.equal(sale.transferencia, false);
  assert.throws(() => sale.setTransferencia(true), /MercadoPago/);
});
