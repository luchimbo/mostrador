import { useEffect, useState } from "react";
import { api, pesos } from "./lib.js";
import { Cabecera, Kpis, Segmentos } from "./ui.jsx";

export const MEDIOS = { mercadopago: "MercadoPago", efectivo: "Efectivo", otros: "Otros", transferencia: "Transferencia", debito: "Débito", credito: "Crédito" };
const pct = (parte, total) => (total ? `${((parte / total) * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%` : "—");
// Día de hoy en Argentina (UTC-3), corrido la cantidad de días indicada.
const diaAR = (dias = 0) => new Date(Date.now() - 3 * 60 * 60 * 1000 + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const fechaCorta = (dia) => dia.split("-").reverse().slice(0, 2).join("/");
const PERIODOS = {
  hoy: ["Hoy", () => [diaAR(), diaAR()]],
  semana: ["7 días", () => [diaAR(-6), diaAR()]],
  mes: ["Este mes", () => [`${diaAR().slice(0, 7)}-01`, diaAR()]],
  todo: ["Todo", () => ["", ""]],
};
const DIA_MS = 24 * 60 * 60 * 1000;
// El mismo largo de período, justo antes: para comparar.
function anterior(desde, hasta) {
  if (!desde || !hasta) return null;
  const d = Date.parse(desde), dias = Math.round((Date.parse(hasta) - d) / DIA_MS) + 1;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  return [iso(d - dias * DIA_MS), iso(d - DIA_MS)];
}
function variacion(actual, previo) {
  if (!previo) return null;
  const v = Math.round(((actual - previo) / previo) * 100);
  return `${v > 0 ? "+" : ""}${v}% vs. período anterior`;
}
const MAS = 5;

export default function Informes() {
  const [periodo, setPeriodo] = useState("mes");
  const [[desde, hasta], setRango] = useState(PERIODOS.mes[1]);
  const [datos, setDatos] = useState(null);
  const [previo, setPrevio] = useState(null);
  const [error, setError] = useState(null);
  const [dia, setDia] = useState(null);
  const [online, setOnline] = useState(null);
  const [todos, setTodos] = useState({});
  useEffect(() => {
    setError(null); setDia(null); setOnline(null); setPrevio(null);
    api(`/estadisticas?${new URLSearchParams({ desde, hasta })}`).then(setDatos).catch((err) => setError(err.message));
    api(`/estadisticas/online?${new URLSearchParams({ desde, hasta })}`).then(setOnline).catch(() => setOnline({ error: "No se pudo consultar la tienda online" }));
    const ant = anterior(desde, hasta);
    if (ant) api(`/estadisticas?${new URLSearchParams({ desde: ant[0], hasta: ant[1] })}`).then(setPrevio).catch(() => {});
  }, [desde, hasta]);
  const elegirPeriodo = (p) => { setPeriodo(p); if (PERIODOS[p]) setRango(PERIODOS[p][1]()); };
  const maxDia = Math.max(1, ...(datos?.porDia || []).map((d) => d.total));
  const ver = (clave, lista) => (todos[clave] ? lista : lista.slice(0, MAS));
  const verTodos = (clave, lista) => lista.length > MAS && <button className="enlace" onClick={() => setTodos({ ...todos, [clave]: !todos[clave] })}>{todos[clave] ? "Ver menos" : `Ver los ${lista.length}`}</button>;

  return <section className="informes">
    <Cabecera titulo="Informes" descripcion="Ventas del mostrador y cross-selling en los dos canales.">
      <InformeExcel desde={desde} hasta={hasta} />
    </Cabecera>
    <div className="informes-filtros">
      <Segmentos etiqueta="Período" valor={periodo} onCambiar={elegirPeriodo} opciones={[...Object.entries(PERIODOS).map(([k, [n]]) => [k, n]), ["fechas", "Elegir fechas"]]} />
      {periodo === "fechas" ? <>
        <label>Desde <input type="date" value={desde} onChange={(e) => setRango([e.target.value, hasta])} /></label>
        <label>Hasta <input type="date" value={hasta} onChange={(e) => setRango([desde, e.target.value])} /></label>
      </> : desde && <span className="metrica">{fechaCorta(desde)} – {fechaCorta(hasta)}</span>}
    </div>
    {error && <p className="aviso error">{error}</p>}
    {!datos ? <p>Cargando…</p> : <>
      <Kpis items={[
        { etiqueta: "Facturado", valor: pesos(datos.facturado), detalle: variacion(datos.facturado, previo?.facturado) },
        { etiqueta: "Ventas", valor: datos.ventas, detalle: variacion(datos.ventas, previo?.ventas) },
        { etiqueta: "Ticket promedio", valor: pesos(datos.ticketPromedio) },
        { etiqueta: "Vendido por cross-selling", valor: pesos(datos.agregados), detalle: `${pct(datos.agregados, datos.facturado)} de lo facturado` },
      ]} />

      {datos.ventas > 0 && <div className="informes-panel">
        <h3>Facturado por día <span className="metrica">{dia ? `${fechaCorta(dia.dia)}: ${pesos(dia.total)} en ${dia.ventas} ${dia.ventas === 1 ? "venta" : "ventas"}` : `Pasá el mouse por una barra. Día más alto: ${pesos(maxDia)}.`}</span></h3>
        <div className="barras-dias" onMouseLeave={() => setDia(null)}>
          {datos.porDia.map((d) => <div key={d.dia} className="barra-dia" title={`${fechaCorta(d.dia)}: ${pesos(d.total)} (${d.ventas})`} onMouseEnter={() => setDia(d)}>
            <i style={{ height: `${(d.total / maxDia) * 100}%` }} />
          </div>)}
        </div>
        <div className="barras-eje"><span>{fechaCorta(datos.porDia[0].dia)}</span>{datos.porDia.length > 1 && <span>{fechaCorta(datos.porDia.at(-1).dia)}</span>}</div>
      </div>}

      <CrossSellingPorCanal local={datos} online={online} />

      {!datos.ventas ? <p className="vacio">No hay ventas del mostrador en este período.</p> : <div className="dos-columnas">
        <div className="informes-panel">
          <h3>Medios de pago</h3>
          {datos.porMedio.map((m) => <div className="barra-h" key={m.medio}>
            <span>{MEDIOS[m.medio] || m.medio} <small className="metrica">{m.ventas} {m.ventas === 1 ? "venta" : "ventas"}</small></span><span className="num">{pesos(m.total)}</span>
            <i><b style={{ width: `${(m.total / datos.facturado) * 100}%` }} /></i>
          </div>)}
        </div>
        <div className="informes-panel">
          <h3>Más vendidos</h3>
          {ver("productos", datos.productos).map((p) => <div className="barra-h" key={p.nombre}>
            <span>{p.nombre} <small className="metrica">{p.unidades} u.</small></span><span className="num">{pesos(p.total)}</span>
            <i><b style={{ width: `${(p.total / datos.productos[0].total) * 100}%` }} /></i>
          </div>)}
          {verTodos("productos", datos.productos)}
        </div>
      </div>}
    </>}
  </section>;
}

// Cross-selling separado por canal: Mostrador (ventas del local) y Tienda online (pedidos pagados en Tiendanube).
function CrossSellingPorCanal({ local, online }) {
  const o = online?.datos;
  const reglasOnline = o ? Object.values(o.rules || {}) : [];
  const mostradas = reglasOnline.reduce((n, r) => n + r.shown, 0), aceptadas = reglasOnline.reduce((n, r) => n + r.accepted, 0);
  const productos = [...(local.cruzados || []).map((c) => ({ canal: "Mostrador", nombre: c.nombre, ventas: c.ventas, unidades: c.unidades, total: c.total })),
    ...(o?.products || []).map((p) => ({ canal: "Online", nombre: p.name, ventas: p.sales, unidades: p.units, total: p.revenue }))].sort((a, b) => b.total - a.total);
  return <div className="informes-panel">
    <h3>Cross-selling por canal</h3>
    <div className="canales-informe">
      <div><span className="metrica">Mostrador</span><b>{pesos(local.agregados)}</b>
        <small className="metrica">{local.conAgregado} de {local.ventas} ventas ({pct(local.conAgregado, local.ventas)}) · {pct(local.agregados, local.facturado)} de lo facturado</small></div>
      <div><span className="metrica">Tienda online</span>
        {!online ? <small className="metrica">Consultando la tienda online…</small>
          : online.configurado === false ? <small className="metrica">La tienda online no está conectada en este servidor.</small>
          : online.error ? <small className="aviso error">{online.error}</small>
          : <><b>{pesos(o.crossSellingRevenue)}</b>
            <small className="metrica">{o.ordersWithCrossSelling} de {o.orders} pedidos ({pct(o.ordersWithCrossSelling, o.orders)}) · {mostradas} ofertas, {aceptadas} aceptadas · descuento {pesos(o.crossSellingDiscount)}</small></>}
      </div>
    </div>
    {productos.length > 0 && <details className="detalle-cruzados">
      <summary>Productos agregados por cross-selling ({productos.length})</summary>
      <table>
        <thead><tr><th>Producto agregado</th><th>Canal</th><th className="num">Ventas</th><th className="num">Unidades</th><th className="num">Vendido</th></tr></thead>
        <tbody>{productos.map((c, i) => <tr key={i}><td>{c.nombre}</td><td>{c.canal}</td><td className="num">{c.ventas}</td><td className="num">{c.unidades}</td><td className="num">{pesos(c.total)}</td></tr>)}</tbody>
      </table>
    </details>}
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
    <button disabled={estado?.guardando} onClick={guardar}
      title="Una fila por venta del período: fecha, comprobante, producto principal, agregados por cross-selling y precios. Se guarda en la carpeta «informes» del mostrador.">
      {estado?.guardando ? "Guardando…" : "Guardar Excel"}</button>
    {estado?.archivo && <span className="aviso ok" role="status">Guardado ({estado.ventas} ventas): <code>{estado.archivo}</code></span>}
    {estado?.error && <span className="aviso error" role="alert">{estado.error}</span>}
  </div>;
}
