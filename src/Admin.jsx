import { useEffect, useMemo, useState } from "react";
import { api, buscar, pesos } from "./lib.js";
import PantallaReposo from "./PantallaReposo.jsx";
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
            ["ajustes", "Descuentos y topes"],
            ["facturas", "Facturas emitidas"],
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
      {tab === "ajustes" && <Ajustes />}
      {tab === "facturas" && <FacturasEmitidas />}
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
  const medios = { mercadopago: "MercadoPago", efectivo: "Efectivo", otros: "Otros", transferencia: "Transferencia", debito: "Débito", credito: "Crédito" };
  return <section>
    <h2>Facturas emitidas</h2>
    <p>MercadoPago registra la cobranza automáticamente. Efectivo y Otros requieren cobranza manual. Este historial no verifica cobros cargados posteriormente en Contabilium.</p>
    <button onClick={cargar}>Actualizar</button>
    <InformeExcel />
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

function InformeExcel() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [estado, setEstado] = useState(null);
  async function guardar() {
    setEstado({ guardando: true });
    try { setEstado(await api("/reporte", { method: "POST", body: { desde, hasta } })); }
    catch (err) { setEstado({ error: err.message }); }
  }
  return <div className="informe-excel">
    <h3>Informe de ventas en Excel</h3>
    <p>Fecha, comprobante, producto principal, productos agregados por recomendación, precio total y precio de los agregados. Sin fechas incluye todas las ventas. Se guarda en la carpeta <b>informes</b> del mostrador.</p>
    <label>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
    <label>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
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
  const [guardado, setGuardado] = useState(true);
  const rubros = useMemo(() => [...new Set(productos.map((p) => p.rubro))].sort(), [productos]);
  const subrubros = useMemo(() => [...new Set(productos.map((p) => p.subrubro).filter(Boolean))].sort(), [productos]);

  useEffect(() => {
    api("/reglas").then(setReglas);
    api("/metricas").then(setMetricas);
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
                Mostrada {m.mostradas} veces · aceptada {m.aceptadas}
                {m.mostradas > 0 && ` (${Math.round((m.aceptadas / m.mostradas) * 100)}%)`} · vendido {pesos(m.ingresos)}
              </p>
            )}
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
