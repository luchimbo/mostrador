import { buildReviewsSnapshot } from "../shared/reviews.js";
import { publicationSignature, snapshotRevision } from "../shared/publish-protocol.js";

const DOCUMENT = "resenas.json";
const defaults = { reviews: [], enabled: false, lastPublishedAt: null, lastRevision: null, error: null };

// Reseñas de productos: se cargan y moderan en Mostrador y se publican a Logitrack con la misma firma
// que el cross-selling. «enabled» viaja dentro de la publicación: apagado, la tienda no muestra nada.
export function createReviewsPublisher({ connection, read, write, fetchImpl = fetch, now = () => new Date() }) {
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
  async function request(method, body = "") {
    const base = new URL(connection.url);
    if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("Logitrack debe usar HTTPS");
    const url = new URL("/api/reviews/config", base);
    url.searchParams.set("storeId", connection.storeId);
    const path = url.pathname + url.search, timestamp = String(now().getTime());
    const response = await fetchImpl(url, { method, body: method === "GET" ? undefined : body, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", "x-mostrador-timestamp": timestamp,
        "x-mostrador-signature": publicationSignature({ key: connection.key, method, path, timestamp, body }) } });
    if (!response.ok) throw new Error(`Logitrack no pudo recibir las reseñas (HTTP ${response.status})`);
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
  return { status, list, mutate, publish, setEnabled, remoteStatus: () => configured ? request("GET") : null };
}
