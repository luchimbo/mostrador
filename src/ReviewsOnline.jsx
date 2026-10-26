import { useEffect, useRef, useState } from "react";
import { api } from "./lib.js";
import { BarraCambios, Cabecera, Interruptor, Kpis, Pildora, Segmentos, fechaHora } from "./ui.jsx";

const ORIGENES = { mercadolibre: "MercadoLibre", google: "Google", cliente: "Cliente de PC MIDI" };
const SOLAPAS = { pendiente: "Para revisar", publicada: "Publicadas", oculta: "Ocultas", "": "Todas" };
const hoy = () => new Date().toISOString().slice(0, 10);
const vacia = { sku: "", rating: "5", autor: "", texto: "", fecha: hoy(), origen: "mercadolibre", enlace: "" };
const estrellas = (n) => <span className="estrellas-fila" aria-label={`${n} estrellas`}>{"★".repeat(n)}<span>{"★".repeat(5 - n)}</span></span>;

export default function ReviewsOnline({ productos }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filtro, setFiltro] = useState("pendiente");
  const [busqueda, setBusqueda] = useState("");
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const archivo = useRef(null);
  // Son miles de opiniones: el servidor filtra y manda sólo la primera tanda.
  const consulta = `/resenas?estado=${filtro}&q=${encodeURIComponent(busqueda.trim())}&limit=100`;
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
  const borrar = (r) => confirm(`¿Borrar la opinión de ${r.autor}? No se puede deshacer.`) && run(() => api(`/resenas/${r.id}`, { method: "DELETE" }));
  const agregar = (e) => {
    e.preventDefault();
    run(async () => { await api("/resenas", { method: "POST", body: form }); setForm({ ...vacia, origen: form.origen }); }, "Opinión cargada para revisar.");
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
    setPreview(null); setFiltro("pendiente");
    setMessage(`Se cargaron ${r.importadas} opiniones para revisar${r.repetidas ? ` (${r.repetidas} repetidas, omitidas)` : ""}.`);
  });

  if (!data) return <p role="status">{error || "Cargando reseñas…"}</p>;
  const visibles = data.reviews || [];
  const sinConexion = !data.configured;
  const aprobarPendientes = () => confirm(`¿Aprobar las ${data.pendientes} opiniones para revisar?`) &&
    run(async () => { const r = await api("/resenas/aprobar-pendientes", { method: "POST", body: {} }); setMessage(`Se aprobaron ${r.aprobadas} opiniones.`); });
  const meli = data.meli;

  return <section className="seccion-resenas">
    <Cabecera titulo="Reseñas" descripcion="Opiniones reales de clientes en la ficha de cada producto, siempre con su origen. No se cargan opiniones inventadas.">
      <span className="metrica">Visible en la tienda</span>
      <Interruptor activo={data.enabled} onCambiar={toggle} disabled={busy || sinConexion} etiqueta="Reseñas visibles en la tienda online" />
    </Cabecera>
    {sinConexion && <p className="aviso">Falta configurar la conexión con Logitrack en el servidor.</p>}
    {error && <p className="aviso error" role="alert">{error}</p>}
    {message && <p className="aviso ok" role="status">{message}</p>}
    {data.error && <p className="aviso error">Última publicación con error: {data.error}</p>}

    <Kpis items={[
      { etiqueta: "Publicadas", valor: data.publicadas.toLocaleString("es-AR"), detalle: `en ${data.productos} productos`, onClick: () => setFiltro("publicada") },
      { etiqueta: "Para revisar", valor: data.pendientes.toLocaleString("es-AR"), detalle: "cargadas por CSV o a mano", aviso: data.pendientes > 0, onClick: () => setFiltro("pendiente") },
      { etiqueta: "Promedio", valor: data.promedio != null ? `${data.promedio.toLocaleString("es-AR")} ★` : "—", detalle: "de las publicadas" },
      { etiqueta: "Ocultas", valor: (data.ocultas ?? 0).toLocaleString("es-AR"), detalle: "no se muestran", onClick: () => setFiltro("oculta") },
    ]} />

    <div className="dos-columnas">
      <div className="tarjeta">
        <h3>Cómo se ven en la tienda</h3>
        <Segmentos etiqueta="Qué opiniones se muestran" valor={data.minRating ?? 1} onCambiar={(minRating) => !busy && !sinConexion && configurarVista({ minRating })}
          opciones={[[1, "Todas las estrellas"], [4, "Solo 4 y 5 ★"]]} />
        <label className="check"><input type="checkbox" checked={data.showMeliLink ?? true} disabled={busy || sinConexion}
          onChange={(e) => configurarVista({ showMeliLink: e.target.checked })} />Enlace «Ver en Mercado Libre»</label>
        <p className="metrica">Se publican al cambiarlas. Con «Solo 4 y 5», si el promedio de un producto es menor a 4 no se muestra su bloque. El promedio cuenta todas las opiniones aprobadas.</p>
      </div>
      <div className="tarjeta">
        <h3>De dónde vienen</h3>
        <div className="fuente">
          <span><b>MercadoLibre</b><small>{importando ? "Buscando… tarda varios minutos" : meli?.at ? `Sola cada semana · última ${fechaHora(meli.at)} · ${meli.imported} nuevas` : "Sola cada semana · todavía no terminó ninguna búsqueda"}</small></span>
          <button disabled={busy || importando || sinConexion} onClick={() => run(() => api("/resenas/mercadolibre", { method: "POST" }), "Búsqueda en MercadoLibre iniciada.")}>{importando ? "Buscando…" : "Buscar ahora"}</button>
        </div>
        {meli && (meli.error || meli.partial || meli.withoutSku > 0 || meli.unknownSku > 0 || meli.errors > 0) && <details className="metrica detalle-meli">
          <summary>{meli.error ? <Pildora tipo="error">Error en el último intento</Pildora> : "Detalle de la última búsqueda"}</summary>
          {meli.error ? <p>{meli.error}</p> : <p>{meli.items} publicaciones revisadas, {meli.found} opiniones con texto, {meli.imported} nuevas, {meli.repeated} ya cargadas.
            Omitidas: {meli.withoutSku} publicaciones sin SKU, {meli.unknownSku} con SKU fuera del catálogo, {meli.withoutText} sin texto, {meli.errors} con error.
            {meli.partial && ` Quedó incompleta: ${meli.partial}`}{meli.firstError && ` Primer error: ${meli.firstError}`}</p>}
        </details>}
        <div className="fuente">
          <span><b>Archivo CSV</b><small title="Columnas: sku, rating (1 a 5), autor, texto, fecha (AAAA-MM-DD), origen (mercadolibre, google o cliente) y link (opcional).">Google, mensajes · columnas sku, rating, autor, texto, fecha, origen, link</small></span>
          <button disabled={busy} onClick={() => archivo.current?.click()}>Importar</button>
          <input ref={archivo} type="file" accept=".csv,text/csv" onChange={elegirArchivo} hidden />
        </div>
        <div className="fuente">
          <span><b>A mano</b><small>Una opinión que te pasaron</small></span>
          <button onClick={() => setForm(form ? null : vacia)}>{form ? "Cancelar" : "Cargar"}</button>
        </div>
        <p className="metrica">Las de MercadoLibre entran ya aprobadas. Las de CSV o a mano esperan tu revisión.</p>
      </div>
    </div>

    {preview && <div className="aviso pendiente" role="status">
      <b>Vista previa:</b> {preview.importables} opiniones se pueden importar{preview.totalErrores > 0 && `, ${preview.totalErrores} filas con errores`}.
      {preview.skuDesconocidos.length > 0 && <p>SKU que no están en el catálogo (se omiten): {preview.skuDesconocidos.slice(0, 10).join(", ")}{preview.skuDesconocidos.length > 10 && "…"}</p>}
      {preview.errores.length > 0 && <ul>{preview.errores.slice(0, 8).map((x) => <li key={x.line}>Línea {x.line}: {x.error}</li>)}</ul>}
      <div className="fila-botones">
        <button className="primario" disabled={busy || preview.importables === 0} onClick={confirmarImport}>Importar {preview.importables}</button>
        <button disabled={busy} onClick={() => setPreview(null)}>Cancelar</button>
      </div>
    </div>}

    {form && <form onSubmit={agregar} className="tarjeta form-resena">
      <label>SKU<input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} list="skus-resenas" /></label>
      <datalist id="skus-resenas">{productos.slice(0, 500).map((p) => <option key={p.id} value={p.codigo}>{p.nombre}</option>)}</datalist>
      <label>Estrellas<select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></label>
      <label>Autor (ej. Juan P.)<input required maxLength={60} value={form.autor} onChange={(e) => setForm({ ...form, autor: e.target.value })} /></label>
      <label>Fecha<input type="date" required max={hoy()} value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></label>
      <label>Origen<select value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })}>{Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Link de origen (opcional)<input type="url" placeholder="https://" value={form.enlace} onChange={(e) => setForm({ ...form, enlace: e.target.value })} /></label>
      <label className="ancho">Opinión<textarea required rows={3} maxLength={1500} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} /></label>
      <button className="primario" disabled={busy}>Cargar opinión</button>
    </form>}

    <div className="tarjeta">
      <div className="tarjeta-titulo">
        <Segmentos etiqueta="Estado" valor={filtro} onCambiar={setFiltro}
          opciones={Object.entries(SOLAPAS).map(([k, v]) => [k, <>{v}{k === "pendiente" && data.pendientes > 0 && <span className="contador aviso">{data.pendientes}</span>}</>])} />
        <span className="fila-botones">
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="SKU, producto, autor o texto" />
          {filtro === "pendiente" && data.pendientes > 0 && <button disabled={busy} onClick={aprobarPendientes}>Aprobar las {data.pendientes}</button>}
        </span>
      </div>
      {visibles.length === 0 ? <p className="vacio">{filtro === "pendiente" && !busqueda ? "No hay opiniones para revisar." : "No hay opiniones que coincidan."}</p>
        : <ul className="lista-resenas">{visibles.map((r) => <li key={r.id}>
          <div>
            <div className="resena-cabeza">{estrellas(r.rating)} <b>{r.autor}</b> <span className="metrica">· {r.fecha} · {r.producto || "Fuera del catálogo actual"} ({r.sku})</span>
              <Pildora>{r.enlace ? <a href={r.enlace} target="_blank" rel="noreferrer">{ORIGENES[r.origen]}</a> : ORIGENES[r.origen]}</Pildora>
              {filtro === "" && r.estado !== "publicada" && <Pildora tipo={r.estado === "pendiente" ? "aviso" : "gris"}>{SOLAPAS[r.estado]}</Pildora>}</div>
            <p>{r.texto}</p>
          </div>
          <div className="fila-botones">
            {r.estado !== "publicada" && <button disabled={busy} onClick={() => cambiar(r, "publicada")}>Aprobar</button>}
            {r.estado !== "oculta" && <button disabled={busy} onClick={() => cambiar(r, "oculta")}>Ocultar</button>}
            <button className="peligro" disabled={busy} onClick={() => borrar(r)} aria-label={`Borrar la opinión de ${r.autor}`} title="Borrar">×</button>
          </div>
        </li>)}</ul>}
      {data.coinciden > visibles.length && <p className="metrica">Mostrando {visibles.length} de {data.coinciden.toLocaleString("es-AR")}. Afiná la búsqueda para ver el resto.</p>}
    </div>

    {!sinConexion && <BarraCambios pendiente={data.sinPublicar} ocupado={busy} boton="Publicar ahora"
      onClick={() => run(() => api("/resenas/publicar", { method: "POST" }), "Reseñas publicadas en la tienda online.")}
      texto="Hay cambios sin publicar · la tienda todavía muestra la versión anterior"
      alDia={data.lastPublishedAt ? `La tienda está al día · publicado ${fechaHora(data.lastPublishedAt)}` : null} />}
  </section>;
}
