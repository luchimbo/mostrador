import { pesos, useEstado } from "./lib.js";
import { Totales } from "./Vendedor.jsx";

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
    </main>
  );
}
