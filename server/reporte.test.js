import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { estadisticas, filasReporte, generarReporteExcel } from "./reporte.js";

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

test("Informe: filtra por fecha", () => {
  assert.equal(filasReporte([venta], { desde: "2026-10-09T03:00:00.000Z" }).length, 0);
  assert.equal(filasReporte([venta], { desde: "2026-10-08T03:00:00.000Z", hasta: "2026-10-09T03:00:00.000Z" }).length, 1);
});

test("Estadísticas: resumen, días, medios, productos y recomendaciones", () => {
  const otra = { ...venta, fecha: "2026-10-11T01:00:00.000Z", total: 250000, metodoPago: "mercadopago", lineas: venta.lineas.slice(0, 1), sugerenciasMostradas: ["r1:2", "r9:5"] };
  const e = estadisticas([{ ...venta, metodoPago: "efectivo", sugerenciasMostradas: ["r1:2"] }, otra], { reglas: [{ id: "r1", nombre: "Pedales" }], nombreProducto: (id) => (id === "5" ? "Funda" : null) });
  assert.equal(e.ventas, 2);
  assert.equal(e.facturado, 535000);
  assert.equal(e.ticketPromedio, 267500);
  assert.equal(e.agregados, 47500);
  assert.deepEqual([e.conSugerencia, e.conAgregado], [2, 1]);
  // 01:00 UTC del 11 es todavía el 10 en Argentina; el 9 no tuvo ventas.
  assert.deepEqual(e.porDia, [{ dia: "2026-10-08", ventas: 1, total: 285000 }, { dia: "2026-10-09", ventas: 0, total: 0 }, { dia: "2026-10-10", ventas: 1, total: 250000 }]);
  assert.deepEqual(e.porMedio.map((m) => [m.medio, m.total]), [["efectivo", 285000], ["mercadopago", 250000]]);
  assert.deepEqual(e.productos, [{ nombre: "Teclado", unidades: 2, total: 487500 }, { nombre: "Pedal", unidades: 2, total: 47500 }]);
  // El pedal se ofreció en las dos ventas y se llevó en una; el producto 5 solo se ofreció.
  assert.deepEqual(e.cruzados, [{ nombre: "Pedal", mostradas: 2, aceptadas: 1, unidades: 2, total: 47500 }, { nombre: "Funda", mostradas: 1, aceptadas: 0, unidades: 0, total: 0 }]);
  assert.deepEqual(e.porRegla, [{ id: "r1", nombre: "Pedales", mostradas: 2, aceptadas: 1, ingresos: 47500 }, { id: "r9", nombre: "Regla eliminada", mostradas: 1, aceptadas: 0, ingresos: 0 }]);
  assert.equal(estadisticas([venta], { desde: "2026-10-09T03:00:00.000Z" }).ventas, 0);
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
