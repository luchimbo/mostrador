import { useState } from "react";
import { pesos } from "./lib.js";

export default function CobranzaManual({ factura, destinos, bloqueado, ejecutar }) {
  const [pagos, setPagos] = useState([{ medio: "efectivo", destino: "almagro", importe: factura.total.toFixed(2), referencia: "" }]);
  const [mensaje, setMensaje] = useState(null);
  const medios = factura.metodoPago === "efectivo"
    ? [["efectivo", "Efectivo"], ["transferencia", "Transferencia"]]
    : [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["mercadopago", "MercadoPago (tarjeta)"]];
  const centavos = pagos.reduce((sum, p) => sum + Math.round((Number(p.importe) || 0) * 100), 0);
  const falta = (Math.round(factura.total * 100) - centavos) / 100;
  const listo = pagos.every(p => Number(p.importe) > 0 && destinos.some(d => d.key === p.destino && d.medios.includes(p.medio))) && falta === 0;
  const incierta = factura.cobranza.estado === "revisar";
  function cambiar(i, cambios) {
    setMensaje(null);
    setPagos(actual => actual.map((p, n) => n === i ? { ...p, ...cambios } : p));
  }
  async function guardar(e) {
    e.preventDefault();
    setMensaje(null);
    const res = await ejecutar("cobrar", { pagos: pagos.map(p => ({ ...p, importe: Number(p.importe) })) });
    if (!res.ok) setMensaje(res.error);
  }
  return <form className="cobranza-manual" onSubmit={guardar}>
    <h3>Registrar cobranza</h3>
    <p>Factura {factura.numero} · {factura.cliente.nombre}</p>
    <p>Asigná el importe recibido a cada medio y su destino.</p>
    {incierta && <p className="aviso error">Revisá esta cobranza en Contabilium antes de continuar. No se repetirá desde la app.</p>}
    <fieldset disabled={bloqueado || incierta}>
      {pagos.map((p, i) => <div className="pago-manual" key={i}>
        <label>Medio de cobro
          <select value={p.medio} onChange={e => cambiar(i, { medio: e.target.value, destino: "" })}>
            {medios.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </label>
        <label>Caja o cuenta
          <select value={p.destino} required onChange={e => cambiar(i, { destino: e.target.value })}>
            <option value="">Elegí el destino…</option>
            {destinos.filter(d => d.medios.includes(p.medio)).map(d => <option key={d.key} value={d.key}>{d.nombre}</option>)}
          </select>
        </label>
        <label>Importe recibido
          <input type="number" min="0.01" step="0.01" required value={p.importe} onChange={e => cambiar(i, { importe: e.target.value })} />
        </label>
        <label>Referencia (opcional)
          <input maxLength={100} value={p.referencia} onChange={e => cambiar(i, { referencia: e.target.value })} />
        </label>
        {pagos.length > 1 && <button type="button" onClick={() => setPagos(actual => actual.filter((_, n) => n !== i))}>Quitar medio</button>}
      </div>)}
      <button type="button" disabled={pagos.length >= 10} onClick={() => setPagos(actual => [...actual, { medio: "transferencia", destino: "", importe: falta > 0 ? falta.toFixed(2) : "", referencia: "" }])}>Agregar medio de cobro</button>
      <p>Total asignado: <strong>{pesos(centavos / 100)}</strong></p>
      <p>{falta >= 0 ? "Falta asignar" : "Excede el total"}: <strong>{pesos(Math.abs(falta))}</strong></p>
      <button type="submit" className="primario" disabled={!listo}>{bloqueado ? "Registrando cobranza…" : "Guardar cobranza"}</button>
    </fieldset>
    {mensaje && <p className="aviso error">{mensaje}</p>}
  </form>;
}
