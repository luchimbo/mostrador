import { buildSnapshot } from "../shared/online-crossselling.js";
import { publicationSignature, snapshotRevision } from "../shared/publish-protocol.js";

const DOCUMENT = "crossselling-online.json";
const defaults = { lastPublishedAt: null, lastRevision: null, error: null };

export function createOnlinePublisher({ connection, read, write, source, fetchImpl = fetch, now = () => new Date() }) {
  let running = null, pending = false;
  const configured = Boolean(connection.url && connection.key?.length >= 32 && /^\d+$/.test(connection.storeId));
  const state = () => ({ ...defaults, ...read(DOCUMENT, {}) });
  function status() {
    const s = state();
    return { ...s, configured, storeId: connection.storeId || null };
  }
  async function request(method, body = "") {
    const base = new URL(connection.url);
    if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("Logitrack debe usar HTTPS");
    const url = new URL("/api/cross-selling/config", base);
    url.searchParams.set("storeId", connection.storeId);
    const path = url.pathname + url.search, timestamp = String(now().getTime());
    const response = await fetchImpl(url, { method, body: method === "GET" ? undefined : body, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", "x-mostrador-timestamp": timestamp,
        "x-mostrador-signature": publicationSignature({ key: connection.key, method, path, timestamp, body }) } });
    if (!response.ok) throw new Error(`Logitrack no pudo recibir la configuración (HTTP ${response.status})`);
    return response.json();
  }
  async function publishOnce() {
    if (!configured) throw new Error("Configurá la conexión de cross-selling con Logitrack en el servidor");
    try {
      // Online usa exactamente las reglas de Mostrador; el motor ignora las desactivadas.
      const data = source();
      const snapshot = buildSnapshot({ ...data, storeId: connection.storeId, enabled: true,
        ruleIds: data.rules.map((r) => String(r.id)), now: now() });
      const revision = snapshotRevision(snapshot);
      const result = await request("PUT", JSON.stringify({ snapshot, revision }));
      if (result.revision !== revision) throw new Error("Logitrack no confirmó la versión publicada");
      await write(DOCUMENT, { ...state(), lastPublishedAt: now().toISOString(), lastRevision: revision, error: null, remote: result });
      return status();
    } catch (err) {
      await write(DOCUMENT, { ...state(), error: err.message });
      throw err;
    }
  }
  function publish() {
    pending = true;
    if (!running) running = (async () => {
      let result;
      do { pending = false; result = await publishOnce(); } while (pending);
      return result;
    })().finally(() => { running = null; });
    return running;
  }
  // Guardar una regla local nunca depende de la disponibilidad de la tienda online.
  function schedule() { if (configured) void publish().catch(() => {}); }
  async function remoteStatus() {
    if (!configured) return status();
    const remote = await request("GET");
    await write(DOCUMENT, { ...state(), remote });
    return status();
  }
  return { status, publish, schedule, remoteStatus };
}
