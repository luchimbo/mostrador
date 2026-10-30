import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewsSnapshot, importCsv, newestReviewsFirst, normalizeReview, parseCsv, reviewKey, validateReviewsSnapshot } from "../shared/reviews.js";

test("las opiniones se ordenan por fecha antes de limitar y conservan empates", () => {
  const reviews = [{ id: "vieja", fecha: "2024-01-01" }, { id: "primera", fecha: "2026-01-01" },
    { id: "segunda", fecha: "2026-01-01" }, { id: "media", fecha: "2025-01-01" }];
  assert.deepEqual(newestReviewsFirst(reviews).slice(0, 3).map((r) => r.id), ["primera", "segunda", "media"]);
  assert.equal(reviews[0].id, "vieja");
});
import { verifyPublication } from "../shared/publish-protocol.js";
import { createReviewsPublisher } from "./reviews-publisher.js";

const today = "2026-10-22";
const base = { sku: " md10d ", rating: "5", autor: "Juan P.", texto: "Llegó rápido y funciona perfecto", fecha: "2026-09-01", origen: "mercadolibre" };

test("normaliza una reseña y rechaza datos inválidos con mensajes claros", () => {
  const r = normalizeReview(base, { today });
  assert.deepEqual([r.sku, r.rating, r.estado], ["MD10D", 5, "pendiente"]);
  const bad = (patch, message) => assert.throws(() => normalizeReview({ ...base, ...patch }, { today }), message);
  bad({ rating: 6 }, /1 a 5/);
  bad({ rating: 4.5 }, /1 a 5/);
  bad({ fecha: "2027-01-01" }, /Fecha inválida/);
  bad({ origen: "inventada" }, /Origen inválido/);
  bad({ enlace: "http://x.com" }, /https/);
  bad({ sku: "" }, /SKU/);
});

test("el CSV acepta ; de Excel, comillas, saltos de línea y BOM", () => {
  const rows = parseCsv('﻿sku;texto\r\nA;"dijo ""hola""; y\nchau"\r\n');
  assert.deepEqual(rows, [["sku", "texto"], ["A", 'dijo "hola"; y\nchau']]);
});

test("importa filas válidas, informa errores con su línea y exige las columnas obligatorias", () => {
  const csv = "SKU,Calificación,Autor,Opinión,Fecha,Origen,Link\nA1,5,Ana,Muy buen producto,2026-08-01,google,\nA2,0,Beto,Malo,2026-08-01,google,\n";
  const { valid, errors } = importCsv(csv, { today });
  assert.equal(valid.length, 1);
  assert.deepEqual(errors, [{ line: 3, error: "La calificación debe ser un entero de 1 a 5" }]);
  assert.throws(() => importCsv("sku,rating\nA,5"), /Falta la columna «autor»/);
});

test("la misma opinión tiene la misma clave aunque cambien mayúsculas", () => {
  const a = normalizeReview(base, { today }), b = normalizeReview({ ...base, autor: "JUAN P.", sku: "MD10D" }, { today });
  assert.equal(reviewKey(a), reviewKey(b));
});

test("el snapshot publica sólo las reseñas aprobadas, con promedio y la más nueva primero", () => {
  const make = (patch) => ({ ...normalizeReview({ ...base, sku: "A1", ...patch }, { today }), estado: "publicada" });
  const reviews = [make({ rating: 5, fecha: "2026-01-01" }), make({ rating: 4, fecha: "2026-05-01", texto: "Bueno, cumple" }),
    { ...make({ sku: "B2" }), estado: "oculta" }, { ...make({ sku: "C3" }), estado: "pendiente" }];
  const snap = buildReviewsSnapshot({ storeId: "78394", reviews, enabled: true, now: new Date("2026-10-22T10:00:00Z") });
  assert.deepEqual(Object.keys(snap.products), ["A1"]);
  assert.equal(snap.products.A1.avg, 4.5);
  assert.equal(snap.products.A1.reviews[0].fecha, "2026-05-01");
  assert.equal(JSON.stringify(snap).includes("estado"), false);
  assert.throws(() => validateReviewsSnapshot({ ...snap, products: { A1: { ...snap.products.A1, count: 1 } } }), /inválidas/);
});

test("filtra comentarios desde 4 estrellas sin alterar el promedio y permite ocultar sólo el enlace de ML", () => {
  const reviews = [3, 4, 4, 5].map((rating) => ({ ...normalizeReview({ ...base, rating, enlace: "https://mercadolibre.com.ar/producto" }, { today }), estado: "publicada" }));
  reviews.push({ ...reviews[0], sku: "BAJO" });
  reviews.push({ ...reviews[0], sku: "MIXTO", rating: 1 }, { ...reviews[0], sku: "MIXTO", rating: 5 });
  reviews.push({ ...reviews[3], origen: "google", enlace: "https://google.com/review" });
  const snap = buildReviewsSnapshot({ storeId: "78394", reviews, enabled: true, minRating: 4, showMeliLink: false });
  const p = snap.products.MD10D;
  assert.deepEqual(p.reviews.map((r) => r.rating), [4, 4, 5, 5]);
  assert.equal(snap.products.MIXTO, undefined);
  assert.equal(p.count, 5);
  assert.equal(p.avg, 4.2);
  assert.equal(snap.products.BAJO, undefined);
  assert.ok(p.reviews.filter((r) => r.origen === "mercadolibre").every((r) => !r.enlace));
  assert.equal(p.reviews[3].enlace, "https://google.com/review");
  const original = buildReviewsSnapshot({ storeId: "78394", reviews, enabled: true });
  assert.equal(original.products.MD10D.reviews.length, 5);
  assert.equal(original.products.MD10D.reviews[0].enlace, reviews[0].enlace);
});

test("las opciones se guardan, se publican y se conservan al recrear el publicador", async () => {
  let doc = { reviews: [{ ...normalizeReview({ ...base, enlace: "https://mercadolibre.com.ar/producto" }, { today }), estado: "publicada" }] };
  const sent = [];
  const options = { connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: () => doc, write: async (_n, v) => { doc = v; }, fetchImpl: async (_url, init) => {
      const { snapshot, revision } = JSON.parse(init.body); sent.push(snapshot);
      return { ok: true, json: async () => ({ revision }) };
    } };
  const publisher = createReviewsPublisher(options);
  await assert.rejects(publisher.setDisplayOptions({ minRating: 3, showMeliLink: false }));
  await publisher.setDisplayOptions({ minRating: 4, showMeliLink: false });
  assert.equal(sent[0].products.MD10D.reviews[0].enlace, undefined);
  const restored = createReviewsPublisher(options);
  assert.equal(restored.status().minRating, 4);
  assert.equal(restored.status().showMeliLink, false);
  await restored.setDisplayOptions({ minRating: 1, showMeliLink: true });
  assert.equal(sent[1].products.MD10D.reviews[0].enlace, doc.reviews[0].enlace);
});

test("el publicador firma la publicación y lleva el interruptor dentro del snapshot", async () => {
  let doc = { reviews: [{ ...normalizeReview(base, { today }), id: "1", estado: "publicada" }] };
  const key = "k".repeat(40), sent = [];
  const fetchImpl = async (url, init) => {
    const { snapshot, revision } = JSON.parse(init.body);
    sent.push({ url, init, snapshot });
    return { ok: true, json: async () => ({ revision }) };
  };
  const now = () => new Date("2026-10-22T10:00:00Z");
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key, storeId: "78394" },
    read: (_n, fallback) => doc ?? fallback, write: async (_n, v) => { doc = v; }, fetchImpl, now });
  assert.equal((await publisher.setEnabled(true)).enabled, true);
  const call = sent[0], url = new URL(call.url);
  assert.equal(url.pathname, "/api/reviews/config");
  assert.equal(call.snapshot.enabled, true);
  assert.ok(verifyPublication({ key, method: "PUT", path: url.pathname + url.search, timestamp: call.init.headers["x-mostrador-timestamp"],
    signature: call.init.headers["x-mostrador-signature"], body: call.init.body, now: now().getTime() }));
  await publisher.setEnabled(false);
  assert.equal(sent[1].snapshot.enabled, false);
  assert.equal(publisher.status().publicadas, 1);
});

test("si Logitrack no confirma la versión, queda el error y no se marca como publicado", async () => {
  let doc = { reviews: [] };
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; }, fetchImpl: async () => ({ ok: true, json: async () => ({ revision: "otra" }) }) });
  await assert.rejects(publisher.publish(), /no confirmó/);
  assert.match(publisher.status().error, /no confirmó/);
  assert.equal(publisher.status().lastPublishedAt, null);
});

test("importa las opiniones de Mercado Libre ya aprobadas, sin repetir ni aceptar SKU ajenos", async () => {
  let doc = { reviews: [] };
  const meli = { items: 3, withoutSkuCount: 1, withoutText: 2, withoutReviews: 0, errors: 0, reviews: [
    { externalId: "ml:1", sku: "ZTO115", rating: 5, texto: "Excelente producto", fecha: "2026-09-10", enlace: "https://articulo.mercadolibre.com.ar/MLA1" },
    { externalId: "ml:2", sku: "AJENO", rating: 4, texto: "Otro producto", fecha: "2026-09-11", enlace: "" },
    { externalId: "ml:3", sku: "ZTO115", rating: 5, texto: "Sin fecha válida", fecha: "", enlace: "" }] };
  const urls = [];
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; }, knownSkus: () => new Set(["ZTO115"]),
    fetchImpl: async (url) => { urls.push(String(url)); return { ok: true, json: async () => meli }; } });
  const first = await publisher.importMeli();
  assert.deepEqual([first.imported, first.unknownSku, first.invalid, first.repeated], [1, 1, 1, 0]);
  assert.match(urls[0], /\/api\/reviews\/meli\?part=0&offset=0&limit=150&storeId=78394$/);
  const [saved] = publisher.list();
  assert.deepEqual([saved.estado, saved.autor, saved.origen, saved.externalId], ["publicada", "Comprador de MercadoLibre", "mercadolibre", "ml:1"]);
  const second = await publisher.importMeli();
  assert.deepEqual([second.imported, second.repeated], [0, 1]);
  assert.equal(publisher.list().length, 1);
  assert.equal(publisher.status().meli.imported, 0);
});

test("si Logitrack falla al leer Mercado Libre queda el motivo y no se pierde lo cargado", async () => {
  let doc = { reviews: [{ id: "x", sku: "A", estado: "pendiente" }] };
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; },
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ error: "No hay una cuenta de Mercado Libre conectada" }) }) });
  await assert.rejects(publisher.importMeli(), /No hay una cuenta/);
  assert.match(publisher.status().meli.error, /No hay una cuenta/);
  assert.equal(publisher.list().length, 1);
});

test("Mercado Libre se lee por tandas y por cuenta, y si se corta se conserva lo leído", async () => {
  let doc = { reviews: [] };
  const pages = { "0:0": { accounts: 2, items: 2, nextOffset: 2, reviews: [{ externalId: "ml:1", sku: "A1", rating: 5, texto: "Excelente producto", fecha: "2026-09-10", enlace: "" }] },
    "0:2": { accounts: 2, items: 1, nextOffset: null, errors: 1, firstError: "too many requests", reviews: [{ externalId: "ml:2", sku: "A1", rating: 4, texto: "Muy bueno todo", fecha: "2026-09-11", enlace: "" }] } };
  const urls = [];
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; },
    fetchImpl: async (url) => {
      const q = new URL(url).searchParams; urls.push(`${q.get("part")}:${q.get("offset")}`);
      const page = pages[`${q.get("part")}:${q.get("offset")}`];
      return page ? { ok: true, json: async () => page } : { ok: false, status: 502, json: async () => ({ error: "Mercado Libre caído" }) };
    } });
  const summary = await publisher.importMeli();
  assert.deepEqual(urls, ["0:0", "0:2", "1:0"]);
  assert.deepEqual([summary.imported, summary.items, summary.errors, summary.firstError], [2, 3, 1, "too many requests"]);
  assert.match(summary.partial, /Mercado Libre caído/);
  assert.equal(publisher.list().length, 2);
});

test("la publicación manda las más nuevas de cada producto pero el promedio y el total cuentan todas", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...normalizeReview({ sku: "A1", rating: i < 30 ? 5 : 1, autor: "Comprador de MercadoLibre",
    texto: `Opinión número ${i}`, fecha: `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`, origen: "mercadolibre" }, { today }), estado: "publicada" }));
  const p = buildReviewsSnapshot({ storeId: "78394", reviews: many, enabled: true }).products.A1;
  assert.deepEqual([p.count, p.reviews.length, p.avg], [40, 25, 4.0]);
  assert.ok(p.reviews.every((r, i, a) => i === 0 || a[i - 1].fecha >= r.fecha));
});

test("aprueba en bloque sólo lo pendiente y la búsqueda de Mercado Libre se puede iniciar sin esperar", async () => {
  let doc = { reviews: ["pendiente", "pendiente", "oculta", "publicada"].map((estado, i) => ({ id: String(i), sku: "A", origen: i === 0 ? "google" : "cliente", estado })) };
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; }, fetchImpl: async () => new Promise(() => {}) });
  assert.equal(await publisher.approvePending("google"), 1);
  assert.equal(await publisher.approvePending(), 1);
  assert.deepEqual(publisher.list().map((r) => r.estado), ["publicada", "publicada", "oculta", "publicada"]);
  assert.equal(publisher.startImportMeli(), true);
  assert.equal(publisher.status().importando, true);
});

test("la búsqueda de Mercado Libre toca una vez por semana y un reinicio no la repite", () => {
  const day = 24 * 60 * 60_000, base = Date.parse("2026-10-22T12:00:00Z");
  let clock = base, doc = { reviews: [] };
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; }, now: () => new Date(clock) });
  assert.equal(publisher.meliDue(), true); // nunca se buscó
  doc = { reviews: [], meli: { at: new Date(base - 2 * day).toISOString() } };
  assert.equal(publisher.meliDue(), false); // hace 2 días
  const restarted = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async () => {}, now: () => new Date(clock) });
  assert.equal(restarted.meliDue(), false); // servidor nuevo, mismos datos guardados
  clock = base + 6 * day;
  assert.equal(publisher.meliDue(), true); // pasaron 8 días
  doc = { reviews: [], meli: { at: new Date(base - 8 * day).toISOString(), errorAt: new Date(base + 6 * day - 60_000).toISOString() } };
  assert.equal(publisher.meliDue(), false); // falló hace un minuto: espera para reintentar
  clock += 7 * 60 * 60_000;
  assert.equal(publisher.meliDue(), true);
});

test("un error de la búsqueda no adelanta la fecha de la última que terminó bien", async () => {
  let doc = { reviews: [], meli: { at: "2026-10-01T00:00:00.000Z", imported: 5 } };
  const publisher = createReviewsPublisher({ connection: { url: "https://logitrack.test", key: "k".repeat(40), storeId: "78394" },
    read: (_n, f) => doc ?? f, write: async (_n, v) => { doc = v; }, now: () => new Date("2026-10-22T12:00:00Z"),
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({ error: "caído" }) }) });
  await assert.rejects(publisher.importMeli(), /caído/);
  assert.deepEqual([doc.meli.at, doc.meli.imported, doc.meli.errorAt], ["2026-10-01T00:00:00.000Z", 5, "2026-10-22T12:00:00.000Z"]);
});

test("la ruta del módulo está antes que la de una opinión por id (si no, «modulo» se tomaría como un id)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const modulo = src.indexOf('app.put("/api/resenas/modulo"'), porId = src.indexOf('app.put("/api/resenas/:id"');
  assert.ok(modulo > 0 && porId > 0 && modulo < porId);
});
