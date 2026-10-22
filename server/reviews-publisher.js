import crypto from "node:crypto";
import { buildReviewsSnapshot, normalizeReview, reviewKey } from "../shared/reviews.js";
import { publicationSignature, snapshotRevision } from "../shared/publish-protocol.js";

const DOCUMENT = "resenas.json";
const defaults = { reviews: [], enabled: false, lastPublishedAt: null, lastRevision: null, error: null };

// Reseñas de productos: se cargan y moderan en Mostrador y se publican a Logitrack con la misma firma
// que el cross-selling. «enabled» viaja dentro de la publicación: apagado, la tienda no muestra nada.
export function createReviewsPublisher({ connection, read, write, knownSkus = () => null, fetchImpl = fetch, now = () => new Date() }) {
  let running = null, pending = false, queue = Promise.resolve();
  const configured = Boolean(connection.url && connection.key?.length >= 32 && /^\d+$/.test(connection.storeId));
  const state = () => ({ ...defaults, ...read(DOCUMENT, {}) });
  const save = (patch) => write(DOCUMENT, { ...state(), ...patch });
  // Las altas y bajas se encadenan: dos pedidos seguidos no pueden pisarse la lista.
  const mutate = (fn) => (queue = queue.catch(() => {}).then(async () => {
    const out = await fn(state().reviews);
    await save({ reviews: out.reviews });
    return out.result;
  }));
  function status() {
    const { reviews, ...rest } = state();
    const published = reviews.filter((r) => r.estado === "publicada");
    return { ...rest, configured, storeId: connection.storeId || null, total: reviews.length,
      pendientes: reviews.filter((r) => r.estado === "pendiente").length, publicadas: published.length,
      productos: new Set(published.map((r) => r.sku)).size };
  }
  const list = () => state().reviews;
  async function request(method, body = "", endpoint = "/api/reviews/config", timeout = 30_000) {
    const base = new URL(connection.url);
    if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("Logitrack debe usar HTTPS");
    const url = new URL(endpoint, base);
    url.searchParams.set("storeId", connection.storeId);
    const path = url.pathname + url.search, timestamp = String(now().getTime());
    const response = await fetchImpl(url, { method, body: method === "GET" ? undefined : body, redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { "Content-Type": "application/json", "x-mostrador-timestamp": timestamp,
        "x-mostrador-signature": publicationSignature({ key: connection.key, method, path, timestamp, body }) } });
    if (!response.ok) {
      const detail = await response.json().then((b) => b?.error).catch(() => null);
      throw new Error(`${detail || "Logitrack no pudo procesar las reseñas"} (HTTP ${response.status})`);
    }
    return response.json();
  }
  async function publishOnce() {
    if (!configured) throw new Error("Configurá la conexión con Logitrack en el servidor");
    try {
      const s = state();
      const snapshot = buildReviewsSnapshot({ storeId: connection.storeId, reviews: s.reviews, enabled: s.enabled, now: now() });
      const revision = snapshotRevision(snapshot);
      const result = await request("PUT", JSON.stringify({ snapshot, revision }));
      if (result.revision !== revision) throw new Error("Logitrack no confirmó la versión publicada");
      await save({ lastPublishedAt: now().toISOString(), lastRevision: revision, error: null });
      return status();
    } catch (err) { await save({ error: err.message }); throw err; }
  }
  function publish() {
    pending = true;
    if (!running) running = (async () => { let r; do { pending = false; r = await publishOnce(); } while (pending); return r; })().finally(() => { running = null; });
    return running;
  }
  async function setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new Error("Indicá si el módulo queda activo o inactivo");
    await save({ enabled });
    return publish();
  }
  // Opiniones de Mercado Libre: Logitrack las lee con la cuenta vinculada; acá entran como «pendiente» para revisarlas.
  let importing = null;
  function importMeli() {
    return importing ||= (async () => {
      if (!configured) throw new Error("Configurá la conexión con Logitrack en el servidor");
      try {
        const data = await request("GET", "", "/api/reviews/meli", 290_000);
        const known = knownSkus();
        const summary = { at: now().toISOString(), items: data.items, withoutSku: data.withoutSkuCount, withoutText: data.withoutText,
          withoutReviews: data.withoutReviews, errors: data.errors, found: data.reviews.length, imported: 0, repeated: 0, unknownSku: 0, invalid: 0 };
        await mutate((all) => {
          const external = new Set(all.map((r) => r.externalId && `${r.externalId}|${r.sku}`).filter(Boolean));
          const keys = new Set(all.map(reviewKey)), added = [];
          for (const raw of data.reviews) {
            let review;
            try { review = normalizeReview({ ...raw, autor: "Comprador de MercadoLibre", origen: "mercadolibre", estado: "pendiente" }); }
            catch { summary.invalid++; continue; }
            if (known && !known.has(review.sku)) { summary.unknownSku++; continue; }
            const ext = `${review.externalId}|${review.sku}`;
            if (external.has(ext) || keys.has(reviewKey(review))) { summary.repeated++; continue; }
            external.add(ext); keys.add(reviewKey(review));
            added.push({ ...review, id: crypto.randomUUID() });
          }
          summary.imported = added.length;
          return { reviews: [...added, ...all], result: null };
        });
        await save({ meli: summary });
        return summary;
      } catch (err) {
        await save({ meli: { ...(state().meli || {}), at: now().toISOString(), error: err.message } });
        throw err;
      } finally { importing = null; }
    })();
  }
  return { status, list, mutate, publish, setEnabled, importMeli, remoteStatus: () => configured ? request("GET") : null };
}
