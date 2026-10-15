import assert from "node:assert/strict";
import test from "node:test";
import { Sale } from "./sale.js";

const settings = { descuentoContadoPct: 5, margenMinimoPct: 0 };
const productos = [
  { id: "1", nombre: "Pedal", precioFinal: 25000 },
  { id: "2", nombre: "Teclado", precioFinal: 250000 },
  { id: "3", nombre: "Funda", precioFinal: 30000 },
];
const porId = new Map(productos.map((p) => [p.id, p]));
const marcas = (sale) => sale.snapshot(porId, [], settings).lines.map((l) => [l.nombre, l.crossSelling, l.crossSellingManual]);

test("Venta: lo que se suma al producto más caro queda como cross-selling, y el vendedor lo puede cambiar", () => {
  const sale = new Sale();
  for (const p of productos) sale.agregar(p);
  assert.deepEqual(marcas(sale), [["Pedal", true, false], ["Teclado", false, false], ["Funda", true, false]]);
  const [pedal, teclado] = sale.lines;
  sale.marcarCrossSelling(pedal.lineId, false);
  sale.marcarCrossSelling(teclado.lineId, true);
  assert.deepEqual(marcas(sale), [["Pedal", false, true], ["Teclado", true, true], ["Funda", true, false]]);
  sale.marcarCrossSelling(pedal.lineId, null);
  assert.equal(marcas(sale)[0][1], true);
});
