import ExcelJS from "exceljs";
import { round2 } from "./pricing.js";

// Informe de ventas: producto principal = el primero que se cargó en la venta;
// productos agregados (cross-selling) = todos los que se sumaron después, vengan o no de una recomendación.
const describir = (lineas) => lineas.map((l) => (l.cantidad > 1 ? `${l.cantidad} × ${l.nombre}` : l.nombre)).join(" + ");

const enRango = (ventas, { desde, hasta } = {}) => ventas.filter((v) => (!desde || v.fecha >= desde) && (!hasta || v.fecha < hasta));

// Los totales de línea no incluyen el descuento de contado: se reparte en proporción
// para que el precio de cada producto sea lo realmente cobrado, como el total.
function proporcionCobrada(v) {
  const sumaLineas = (v.lineas || []).reduce((a, l) => a + l.total, 0);
  return sumaLineas ? v.total / sumaLineas : 1;
}

// Los productos de prueba (PRODUCTOS_PRUEBA_IDS) no cuentan en los informes: se quitan sus líneas
// con lo que se cobró por ellas, y las ventas que solo tenían esos productos.
export function sinProductosPrueba(ventas, ids = []) {
  const prueba = new Set(ids.map(String));
  if (!prueba.size) return ventas;
  return ventas.flatMap((v) => {
    const lineas = (v.lineas || []).filter((l) => !prueba.has(String(l.productId)));
    if (lineas.length === (v.lineas || []).length) return [v];
    if (!lineas.length) return [];
    return [{ ...v, lineas, total: round2(lineas.reduce((a, l) => a + l.total, 0) * proporcionCobrada(v)) }];
  });
}

export function filasReporte(ventas, rango) {
  return enRango(ventas, rango)
    .map((v) => {
      const lineas = v.lineas || [];
      const principales = lineas.slice(0, 1);
      const agregados = lineas.slice(1);
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
// Cross-selling: todo producto que se suma al primero que se cargó en la venta.
export function estadisticas(ventas, { desde, hasta } = {}) {
  const lista = enRango(ventas, { desde, hasta });
  const dias = new Map();
  const medios = new Map();
  const productos = new Map();
  const cruzados = new Map();
  const sumar = (mapa, clave, total) => {
    const actual = mapa.get(clave) || mapa.set(clave, { ventas: 0, total: 0 }).get(clave);
    actual.ventas++;
    actual.total += total;
  };
  const sumarProducto = (mapa, l, cobrado) => {
    const p = mapa.get(String(l.productId)) || mapa.set(String(l.productId), { nombre: l.nombre, ventas: 0, unidades: 0, total: 0 }).get(String(l.productId));
    p.ventas++;
    p.unidades += l.cantidad;
    p.total += cobrado;
  };
  let facturado = 0, agregados = 0, conAgregado = 0;

  for (const v of lista) {
    const lineas = v.lineas || [];
    const proporcion = proporcionCobrada(v);
    facturado += v.total;
    sumar(dias, diaAR(v.fecha), v.total);
    sumar(medios, v.transferencia ? "transferencia" : v.metodoPago || "otros", v.total);
    if (lineas.length > 1) conAgregado++;
    lineas.forEach((l, i) => {
      const cobrado = l.total * proporcion;
      sumarProducto(productos, l, cobrado);
      if (i > 0) {
        agregados += cobrado;
        sumarProducto(cruzados, l, cobrado);
      }
    });
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
    conAgregado,
    porDia,
    porMedio: [...medios].map(([medio, m]) => redondear({ medio, ...m })).sort((a, b) => b.total - a.total),
    productos: [...productos.values()].map(redondear).sort((a, b) => b.total - a.total).slice(0, 15),
    cruzados: [...cruzados.values()].map(redondear).sort((a, b) => b.total - a.total),
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
