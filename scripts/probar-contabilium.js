// Prueba de conexión con Contabilium. SOLO LECTURA: no crea clientes ni facturas.
// Uso: npm run probar-contabilium
import { descargarCatalogo, get } from "../server/contabilium.js";

const items = (r) => (Array.isArray(r) ? r : r?.Items || r?.items || []);

async function paso(titulo, fn) {
  process.stdout.write(`\n▶ ${titulo}\n`);
  try {
    await fn();
  } catch (err) {
    console.log(`  ✗ ${err.message}`);
  }
}

await paso("Datos de la empresa", async () => {
  const info = await get("/usuarios/obtenerinfo");
  console.log(`  ✓ ${info?.RazonSocial || "(sin razón social)"} · Condición IVA: ${info?.CondicionIVA ?? info?.CondicionIva ?? "?"}`);
});

await paso("Puntos de venta (copiá el Id al .env como CONTABILIUM_PUNTO_VENTA)", async () => {
  for (const pv of items(await get("/puntosdeventa/search"))) {
    console.log(`  · Id ${pv.Id} · Punto ${pv.Punto ?? pv.Numero ?? "?"} · ${pv.Nombre || ""} ${pv.Activo === false ? "(inactivo)" : ""}`);
  }
});

await paso("Cliente 'Consumidor Final' (copiá el Id al .env como CONTABILIUM_ID_CLIENTE_CF)", async () => {
  const lista = items(await get("/clientes/search", { filtro: "consumidor final", pageSize: 10 }));
  if (!lista.length) console.log("  ! No se encontró. Crealo en Contabilium como cliente genérico.");
  for (const c of lista) console.log(`  · Id ${c.Id} · ${c.RazonSocial} · ${c.TipoDoc || ""} ${c.NroDoc || ""} · ${c.CondicionIva || ""}`);
});

await paso("Catálogo", async () => {
  const crudo = items(await get("/conceptos/search", { page: 1, pageSize: 5 }));
  if (crudo[0]) console.log(`  Campos que devuelve Contabilium: ${Object.keys(crudo[0]).join(", ")}`);
  const productos = await descargarCatalogo();
  console.log(`  ✓ ${productos.length} productos activos con precio. Primeros 5:`);
  for (const p of productos.slice(0, 5)) {
    console.log(`  · [${p.id}] ${p.nombre} · ${p.rubro} · $${p.precioFinal} (IVA ${p.iva}%) · costo ${p.costo || "-"}`);
  }
});
