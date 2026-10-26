import { useEffect, useState } from "react";
import { api, pesos } from "./lib.js";
import { MEDIOS } from "./Informes.jsx";
import { Cabecera, Pildora, Segmentos } from "./ui.jsx";

export const cobranzaPendiente = (f) => f.cobranza?.modalidad === "manual" && f.cobranza.estado === "pendiente";
function estadoCobranza(f) {
  if (f.cobranza?.estado === "revisar") return ["error", "Revisar en Contabilium"];
  if (f.cobranza?.estado === "registrada") return ["ok", "Cobranza registrada"];
  if (cobranzaPendiente(f)) return ["aviso", "Cobranza pendiente"];
  return ["gris", "Registro anterior"];
}
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Facturas() {
  const [facturas, setFacturas] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");
  function cargar() {
    setError(null);
    api("/facturas").then(setFacturas).catch((err) => setError(err.message));
  }
  useEffect(() => { cargar(); }, []);
  async function registrar(f) {
    try { await api(`/facturas/${f.idComprobante}/retomar`, { method: "POST" }); window.location.href = "/vendedor"; }
    catch (err) { setError(err.message); }
  }
  const lista = facturas || [];
  const pendientes = lista.filter(cobranzaPendiente).length, revisar = lista.filter((f) => f.cobranza?.estado === "revisar").length;
  const texto = normalizar(busqueda.trim());
  const visibles = lista.filter((f) => (filtro === "todas" || (filtro === "pendiente" ? cobranzaPendiente(f) : f.cobranza?.estado === "revisar")) &&
    (!texto || normalizar(`${f.numero} ${f.cliente?.nombre} ${f.cliente?.documento}`).includes(texto)));

  return <section>
    <Cabecera titulo="Facturas" descripcion="Emitidas desde el mostrador. MercadoPago registra la cobranza solo; Efectivo y Otros se registran desde acá.">
      <input type="search" placeholder="Número, cliente o documento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      <button onClick={cargar}>Actualizar</button>
    </Cabecera>
    {error && <p className="aviso error">{error}</p>}
    <Segmentos etiqueta="Filtrar facturas" valor={filtro} onCambiar={setFiltro} opciones={[
      ["todas", "Todas"],
      ["pendiente", <>Cobranza pendiente {pendientes > 0 && <span className="contador aviso">{pendientes}</span>}</>],
      ["revisar", <>A revisar {revisar > 0 && <span className="contador aviso">{revisar}</span>}</>],
    ]} />
    {!facturas ? <p>Cargando facturas…</p> : !visibles.length ? <p className="vacio">{lista.length ? "No hay facturas en esta lista." : "Todavía no hay facturas registradas."}</p> :
      <div className="tarjeta lista-facturas">
        <div className="factura-fila cabeza"><span>Comprobante</span><span>Cliente</span><span className="num">Total</span><span>Cobranza</span></div>
        {visibles.map((f, i) => {
          const [tipo, nombre] = estadoCobranza(f);
          return <div className="factura-fila" key={f.idComprobante || `${f.fecha}:${i}`}>
            <span><b>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.numero}</a> : f.numero}</b>
              {f.tipo === "Cotización" && <Pildora>Sin factura</Pildora>}{f.prueba && <Pildora>Prueba</Pildora>}
              <small>{new Date(f.fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} · {MEDIOS[f.metodoPago] || f.metodoPago}</small></span>
            <span>{f.cliente?.nombre}<small>{f.cliente?.documento}</small></span>
            <span className="num"><b>{pesos(f.total)}</b></span>
            <span>{cobranzaPendiente(f) ? <button className="primario" onClick={() => registrar(f)}>Registrar cobranza</button> : <Pildora tipo={tipo}>{nombre}</Pildora>}</span>
          </div>;
        })}
      </div>}
    <p className="metrica">El historial no verifica cobros cargados después directamente en Contabilium.</p>
  </section>;
}
