import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewsSnapshot, importCsv, normalizeReview, parseCsv, reviewKey, validateReviewsSnapshot } from "../shared/reviews.js";
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
  assert.throws(() => validateReviewsSnapshot({ ...snap, products: { A1: { ...snap.products.A1, count: 9 } } }), /inválidas/);
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
