import ExcelJS from "exceljs";
import { round2 } from "./pricing.js";

// Informe de ventas: producto principal = lo que agregó el vendedor;
// productos agregados = los que entraron por una recomendación aceptada (reglaId).
const describir = (lineas) => lineas.map((l) => (l.cantidad > 1 ? `${l.cantidad} × ${l.nombre}` : l.nombre)).join(" + ");

const enRango = (ventas, { desde, hasta } = {}) => ventas.filter((v) => (!desde || v.fecha >= desde) && (!hasta || v.fecha < hasta));

// Los totales de línea no incluyen el descuento de contado: se reparte en proporción
// para que el precio de cada producto sea lo realmente cobrado, como el total.
function proporcionCobrada(v) {
  const sumaLineas = (v.lineas || []).reduce((a, l) => a + l.total, 0);
  return sumaLineas ? v.total / sumaLineas : 1;
}

export function filasReporte(ventas, rango) {
  return enRango(ventas, rango)
    .map((v) => {
      const lineas = v.lineas || [];
      const principales = lineas.filter((l) => !l.reglaId);
      const agregados = lineas.filter((l) => l.reglaId);
      const proporcion = proporcionCobrada(v);
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

// Día en hora de Argentina (UTC-3).
const diaAR = (iso) => new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Estadísticas del período para la pestaña Informes. Los importes son lo cobrado.
export function estadisticas(ventas, { desde, hasta, reglas = [] } = {}) {
  const lista = enRango(ventas, { desde, hasta });
  const dias = new Map();
  const medios = new Map();
  const productos = new Map();
  const porRegla = new Map(reglas.map((r) => [r.id, { id: r.id, nombre: r.nombre, mostradas: 0, aceptadas: 0, ingresos: 0 }]));
  const regla = (id) => porRegla.get(id) || porRegla.set(id, { id, nombre: "Regla eliminada", mostradas: 0, aceptadas: 0, ingresos: 0 }).get(id);
  const sumar = (mapa, clave, total, extra = {}) => {
    const actual = mapa.get(clave) || mapa.set(clave, { ventas: 0, total: 0, ...extra }).get(clave);
    actual.ventas++;
    actual.total += total;
  };
  let facturado = 0, agregados = 0, conSugerencia = 0, conAgregado = 0;

  for (const v of lista) {
    const lineas = v.lineas || [];
    const proporcion = proporcionCobrada(v);
    facturado += v.total;
    sumar(dias, diaAR(v.fecha), v.total);
    sumar(medios, v.transferencia ? "transferencia" : v.metodoPago || "otros", v.total);
    if (v.sugerenciasMostradas?.length) conSugerencia++;
    if (lineas.some((l) => l.reglaId)) conAgregado++;
    for (const clave of v.sugerenciasMostradas || []) regla(clave.split(":")[0]).mostradas++;
    for (const l of lineas) {
      const cobrado = l.total * proporcion;
      const p = productos.get(String(l.productId)) || productos.set(String(l.productId), { nombre: l.nombre, unidades: 0, total: 0 }).get(String(l.productId));
      p.unidades += l.cantidad;
      p.total += cobrado;
      if (l.reglaId) {
        agregados += cobrado;
        regla(l.reglaId).aceptadas++;
        regla(l.reglaId).ingresos += cobrado;
      }
    }
  }

  // Los días sin ventas también se muestran, para que el gráfico no los saltee.
  const porDia = [];
  const claves = [...dias.keys()].sort();
  if (claves.length) {
    for (const d = new Date(`${claves[0]}T00:00:00Z`); d.toISOString().slice(0, 10) <= claves.at(-1); d.setUTCDate(d.getUTCDate() + 1)) {
      const dia = d.toISOString().slice(0, 10);
      const { ventas: cantidad = 0, total = 0 } = dias.get(dia) || {};
      porDia.push({ dia, ventas: cantidad, total: round2(total) });
    }
  }
  const redondear = (x) => ({ ...x, total: round2(x.total) });
  return {
    ventas: lista.length,
    facturado: round2(facturado),
    ticketPromedio: lista.length ? round2(facturado / lista.length) : 0,
    agregados: round2(agregados),
    conSugerencia,
    conAgregado,
    porDia,
    porMedio: [...medios].map(([medio, m]) => redondear({ medio, ...m })).sort((a, b) => b.total - a.total),
    productos: [...productos.values()].map(redondear).sort((a, b) => b.total - a.total).slice(0, 15),
    porRegla: [...porRegla.values()].map((r) => ({ ...r, ingresos: round2(r.ingresos) })).sort((a, b) => b.ingresos - a.ingresos || b.mostradas - a.mostradas),
  };
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
