import assert from "node:assert/strict";
import { test } from "node:test";
import { esOferta, productosEnReposo, secuenciaReposo, validarPantalla, youtubeId } from "../shared/display.js";
import { DEFAULT_SETTINGS } from "./store.js";

const p = (id, extra = {}) => ({ id, activo: true, stock: 2, imagen: "foto.jpg", precioFinal: 100, rubro: "Teclados", ...extra });
const video = (id, extra = {}) => ({ id, url: "https://youtu.be/M7lc1UVf-VE", activo: true, titulo: "Demo", inicio: 10, fin: null, productId: null, ...extra });

test("YouTube: enlaces normales, cortos, Shorts y embeds; rechaza otros sitios", () => {
  for (const url of ["https://www.youtube.com/watch?v=M7lc1UVf-VE&t=10", "https://youtu.be/M7lc1UVf-VE?si=abc", "https://youtube.com/shorts/M7lc1UVf-VE", "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE"]) assert.equal(youtubeId(url), "M7lc1UVf-VE");
  for (const url of ["https://youtube.com.ejemplo.com/watch?v=M7lc1UVf-VE", "javascript:alert(1)", "https://youtu.be/corto", "hola"]) assert.equal(youtubeId(url), null);
});

test("Reposo: prioriza ofertas reales con foto y stock y respeta exclusiones", () => {
  const productos = [p("1", { precioLista: 150 }), p("2"), p("3", { precioLista: 150, stock: 0 }), p("4", { precioLista: 150, imagen: null }), p("5", { precioLista: 150 })];
  const settings = { ...DEFAULT_SETTINGS, excluidosReposo: ["5"] };
  assert.deepEqual(productosEnReposo(productos, ["2"], settings).map((x) => x.id), ["1"]);
  assert.equal(esOferta(p("2")), false);
  assert.equal(esOferta(p("2", { precioLista: 100 })), false);
});

test("Reposo: respaldo sin ofertas, selección manual y mezcla sin duplicados", () => {
  const productos = [p("1"), p("2", { precioFinal: 200 })];
  assert.deepEqual(productosEnReposo(productos, ["1"], DEFAULT_SETTINGS).map((x) => x.id), ["1"]);
  assert.deepEqual(productosEnReposo(productos, [], DEFAULT_SETTINGS).map((x) => x.id), ["2"]);
  assert.equal(productosEnReposo(productos.map((x) => ({ ...x, stock: 0 })), ["1"], DEFAULT_SETTINGS).length, 0);
  const ofertas = [p("1", { precioLista: 150 }), p("2")];
  assert.deepEqual(productosEnReposo(ofertas, ["2"], { ...DEFAULT_SETTINGS, modoReposo: "manual" }).map((x) => x.id), ["2"]);
  assert.deepEqual(productosEnReposo(ofertas, ["1", "2"], { ...DEFAULT_SETTINGS, modoReposo: "mixto" }).map((x) => x.id), ["1", "2"]);
});

test("Rotación: tres productos por video e incluye todos los videos aunque haya pocos productos", () => {
  const slides = secuenciaReposo([p("1")], [video("a"), video("b"), video("c", { activo: false })], 3);
  assert.deepEqual(slides.map((x) => x.tipo), ["producto", "producto", "producto", "video", "producto", "producto", "producto", "video"]);
  assert.deepEqual(slides.filter((x) => x.video).map((x) => x.video.id), ["a", "b"]);
  assert.deepEqual(secuenciaReposo([], []).map((x) => x.tipo), ["marca"]);
  assert.equal(secuenciaReposo([], [video("a")])[0].tipo, "marca");
});

test("Pantalla: valida tiempos, segmentos, enlaces y URL de opiniones", () => {
  assert.equal(validarPantalla(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => validarPantalla({ ...DEFAULT_SETTINGS, videosReposo: [video("a", { fin: 40 })] }));
  for (const parcial of [{ segundosPorSlide: 0 }, { segundosPorVideo: NaN }, { modoReposo: "otro" }, { videosReposo: [video("a", { fin: 10 })] }, { videosReposo: [video("a", { fin: 500 })] }, { videosReposo: [video("a"), video("a")] }, { opinionUrl: "javascript:alert(1)" }]) assert.throws(() => validarPantalla({ ...DEFAULT_SETTINGS, ...parcial }));
  assert.doesNotThrow(() => validarPantalla({ ...DEFAULT_SETTINGS, opinionUrl: "" }));
});
