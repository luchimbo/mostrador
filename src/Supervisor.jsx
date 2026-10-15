import { useEffect, useState } from "react";
import { pesos, socket, useEstado } from "./lib.js";
import { Totales } from "./Vendedor.jsx";
import VozJoaquito from "./VozJoaquito.jsx";

const FASES = {
  idle: "Esperando una venta",
  venta: "Venta en curso",
  facturando: "Emitiendo comprobante",
  cobranza: "Cobranza pendiente",
  cobrando: "Registrando cobranza",
  gracias: "Venta finalizada",
};
const METODOS = { mercadopago: "MercadoPago", efectivo: "Efectivo", otros: "Otros" };
const COBRANZAS = { pendiente: "Pendiente", registrada: "Registrada", revisar: "Requiere revisión" };

export default function Supervisor() {
  const { estado, conectado } = useEstado();
  const factura = estado?.factura;

  return (
    <main className="supervision">
      <header className="supervision-cabecera">
        <div>
          <span className="supervision-marca">PC MIDI Center · Mostrador</span>
          <h1>Supervisión en vivo</h1>
          <p>Venta compartida del mostrador · Solo lectura</p>
        </div>
        <span className={`supervision-conexion ${conectado ? "conectado" : "desconectado"}`} role="status">
          {conectado ? "En vivo" : "Sin conexión"}
        </span>
      </header>

      {!conectado && <p className="aviso error" role="alert">Sin conexión. Los datos pueden estar desactualizados; se actualizarán al reconectar.</p>}
      {!estado ? <p className="cargando">Esperando el estado del mostrador…</p> : <>
        {estado.facturacionSimulada && <p className="aviso prueba">{estado.modo === "mock" ? "MODO PRUEBA" : "FACTURACIÓN SIMULADA"}: las facturas no son reales</p>}
        <div className="supervision-resumen">
          <div><span>Estado de la venta</span><strong>{FASES[estado.fase] || estado.fase}</strong></div>
          <div><span>Condición de venta</span><strong>{METODOS[estado.metodoPago] || "Sin elegir"}{estado.transferencia && " · Transferencia"}</strong></div>
          <div><span>Comprobante</span><strong>{estado.sinFactura ? "Cotización sin factura" : "Con factura"}</strong></div>
        </div>
        <div className="supervision-cuerpo">
          <section className="supervision-panel">
            <h2>Productos de la venta</h2>
            {estado.lines.length ? <ul className="supervision-lineas">
              {estado.lines.map((linea) => <li key={linea.lineId}>
                <div className="linea-info">
                  <strong>{linea.nombre}</strong>
                  <span className="detalle">{linea.cantidad} × {pesos(linea.precioFinal)}
                    {linea.descuentoPct > 0 && <span className="badge">−{linea.descuentoPct}% recomendado</span>}
                    {linea.crossSelling && <span className="badge gris">cross-selling</span>}
                  </span>
                </div>
                <span className="importe">{pesos(linea.total)}</span>
              </li>)}
            </ul> : <p className="vacio">Cuando el vendedor agregue productos, aparecerán acá automáticamente.</p>}
            {estado.sugerencias.length > 0 && <div className="sugerencias-vendedor">
              <h3>Sugerencias que ve el cliente</h3>
              {estado.sugerencias.map((s) => <div className="sugerencia" key={s.productId}>
                <span className="nombre">{s.nombre}</span>
                <span className="precio">{pesos(s.precioConDescuento)}{s.descuentoPct > 0 && <span className="badge">−{s.descuentoPct}%</span>}</span>
              </div>)}
            </div>}
          </section>
          <aside className="supervision-panel supervision-ticket">
            <h2>Total y cobranza</h2>
            <Totales totales={estado.totales} />
            {factura && <div className="supervision-comprobante">
              <h3>{factura.tipo}{factura.prueba && " (PRUEBA)"}</h3>
              <p>N° {factura.numero}</p>
              <p>{factura.cliente?.nombre}</p>
              <p>Total del comprobante: <strong>{pesos(factura.total)}</strong></p>
              {factura.cobranza && <p className="aviso pendiente">Cobranza: <strong>{COBRANZAS[factura.cobranza.estado] || factura.cobranza.estado}</strong></p>}
            </div>}
            {estado.error && <p className="aviso error" role="alert">{estado.error}</p>}
          </aside>
        </div>
      </>}
      <footer className="supervision-nota">Los cambios de la venta aparecen automáticamente. Las búsquedas, los clics y los campos sin enviar del vendedor no se muestran. Esta vista muestra la venta compartida, sin identificar quién la opera.</footer>
      <MensajesOcultos conectado={conectado} estado={estado} />
    </main>
  );
}

function MensajesOcultos({ conectado, estado }) {
  const [habilitado, setHabilitado] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState("");
  useEffect(() => {
    let secuencia = "";
    const detectar = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key.length !== 1) { secuencia = ""; return; }
      secuencia = (secuencia + e.key.toLowerCase()).slice(-8);
      if (secuencia === "joaquito") { setHabilitado(true); secuencia = ""; }
    };
    window.addEventListener("keydown", detectar);
    return () => window.removeEventListener("keydown", detectar);
  }, []);

  async function enviar(e) {
    e.preventDefault();
    if (!conectado || enviando || !texto.trim()) return;
    setEnviando(true);
    setResultado("");
    try {
      const res = await socket.timeout(5000).emitWithAck("mensaje-vendedor", { codigo: "joaquito", texto });
      setResultado(res.ok ? `Enviado a ${res.pantallas} pantalla${res.pantallas === 1 ? "" : "s"} del vendedor.` : res.error);
      if (res.ok) setTexto("");
    } catch {
      setResultado("No se pudo confirmar el envío. Revisá la conexión antes de volver a intentarlo.");
    } finally {
      setEnviando(false);
    }
  }
  if (!habilitado) return null;
  return <section className="supervision-panel mensajes-ocultos">
    <div className="mensajes-cabecera"><h2>Canal secreto 👀</h2><button type="button" onClick={() => { setHabilitado(false); setTexto(""); setResultado(""); }}>Ocultar</button></div>
    <VozJoaquito estado={estado} />
    <p>Aparece como un aviso en las pantallas del vendedor conectadas.</p>
    <form onSubmit={enviar}>
      <label htmlFor="mensaje-secreto">Mensaje para el vendedor</label>
      <textarea id="mensaje-secreto" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={280} rows={3} required />
      <div className="mensajes-cabecera"><small>{texto.length}/280</small><button className="primario" disabled={!conectado || enviando || !texto.trim()}>{enviando ? "Enviando…" : "Enviar mensaje"}</button></div>
    </form>
    {resultado && <p role="status">{resultado}</p>}
  </section>;
}
