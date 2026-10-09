import ExcelJS from "exceljs";
import { round2 } from "./pricing.js";

// Informe de ventas: producto principal = lo que agregó el vendedor;
// productos agregados = los que entraron por una recomendación aceptada (reglaId).
const describir = (lineas) => lineas.map((l) => (l.cantidad > 1 ? `${l.cantidad} × ${l.nombre}` : l.nombre)).join(" + ");

export function filasReporte(ventas, { desde, hasta } = {}) {
  return ventas
    .filter((v) => (!desde || v.fecha >= desde) && (!hasta || v.fecha < hasta))
    .map((v) => {
      const lineas = v.lineas || [];
      const principales = lineas.filter((l) => !l.reglaId);
      const agregados = lineas.filter((l) => l.reglaId);
      // Los totales de línea no incluyen el descuento de contado: se reparte en proporción
      // para que el precio de los agregados sea lo realmente cobrado, como el total.
      const sumaLineas = lineas.reduce((a, l) => a + l.total, 0);
      const proporcion = sumaLineas ? v.total / sumaLineas : 1;
      return {
        fecha: new Date(v.fecha),
        comprobante: [v.tipo || v.factura?.tipo, v.numero].filter(Boolean).join(" "),
        principal: describir(principales),
        agregados: describir(agregados),
        total: v.total,
        totalAgregados: round2(agregados.reduce((a, l) => a + l.total, 0) * proporcion),
        prueba: Boolean(v.prueba),
      };
    });
}

export async function generarReporteExcel(filas) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Ventas", { views: [{ state: "frozen", ySplit: 1 }] });
  const moneda = '"$" #,##0.00';
  hoja.columns = [
    { header: "Fecha", key: "fecha", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Comprobante", key: "comprobante", width: 26 },
    { header: "Producto principal", key: "principal", width: 50 },
    { header: "Productos agregados", key: "agregados", width: 50 },
    { header: "Precio total", key: "total", width: 16, style: { numFmt: moneda } },
    { header: "Precio productos agregados", key: "totalAgregados", width: 16, style: { numFmt: moneda } },
  ];
  // Excel no guarda zona horaria: se escribe la hora de Argentina.
  for (const f of filas) {
    hoja.addRow({
      ...f,
      fecha: new Date(f.fecha.getTime() - 3 * 60 * 60 * 1000),
      comprobante: f.prueba ? `${f.comprobante} (PRUEBA)` : f.comprobante,
    });
  }
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true };
  encabezado.alignment = { vertical: "middle", wrapText: true };
  hoja.getColumn("principal").alignment = { wrapText: true, vertical: "top" };
  hoja.getColumn("agregados").alignment = { wrapText: true, vertical: "top" };

  if (filas.length) {
    const ultima = filas.length + 1;
    const totales = hoja.addRow({
      comprobante: `${filas.length} ventas`,
      agregados: "Totales",
      total: { formula: `SUM(E2:E${ultima})`, result: round2(filas.reduce((a, f) => a + f.total, 0)) },
      totalAgregados: { formula: `SUM(F2:F${ultima})`, result: round2(filas.reduce((a, f) => a + f.totalAgregados, 0)) },
    });
    totales.font = { bold: true };
  }
  hoja.autoFilter = { from: "A1", to: "F1" };
  return libro.xlsx.writeBuffer();
}
