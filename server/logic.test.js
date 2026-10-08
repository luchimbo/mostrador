import assert from "node:assert/strict";
import { test } from "node:test";
import { clasificarDocumento, tipoFactura, validarCuit } from "./documento.js";
import { armarComprobante, normalizarCondicionIva } from "./invoice.js";
import { CATALOGO_DEMO, REGLAS_DEMO } from "./mock.js";
import { calcularTotales, combinarDescuentos, descuentoSeguro } from "./pricing.js";
import { Sale } from "./sale.js";
import { DEFAULT_SETTINGS } from "./store.js";

const settings = DEFAULT_SETTINGS;
const porId = new Map(CATALOGO_DEMO.map((p) => [p.id, p]));

test("CUIT válido e inválido", () => {
  assert.equal(validarCuit("20123456786"), true);
  assert.equal(validarCuit("20123456787"), false);
  assert.throws(() => clasificarDocumento("20-12345678-7"), /no es válido/);
  assert.deepEqual(clasificarDocumento("30.123.456"), { tipo: "DNI", documento: "30123456" });
  assert.throws(() => clasificarDocumento(""), /Ingresá el DNI o CUIT/);
});

test("letra de factura para emisor Responsable Inscripto", () => {
  assert.equal(tipoFactura("RI"), "FCA");
  assert.equal(tipoFactura("MO"), "FCA");
  assert.equal(tipoFactura("CF"), "FCB");
  assert.equal(tipoFactura("EX"), "FCB");
  assert.equal(normalizarCondicionIva("Responsable Inscripto"), "RI");
  assert.equal(normalizarCondicionIva("Monotributista"), "MO");
});

test("descuento contado de 5%", () => {
  const lines = [{ precioFinal: 100000, cantidad: 2, descuentoPct: 0 }];
  const sin = calcularTotales(lines, "credito", settings);
  assert.equal(sin.totalAPagar, 200000);
  const con = calcularTotales(lines, "efectivo", settings);
  assert.equal(con.totalAPagar, 190000);
  assert.equal(combinarDescuentos(10, 5), 14.5);
});

test("el descuento respeta el margen mínimo sobre el costo", () => {
  const producto = { precioFinal: 12100, iva: 21, costo: 9000 }; // neto 10000
  // piso = 9000 * 1.10 = 9900 -> máximo 1%
  assert.equal(descuentoSeguro(producto, 15, settings), 1);
  assert.equal(descuentoSeguro({ precioFinal: 1000, costo: 0 }, 50, settings), settings.descuentoMaximoPct);
});

test("sugerencias y descuento atado al producto que lo disparó", () => {
  const sale = new Sale();
  sale.agregar(porId.get("101")); // controlador MIDI (MiniLab 3)
  let snap = sale.snapshot(porId, REGLAS_DEMO, settings);
  assert.deepEqual(snap.sugerencias.map((s) => s.productId), ["912", "601", "901"]);

  sale.agregar(porId.get("901"), { reglaId: "r1" });
  snap = sale.snapshot(porId, REGLAS_DEMO, settings);
  const pedal = snap.lines.find((l) => l.productId === "901");
  assert.equal(pedal.descuentoPct, 10);
  assert.ok(!snap.sugerencias.some((s) => s.productId === "901"));

  // Si saca el controlador, el pedal pierde el descuento
  sale.quitar(snap.lines.find((l) => l.productId === "101").lineId);
  snap = sale.snapshot(porId, REGLAS_DEMO, settings);
  assert.equal(snap.lines[0].descuentoPct, 0);
});

test("comprobante: precios netos y bonificación combinada", () => {
  const lines = [{ productId: "901", codigo: "X", nombre: "Pedal", precioFinal: 24200, iva: 21, cantidad: 1, descuentoPct: 10 }];
  const totales = calcularTotales(lines, "transferencia", settings);
  const c = armarComprobante({ lines, metodoPago: "transferencia", totales, idCliente: 5, tipoFc: "FCB", settings });
  assert.equal(c.Items[0].PrecioUnitario, 20000);
  assert.equal(c.Items[0].Bonificacion, 14.5);
  assert.equal(c.Pagos, null); // Emisi?n sin registrar cobro
  assert.equal(totales.totalAPagar, 20691);
});

test("Tiendanube: precio real (con oferta) de las variantes; categoría e imagen del JSON-LD", async () => {
  const { extraerProductos } = await import("./tiendanube.js");
  const html = `<script type="application/ld+json">{"@type":"WebPage","breadcrumb":{"itemListElement":[{"name":"Inicio"},{"name":"Controladores MIDI"},{"name":"Hasta 3/8 (37 teclas)"},{"name":"MiniLab 3"}]},
      "mainEntity":{"@type":"Product","name":"MiniLab 3 &quot;Black&quot;","sku":"zto115","image":"https://x.com/p/minilab-480-0.webp","offers":{"price":"208260"}}}</script>
    <div data-variants="[{&quot;sku&quot;:&quot;ZTO115&quot;,&quot;price_number&quot;:190000.5,&quot;compare_at_price_number&quot;:208260}]"></div>
    <script type="application/ld+json">{"@type":"Product","name":"Afinador","sku":"AIS022","image":"http://x.com/p/afinador-480-0.webp","offers":{"price":"6839.04"}}</script>
    <script type="application/ld+json">{roto</script>`;
  assert.deepEqual(extraerProductos(html), [
    {
      sku: "ZTO115",
      nombre: 'MiniLab 3 "Black"',
      imagen: "https://x.com/p/minilab-1024-1024.webp",
      precio: 190000.5,
      precioLista: 208260,
      categoria: "Controladores MIDI",
      subcategoria: "Hasta 3/8 (37 teclas)",
    },
    { sku: "AIS022", nombre: "Afinador", imagen: "https://x.com/p/afinador-1024-1024.webp", precio: 6839.04 },
  ]);
});

test("Contabilium: costo en dólares se convierte a pesos con la rentabilidad", async () => {
  const { mapearConcepto } = await import("./contabilium.js");
  const p = mapearConcepto(
    { Id: 39221, Codigo: "ZTT058", Nombre: "AKM320", Precio: 94551.6, PrecioFinal: 114397.92, Iva: 21, Rentabilidad: 93.57, CostoInterno: 31.31, IdRubro: "1662", Estado: "Activo" },
    new Map([[1662, "General"]]),
  );
  assert.equal(p.costo, 48846.21);
  assert.equal(p.rubro, "General");
  assert.equal(p.precioFinal, 114397.92);
});
