import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { estadisticas, filasReporte, generarReporteExcel, sinProductosPrueba } from "./reporte.js";

const venta = {
  fecha: "2026-10-08T18:43:25.882Z", numero: "0007-00180436", tipo: "Factura B", total: 285000, prueba: false,
  lineas: [
    { productId: "1", nombre: "Teclado", cantidad: 1, total: 250000, reglaId: null },
    { productId: "2", nombre: "Pedal", cantidad: 2, total: 50000, reglaId: "r1" },
  ],
};

test("Informe: separa producto principal y agregados, con el precio cobrado", () => {
  const [fila] = filasReporte([venta]);
  assert.equal(fila.comprobante, "Factura B 0007-00180436");
  assert.equal(fila.principal, "Teclado");
  assert.equal(fila.agregados, "2 × Pedal");
  assert.equal(fila.total, 285000);
  // 5% de contado repartido: 50000 × 0,95
  assert.equal(fila.totalAgregados, 47500);
});

test("Informe: es agregado todo lo que no es el producto principal, venga o no de una recomendación", () => {
  const lineas = [venta.lineas[0], { ...venta.lineas[1], reglaId: null }, { productId: "3", nombre: "Funda", cantidad: 1, total: 30000, reglaId: null }];
  const [fila] = filasReporte([{ ...venta, total: 330000, lineas }]);
  assert.equal(fila.principal, "Teclado");
  assert.equal(fila.agregados, "2 × Pedal + Funda");
  assert.equal(fila.totalAgregados, 80000);
});

test("Informe: el producto más caro es el principal aunque se haya cargado después", () => {
  const lineas = [{ productId: "4", nombre: "Cable", cantidad: 1, total: 20000, reglaId: null }, { productId: "5", nombre: "Minilab 3", cantidad: 1, total: 400000, reglaId: null }];
  const [fila] = filasReporte([{ ...venta, total: 420000, lineas }]);
  assert.equal(fila.principal, "Minilab 3");
  assert.equal(fila.agregados, "Cable");
  assert.equal(fila.totalAgregados, 20000);
  const e = estadisticas([{ ...venta, total: 420000, lineas }]);
  assert.equal(e.agregados, 20000);
  assert.deepEqual(e.cruzados.map((c) => c.nombre), ["Cable"]);
});

test("Informe: compara por precio unitario, no por total de la línea", () => {
  const lineas = [{ productId: "1", nombre: "Teclado", cantidad: 1, total: 250000, reglaId: null }, { productId: "6", nombre: "Pua", cantidad: 300, total: 300000, reglaId: null }];
  const [fila] = filasReporte([{ ...venta, total: 550000, lineas }]);
  assert.equal(fila.principal, "Teclado");
});

test("Informe: los productos de prueba no cuentan", () => {
  const demo = { ...venta, lineas: [{ productId: 26604, nombre: "PRODUCTO DEMO", cantidad: 1, total: 3000, reglaId: null }], total: 3000 };
  assert.deepEqual(sinProductosPrueba([demo, venta], ["26604"]), [venta]);
  // Venta mixta: queda sin la línea de prueba y sin lo que se cobró por ella (5% de contado).
  const [mixta] = sinProductosPrueba([venta], ["2"]);
  assert.deepEqual(mixta.lineas.map((l) => l.nombre), ["Teclado"]);
  assert.equal(mixta.total, 237500);
  assert.deepEqual(sinProductosPrueba([demo], []), [demo]);
});

test("Informe: filtra por fecha", () => {
  assert.equal(filasReporte([venta], { desde: "2026-10-09T03:00:00.000Z" }).length, 0);
  assert.equal(filasReporte([venta], { desde: "2026-10-08T03:00:00.000Z", hasta: "2026-10-09T03:00:00.000Z" }).length, 1);
});

test("Estadísticas: resumen, días, medios, productos y cross-selling", () => {
  const otra = { ...venta, fecha: "2026-10-11T01:00:00.000Z", total: 250000, metodoPago: "mercadopago", lineas: venta.lineas.slice(0, 1) };
  const e = estadisticas([{ ...venta, metodoPago: "efectivo" }, otra]);
  assert.equal(e.ventas, 2);
  assert.equal(e.facturado, 535000);
  assert.equal(e.ticketPromedio, 267500);
  assert.equal(e.agregados, 47500);
  assert.equal(e.conAgregado, 1);
  // 01:00 UTC del 11 es todavía el 10 en Argentina; el 9 no tuvo ventas.
  assert.deepEqual(e.porDia, [{ dia: "2026-10-08", ventas: 1, total: 285000 }, { dia: "2026-10-09", ventas: 0, total: 0 }, { dia: "2026-10-10", ventas: 1, total: 250000 }]);
  assert.deepEqual(e.porMedio.map((m) => [m.medio, m.total]), [["efectivo", 285000], ["mercadopago", 250000]]);
  assert.deepEqual(e.productos, [{ nombre: "Teclado", ventas: 2, unidades: 2, total: 487500 }, { nombre: "Pedal", ventas: 1, unidades: 2, total: 47500 }]);
  assert.deepEqual(e.cruzados, [{ nombre: "Pedal", ventas: 1, unidades: 2, total: 47500 }]);
  assert.equal(estadisticas([venta], { desde: "2026-10-09T03:00:00.000Z" }).ventas, 0);
});

test("Estadísticas: es cross-selling todo lo que no es el producto principal, venga o no de una recomendación", () => {
  const lineas = [venta.lineas[0], { ...venta.lineas[1], reglaId: null }, { productId: "3", nombre: "Funda", cantidad: 1, total: 30000, reglaId: null }];
  const e = estadisticas([{ ...venta, total: 330000, lineas }]);
  assert.equal(e.agregados, 80000);
  assert.deepEqual(e.cruzados.map((c) => c.nombre), ["Pedal", "Funda"]);
});

test("Informe: genera un Excel con encabezados y totales", async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await generarReporteExcel(filasReporte([venta, { ...venta, numero: "0007-2", lineas: venta.lineas.slice(0, 1), total: 237500 }])));
  const hoja = libro.getWorksheet("Ventas");
  assert.deepEqual(hoja.getRow(1).values.slice(1), ["Fecha", "Comprobante", "Producto principal", "Productos agregados", "Precio total", "Precio productos agregados"]);
  assert.equal(hoja.getCell("D3").value, "");
  assert.equal(hoja.getCell("E4").value.result, 522500);
  assert.equal(hoja.getCell("F4").value.result, 47500);
});
