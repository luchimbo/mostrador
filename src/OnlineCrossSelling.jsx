import { useEffect, useState } from "react";
import { api } from "./lib.js";

export default function OnlineCrossSelling() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    api("/crossselling-online").then((state) => { if (mounted) setStatus(state); })
      .catch((e) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);
  async function act(action) {
    setBusy(true); setError(""); setMessage("");
    try {
      if (action === "publish") {
        setStatus(await api("/crossselling-online/publicar", { method: "POST" }));
        setMessage("Reglas publicadas en la tienda online.");
      } else {
        setStatus(await api("/crossselling-online/estado", { method: "POST" }));
      }
    } catch (e) {
      setError(e.message);
      // Recuperar también el error persistido y la última publicación confirmada.
      try { setStatus(await api("/crossselling-online")); } catch { /* mantener el estado anterior */ }
    } finally { setBusy(false); }
  }
  return <section>
    <h2>Cross-selling en la tienda online</h2>
    <p>La tienda online usa las mismas reglas de Recomendaciones que el mostrador. Cada vez que guardás una regla, un ajuste o se actualiza el catálogo, se publica sola.</p>
    {error && <p className="aviso error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!status ? <p>Cargando configuración…</p> : <>
      {!status.configured && <p className="aviso">Falta configurar la conexión con Logitrack en el servidor.</p>}
      <p><b>Tienda:</b> {status.storeId || "Sin configurar"}<br />
        <b>Última publicación:</b> {status.lastPublishedAt ? new Date(status.lastPublishedAt).toLocaleString("es-AR") : "Todavía no se publicó"}</p>
      {status.error && status.error !== error && <p className="aviso error">{status.error}</p>}
      <div className="acciones">
        <button disabled={busy || !status.configured} onClick={() => act("publish")}>{busy ? "Procesando…" : "Publicar ahora"}</button>
        <button disabled={busy || !status.configured} onClick={() => act("status")}>Consultar estado en Logitrack</button>
      </div>
      {status.remote?.mappedProducts != null && <p>{status.remote.mappedProducts} productos vinculados por SKU. {status.remote.excluded?.length || 0} sin correspondencia válida.</p>}
    </>}
  </section>;
}
