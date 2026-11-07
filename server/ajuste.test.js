import assert from "node:assert/strict";
import { test } from "node:test";
import { armarComprobante } from "./invoice.js";
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

test("El total y el comprobante usan los precios de catálogo y el descuento de contado", () => {
  const sale = ventaEnEfectivo();
  const snap = sale.snapshot(new Map(), [], settings);
  assert.equal(snap.totales.totalAPagar, 323456.77);

  const { Items } = armarComprobante({
    lines: snap.lines,
    metodoPago: snap.metodoPago,
    totales: { ajuste: -3456.77, totalAPagar: 320000 },
    idCliente: 1,
    tipoFc: "FCB",
    settings,
  });
  assert.deepEqual(Items.map(i => i.PrecioUnitario), [260983.03, 11172.55]);
  assert.ok(Items.every(i => i.Bonificacion === 5));
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
  const { Items, CondicionVenta } = armarComprobante({ lines: snap.lines, metodoPago: "mercadopago", transferencia: true, idCliente: 1, tipoFc: "FCB", settings });
  assert.equal(CondicionVenta, "MercadoPago");
  assert.equal(Items[0].Bonificacion, 5);
  sale.setMetodoPago("efectivo");
  assert.equal(sale.transferencia, false);
  assert.throws(() => sale.setTransferencia(true), /MercadoPago/);
});
