import { useEffect, useMemo, useState } from "react";
import { api, pesos } from "./lib.js";
import { reglaSeDispara } from "../shared/recommendations.js";
import { DetalleOnline, useCanalOnline } from "./OnlineCrossSelling.jsx";
import { BarraCambios, Cabecera, Interruptor, Pildora } from "./ui.jsx";
import EditorRegla from "./EditorRegla.jsx";

const coincideDisparador = (regla, p, porId) => reglaSeDispara(
  { ...regla, activa: true }, [{ productId: p.id }], porId,
) !== null;

const LIMITES = [
  ["descuentoGeneralPct", "Descuento por defecto", "Descuento por defecto", "%"],
  ["descuentoContadoPct", "Contado", "Descuento pagando en efectivo o transferencia", "%"],
  ["descuentoMaximoPct", "Desc. máximo", "Descuento máximo para una recomendación", "%"],
  ["margenMinimoPct", "Margen mínimo", "Margen mínimo sobre el costo con descuento", "%"],
  ["maxSugerencias", "Sugerencias", "Cantidad máxima de sugerencias en pantalla", ""],
];
const ORDENES = { guardado: "Orden guardado", vendido: "Más vendidas", nombre: "Nombre" };
const tasa = (aceptadas, mostradas) => (mostradas ? ` (${Math.round((aceptadas / mostradas) * 100)}%)` : "");

function resumenDisparador(d, porId) {
  if (!d.valor) return "Falta elegir el disparador";
  if (d.tipo === "rubro") return `Categoría ${d.valor}`;
  if (d.tipo === "subrubro") return `Subcategoría ${d.valor}`;
  if (d.tipo === "producto") return porId.get(String(d.valor))?.nombre || `Producto #${d.valor}`;
  return `Nombre contiene «${d.valor}»${d.excluir ? ` salvo «${d.excluir}»` : ""}`;
}

export default function CrossSelling({ productos, porId }) {
  const [reglas, setReglas] = useState(null);
  const [ajustes, setAjustes] = useState(null);
  const [guardado, setGuardado] = useState("");
  const [metricas, setMetricas] = useState(null);
  const [metricasOnline, setMetricasOnline] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [verOnline, setVerOnline] = useState(false);
  const [editarLimites, setEditarLimites] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState("guardado");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const online = useCanalOnline();
  const rubros = useMemo(() => [...new Set(productos.map((p) => p.rubro))].sort(), [productos]);
  const subrubros = useMemo(() => [...new Set(productos.map((p) => p.subrubro).filter(Boolean))].sort(), [productos]);

  const foto = (rs, aj) => JSON.stringify([rs, LIMITES.map(([c]) => aj[c])]);
  useEffect(() => {
    Promise.all([api("/reglas"), api("/ajustes")]).then(([rs, aj]) => {
      setReglas(rs); setAjustes(aj); setGuardado(foto(rs, aj));
    }).catch((e) => setError(e.message));
    api("/metricas").then(setMetricas).catch(() => {});
    api("/metricas/online").then((r) => setMetricasOnline(r.datos?.rules || null)).catch(() => {});
  }, []);

  const coincidencias = useMemo(() => new Map((reglas || []).map((r) => [r.id,
    r.disparador.valor ? productos.filter((p) => coincideDisparador(r, p, porId)) : []])), [reglas, productos, porId]);

  if (!reglas || !ajustes) return <p role="status">{error || "Cargando…"}</p>;
  const sinGuardar = foto(reglas, ajustes) !== guardado;

  function cambiar(id, cambios) {
    setReglas((rs) => rs.map((r) => (r.id === id ? { ...r, ...cambios } : r)));
  }
  function nueva() {
    const id = `r${Date.now()}`;
    setReglas((rs) => [...rs, { id, nombre: "Nueva regla", activa: true, disparador: { tipo: "rubro", valor: "" }, sugeridos: [], descuentosPorProducto: {} }]);
    setAbierta(id); setBusqueda(""); setOrden("guardado");
  }
  function quitar(r) {
    if (!confirm(`¿Quitar la regla «${r.nombre}»? Deja de sugerirse en el mostrador y en la tienda online cuando guardes.`)) return;
    setReglas((rs) => rs.filter((x) => x.id !== r.id));
  }
  async function guardar() {
    setOcupado(true); setError("");
    try {
      const rs = await api("/reglas", { method: "PUT", body: reglas });
      const aj = await api("/ajustes", { method: "PUT", body: Object.fromEntries(LIMITES.map(([c]) => [c, ajustes[c]])) });
      setReglas(rs); setAjustes(aj); setGuardado(foto(rs, aj));
    } catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
  async function canalMostrador(activo) {
    if (!activo && !confirm("¿Apagar el cross-selling en el mostrador? El vendedor y la pantalla del cliente dejan de mostrar sugerencias. Las reglas se conservan.")) return;
    setError("");
    try {
      const aj = await api("/ajustes", { method: "PUT", body: { crossSellingMostrador: activo } });
      setAjustes((prev) => ({ ...prev, crossSellingMostrador: aj.crossSellingMostrador }));
    } catch (e) { setError(e.message); }
  }

  const deMostrador = (id) => metricas?.porRegla.find((m) => m.id === id);
  const deOnline = (id) => metricasOnline?.[String(id)];
  const vendido = (r) => (deMostrador(r.id)?.ingresos || 0) + (deOnline(r.id)?.revenue || 0);
  const totalMostrador = (metricas?.porRegla || []).reduce((t, m) => ({ m: t.m + m.mostradas, a: t.a + m.aceptadas }), { m: 0, a: 0 });
  const totalOnline = Object.values(metricasOnline || {}).reduce((t, o) => ({ m: t.m + o.shown, a: t.a + o.accepted }), { m: 0, a: 0 });

  const texto = busqueda.trim().toLowerCase();
  const visibles = reglas.filter((r) => !texto || [r.nombre, resumenDisparador(r.disparador, porId),
    ...r.sugeridos.map((id) => porId.get(String(id))?.nombre || "")].some((t) => t.toLowerCase().includes(texto)));
  if (orden === "nombre") visibles.sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (orden === "vendido") visibles.sort((a, b) => vendido(b) - vendido(a));
  const st = online.status, moduloActivo = Boolean(st?.module?.enabled);

  return <section className="seccion-crossselling">
    <Cabecera titulo="Cross-selling" descripcion="Las mismas reglas sugieren productos en el mostrador y en la tienda online." />
    {error && <p className="aviso error" role="alert">{error}</p>}

    <div className="canales">
      <div className="tarjeta canal">
        <div className="canal-titulo"><h3>Mostrador</h3><Interruptor activo={ajustes.crossSellingMostrador} onCambiar={canalMostrador} etiqueta="Cross-selling en el mostrador" /></div>
        <p className="metrica">{ajustes.crossSellingMostrador ? "Sugerencias en la pantalla del vendedor y del cliente" : "Apagado: las ventas no muestran sugerencias"}</p>
        {metricas && <p className="metrica">Acumulado: {totalMostrador.m} mostradas · {totalMostrador.a} aceptadas{tasa(totalMostrador.a, totalMostrador.m)}</p>}
      </div>
      <div className="tarjeta canal">
        <div className="canal-titulo"><h3>Tienda online</h3>
          {st?.configured && <Interruptor activo={moduloActivo} onCambiar={online.toggleModule} disabled={online.busy || !st.module} etiqueta="«Completá tu equipo» en la tienda online" />}</div>
        <p className="metrica">{!st ? "Consultando…" : !st.configured ? "Falta configurar la conexión con Logitrack" : !st.module ? "Consultando el módulo en la tienda…" : `«Completá tu equipo» · tienda ${st.storeId}`}</p>
        <p className="metrica">{st?.lastPublishedAt ? `Publicado ${new Date(st.lastPublishedAt).toLocaleString("es-AR")}` : st?.configured ? "Todavía no se publicó" : ""}
          {st?.configured && <> · <button className="enlace" onClick={() => setVerOnline(!verOnline)}>{verOnline ? "Ocultar estado" : "Ver estado"}</button></>}</p>
        {metricasOnline && <p className="metrica">Desde enero: {totalOnline.m} mostradas · {totalOnline.a} aceptadas{tasa(totalOnline.a, totalOnline.m)}</p>}
        {(st?.error || online.moduleError) && <Pildora tipo="error">Revisá el estado</Pildora>}
      </div>
    </div>
    {verOnline && <DetalleOnline online={online} productos={productos} />}

    <div className="tarjeta limites">
      {editarLimites ? <div className="limites-campos">
        {LIMITES.map(([campo, , etiqueta]) => <label key={campo}>{etiqueta}
          <input type="number" min="0" value={ajustes[campo]} onChange={(e) => setAjustes({ ...ajustes, [campo]: Number(e.target.value) })} /></label>)}
        <p className="metrica">El margen mínimo usa el costo cargado en Contabilium: si un descuento dejaría el precio por debajo de costo + margen, se reduce automáticamente.</p>
      </div> : <div className="limites-resumen">
        {LIMITES.map(([campo, corto, etiqueta, unidad]) => <span key={campo} title={etiqueta}>{corto} <b>{ajustes[campo]}{unidad}</b></span>)}
      </div>}
      <p className="metrica">El descuento por defecto se aplica a los productos sin descuento personalizado. Si cambiás el descuento de un producto, ese valor se conserva aunque después cambies el descuento por defecto.</p>
      <button className="enlace" onClick={() => setEditarLimites(!editarLimites)}>{editarLimites ? "Listo" : "Editar límites"}</button>
    </div>

    <div className="barra-lista">
      <h3>Reglas <span className="metrica">{reglas.filter((r) => r.activa).length} activas de {reglas.length}</span></h3>
      <div className="fila-botones">
        <input type="search" placeholder="Buscar regla o producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Ordenar reglas">
          {Object.entries(ORDENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={nueva}>+ Nueva regla</button>
      </div>
    </div>

    <div className="tarjeta lista-reglas">
      <div className="regla-fila cabeza"><span /><span>Regla</span><span className="num">Mostrador</span><span className="num">Online</span><span className="num">Vendido</span><span /></div>
      {visibles.length === 0 && <p className="vacio">{reglas.length ? "Ninguna regla coincide con la búsqueda." : "Todavía no hay reglas. Creá la primera con «+ Nueva regla»."}</p>}
      {visibles.map((r) => {
        const m = deMostrador(r.id), o = deOnline(r.id), cs = coincidencias.get(r.id) || [];
        const abiertaEsta = abierta === r.id;
        return <div key={r.id} className={`regla-item ${r.activa ? "" : "inactiva"} ${abiertaEsta ? "abierta" : ""}`}>
          <div className="regla-fila">
            <Interruptor activo={r.activa} onCambiar={(activa) => cambiar(r.id, { activa })} etiqueta={`Regla ${r.nombre} activa`} />
            <button className="regla-resumen" aria-expanded={abiertaEsta} onClick={() => setAbierta(abiertaEsta ? null : r.id)}>
              <b>{r.nombre}</b>
              {r.disparador.valor && !cs.length && <Pildora tipo="aviso">Sin coincidencias</Pildora>}
              <small>{resumenDisparador(r.disparador, porId)}{r.disparador.valor && ` · ${cs.length} productos`} → {r.sugeridos.length} sugeridos</small>
            </button>
            <span className="num" title="Ventas completadas con esta regla en el mostrador">{m ? (m.ventas ?? 0) : "—"}</span>
            <span className="num" title="Ventas completadas con esta regla en la tienda online">{o ? (o.sold ?? 0) : metricasOnline ? 0 : "—"}</span>
            <span className="num">{m || o ? pesos(vendido(r)) : "—"}</span>
            <button className="quitar-regla" aria-label={`Quitar la regla ${r.nombre}`} title="Quitar regla" onClick={() => quitar(r)}>×</button>
          </div>
          {abiertaEsta && <EditorRegla r={r} cs={cs} productos={productos} porId={porId} rubros={rubros} subrubros={subrubros} general={ajustes.descuentoGeneralPct} cambiar={(c) => cambiar(r.id, c)}>
            {(m || o) && <p className="metrica">
              {m && <>Mostrador: mostrada {m.mostradas} veces · aceptada {m.aceptadas}{tasa(m.aceptadas, m.mostradas)} · {m.ventas ?? 0} ventas completadas · vendido {pesos(m.ingresos)}</>}
              {m && o && <br />}
              {o && <>Online: mostrada {o.shown} veces · aceptada {o.accepted}{tasa(o.accepted, o.shown)} · vendida {o.sold} · vendido {pesos(o.revenue)}</>}
            </p>}
          </EditorRegla>}
        </div>;
      })}
    </div>
    <p className="metrica">Mostrador y Online: ventas completadas con la regla. El orden guardado define qué regla tiene prioridad si dos sugieren lo mismo.</p>

    <BarraCambios pendiente={sinGuardar} ocupado={ocupado} onClick={guardar} boton="Guardar cambios"
      texto={`Hay cambios sin guardar${st?.configured && moduloActivo ? " · al guardar se publican también en la tienda online" : ""}`} />
  </section>;
}
