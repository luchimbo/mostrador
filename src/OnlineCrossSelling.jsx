import { useEffect, useMemo, useState } from "react";
import { api, buscar } from "./lib.js";

export default function OnlineCrossSelling({ productos }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [moduleError, setModuleError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const excluidos = useMemo(() => {
    const nombres = new Map();
    for (const p of productos) {
      const codigo = String(p.codigo || "").trim().toUpperCase();
      if (!codigo || !p.nombre) continue;
      const existentes = nombres.get(codigo) || new Set();
      existentes.add(p.nombre);
      nombres.set(codigo, existentes);
    }
    return (status?.remote?.excluded || []).map((p) => ({
      codigo: p.sku,
      nombre: [...(nombres.get(String(p.sku).trim().toUpperCase()) || [])].join(" / "),
      motivo: p.reason,
    }));
  }, [productos, status?.remote?.excluded]);
  const visibles = buscar(excluidos, busqueda);
  useEffect(() => {
    let mounted = true;
    api("/crossselling-online").then((state) => {
      if (!mounted) return;
      setStatus(state);
      // El estado del módulo vive en Logitrack: consultarlo al abrir el panel.
      if (state.configured) api("/crossselling-online/modulo").then((s) => { if (mounted) setStatus(s); })
        .catch((e) => { if (mounted) setModuleError(e.message); });
    }).catch((e) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);
  async function toggleModule(enabled) {
    const question = enabled
      ? `¿Activar «Completá tu equipo» en la tienda online ${status.storeId}? Los clientes verán las sugerencias con descuento al agregar productos al carrito.`
      : `¿Desactivar «Completá tu equipo» en la tienda online ${status.storeId}? Se dejan de mostrar las sugerencias y se retiran los descuentos aceptados.`;
    if (!confirm(question)) return;
    setBusy(true); setModuleError(""); setMessage("");
    try {
      setStatus(await api("/crossselling-online/modulo", { method: "PUT", body: { enabled } }));
      setMessage(enabled ? "Módulo activado en la tienda online." : "Módulo desactivado en la tienda online.");
    } catch (e) {
      setModuleError(e.message);
      try { setStatus(await api("/crossselling-online/modulo")); } catch { /* mantener el estado anterior */ }
    } finally { setBusy(false); }
  }
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
      {status.configured && <div className="modulo-online">
        <label className="check">
          <input type="checkbox" checked={Boolean(status.module?.enabled)} disabled={busy || !status.module}
            onChange={(e) => toggleModule(e.target.checked)} />
          <b>Activo en la tienda online</b>
        </label>
        {!status.module && !moduleError && <p>Consultando el módulo en la tienda…</p>}
        {status.module && <p>
          Promoción en Tiendanube: {status.module.promotion ? (status.module.promotion.active ? "activa" : "inactiva") : "todavía no creada"}
          {" · "}Script del módulo: {status.module.script?.error ? "no se pudo consultar" : status.module.script?.found ? "disponible" : "no encontrado"}
        </p>}
        {moduleError && <p className="aviso error" role="alert">{moduleError}</p>}
      </div>}
      <div className="acciones">
        <button disabled={busy || !status.configured} onClick={() => act("publish")}>{busy ? "Procesando…" : "Publicar ahora"}</button>
        <button disabled={busy || !status.configured} onClick={() => act("status")}>Consultar estado en Logitrack</button>
      </div>
      {status.remote?.mappedProducts != null && <>
        <p>{status.remote.mappedProducts} productos vinculados por SKU. {excluidos.length} excluidos de las recomendaciones online.</p>
        {excluidos.length > 0 && <details className="excluidos-online">
          <summary>Ver {excluidos.length} productos excluidos</summary>
          <p>El detalle corresponde a la última publicación. Un producto puede quedar excluido por su SKU, publicación, precio o stock.</p>
          <label className="buscar-excluidos-online">
            Buscar por nombre o SKU
            <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o SKU del producto" />
          </label>
          <p role="status">Mostrando {visibles.length} de {excluidos.length} productos</p>
          {visibles.length === 0 ? <p>No hay productos que coincidan con la búsqueda.</p> : <div className="tabla-excluidos-online" role="region" aria-label="Productos excluidos de las recomendaciones online" tabIndex={0}>
            <table>
              <thead><tr><th scope="col">SKU</th><th scope="col">Producto</th><th scope="col">Motivo de exclusión</th></tr></thead>
              <tbody>{visibles.map((p) => <tr key={p.codigo}>
                <td>{p.codigo}</td><td>{p.nombre || "Nombre no disponible en el catálogo actual"}</td><td>{p.motivo}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          <p className="nota-excluidos-online">«No publicado, sin precio o sin stock» agrupa esas tres causas; el diagnóstico actual no las distingue.</p>
        </details>}
      </>}
    </>}
  </section>;
}
