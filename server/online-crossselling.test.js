import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, validateSnapshot, mapOnlineCatalog, onlineRecommendations, discountCommands } from "../shared/online-crossselling.js";
import { obtenerSugerencias } from "./recommendations.js";
import { digest, publicationSignature, verifyPublication, snapshotRevision } from "../shared/publish-protocol.js";
import { createOnlinePublisher } from "./online-publisher.js";

const now = new Date("2026-10-16T12:00:00Z");
const settings = { maxSugerencias: 3, descuentoMaximoPct: 25, margenMinimoPct: 10 };
const products = [
  { id: "1", codigo: "KEY", nombre: "Teclado MIDI", precioFinal: 200000, costo: 50000, iva: 21, stock: 3, rubro: "Teclados", subrubro: "Teclados › MIDI" },
  { id: "2", codigo: "PED", nombre: "Pedal", precioFinal: 12100, costo: 8000, iva: 21, stock: 3 },
  { id: "3", codigo: "FUND", nombre: "Funda", precioFinal: 20000, costo: 1000, iva: 21, stock: 3 },
];
const rules = [{ id: "r1", activa: true, nombre: "Equipo", disparador: { tipo: "nombre", valor: "teclado", excluir: "infantil" }, sugeridos: ["2", "3"], descuentoPct: 15 }];
const make = (extra = {}) => buildSnapshot({ storeId: "7570182", products, rules, settings, enabled: true, ruleIds: ["r1"], now, ...extra });
const tnProducts = products.map((p, i) => ({ id: i + 10, name: { es: p.nombre }, published: true, variants: [{ id: i + 100, sku: p.codigo, price: String(p.precioFinal), stock_management: true, stock: 3, values: [{ es: "Negro" }] }] }));
const cart = { store_id: "7570182", cart_id: "cart1", currency: "ARS", execution_tier: "line_item", coupons: [], products: [{ id: "line1", variant_id: 100, quantity: 1, price: "200000" }], promotions: [] };
const withAccessory = { ...cart, products: [...cart.products, { id: "line2", variant_id: 101, quantity: 2, price: "12100" }], promotions: [{ id: "promo1", line_items: ["line2"] }] };
const accepted = { storeId: "7570182", cartId: "cart1", revision: "v1", ruleId: "r1", variantId: "101", expiresAt: now.getTime() + 10000 };
function commands(extra = {}) {
  const snapshot = make();
  return discountCommands({ snapshot, revision: "v1", catalog: mapOnlineCatalog(snapshot, tnProducts), cart: withAccessory,
    acceptances: [accepted], promotionIds: { r1: "promo1" }, enabled: true, now: now.getTime(), ...extra }).commands;
}

test("online y mostrador comparten disparadores, orden y descuentos", () => {
  for (const disparador of [{ tipo: "producto", valor: "1" }, { tipo: "rubro", valor: "Teclados" },
    { tipo: "subrubro", valor: "Teclados › MIDI" }, rules[0].disparador]) {
    const snapshot = make({ rules: [{ ...rules[0], disparador }] });
    const expected = obtenerSugerencias([{ productId: "1" }], new Map(products.map((p) => [p.id, p])), snapshot.rules, settings);
    const actual = onlineRecommendations(snapshot, mapOnlineCatalog(snapshot, tnProducts), cart);
    assert.deepEqual(actual.map((s) => [s.productId, s.reglaId, s.precioConDescuento]), expected.map((s) => [s.productId, s.reglaId, s.precioConDescuento]));
  }
});
test("no ofrece excluidos por nombre, accesorios presentes ni más que el máximo", () => {
  const snapshot = make({ settings: { ...settings, maxSugerencias: 1 } });
  let catalog = mapOnlineCatalog(snapshot, tnProducts);
  assert.equal(onlineRecommendations(snapshot, catalog, cart).length, 1);
  assert.deepEqual(onlineRecommendations(snapshot, catalog, withAccessory).map((s) => s.productId), ["3"]);
  catalog.productsById.get("1").nombre = "Teclado infantil";
  assert.equal(onlineRecommendations(snapshot, catalog, cart).length, 0);
});
test("SKUs ausentes, ambiguos, stock cero, no publicados y productos de prueba", () => {
  for (const alter of [
    (list) => list.push({ ...structuredClone(list[1]), id: 99 }),
    (list) => { list[1].published = false; },
    (list) => { list[1].variants[0].stock = 0; },
    (list) => { list[1].variants[0].sku = "OTRO"; },
  ]) {
    const list = structuredClone(tnProducts); alter(list);
    assert.equal(mapOnlineCatalog(make(), list).productsById.has("2"), false);
  }
  assert.equal(make({ products: [...products, { ...products[2], id: "demo", productoPrueba: true }] }).products.length, 3);
  assert.equal(mapOnlineCatalog(make({ products: [...products, { ...products[1], id: "duplicate" }] }), tnProducts).productsById.has("2"), false);
});
test("variantes: precio promocional, stock ilimitado y correspondencia individual", () => {
  const list = structuredClone(tnProducts);
  list[1].variants[0] = { ...list[1].variants[0], promotional_price: "10000", stock_management: false, stock: null };
  const p = mapOnlineCatalog(make(), list).productsById.get("2");
  assert.equal(p.precioFinal, 10000); assert.equal(p.variante, "Negro"); assert.equal(p.stock, null);
});
test("descuento requiere aceptación vigente de esta tienda, carrito, variante, regla y versión", () => {
  assert.equal(commands()[0].command, "create_or_update_discount");
  for (const changes of [{ storeId: "other" }, { cartId: "other" }, { variantId: "102" }, { ruleId: "r2" }, { revision: "old" }, { expiresAt: 0 }]) {
    assert.equal(commands({ acceptances: [{ ...accepted, ...changes }] })[0].command, "remove_discount");
  }
  assert.equal(commands({ acceptances: [] })[0].command, "remove_discount");
});
test("retiro de principal, desactivación y cupón retiran beneficio; transferencia se conserva", () => {
  for (const change of [{ products: [withAccessory.products[1]] }, { coupons: ["CUPON"] }]) {
    assert.equal(commands({ cart: { ...withAccessory, ...change } })[0].command, "remove_discount");
  }
  assert.equal(commands({ enabled: false })[0].command, "remove_discount");
  assert.equal(commands({ snapshot: make({ ruleIds: [] }) })[0].command, "remove_discount");
  assert.equal(commands({ cart: { ...withAccessory, payment: { method: "transfer" } } })[0].command, "create_or_update_discount");
  assert.deepEqual(commands({ cart: { ...withAccessory, store_id: "1" } }), []);
  assert.deepEqual(commands({ cart: { ...withAccessory, execution_tier: "cross_items" } }), []);
});
test("se recalcula el margen con el precio del callback, cantidades y centavos", () => {
  assert.equal(commands()[0].specs.line_items[0].discount_specs.amount, "2904.00"); // margen limita 15% a 12%
  const cheaper = { ...withAccessory, products: [cart.products[0], { ...withAccessory.products[1], price: "10000" }] };
  assert.equal(commands({ cart: cheaper })[0].command, "remove_discount");
});
test("misma prioridad que mostrador: no acumula dos reglas sobre el accesorio", () => {
  const snapshot = make({ rules: [...rules, { ...rules[0], id: "r2", descuentoPct: 25 }], ruleIds: ["r1", "r2"] });
  const actual = commands({ snapshot, promotionIds: { r2: "promo2", r1: "promo1" }, acceptances: [accepted, { ...accepted, ruleId: "r2" }] });
  assert.equal(actual.filter((c) => c.command === "create_or_update_discount").length, 1);
  assert.equal(actual[0].specs.promotion_id, "promo1");
});
test("snapshot restringe campos internos y rechaza valores no finitos", () => {
  const snapshot = make({ products: products.map((p) => ({ ...p, secret: "not-sent" })), settings: { ...settings, password: "not-sent" } });
  assert.equal(JSON.stringify(snapshot).includes("not-sent"), false);
  for (const value of [NaN, Infinity, -1]) assert.throws(() => validateSnapshot({ ...snapshot, settings: { ...settings, margenMinimoPct: value } }));
  assert.equal(snapshotRevision(snapshot), snapshotRevision({ ...snapshot, generatedAt: new Date().toISOString() }));
});
test("firma rechaza cambios de cuerpo, tienda, método y replays vencidos", () => {
  const input = { key: "a".repeat(32), method: "PUT", path: "/api/cross-selling/config?storeId=7570182", timestamp: String(now.getTime()), body: "{}" };
  const signature = publicationSignature(input);
  assert.equal(verifyPublication({ ...input, signature, now: now.getTime() }), true);
  for (const changes of [{ body: "{ }" }, { method: "GET" }, { path: input.path + "1" }, { timestamp: "0" }])
    assert.equal(verifyPublication({ ...input, ...changes, signature, now: now.getTime() }), false);
  assert.equal(verifyPublication({ ...input, signature, now: now.getTime() + 300001 }), false);
  assert.equal(digest("a").length, 64);
});

function publisher(fetchImpl) {
  let document = {};
  const pub = createOnlinePublisher({ connection: { url: "https://example.com", key: "a".repeat(32), storeId: "7570182" },
    read: () => document, write: async (_name, value) => { document = value; }, source: () => ({ products, rules, settings }), fetchImpl, now: () => now });
  return pub;
}
test("publicación confirmada y falla posterior conservan la última versión", async () => {
  let fail = false;
  const pub = publisher(async (_url, options) => {
    if (fail) return { ok: false, status: 503 };
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ revision: body.revision, ready: false }) };
  });
  const published = await pub.publish();
  assert.equal(published.lastPublishedAt, now.toISOString());
  fail = true;
  await assert.rejects(pub.publish(), /HTTP 503/);
  assert.equal(pub.status().lastRevision, published.lastRevision);
  assert.match(pub.status().error, /503/);
  assert.equal(JSON.stringify(pub.status()).includes("a".repeat(32)), false);
});
test("publicación simultánea se serializa y publica cambios pendientes", async () => {
  let release, calls = 0;
  const barrier = new Promise((r) => { release = r; });
  const pub = publisher(async (_url, options) => {
    calls++; if (calls === 1) await barrier;
    return { ok: true, json: async () => ({ revision: JSON.parse(options.body).revision }) };
  });
  const first = pub.publish();
  const second = pub.publish(); release(); await Promise.all([first, second]);
  assert.equal(calls, 2);
});
test("online publica las mismas reglas que usa Mostrador, sin selección aparte", async () => {
  let sent;
  const pub = publisher(async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ revision: sent.revision }) }; });
  await pub.publish();
  assert.equal(sent.snapshot.enabled, true);
  assert.deepEqual(sent.snapshot.ruleIds, rules.map((r) => String(r.id)));
});
test("stock negativo de Contabilium no invalida la publicación: se trata como sin stock", () => {
  const snapshot = make({ products: [...products, { ...products[0], id: "neg", codigo: "NEG1", stock: -3 }] });
  assert.equal(snapshot.products.find((p) => p.id === "neg").stock, 0);
});

test("módulo de la tienda: lectura y cambio firmados en la ruta del módulo", async () => {
  const sent = [];
  const pub = publisher(async (url, options) => {
    sent.push({ url: String(url), method: options.method, body: options.body, headers: options.headers });
    const enabled = options.method === "PUT" ? JSON.parse(options.body).enabled : false;
    return { ok: true, json: async () => ({ storeId: "7570182", enabled, promotion: null, script: { found: true } }) };
  });
  assert.equal((await pub.moduleStatus()).module.enabled, false);
  const result = await pub.setModule(true);
  assert.equal(result.module.enabled, true);
  assert.equal(pub.status().module.enabled, true);
  for (const r of sent) {
    const url = new URL(r.url);
    assert.equal(url.pathname + url.search, "/api/cross-selling/module?storeId=7570182");
    assert.ok(verifyPublication({ key: "a".repeat(32), method: r.method, path: url.pathname + url.search,
      timestamp: r.headers["x-mostrador-timestamp"], signature: r.headers["x-mostrador-signature"], body: r.body || "", now: now.getTime() }));
  }
  assert.deepEqual(sent.map((r) => [r.method, r.body]), [["GET", undefined], ["PUT", '{"enabled":true}']]);
  await assert.rejects(pub.setModule("si"), /activo o inactivo/);
});

test("módulo de la tienda: muestra el error de Logitrack y rechaza confirmaciones distintas", async () => {
  const refused = publisher(async () => ({ ok: false, status: 403, json: async () => ({ error: "El módulo todavía no está habilitado para esta tienda" }) }));
  await assert.rejects(refused.setModule(true), /no está habilitado para esta tienda \(HTTP 403\)/);
  const unsigned = publisher(async () => ({ ok: false, status: 401, json: async () => { throw new Error("sin cuerpo"); } }));
  await assert.rejects(unsigned.moduleStatus(), /no pudo cambiar el módulo \(HTTP 401\)/);
  const stale = publisher(async () => ({ ok: true, json: async () => ({ enabled: false }) }));
  await assert.rejects(stale.setModule(true), /no confirmó/);
  const missing = createOnlinePublisher({ connection: {}, read: () => ({}), write: async () => {}, source: () => ({}) });
  await assert.rejects(missing.setModule(true), /Configurá la conexión/);
});
