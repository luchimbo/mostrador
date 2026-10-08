// Prueba de factura SIN efecto fiscal: arma el mismo comprobante que emitiría el mostrador
// y lo guarda en Contabilium como BORRADOR (no va a ARCA, no tiene CAE ni consume número).
//
// Uso:
//   npm run probar-borrador                 -> solo muestra lo que se enviaría (no toca nada)
//   npm run probar-borrador -- --confirmar  -> crea el borrador en Contabilium
//   npm run probar-borrador -- AIS022       -> elegir otro producto por SKU
//
// Después de crearlo: revisalo en Contabilium (Ventas -> Comprobantes) y eliminalo.

// Usar los datos reales (catálogo y tienda) aunque el .env siga en modo prueba.
process.env.CONTABILIUM_MODE = "real";

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const sku = (args.find((a) => !a.startsWith("--")) || "AIS022").toUpperCase();

const { config } = await import("../server/config.js");
const { descargarCatalogo, post } = await import("../server/contabilium.js");
const { combinarConTienda } = await import("../server/tiendanube.js");
const { armarComprobante } = await import("../server/invoice.js");
const { Sale } = await import("../server/sale.js");
const { getSettings } = await import("../server/store.js");

if (!config.contabilium.puntoVenta || !config.contabilium.idClienteConsumidorFinal) {
  console.error("Faltan CONTABILIUM_PUNTO_VENTA o CONTABILIUM_ID_CLIENTE_CF en el .env");
  process.exit(1);
}

console.log("Descargando catálogo de Contabilium…");
const productos = combinarConTienda(await descargarCatalogo());
const producto = productos.find((p) => String(p.codigo).toUpperCase() === sku);
if (!producto) {
  console.error(`No se encontró el SKU ${sku} en el catálogo del mostrador.`);
  process.exit(1);
}

// Misma venta que haría el vendedor: 1 unidad, Consumidor Final, efectivo.
const settings = getSettings();
const sale = new Sale();
sale.agregar(producto);
sale.setMetodoPago("efectivo");
const porId = new Map(productos.map((p) => [String(p.id), p]));
const snapshot = sale.snapshot(porId, [], settings);

const { Pagos, ...comprobante } = armarComprobante({
  lines: snapshot.lines,
  metodoPago: snapshot.metodoPago,
  totales: snapshot.totales,
  idCliente: config.contabilium.idClienteConsumidorFinal,
  tipoFc: "FCB",
  settings,
});
// El borrador no lleva cobranza; la fecha de vencimiento la pide /comprobantes/crear.
comprobante.FechaVencimiento = comprobante.FechaEmision;

console.log(`\nProducto: ${producto.nombre} (${producto.codigo}) · precio ${producto.precioFinal}`);
console.log(`Total esperado en efectivo (-${settings.descuentoContadoPct}%): ${snapshot.totales.totalAPagar}`);
console.log("\nComprobante a enviar:\n" + JSON.stringify(comprobante, null, 2));
console.log("Cobranza (no se envía en el borrador):", JSON.stringify(Pagos));

if (!confirmar) {
  console.log("\nNo se envió nada. Para crear el borrador en Contabilium: npm run probar-borrador -- --confirmar");
  process.exit(0);
}

console.log("\nCreando BORRADOR en Contabilium (POST /api/comprobantes/crear)…");
try {
  const res = await post("/comprobantes/crear", comprobante);
  console.log("✓ Borrador creado. Respuesta de Contabilium:", JSON.stringify(res));
  console.log(`\nAhora: abrilo en Contabilium, verificá que el total sea ${snapshot.totales.totalAPagar} y ELIMINALO.`);
} catch (err) {
  console.error("✗ Contabilium rechazó el borrador:", err.message);
  process.exit(1);
}
