import { useEffect, useMemo, useState } from "react";
import { api, buscar, pesos } from "./lib.js";
import PantallaReposo from "./PantallaReposo.jsx";
import OnlineCrossSelling from "./OnlineCrossSelling.jsx";
import { coincideNombre } from "../shared/reglas.js";

const coincideDisparador = (regla, p) => !regla.sugeridos.map(String).includes(String(p.id)) && coincideNombre(regla.disparador, p);

export default function Admin() {
  const [tab, setTab] = useState("reglas");
  const [productos, setProductos] = useState([]);
  const cargarCatalogo = () => api("/catalogo").then((c) => setProductos(c.productos));
  useEffect(() => {
    cargarCatalogo();
  }, []);
  const porId = useMemo(() => new Map(productos.map((p) => [String(p.id), p])), [productos]);

  return (
    <div className="admin">
      <header>
        <h1>Mostrador · Ajustes</h1>
        <nav>
          {[
            ["reglas", "Recomendaciones"],
            ["destacados", "Pantalla en reposo"],
            ["tienda", "Tienda online"],
            ["crossselling-online", "Cross-selling online"],
            ["ajustes", "Descuentos y topes"],
            ["facturas", "Facturas emitidas"],
            ["informes", "Informes"],
          ].map(([id, nombre]) => (
            <button key={id} className={tab === id ? "activo" : ""} onClick={() => setTab(id)}>
              {nombre}
            </button>
          ))}
        </nav>
      </header>
      {tab === "reglas" && <Reglas productos={productos} porId={porId} />}
      {tab === "destacados" && <PantallaReposo productos={productos} porId={porId} SelectorProducto={SelectorProducto}><Destacados productos={productos} porId={porId} /></PantallaReposo>}
      {tab === "tienda" && <Tienda productos={productos} onActualizado={cargarCatalogo} />}
      {tab === "crossselling-online" && <OnlineCrossSelling />}
      {tab === "ajustes" && <Ajustes />}
      {tab === "facturas" && <FacturasEmitidas />}
      {tab === "informes" && <Informes />}
    </div>
  );
}

function FacturasEmitidas() {
  const [facturas, setFacturas] = useState(null);
  const [error, setError] = useState(null);
  function cargar() {
    setError(null);
    api("/facturas").then(setFacturas).catch((err) => setError(err.message));
  }
  useEffect(() => { cargar(); }, []);
  const medios = MEDIOS;
  return <section>
    <h2>Facturas emitidas</h2>
    <p>MercadoPago registra la cobranza automáticamente. Efectivo y Otros requieren cobranza manual. Este historial no verifica cobros cargados posteriormente en Contabilium.</p>
    <button onClick={cargar}>Actualizar</button>
    {error && <p className="aviso error">{error}</p>}
    {!facturas ? <p>Cargando facturas…</p> : !facturas.length ? <p>Todavía no hay facturas registradas.</p> :
      <div className="historial-facturas"><table>
        <thead><tr><th>Fecha</th><th>Factura</th><th>Cliente</th><th>Total</th><th>Condición de venta</th><th>Cobranza al emitir</th></tr></thead>
        <tbody>{facturas.map((f, i) => <tr key={f.idComprobante || `${f.fecha}:${i}`}>
          <td>{new Date(f.fecha).toLocaleString("es-AR")}</td>
          <td>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.numero}</a> : f.numero}{f.tipo === "Cotización" && " · Sin factura"}{f.prueba && " (PRUEBA)"}<br /><small>{f.idComprobante ? `ID ${f.idComprobante}` : ""}</small></td>
          <td>{f.cliente?.nombre}<br /><small>{f.cliente?.documento}</small></td>
          <td>{pesos(f.total)}</td><td>{medios[f.metodoPago] || f.metodoPago}</td>
          <td>{f.cobranza?.estado === "revisar" ? "Revisar en Contabilium" : f.cobranza?.estado === "registrada" ? "Cobranza registrada" : f.cobranza?.modalidad === "manual" ? "Cobranza pendiente" : "Registro anterior"}
            {f.cobranza?.modalidad === "manual" && f.cobranza.estado === "pendiente" && <button onClick={async () => {
              try { await api(`/facturas/${f.idComprobante}/retomar`, { method: "POST" }); window.location.href = "/vendedor"; }
              catch (err) { setError(err.message); }
            }}>Registrar cobranza</button>}
          </td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

const MEDIOS = { mercadopago: "MercadoPago", efectivo: "Efectivo", otros: "Otros", transferencia: "Transferencia", debito: "Débito", credito: "Crédito" };
const pct = (parte, total) => (total ? `${Math.round((parte / total) * 100)}%` : "—");
// Día de hoy en Argentina (UTC-3), corrido la cantidad de días indicada.
const diaAR = (dias = 0) => new Date(Date.now() - 3 * 60 * 60 * 1000 + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const fechaCorta = (dia) => dia.split("-").reverse().slice(0, 2).join("/");
const PERIODOS = [
  ["Hoy", () => [diaAR(), diaAR()]],
  ["Últimos 7 días", () => [diaAR(-6), diaAR()]],
  ["Este mes", () => [`${diaAR().slice(0, 7)}-01`, diaAR()]],
  ["Todo", () => ["", ""]],
];

function Informes() {
  const [[desde, hasta], setRango] = useState(PERIODOS[2][1]);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [dia, setDia] = useState(null);
  const [online, setOnline] = useState(null);
  useEffect(() => {
    setError(null);
    setDia(null);
    setOnline(null);
    api(`/estadisticas?${new URLSearchParams({ desde, hasta })}`).then(setDatos).catch((err) => setError(err.message));
    api(`/estadisticas/online?${new URLSearchParams({ desde, hasta })}`).then(setOnline).catch(() => setOnline({ error: "No se pudo consultar la tienda online" }));
  }, [desde, hasta]);
  const maxDia = Math.max(1, ...(datos?.porDia || []).map((d) => d.total));
  const maxProducto = Math.max(1, ...(datos?.productos || []).map((p) => p.total));

  return <section className="informes">
    <div className="informes-filtros">
      {PERIODOS.map(([nombre, rango]) => {
        const [d, h] = rango();
        return <button key={nombre} className={d === desde && h === hasta ? "activo" : ""} onClick={() => setRango([d, h])}>{nombre}</button>;
      })}
      <label>Desde <input type="date" value={desde} onChange={(e) => setRango([e.target.value, hasta])} /></label>
      <label>Hasta <input type="date" value={hasta} onChange={(e) => setRango([desde, e.target.value])} /></label>
    </div>
    {error && <p className="aviso error">{error}</p>}
    {datos && <CrossSellingPorCanal local={datos} online={online} />}
    {!datos ? <p>Cargando…</p> : !datos.ventas ? <p className="vacio">No hay ventas del mostrador en este período.</p> : <>
      <div className="informes-resumen">
        <div><span>Facturado</span><b>{pesos(datos.facturado)}</b></div>
        <div><span>Ventas</span><b>{datos.ventas}</b></div>
        <div><span>Ticket promedio</span><b>{pesos(datos.ticketPromedio)}</b></div>
        <div><span>Vendido por cross-selling</span><b>{pesos(datos.agregados)}</b><small>{pct(datos.agregados, datos.facturado)} de lo facturado</small></div>
        <div><span>Ventas con cross-selling</span><b>{datos.conAgregado}</b><small>{pct(datos.conAgregado, datos.ventas)} de las ventas</small></div>
      </div>

      <div className="informes-panel">
        <h3>Facturado por día</h3>
        <p className="metrica">{dia ? `${fechaCorta(dia.dia)}: ${pesos(dia.total)} en ${dia.ventas} ${dia.ventas === 1 ? "venta" : "ventas"}` : `Pasá el mouse por una barra para ver el detalle. Día más alto: ${pesos(maxDia)}.`}</p>
        <div className="barras-dias" onMouseLeave={() => setDia(null)}>
          {datos.porDia.map((d) => <div key={d.dia} className="barra-dia" title={`${fechaCorta(d.dia)}: ${pesos(d.total)} (${d.ventas})`} onMouseEnter={() => setDia(d)}>
            <i style={{ height: `${(d.total / maxDia) * 100}%` }} />
          </div>)}
        </div>
        <div className="barras-eje"><span>{fechaCorta(datos.porDia[0].dia)}</span>{datos.porDia.length > 1 && <span>{fechaCorta(datos.porDia.at(-1).dia)}</span>}</div>
      </div>

      <div className="informes-panel">
        <h3>Por medio de pago</h3>
        <table>
          <thead><tr><th>Medio</th><th className="num">Ventas</th><th className="num">Facturado</th><th className="num">Parte</th></tr></thead>
          <tbody>{datos.porMedio.map((m) => <tr key={m.medio}><td>{MEDIOS[m.medio] || m.medio}</td><td className="num">{m.ventas}</td><td className="num">{pesos(m.total)}</td><td className="num">{pct(m.total, datos.facturado)}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="informes-panel">
        <h3>Productos más vendidos</h3>
        <table>
          <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Facturado</th><th /></tr></thead>
          <tbody>{datos.productos.map((p) => <tr key={p.nombre}><td>{p.nombre}</td><td className="num">{p.unidades}</td><td className="num">{pesos(p.total)}</td>
            <td className="barra-celda"><i style={{ width: `${(p.total / maxProducto) * 100}%` }} /></td></tr>)}</tbody>
        </table>
      </div>

      <div className="informes-panel">
        <h3>Cross-selling por producto</h3>
        <p className="metrica">Productos que se sumaron al primer producto de la venta: en cuántas ventas se sumó cada uno, cuántas unidades y cuánto se vendió así.</p>
        {!datos.cruzados.length ? <p className="metrica">En este período ninguna venta llevó más de un producto.</p> : <table>
          <thead><tr><th>Producto agregado</th><th className="num">Ventas</th><th className="num">Unidades</th><th className="num">Vendido</th></tr></thead>
          <tbody>{datos.cruzados.map((c, i) => <tr key={i}><td>{c.nombre}</td><td className="num">{c.ventas}</td><td className="num">{c.unidades}</td><td className="num">{pesos(c.total)}</td></tr>)}</tbody>
        </table>}
      </div>
    </>}
    <InformeExcel desde={desde} hasta={hasta} />
  </section>;
}

// Cross-selling separado por canal: Mostrador (ventas del local) y Tienda online (pedidos pagados en Tiendanube).
function CrossSellingPorCanal({ local, online }) {
  const o = online?.datos;
  const canales = [
    { nombre: "Mostrador", ventas: local.ventas, facturado: local.facturado, con: local.conAgregado, vendido: local.agregados },
    ...(o ? [{ nombre: "Tienda online", ventas: o.orders, facturado: o.total, con: o.ordersWithCrossSelling, vendido: o.crossSellingRevenue }] : []),
  ];
  const total = canales.reduce((t, c) => ({ ventas: t.ventas + c.ventas, facturado: t.facturado + c.facturado, con: t.con + c.con, vendido: t.vendido + c.vendido }),
    { ventas: 0, facturado: 0, con: 0, vendido: 0 });
  const reglasOnline = o ? Object.values(o.rules || {}) : [];
  const mostradas = reglasOnline.reduce((n, r) => n + r.shown, 0), aceptadas = reglasOnline.reduce((n, r) => n + r.accepted, 0);
  return <div className="informes-panel">
    <h3>Cross-selling por canal</h3>
    <p className="metrica">Mostrador: ventas del local. Tienda online: pedidos pagados en Tiendanube con productos agregados desde «Completá tu equipo».</p>
    <table>
      <thead><tr><th>Canal</th><th className="num">Ventas</th><th className="num">Con cross-selling</th><th className="num">Vendido por cross-selling</th><th className="num">De lo facturado</th></tr></thead>
      <tbody>
        {canales.map((c) => <tr key={c.nombre}><td>{c.nombre}</td><td className="num">{c.ventas}</td><td className="num">{c.con} ({pct(c.con, c.ventas)})</td>
          <td className="num">{pesos(c.vendido)}</td><td className="num">{pct(c.vendido, c.facturado)}</td></tr>)}
        {o && <tr><td><b>Total</b></td><td className="num"><b>{total.ventas}</b></td><td className="num"><b>{total.con}</b></td>
          <td className="num"><b>{pesos(total.vendido)}</b></td><td className="num"><b>{pct(total.vendido, total.facturado)}</b></td></tr>}
      </tbody>
    </table>
    {!online ? <p className="metrica">Consultando la tienda online…</p>
      : online.configurado === false ? <p className="metrica">La tienda online no está conectada en este servidor.</p>
      : online.error ? <p className="aviso error">Tienda online: {online.error}</p>
      : <p className="metrica">Tienda online en el período: {mostradas} ofertas mostradas · {aceptadas} aceptadas{mostradas > 0 && ` (${pct(aceptadas, mostradas)})`} · descuento otorgado {pesos(o.crossSellingDiscount)}.</p>}
    {o?.products?.length > 0 && <table>
      <thead><tr><th>Producto agregado online</th><th className="num">Pedidos</th><th className="num">Unidades</th><th className="num">Vendido</th></tr></thead>
      <tbody>{o.products.map((p, i) => <tr key={i}><td>{p.name}</td><td className="num">{p.sales}</td><td className="num">{p.units}</td><td className="num">{pesos(p.revenue)}</td></tr>)}</tbody>
    </table>}
  </div>;
}

function InformeExcel({ desde, hasta }) {
  const [estado, setEstado] = useState(null);
  async function guardar() {
    setEstado({ guardando: true });
    try { setEstado(await api("/reporte", { method: "POST", body: { desde, hasta } })); }
    catch (err) { setEstado({ error: err.message }); }
  }
  return <div className="informe-excel">
    <h3>Informe de ventas en Excel</h3>
    <p>Una fila por venta del período elegido arriba: fecha, comprobante, producto principal, productos agregados (cross-selling), precio total y precio de los agregados. Se guarda en la carpeta <b>informes</b> del mostrador.</p>
    <button className="primario" disabled={estado?.guardando} onClick={guardar}>{estado?.guardando ? "Guardando…" : "Guardar Excel"}</button>
    {estado?.archivo && <p className="aviso ok">Informe guardado ({estado.ventas} ventas): <code>{estado.archivo}</code></p>}
    {estado?.error && <p className="aviso error">{estado.error}</p>}
  </div>;
}

function SelectorProducto({ productos, onElegir, excluir = [] }) {
  const [texto, setTexto] = useState("");
  const resultados = texto
    ? buscar(productos, texto)
        .filter((p) => !excluir.includes(String(p.id)))
        .slice(0, 8)
    : [];
  return (
    <div className="selector">
      <input placeholder="Buscar producto para agregar…" value={texto} onChange={(e) => setTexto(e.target.value)} />
      {resultados.length > 0 && (
        <ul>
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onElegir(p);
                  setTexto("");
                }}
              >
                {p.nombre} <small>{pesos(p.precioFinal)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Reglas({ productos, porId }) {
  const [reglas, setReglas] = useState(null);
  const [metricas, setMetricas] = useState(null);
  const [metricasOnline, setMetricasOnline] = useState(null);
  const [guardado, setGuardado] = useState(true);
  const rubros = useMemo(() => [...new Set(productos.map((p) => p.rubro))].sort(), [productos]);
  const subrubros = useMemo(() => [...new Set(productos.map((p) => p.subrubro).filter(Boolean))].sort(), [productos]);

  useEffect(() => {
    api("/reglas").then(setReglas);
    api("/metricas").then(setMetricas);
    api("/metricas/online").then((r) => setMetricasOnline(r.datos?.rules || null)).catch(() => {});
  }, []);

  function cambiar(id, cambios) {
    setReglas((rs) => rs.map((r) => (r.id === id ? { ...r, ...cambios } : r)));
    setGuardado(false);
  }

  function nueva() {
    const id = `r${Date.now()}`;
    setReglas((rs) => [
      ...rs,
      {
        id,
        nombre: "Nueva regla",
        activa: true,
        disparador: { tipo: "rubro", valor: rubros[0] || "" },
        sugeridos: [],
        descuentoPct: 10,
      },
    ]);
    setGuardado(false);
  }

  async function guardar() {
    setReglas(await api("/reglas", { method: "PUT", body: reglas }));
    setGuardado(true);
  }

  if (!reglas) return <p>Cargando…</p>;
  const metricaDe = (id) => metricas?.porRegla.find((m) => m.id === id);

  return (
    <section>
      <p className="ayuda">
        Cuando el cliente lleva algo que cumple el <b>disparador</b>, la pantalla le sugiere los productos de la regla con el
        descuento indicado. El descuento solo vale si lo lleva en la misma compra.
      </p>
      {reglas.map((r) => {
        const m = metricaDe(r.id);
        return (
          <div key={r.id} className={`regla ${r.activa ? "" : "inactiva"}`}>
            <div className="fila">
              <input className="titulo" value={r.nombre} onChange={(e) => cambiar(r.id, { nombre: e.target.value })} />
              <label>
                <input type="checkbox" checked={r.activa} onChange={(e) => cambiar(r.id, { activa: e.target.checked })} /> Activa
              </label>
              <button
                className="peligro"
                onClick={() => {
                  if (confirm(`¿Borrar la regla "${r.nombre}"?`)) {
                    setReglas((rs) => rs.filter((x) => x.id !== r.id));
                    setGuardado(false);
                  }
                }}
              >
                Borrar
              </button>
            </div>
            <div className="fila">
              <span>Si lleva</span>
              <select
                value={r.disparador.tipo}
                onChange={(e) => cambiar(r.id, { disparador: { tipo: e.target.value, valor: "" } })}
              >
                <option value="rubro">cualquier producto de la categoría</option>
                <option value="subrubro">cualquier producto de la subcategoría</option>
                <option value="producto">el producto</option>
                <option value="nombre">un producto cuyo nombre contenga</option>
              </select>
              {r.disparador.tipo === "nombre" ? (
                <>
                  <input
                    placeholder="minifuse, studio m"
                    title="Separá con comas. Si ponés varias palabras juntas, el nombre tiene que tener todas."
                    value={r.disparador.valor}
                    onChange={(e) => cambiar(r.id, { disparador: { ...r.disparador, valor: e.target.value } })}
                  />
                  <span>salvo que contenga</span>
                  <input
                    placeholder="funda, soporte"
                    value={r.disparador.excluir || ""}
                    onChange={(e) => cambiar(r.id, { disparador: { ...r.disparador, excluir: e.target.value } })}
                  />
                  <span className="metrica">
                    {productos.filter((p) => coincideDisparador(r, p)).length} productos coinciden
                  </span>
                </>
              ) : r.disparador.tipo === "rubro" || r.disparador.tipo === "subrubro" ? (
                <select
                  value={r.disparador.valor}
                  onChange={(e) => cambiar(r.id, { disparador: { tipo: r.disparador.tipo, valor: e.target.value } })}
                >
                  <option value="">Elegir…</option>
                  {(r.disparador.tipo === "rubro" ? rubros : subrubros).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                  {r.disparador.valor && !(r.disparador.tipo === "rubro" ? rubros : subrubros).includes(r.disparador.valor) && (
                    <option>{r.disparador.valor}</option>
                  )}
                </select>
              ) : r.disparador.valor ? (
                <span className="chip">
                  {porId.get(String(r.disparador.valor))?.nombre || `#${r.disparador.valor}`}
                  <button onClick={() => cambiar(r.id, { disparador: { tipo: "producto", valor: "" } })}>×</button>
                </span>
              ) : (
                <SelectorProducto
                  productos={productos}
                  onElegir={(p) => cambiar(r.id, { disparador: { tipo: "producto", valor: String(p.id) } })}
                />
              )}
            </div>
            <div className="fila">
              <span>sugerir con</span>
              <input
                type="number"
                min="0"
                max="100"
                className="pct"
                value={r.descuentoPct}
                onChange={(e) => cambiar(r.id, { descuentoPct: Number(e.target.value) })}
              />
              <span>% de descuento:</span>
            </div>
            <div className="sugeridos">
              {r.sugeridos.map((id) => (
                <span key={id} className="chip">
                  {porId.get(String(id))?.nombre || `#${id} (no está en el catálogo)`}
                  <button onClick={() => cambiar(r.id, { sugeridos: r.sugeridos.filter((x) => x !== id) })}>×</button>
                </span>
              ))}
              <SelectorProducto
                productos={productos}
                excluir={r.sugeridos}
                onElegir={(p) => cambiar(r.id, { sugeridos: [...r.sugeridos, String(p.id)] })}
              />
            </div>
            <label className="mensaje-regla">
              Frase para el vendedor
              <textarea
                rows="2"
                placeholder="¿Tenés la funda para protegerlo y transportarlo?"
                value={r.mensaje || ""}
                onChange={(e) => cambiar(r.id, { mensaje: e.target.value })}
              />
            </label>
            {m && (
              <p className="metrica">
                Mostrador: mostrada {m.mostradas} veces · aceptada {m.aceptadas}
                {m.mostradas > 0 && ` (${Math.round((m.aceptadas / m.mostradas) * 100)}%)`} · vendido {pesos(m.ingresos)}
              </p>
            )}
            {metricasOnline && (() => {
              const o = metricasOnline[String(r.id)] || { shown: 0, accepted: 0, sold: 0, revenue: 0 };
              return <p className="metrica">
                Online: mostrada {o.shown} veces · aceptada {o.accepted}
                {o.shown > 0 && ` (${Math.round((o.accepted / o.shown) * 100)}%)`} · vendida {o.sold} · vendido {pesos(o.revenue)}
              </p>;
            })()}
          </div>
        );
      })}
      <div className="acciones">
        <button onClick={nueva}>+ Nueva regla</button>
        <button className="primario" disabled={guardado} onClick={guardar}>
          {guardado ? "Guardado" : "Guardar cambios"}
        </button>
      </div>
    </section>
  );
}

function Destacados({ productos, porId }) {
  const [ids, setIds] = useState(null);
  useEffect(() => {
    api("/destacados").then(setIds);
  }, []);
  async function guardar(next) {
    setIds(await api("/destacados", { method: "PUT", body: next }));
  }
  if (!ids) return <p>Cargando…</p>;
  return (
    <section>
      <p className="ayuda">Productos que pasan en la pantalla del cliente cuando no hay ninguna venta en curso.</p>
      <div className="sugeridos">
        {ids.map((id) => (
          <span key={id} className="chip">
            {porId.get(String(id))?.nombre || `#${id}`}
            <button onClick={() => guardar(ids.filter((x) => x !== id))}>×</button>
          </span>
        ))}
        <SelectorProducto productos={productos} excluir={ids} onElegir={(p) => guardar([...ids, String(p.id)])} />
      </div>
    </section>
  );
}

function Tienda({ productos, onActualizado }) {
  const [estado, setEstado] = useState(null);
  const [faltantes, setFaltantes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const sinFoto = productos.filter((p) => !p.imagen);

  useEffect(() => {
    api("/tienda/faltantes").then(setFaltantes);
  }, []);

  async function actualizar() {
    setCargando(true);
    try {
      setEstado(await api("/tienda/actualizar", { method: "POST" }));
      await onActualizado();
      setFaltantes(await api("/tienda/faltantes"));
    } catch (err) {
      setEstado({ error: err.message });
    } finally {
      setCargando(false);
    }
  }

  return (
    <section>
      <p className="ayuda">
        El mostrador muestra los productos publicados en la tienda online (Tiendanube), con su <b>precio</b>, <b>categoría</b> y{" "}
        <b>foto</b>. Se empareja el SKU de la tienda con el código del producto en Contabilium. Los precios se actualizan cada 30
        minutos (o con "Actualizar precios" en la pantalla del vendedor); categorías, fotos y productos nuevos, una vez por día o con este botón (tarda unos minutos).
      </p>
      <div className="acciones-imagenes">
        <button className="primario" disabled={cargando} onClick={actualizar}>
          {cargando ? "Leyendo la tienda…" : "Actualizar ahora"}
        </button>
        <span>
          {productos.length} productos en el mostrador · {productos.length - sinFoto.length} con foto
          {estado?.skus != null && ` · ${estado.skus} SKUs en la tienda`}
        </span>
      </div>
      {estado?.error && <div className="aviso error">{estado.error}</div>}
      {faltantes.length > 0 && (
        <>
          <h3>En la tienda pero no en Contabilium ({faltantes.length})</h3>
          <p className="ayuda">
            No se pueden vender en el mostrador porque no hay un producto en Contabilium con ese código. Revisá el código en
            Contabilium.
          </p>
          <ul className="sin-foto">
            {faltantes.map((p) => (
              <li key={p.sku}>
                <code>{p.sku}</code> {p.nombre}
              </li>
            ))}
          </ul>
        </>
      )}
      {sinFoto.length > 0 && (
        <>
          <h3>Sin foto ({sinFoto.length})</h3>
          <ul className="sin-foto">
            {sinFoto.map((p) => (
              <li key={p.id}>
                <code>{p.codigo || "sin código"}</code> {p.nombre}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="galeria">
        {productos
          .filter((p) => p.imagen)
          .map((p) => (
            <figure key={p.id}>
              <img src={p.imagen} alt="" loading="lazy" />
              <figcaption>{p.nombre}</figcaption>
            </figure>
          ))}
      </div>
    </section>
  );
}

const CAMPOS_AJUSTES = [
  ["descuentoContadoPct", "Descuento pagando en efectivo o transferencia (%)"],
  ["descuentoMaximoPct", "Descuento máximo para una recomendación (%)"],
  ["margenMinimoPct", "Margen mínimo sobre el costo con descuento (%)"],
  ["maxSugerencias", "Cantidad máxima de sugerencias en pantalla"],
];

function Ajustes() {
  const [ajustes, setAjustes] = useState(null);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/ajustes").then(setAjustes);
  }, []);
  if (!ajustes) return <p>Cargando…</p>;
  return (
    <section className="ajustes">
      {CAMPOS_AJUSTES.map(([campo, etiqueta]) => (
        <label key={campo}>
          {etiqueta}
          <input
            type="number"
            min="0"
            value={ajustes[campo]}
            onChange={(e) => {
              setAjustes({ ...ajustes, [campo]: Number(e.target.value) });
              setOk(false);
            }}
          />
        </label>
      ))}
      <p className="ayuda">
        El margen mínimo usa el costo cargado en Contabilium: si un descuento dejaría el precio por debajo de costo + margen, se
        reduce automáticamente.
      </p>
      <button
        className="primario"
        onClick={async () => {
          try {
            setError("");
            setAjustes(await api("/ajustes", { method: "PUT", body: Object.fromEntries(CAMPOS_AJUSTES.map(([c]) => [c, ajustes[c]])) }));
            setOk(true);
          } catch (e) { setError(e.message); }
        }}
      >
        {ok ? "Guardado ✓" : "Guardar"}
      </button>
      {error && <p className="aviso error" role="alert">{error}</p>}
    </section>
  );
}
