import { useEffect, useMemo, useRef, useState } from "react";
import { accion, api, buscar, pesos, useEstado } from "./lib.js";
import CobranzaManual from "./CobranzaManual.jsx";

const METODOS = [
  ["mercadopago", "MercadoPago"],
  ["efectivo", "Efectivo"],
  ["otros", "Otros"],
];

export default function Vendedor() {
  const { estado, conectado } = useEstado();
  const [productos, setProductos] = useState([]);
  const [texto, setTexto] = useState("");
  const [rubro, setRubro] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const buscador = useRef(null);

  const actualizado = estado?.catalogo.actualizado;
  useEffect(() => {
    api("/catalogo").then((c) => setProductos(c.productos));
  }, [actualizado]);

  const rubros = useMemo(() => [...new Set(productos.map((p) => p.rubro))].sort(), [productos]);
  const visibles = useMemo(
    () => buscar(rubro ? productos.filter((p) => p.rubro === rubro) : productos, texto),
    [productos, texto, rubro],
  );

  async function ejecutar(tipo, datos) {
    const res = await accion(tipo, datos);
    if (!res.ok) setMensaje(res.error);
    else setMensaje(null);
    return res;
  }

  async function agregar(productId, reglaId) {
    await ejecutar("agregar", { productId, reglaId });
    setTexto("");
    buscador.current?.focus();
  }

  if (!estado) return <div className="cargando">Conectando con el mostrador…</div>;

  const bloqueado = ["facturando", "cobranza", "cobrando"].includes(estado.fase);

  return (
    <div className="vendedor">
      {!conectado && <div className="aviso error">Sin conexión con el servidor del mostrador.</div>}
      {estado.facturacionSimulada && (
        <div className="aviso prueba">
          {estado.modo === "mock" ? "MODO PRUEBA" : "FACTURACIÓN SIMULADA"}: las facturas no son reales
        </div>
      )}

      <div className="cuerpo">
        <section className="catalogo">
          <input
            ref={buscador}
            autoFocus
            className="buscador"
            placeholder="Buscar producto (nombre o código)…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && visibles.length === 1) agregar(visibles[0].id);
              if (e.key === "Escape") setTexto("");
            }}
          />
          <div className="rubros">
            <button className={!rubro ? "activo" : ""} onClick={() => setRubro(null)}>
              Todos
            </button>
            {rubros.map((r) => (
              <button key={r} className={rubro === r ? "activo" : ""} onClick={() => setRubro(r)}>
                {r}
              </button>
            ))}
          </div>
          <div className="grilla">
            {visibles.map((p) => (
              <button key={p.id} className="producto" disabled={bloqueado} onClick={() => agregar(p.id)}>
                <span className="foto">{p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : p.rubro}</span>
                <span className="nombre">{p.nombre}</span>
                {p.productoPrueba && <span className="badge gris">Producto de prueba</span>}
                <span className="precio">{pesos(p.precioFinal)}</span>
                {p.stock === 0 && <span className="sin-stock">Sin stock</span>}
              </button>
            ))}
            {!visibles.length && <p className="vacio">No hay productos que coincidan.</p>}
          </div>
          <footer className="estado-catalogo">
            {estado.catalogo.tienda.error && <span className="error">Tienda online: {estado.catalogo.tienda.error}</span>}
            {estado.catalogo.error ? (
              <span className="error">Error al actualizar catálogo: {estado.catalogo.error}</span>
            ) : (
              <span>
                {estado.catalogo.cantidad} productos ({estado.catalogo.conImagen} con foto) · actualizado{" "}
                {actualizado ? new Date(actualizado).toLocaleTimeString("es-AR") : "nunca"}
              </span>
            )}
            <button onClick={() => api("/catalogo/actualizar", { method: "POST" })}>Actualizar ahora</button>
            <a href="/admin" target="_blank" rel="noreferrer">
              Ajustes
            </a>
          </footer>
        </section>

        <section className="ticket">
          {["gracias", "cobranza", "cobrando"].includes(estado.fase) ? (
            <FacturaEmitida factura={estado.factura} estado={estado} ejecutar={ejecutar} onNueva={() => ejecutar("cancelar")} />
          ) : (
            <>
              <h2>Venta actual</h2>
              <Lineas estado={estado} bloqueado={bloqueado} ejecutar={ejecutar} />
              <Sugerencias sugerencias={estado.sugerencias} bloqueado={bloqueado} onAgregar={agregar} />
              <Totales totales={estado.totales} />
              {estado.lines.length > 0 && <Cobro estado={estado} bloqueado={bloqueado} ejecutar={ejecutar} />}
            </>
          )}
          {(mensaje || estado.error) && <div className="aviso error">{mensaje || estado.error}</div>}
        </section>
      </div>
    </div>
  );
}

function Lineas({ estado, bloqueado, ejecutar }) {
  if (!estado.lines.length) return <p className="vacio">Agregá productos desde la izquierda.</p>;
  return (
    <ul className="lineas">
      {estado.lines.map((l) => (
        <li key={l.lineId}>
          <div className="linea-info">
            <span className="nombre">{l.nombre}</span>
            <span className="detalle">
              {pesos(l.precioFinal)} c/u
              {l.descuentoPct > 0 && <span className="badge">-{l.descuentoPct}% recomendado</span>}
              {l.recomendado && l.descuentoPct === 0 && <span className="badge gris">sin descuento</span>}
            </span>
          </div>
          <div className="cantidad">
            <button disabled={bloqueado} onClick={() => ejecutar("cantidad", { lineId: l.lineId, cantidad: l.cantidad - 1 })}>
              −
            </button>
            <span>{l.cantidad}</span>
            <button disabled={bloqueado} onClick={() => ejecutar("cantidad", { lineId: l.lineId, cantidad: l.cantidad + 1 })}>
              +
            </button>
          </div>
          <span className="importe">{pesos(l.total)}</span>
          <button className="quitar" disabled={bloqueado} onClick={() => ejecutar("quitar", { lineId: l.lineId })} title="Quitar">
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function Sugerencias({ sugerencias, bloqueado, onAgregar }) {
  if (!sugerencias.length) return null;
  return (
    <div className="sugerencias-vendedor">
      <h3>El cliente está viendo estas sugerencias</h3>
      {[...new Set(sugerencias.map((s) => s.mensaje).filter(Boolean))].map((m) => (
        <p key={m} className="guion">{m}</p>
      ))}
      {sugerencias.map((s) => (
        <div key={s.productId} className="sugerencia">
          <span className="nombre">{s.nombre}</span>
          {s.precioFinal > s.precioConDescuento && (
            <span className="ahorro-sugerencia">Te ahorrás <strong>{pesos(s.precioFinal - s.precioConDescuento)}</strong></span>
          )}
          <span className="precio">
            {s.descuentoPct > 0 && <s>{pesos(s.precioFinal)}</s>} {pesos(s.precioConDescuento)}
            {s.descuentoPct > 0 && <span className="badge">-{s.descuentoPct}%</span>}
          </span>
          <button disabled={bloqueado} onClick={() => onAgregar(s.productId, s.reglaId)}>
            + Agregar
          </button>
        </div>
      ))}
    </div>
  );
}

function Totales({ totales }) {
  return (
    <div className="totales">
      {totales.descuentoRecomendaciones > 0 && (
        <>
          <div>
            <span>Subtotal</span>
            <span>{pesos(totales.subtotal)}</span>
          </div>
          <div className="descuento">
            <span>Descuentos por recomendación</span>
            <span>−{pesos(totales.descuentoRecomendaciones)}</span>
          </div>
        </>
      )}
      {totales.aplicaContado && (
        <div className="descuento">
          <span>Descuento efectivo/transferencia ({totales.descuentoContadoPct}%)</span>
          <span>−{pesos(totales.descuentoContado)}</span>
        </div>
      )}
      <div className="total">
        <span>Total</span>
        <span>{pesos(totales.totalAPagar)}</span>
      </div>
    </div>
  );
}

function Cobro({ estado, bloqueado, ejecutar }) {
  const [documento, setDocumento] = useState("");
  const [nombre, setNombre] = useState("");
  const [condicionIva, setCondicionIva] = useState("");
  const [email, setEmail] = useState("");
  const [pideDatos, setPideDatos] = useState(false);

  async function facturar(e) {
    e.preventDefault();
    const res = await ejecutar("facturar", { documento, nombre, condicionIva, email });
    if (res.ok && res.necesitaDatos) setPideDatos(true);
  }

  const sinFactura = estado.sinFactura;
  const soloDigitos = documento.replace(/\D/g, "");
  const documentoCompleto = [7, 8, 11].includes(soloDigitos.length);
  // Sin factura el documento es opcional (Consumidor Final); si se ingresa, se valida igual.
  const documentoListo = documentoCompleto || (sinFactura && !soloDigitos);
  const tipo = soloDigitos.length === 11 ? "CUIT" : "DNI";

  return (
    <form className="cobro" onSubmit={facturar}>
      <label>Condición de venta</label>
      <div className="metodos">
        {METODOS.map(([id, nombreMetodo]) => (
          <button
            type="button"
            key={id}
            disabled={bloqueado}
            className={estado.metodoPago === id ? "activo" : ""}
            onClick={() => ejecutar("metodoPago", { metodo: id })}
          >
            {nombreMetodo}
          </button>
        ))}
      </div>
      {estado.metodoPago === "efectivo" && (
        <>
          <label>Comprobante</label>
          <div className="metodos">
            <button type="button" disabled={bloqueado} className={!sinFactura ? "activo" : ""} onClick={() => ejecutar("sinFactura", { valor: false })}>
              Con factura
            </button>
            <button type="button" disabled={bloqueado} className={sinFactura ? "activo" : ""} onClick={() => ejecutar("sinFactura", { valor: true })}>
              Sin factura (cotización)
            </button>
          </div>
        </>
      )}
      <label>
        DNI o CUIT{" "}
        <small>{documentoCompleto ? `(${tipo})` : sinFactura ? "Opcional sin factura" : "Obligatorio para facturar"}</small>
        <input
          inputMode="numeric"
          required={!sinFactura}
          value={documento}
          disabled={bloqueado}
          onChange={(e) => {
            setDocumento(e.target.value);
            setPideDatos(false);
            setCondicionIva("");
            setNombre("");
            setEmail("");
          }}
          placeholder="Ej: 30123456 o 20-12345678-6"
        />
      </label>
      {documentoCompleto && (
        <label>Condición frente al IVA
          <select value={condicionIva} disabled={bloqueado} onChange={(e) => setCondicionIva(e.target.value)} required>
            <option value="">Elegí la condición del cliente…</option>
            <option value="CF">{`Consumidor Final${sinFactura ? "" : " (Factura B)"}`}</option>
            <option value="RI" disabled={soloDigitos.length !== 11}>{`Responsable Inscripto${sinFactura ? "" : " (Factura A)"}`}</option>
            <option value="MO" disabled={soloDigitos.length !== 11}>{`Monotributista${sinFactura ? "" : " (Factura A)"}`}</option>
            <option value="EX">{`Exento${sinFactura ? "" : " (Factura B)"}`}</option>
          </select>
        </label>
      )}
      {pideDatos && (
        <div className="datos-nuevos">
          <p>Cliente nuevo: completá sus datos fiscales.</p>
          <input placeholder="Razón social" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          <input type="email" placeholder="Email (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      <div className="acciones">
        <button type="button" className="secundario" disabled={bloqueado} onClick={() => ejecutar("cancelar")}>
          Cancelar venta
        </button>
        <button type="submit" className="primario" disabled={bloqueado || !estado.metodoPago || !documentoListo || (documentoCompleto && !condicionIva)}>
          {bloqueado
            ? sinFactura ? "Registrando cotización…" : "Emitiendo factura…"
            : !estado.metodoPago
              ? "Elegí condición de venta"
              : !documentoListo
                ? "Ingresá DNI o CUIT"
                : documentoCompleto && !condicionIva
                  ? "Elegí condición frente al IVA"
              : sinFactura
                ? `Registrar sin factura ${pesos(estado.totales.totalAPagar)}`
                : `Facturar ${pesos(estado.totales.totalAPagar)}`}
        </button>
      </div>
      {estado.metodoPago === "mercadopago" ? (
        <p className="aviso pendiente">Débito o crédito por MercadoPago. La cobranza se registra automáticamente en MercadoPago.</p>
      ) : estado.metodoPago === "efectivo" && sinFactura ? (
        <p className="aviso pendiente">Sin factura: se registra como Cotización en Contabilium (no va a ARCA). Después registrá la cobranza igual que en Efectivo.</p>
      ) : estado.metodoPago === "efectivo" ? (
        <p className="aviso pendiente">Efectivo, transferencia o ambos. Registrá la cobranza manualmente en Contabilium.</p>
      ) : estado.metodoPago === "otros" ? (
        <p className="aviso pendiente">Tarjeta combinada con efectivo o transferencia. Registrá los importes de cada medio manualmente en Contabilium.</p>
      ) : null}
    </form>
  );
}

function FacturaEmitida({ factura, estado, ejecutar, onNueva }) {
  return (
    <div className="factura-ok">
      <h2>
        ✓ {factura.tipo} {factura.cotizacion ? "registrada" : "emitida"}{factura.prueba && " (PRUEBA)"}
      </h2>
      <p>
        N° {factura.numero}{factura.cae && ` · CAE ${factura.cae}`}
      </p>
      <p>
        {factura.cliente.nombre} {factura.cliente.documento}
      </p>
      <p className="total">{pesos(factura.total)}</p>
      {factura.cobranza?.estado === "pendiente" && (
        <div className="aviso pendiente">
          <strong>{factura.cotizacion ? "Cotización registrada" : "Factura emitida"} · cobranza pendiente</strong>
          <p>Completá los medios y los importes para registrar el cobro.</p>
        </div>
      )}
      {factura.cobranza?.estado === "registrada" && factura.cobranza.modalidad === "automatica" && (
        <div className="aviso pendiente"><strong>Cobranza automática registrada en MercadoPago</strong></div>
      )}
      {factura.cobranza?.estado === "revisar" && factura.cobranza.modalidad === "automatica" && (
        <div className="aviso pendiente"><strong>Factura emitida · revisá la cobranza en MercadoPago</strong></div>
      )}
      {factura.cobranza?.estado === "registrada" && factura.cobranza.modalidad === "manual" && <p className="aviso pendiente">Cobranza registrada en Contabilium</p>}
      {factura.cobranza?.modalidad === "manual" && ["pendiente", "revisar"].includes(factura.cobranza.estado) && <CobranzaManual key={factura.idComprobante} factura={factura} destinos={estado.destinosCobranza} bloqueado={estado.fase === "cobrando"} ejecutar={ejecutar} />}
      {factura.advertencia && <div className="aviso error">{factura.advertencia}</div>}
      {factura.url && (
        <a href={factura.url} target="_blank" rel="noreferrer">
          Ver / imprimir {factura.cotizacion ? "comprobante" : "factura"}
        </a>
      )}
      <button className="primario" onClick={onNueva} disabled={estado.fase === "cobrando"}>
        {factura.cobranza?.estado === "pendiente" ? "Dejar cobranza pendiente y abrir nueva venta" : "Nueva venta"}
      </button>
    </div>
  );
}
