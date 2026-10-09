import assert from "node:assert/strict";
import { test } from "node:test";
import { incluirProductosPrueba } from "./catalog.js";
import { productosEnReposo } from "../shared/display.js";
import { obtenerSugerencias } from "./recommendations.js";
import { DEFAULT_SETTINGS } from "./store.js";

const demo = { id: "26604", nombre: "PRODUCTO DEMO", codigo: "1", precioFinal: 3946.8, stock: 100, activo: true, imagen: "demo.jpg", rubro: "Pruebas", iva: 21 };
const real = { ...demo, id: "2", nombre: "Teclado", rubro: "Teclados" };

test("El producto de prueba entra por su ID, sin habilitar otros conceptos", () => {
  const productos = incluirProductosPrueba([real], [real, demo, { ...demo, id: "3" }], ["26604"]);
  assert.deepEqual(productos.map((p) => p.id), ["2", "26604"]);
  assert.equal(productos[1].productoPrueba, true);
  assert.equal(productos[1].precioFinal, 3946.8);
});

test("La excepción requiere un ID habilitado y no genera duplicados", () => {
  assert.deepEqual(incluirProductosPrueba([real], [real, demo], []), [real]);
  assert.equal(incluirProductosPrueba([demo], [demo], ["26604"]).length, 1);
  assert.equal(incluirProductosPrueba([], [{ ...demo, activo: false }], ["26604"]).length, 0);
});

test("Los productos de prueba no se promocionan en reposo ni como sugerencias", () => {
  const productos = incluirProductosPrueba([real], [real, demo], ["26604"]);
  assert.deepEqual(productosEnReposo(productos, ["26604", "2"], DEFAULT_SETTINGS).map((p) => p.id), ["2"]);
  const regla = { id: "prueba", activa: true, disparador: { tipo: "producto", valor: "2" }, sugeridos: ["26604"], descuentoPct: 10 };
  assert.equal(obtenerSugerencias([{ productId: "2" }], new Map(productos.map((p) => [p.id, p])), [regla], DEFAULT_SETTINGS).length, 0);
});

test("Tienda: lee SKU, precio de venta y precio tachado de las tarjetas del listado", async () => {
  const { extraerPreciosListado } = await import("./tiendanube.js");
  const tarjeta = (sku, centavos, tachado) => `<div class="js-item-product col-6" data-product-id="1">
    <span class="js-price-display item-price" data-product-price="${centavos}"> $x </span>
    <span class="js-compare-price-display price-compare" style="${tachado ? "display:inline-block;" : "display:none;"}"> ${tachado || "$0"} </span>
    <script type="application/ld+json">{ "@type": "Product", "sku": "${sku}", "offers": { "price": "1" } }</script></div>`;
  const html = `<html>${tarjeta("sof002", 20515932, "$215.957,28")}${tarjeta("ZTO150", 385431200)}<div class="js-item-product"></div></html>`;
  assert.deepEqual(extraerPreciosListado(html), [
    { sku: "SOF002", precio: 205159.32, precioLista: 215957.28 },
    { sku: "ZTO150", precio: 3854312, precioLista: null },
  ]);
});
