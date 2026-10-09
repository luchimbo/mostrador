import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { filasReporte, generarReporteExcel } from "./reporte.js";

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

test("Informe: genera un Excel con encabezados y totales", async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await generarReporteExcel(filasReporte([venta, { ...venta, numero: "0007-2", lineas: venta.lineas.slice(0, 1), total: 237500 }])));
  const hoja = libro.getWorksheet("Ventas");
  assert.deepEqual(hoja.getRow(1).values.slice(1), ["Fecha", "Comprobante", "Producto principal", "Productos agregados", "Precio total", "Precio productos agregados"]);
  assert.equal(hoja.getCell("D3").value, "");
  assert.equal(hoja.getCell("E4").value.result, 522500);
  assert.equal(hoja.getCell("F4").value.result, 47500);
});
