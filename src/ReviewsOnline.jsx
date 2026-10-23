import { useEffect, useRef, useState } from "react";
import { api } from "./lib.js";

const ORIGENES = { mercadolibre: "MercadoLibre", google: "Google", cliente: "Cliente de PC MIDI" };
const ESTADOS = { pendiente: "Pendiente", publicada: "Publicada", oculta: "Oculta" };
const hoy = () => new Date().toISOString().slice(0, 10);
const vacia = { sku: "", rating: "5", autor: "", texto: "", fecha: hoy(), origen: "mercadolibre", enlace: "" };

export default function ReviewsOnline({ productos }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  const [form, setForm] = useState(vacia);
  const [preview, setPreview] = useState(null);
  // Son miles de opiniones: el servidor filtra y manda sólo la primera tanda.
  const consulta = `/resenas?estado=${filtro === "todas" ? "" : filtro}&q=${encodeURIComponent(busqueda.trim())}&limit=100`;
  const consultaRef = useRef(consulta);
  consultaRef.current = consulta;
  const cargar = () => api(consultaRef.current).then(setData).catch((e) => setError(e.message));
  useEffect(() => { const t = setTimeout(cargar, busqueda ? 300 : 0); return () => clearTimeout(t); }, [consulta]);
  // La búsqueda en MercadoLibre corre en el servidor: se consulta el avance hasta que termina.
  const importando = Boolean(data?.importando);
  useEffect(() => {
    if (!importando) return undefined;
    const t = setInterval(cargar, 5000);
    return () => clearInterval(t);
  }, [importando]);

  async function run(fn, okMessage) {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); if (okMessage) setMessage(okMessage); } catch (e) { setError(e.message); } finally { setBusy(false); await cargar(); }
  }
  const toggle = (enabled) => {
    const q = enabled ? "¿Mostrar las reseñas aprobadas en la tienda online?" : "¿Ocultar las reseñas de la tienda online?";
    if (confirm(q)) run(() => api("/resenas/modulo", { method: "PUT", body: { enabled } }), enabled ? "Reseñas activadas en la tienda." : "Reseñas desactivadas en la tienda.");
  };
  const cambiar = (r, estado) => run(() => api(`/resenas/${r.id}`, { method: "PUT", body: { estado } }));
  const configurarVista = (patch) => run(() => api("/resenas/visualizacion", { method: "PUT", body: {
    minRating: data.minRating ?? 1, showMeliLink: data.showMeliLink ?? true, ...patch,
  } }), "Opciones guardadas y publicadas en la tienda.");
  const borrar = (r) => confirm(`¿Borrar la opinión de ${r.autor}?`) && run(() => api(`/resenas/${r.id}`, { method: "DELETE" }));
  const agregar = (e) => {
    e.preventDefault();
    run(async () => { await api("/resenas", { method: "POST", body: form }); setForm({ ...vacia, origen: form.origen }); }, "Opinión cargada como pendiente.");
  };
  async function elegirArchivo(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    try { const csv = await file.text(); setPreview({ csv, ...(await api("/resenas/importar", { method: "POST", body: { csv, confirmar: false } })) }); }
    catch (err) { setError(err.message); }
  }
  const confirmarImport = () => run(async () => {
    const r = await api("/resenas/importar", { method: "POST", body: { csv: preview.csv, confirmar: true } });
    setPreview(null);
    setMessage(`Se cargaron ${r.importadas} opiniones como pendientes${r.repetidas ? ` (${r.repetidas} repetidas, omitidas)` : ""}.`);
  });

  const visibles = data?.reviews || [];
  const aprobarPendientes = () => confirm(`¿Aprobar las ${data.pendientes} opiniones pendientes (las de CSV o carga manual)? Quedan listas para publicar.`) &&
    run(async () => { const r = await api("/resenas/aprobar-pendientes", { method: "POST", body: {} }); setMessage(`Se aprobaron ${r.aprobadas} opiniones. Falta «Publicar ahora».`); });

  return <section>
    <h2>Reseñas en la tienda online</h2>
    <p>Cargá opiniones <b>reales</b> de clientes (MercadoLibre, Google, mensajes) y aprobá las que se muestran en la ficha de cada producto. Cada una se publica con su origen; no se cargan opiniones inventadas.</p>
    {error && <p className="aviso error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!data ? <p>Cargando reseñas…</p> : <>
      {!data.configured && <p className="aviso">Falta configurar la conexión con Logitrack en el servidor.</p>}
      <p><b>Tienda:</b> {data.storeId || "Sin configurar"} · <b>Última publicación:</b> {data.lastPublishedAt ? new Date(data.lastPublishedAt).toLocaleString("es-AR") : "todavía no se publicó"}<br />
        {data.total} cargadas · {data.pendientes} pendientes · {data.publicadas} aprobadas en {data.productos} productos</p>
      {data.error && <p className="aviso error">{data.error}</p>}
      <div className="modulo-online">
        <label className="check">
          <input type="checkbox" checked={Boolean(data.enabled)} disabled={busy || !data.configured} onChange={(e) => toggle(e.target.checked)} />
          <b>Activo en la tienda online</b>
        </label>
      </div>
      <div className="filtros-resenas">
        <label>Opiniones que se muestran<select value={data.minRating ?? 1} disabled={busy || !data.configured}
          onChange={(e) => configurarVista({ minRating: Number(e.target.value) })}>
          <option value={1}>Todas las estrellas</option>
          <option value={4}>Solo 4 y 5 estrellas (ocultar bloque si el promedio es menor a 4)</option>
        </select></label>
        <label className="check"><input type="checkbox" checked={data.showMeliLink ?? true} disabled={busy || !data.configured}
          onChange={(e) => configurarVista({ showMeliLink: e.target.checked })} />Mostrar enlace a Mercado Libre en la tienda</label>
      </div>
      <p className="nota-resenas">Estas opciones se guardan y publican al cambiarlas. El promedio y el total incluyen todas las opiniones aprobadas; con el filtro de 4 y 5 estrellas, si el promedio es menor a 4 se oculta todo el bloque y las estrellas del producto. Al ocultar el enlace, el origen MercadoLibre sigue visible y las opiniones se conservan.</p>
      <div className="acciones">
        <button disabled={busy || !data.configured} onClick={() => run(() => api("/resenas/publicar", { method: "POST" }), "Reseñas publicadas en la tienda online.")}>{busy ? "Procesando…" : "Publicar ahora"}</button>
        <button disabled={busy || importando || !data.configured} onClick={() => run(() => api("/resenas/mercadolibre", { method: "POST" }), "Búsqueda en MercadoLibre iniciada.")}>
          {importando ? "Buscando en MercadoLibre…" : "Buscar en MercadoLibre"}</button>
        {data.pendientes > 0 && <button disabled={busy} onClick={aprobarPendientes}>Aprobar las {data.pendientes} pendientes</button>}
        <label className="boton-archivo">Importar CSV
          <input type="file" accept=".csv,text/csv" onChange={elegirArchivo} disabled={busy} hidden />
        </label>
      </div>
      {data.meli && <p className="nota-resenas">
        <b>MercadoLibre</b> (se busca sola una vez por semana; las nuevas entran ya aprobadas y, con el módulo activo, salen a la tienda solas): {data.meli.at ? `última búsqueda ${new Date(data.meli.at).toLocaleString("es-AR")}.` : "todavía no terminó ninguna búsqueda."}
        {data.meli.error ? ` Error en el último intento: ${data.meli.error}` : ` ${data.meli.items} publicaciones revisadas, ${data.meli.found} opiniones con texto, ${data.meli.imported} nuevas, ${data.meli.repeated} ya cargadas.`}
        {data.meli.partial && ` Quedó incompleta: ${data.meli.partial}`}
        {data.meli.errors > 0 && data.meli.firstError && ` Primer error de MercadoLibre: ${data.meli.firstError}`}
        {!data.meli.error && (data.meli.withoutSku > 0 || data.meli.unknownSku > 0 || data.meli.withoutText > 0 || data.meli.errors > 0) && ` Omitidas: ${data.meli.withoutSku} publicaciones sin SKU, ${data.meli.unknownSku} con SKU que no está en el catálogo, ${data.meli.withoutText} calificaciones sin texto, ${data.meli.errors} publicaciones con error.`}
      </p>}
      {importando && <p className="aviso pendiente" role="status">Buscando opiniones en MercadoLibre. Tarda varios minutos (hasta unos 15); podés seguir usando Mostrador y esta pantalla se actualiza sola.</p>}
      <p className="nota-resenas">Columnas del CSV: sku, rating (1 a 5), autor, texto, fecha (AAAA-MM-DD), origen (mercadolibre, google o cliente) y link (opcional). Se cargan como pendientes y no se muestran hasta que las apruebes y publiques.</p>

      {preview && <div className="aviso pendiente" role="status">
        <b>Vista previa:</b> {preview.importables} opiniones se pueden importar{preview.totalErrores > 0 && `, ${preview.totalErrores} filas con errores`}.
        {preview.skuDesconocidos.length > 0 && <p>SKU que no están en el catálogo (se omiten): {preview.skuDesconocidos.slice(0, 10).join(", ")}{preview.skuDesconocidos.length > 10 && "…"}</p>}
        {preview.errores.length > 0 && <ul>{preview.errores.slice(0, 8).map((x) => <li key={x.line}>Línea {x.line}: {x.error}</li>)}</ul>}
        <div className="acciones">
          <button disabled={busy || preview.importables === 0} onClick={confirmarImport}>Importar {preview.importables}</button>
          <button disabled={busy} onClick={() => setPreview(null)}>Cancelar</button>
        </div>
      </div>}

      <details className="excluidos-online">
        <summary>Cargar una opinión a mano</summary>
        <form onSubmit={agregar} className="form-resena">
          <label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} list="skus-resenas" /></label>
          <datalist id="skus-resenas">{productos.slice(0, 500).map((p) => <option key={p.id} value={p.codigo}>{p.nombre}</option>)}</datalist>
          <label>Estrellas<select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Autor (ej. Juan P.)<input required maxLength={60} value={form.autor} onChange={(e) => setForm({ ...form, autor: e.target.value })} /></label>
          <label>Fecha<input type="date" required max={hoy()} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></label>
          <label>Origen<select value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })}>{Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Link de origen (opcional)<input type="url" placeholder="https://" value={form.enlace} onChange={(e) => setForm({ ...form, enlace: e.target.value })} /></label>
          <label className="ancho">Opinión<textarea required rows={3} maxLength={1500} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} /></label>
          <button disabled={busy}>Cargar opinión</button>
        </form>
      </details>

      <div className="filtros-resenas">
        <label>Estado<select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="todas">Todas</option>{Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Buscar<input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="SKU, producto, autor o texto" /></label>
      </div>
      <p role="status">Mostrando {visibles.length} de {data.coinciden}{data.coinciden > visibles.length && " (afiná el filtro o la búsqueda para ver el resto)"}</p>
      {visibles.length > 0 && <div className="tabla-excluidos-online" role="region" aria-label="Reseñas cargadas" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Producto</th><th scope="col">★</th><th scope="col">Opinión</th><th scope="col">Origen</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
          <tbody>{visibles.map((r) => <tr key={r.id}>
            <td>{r.sku}<br /><small>{r.producto || "Fuera del catálogo actual"}</small></td>
            <td>{r.rating}</td>
            <td><b>{r.autor}</b> · {r.fecha}<br />{r.texto}</td>
            <td>{r.enlace ? <a href={r.enlace} target="_blank" rel="noreferrer">{ORIGENES[r.origen]}</a> : ORIGENES[r.origen]}</td>
            <td>{ESTADOS[r.estado]}</td>
            <td>
              {r.estado !== "publicada" && <button disabled={busy} onClick={() => cambiar(r, "publicada")}>Aprobar</button>}
              {r.estado !== "oculta" && <button disabled={busy} onClick={() => cambiar(r, "oculta")}>Ocultar</button>}
              <button disabled={busy} onClick={() => borrar(r)}>Borrar</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
      <p className="nota-resenas">Aprobar u ocultar no cambia la tienda hasta que toques «Publicar ahora».</p>
    </>}
  </section>;
}
