import { useEffect, useId, useMemo, useRef, useState } from "react";
import "./Catalogo.css";
import { api, buscar, pesos } from "./lib.js";
import { Cabecera, Segmentos, fechaHora } from "./ui.jsx";
import { descuentoRegla, reglaSeDispara } from "../shared/recommendations.js";
import { descuentoSeguro, round2 } from "../shared/pricing.js";

const VISIBLES = 50;
const RECOMENDACIONES_POR_PAGINA = 3;
const dispara = (r, p, porId) => Boolean(reglaSeDispara({ ...r, activa: true }, [{ productId: p.id }], porId));
const tieneCambios = (edicion) => edicion && edicion.valor !== edicion.valorInicial;

function descargarCsv(nombre, filas) {
  const csv = filas.map((f) => f.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: nombre });
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Catalogo({ productos, onActualizado }) {
  const [estado, setEstado] = useState(null);
  const [faltantes, setFaltantes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [solapa, setSolapa] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [seleccionado, setSeleccionado] = useState(null);
  const [edicion, setEdicion] = useState(null);
  const [reglas, setReglas] = useState([]);
  const [ajustes, setAjustes] = useState(null);
  const [errorReglas, setErrorReglas] = useState("");

  useEffect(() => {
    api("/tienda/estado").then(setEstado).catch(() => {});
    api("/tienda/faltantes").then(setFaltantes).catch(() => {});
    Promise.all([api("/reglas"), api("/ajustes")]).then(([r, a]) => { setReglas(r); setAjustes(a); }).catch(() => setErrorReglas("No se pudieron cargar las recomendaciones. Recargá la página para volver a intentar."));
  }, []);

  async function actualizar() {
    setCargando(true);
    try {
      setEstado(await api("/tienda/actualizar", { method: "POST" }));
      await onActualizado();
      setFaltantes(await api("/tienda/faltantes"));
    } catch (err) {
      setEstado((e) => ({ ...e, error: err.message }));
    } finally {
      setCargando(false);
    }
  }

  function puedeSalirDelEditor() {
    return !edicion?.ocupado && (!tieneCambios(edicion) || window.confirm("¿Descartar el cambio de descuento sin guardar?"));
  }

  function elegirProducto(producto) {
    if (producto?.id === seleccionado?.id || !puedeSalirDelEditor()) return;
    setEdicion(null);
    setSeleccionado(producto);
  }

  const sinStock = productos.filter((p) => p.stock === 0);
  const sinFoto = productos.filter((p) => !p.imagen);
  const aLaVenta = productos.length - sinStock.length;
  const total = productos.length + faltantes.length;
  const listas = {
    todos: { nombre: "Todos", filas: productos, ayuda: "Los productos que hoy aparecen en el mostrador, con su categoría, precio y foto." },
    faltan: { nombre: "Falta en Contabilium", filas: faltantes.map((f) => ({ id: f.sku, codigo: f.sku, nombre: f.nombre })), aviso: true,
      ayuda: "Están publicados en la tienda pero ningún producto de Contabilium tiene ese código. Para venderlos en el mostrador, revisá el código en Contabilium." },
    stock: { nombre: "Sin stock", filas: sinStock, aviso: true,
      ayuda: "Se ven en el mostrador pero no aparecen en la pantalla del cliente ni en las sugerencias." },
    foto: { nombre: "Sin foto", filas: sinFoto, aviso: true,
      ayuda: "Se pueden vender, pero no aparecen en la pantalla del cliente. Cargá la foto en la tienda online." },
  };
  const lista = listas[solapa];
  const filas = buscar(lista.filas.map((f) => ({ rubro: "", ...f })), busqueda);
  const mostradas = verTodos ? filas : filas.slice(0, VISIBLES);
  const cambiarSolapa = (s) => { setSolapa(s); setVerTodos(false); };

  return <section className={seleccionado ? "catalogo-con-panel" : ""}>
    <Cabecera titulo="Catálogo" descripcion="Productos de la tienda online (Tiendanube) emparejados por SKU con Contabilium.">
      <button disabled={cargando} onClick={actualizar}>{cargando ? "Leyendo la tienda… (tarda unos minutos)" : "Leer la tienda completa"}</button>
    </Cabecera>
    {estado?.error && <p className="aviso error" role="alert">{estado.error}</p>}
    {errorReglas && <p className="aviso error" role="alert">{errorReglas}</p>}

    <div className="tarjeta">
      <div className="tarjeta-titulo"><h3>De la tienda al mostrador</h3><span className="metrica">{total} productos publicados en la tienda</span></div>
      {total > 0 && <div className="embudo" aria-hidden="true">
        {aLaVenta > 0 && <i className="tramo-venta" style={{ flexGrow: aLaVenta }}>{aLaVenta}</i>}
        {sinStock.length > 0 && <i className="tramo-sin-stock" style={{ flexGrow: sinStock.length }}>{sinStock.length}</i>}
        {faltantes.length > 0 && <i className="tramo-falta" style={{ flexGrow: faltantes.length }}>{faltantes.length}</i>}
      </div>}
      <div className="leyenda">
        <span className="tramo-venta">{aLaVenta} a la venta en el mostrador</span>
        <span className="tramo-sin-stock">{sinStock.length} sin stock</span>
        <span className="tramo-falta">{faltantes.length} no se pueden vender (falta en Contabilium)</span>
      </div>
    </div>

    <div className="tarjeta estado-lectura">
      <span className="punto">Precios: {fechaHora(estado?.actualizado) || "todavía no se leyeron"}</span>
      <span className="punto">Fotos, categorías y productos nuevos: {fechaHora(estado?.completo) || "todavía no se leyeron"}</span>
      <span className="metrica">Precios cada 30 minutos · lo demás una vez por día</span>
    </div>

    <div className="tarjeta">
      <Segmentos etiqueta="Lista de productos" valor={solapa} onCambiar={cambiarSolapa}
        opciones={Object.entries(listas).map(([k, l]) => [k, <>{l.nombre} <span className={`contador ${l.aviso && l.filas.length ? "aviso" : ""}`}>{l.filas.length}</span></>])} />
      <p className="metrica ayuda-lista">{lista.ayuda}</p>
      <div className="tarjeta-titulo">
        <input type="search" placeholder="Buscar SKU o nombre" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <button disabled={!filas.length} onClick={() => descargarCsv(`${lista.nombre.toLowerCase().replaceAll(" ", "-")}.csv`,
          [["SKU", "Producto", "Categoría", "Precio"], ...filas.map((p) => [p.codigo, p.nombre, p.rubro, p.precioFinal ?? ""])])}>Descargar CSV</button>
      </div>
      {!filas.length ? <p className="vacio">{lista.filas.length ? "Ningún producto coincide con la búsqueda." : "No hay productos en esta lista."}</p>
        : solapa === "todos" ? <div className="galeria">
          {mostradas.map((p) => <figure key={p.id}>
            <button className="enlace" style={{ display: "block", width: "100%" }} aria-label={`Ver recomendaciones de ${p.nombre}`} onClick={() => elegirProducto(p)}>
              {p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <div className="sin-imagen">Sin foto</div>}
            </button>
            <figcaption><button className="enlace" onClick={() => elegirProducto(p)}>{p.nombre}</button><small>{p.rubro} · {pesos(p.precioFinal)}</small></figcaption>
          </figure>)}
        </div>
        : <ul className="lista-productos">{mostradas.map((p) => <li key={p.id}><code>{p.codigo || "sin código"}</code><span>{p.nombre}</span>{p.precioFinal != null && <small>{pesos(p.precioFinal)}</small>}</li>)}</ul>}
      {filas.length > VISIBLES && <button className="enlace" onClick={() => setVerTodos(!verTodos)}>{verTodos ? "Ver menos" : `Mostrando ${VISIBLES} de ${filas.length} · Ver todos`}</button>}
    </div>
    {seleccionado && ajustes && <FichaRecomendaciones key={seleccionado.id} producto={seleccionado} productos={productos}
      reglas={reglas} setReglas={setReglas} ajustes={ajustes} cerrar={() => elegirProducto(null)}
      edicion={edicion} setEdicion={setEdicion} puedeSalirDelEditor={puedeSalirDelEditor} />}
  </section>;
}

function FichaRecomendaciones({ producto, productos, reglas, setReglas, ajustes, cerrar, edicion, setEdicion, puedeSalirDelEditor }) {
  const [vista, setVista] = useState(() => reglas.some((r) => r.sugeridos.map(String).includes(String(producto.id))) ? "donde" : "que");
  const [paginaElegida, setPagina] = useState(0);
  const [aviso, setAviso] = useState("");
  const editorId = useId();
  const botonEdicion = useRef(null);
  const avisoRef = useRef(null);
  const porId = useMemo(() => new Map(productos.map((p) => [String(p.id), p])), [productos]);
  const donde = useMemo(() => reglas.filter((r) => r.sugeridos.map(String).includes(String(producto.id))), [reglas, producto.id]);
  const que = useMemo(() => reglas.filter((r) => dispara(r, producto, porId)), [reglas, producto, porId]);
  const relaciones = useMemo(() => vista === "donde"
    ? donde.flatMap((r) => {
      const coincidencias = productos.filter((p) => dispara(r, p, porId));
      return (coincidencias.length ? coincidencias : [null]).map((p) => ({ regla: r, p, recomendado: producto }));
    })
    : que.flatMap((r) => r.sugeridos.map((id) => {
      const recomendado = porId.get(String(id));
      return { regla: r, p: recomendado || { id, nombre: `Producto #${id} (fuera del catálogo)` }, recomendado };
    })), [vista, donde, que, productos, producto, porId]);
  const tam = RECOMENDACIONES_POR_PAGINA;
  const paginas = Math.max(1, Math.ceil(relaciones.length / tam));
  const pagina = Math.min(paginaElegida, paginas - 1);
  useEffect(() => {
    if (pagina !== paginaElegida) setPagina(pagina);
  }, [pagina, paginaElegida]);
  useEffect(() => {
    if (aviso) avisoRef.current?.focus();
  }, [aviso]);

  function cancelar() {
    botonEdicion.current?.focus();
    setEdicion(null);
  }

  function abrirEditor(clave, regla, idProducto) {
    if (!puedeSalirDelEditor()) return;
    setAviso("");
    if (edicion?.clave === clave) {
      cancelar();
      return;
    }
    const valorInicial = String(regla.descuentosPorProducto?.[idProducto] ?? "");
    setEdicion({ clave, original: regla, idProducto, valorInicial, valor: valorInicial });
  }

  function cambiarVista(siguiente) {
    if (vista === siguiente || !puedeSalirDelEditor()) return;
    setEdicion(null);
    setAviso("");
    setVista(siguiente);
    setPagina(0);
  }

  function cambiarPagina(siguiente) {
    if (!puedeSalirDelEditor()) return;
    setEdicion(null);
    setAviso("");
    setPagina(siguiente);
  }

  function cambiarDescuento(valor) {
    setEdicion((actual) => ({ ...actual, valor }));
  }

  async function actualizarReglas(recargar) {
    if (edicion.ocupado) return;
    setEdicion({ ...edicion, ocupado: true, error: "" });
    try {
      let nuevasReglas;
      if (recargar) {
        nuevasReglas = await api("/reglas");
      } else {
        const { original, idProducto, valor } = edicion;
        const descuentosPorProducto = { ...original.descuentosPorProducto };
        if (valor === "") delete descuentosPorProducto[idProducto];
        else descuentosPorProducto[idProducto] = Number(valor);
        nuevasReglas = await api(`/reglas/${encodeURIComponent(original.id)}`, {
          method: "PUT",
          body: { original, regla: { ...original, descuentosPorProducto } },
        });
      }
      setReglas(nuevasReglas);
      setEdicion(null);
      setAviso(recargar ? "Descuentos actualizados. Volvé a abrir el editor para hacer cambios." : "Descuento guardado.");
    } catch (err) {
      setEdicion({ ...edicion, ocupado: false, error: err.message, conflicto: edicion.conflicto || err.status === 409 || err.status === 404 });
    }
  }

  return <aside className="catalogo-panel" aria-label={`Recomendaciones de ${producto.nombre}`}>
    <div className="catalogo-panel-cabecera"><span>RECOMENDACIONES</span><button disabled={edicion?.ocupado} onClick={cerrar} aria-label="Cerrar recomendaciones">×</button></div>
    <div className="catalogo-panel-producto">{producto.imagen ? <img src={producto.imagen} alt="" /> : <div className="catalogo-panel-sinfoto">Sin foto</div>}<div><strong>{producto.nombre}</strong><small>{producto.codigo} · {pesos(producto.precioFinal)}</small></div></div>
    <div className="catalogo-panel-tabs" role="group" aria-label="Tipo de recomendación">
      <button className={vista === "donde" ? "activo" : ""} aria-pressed={vista === "donde"} disabled={edicion?.ocupado} onClick={() => cambiarVista("donde")}>Se recomienda con <b>{donde.length}</b></button>
      <button className={vista === "que" ? "activo" : ""} aria-pressed={vista === "que"} disabled={edicion?.ocupado} onClick={() => cambiarVista("que")}>Recomienda <b>{que.length}</b></button>
    </div>
    <p className="catalogo-panel-ayuda">{vista === "donde" ? "Este producto se ofrece junto con:" : "Al elegir este producto, se ofrece:"}</p>
    {aviso && <p className="catalogo-panel-aviso" role="status" tabIndex={-1} ref={avisoRef}>{aviso}</p>}
    <div className="catalogo-panel-lista">{!relaciones.length ? <p className="metrica">No hay recomendaciones configuradas.</p> : relaciones.slice(pagina * tam, (pagina + 1) * tam).map(({ regla, p, recomendado }) => {
      const clave = JSON.stringify([regla.id, p?.id ?? null]);
      const abierta = edicion?.clave === clave;
      const idDescuento = String(vista === "donde" ? producto.id : p.id);
      const solicitado = descuentoRegla(regla, idDescuento, ajustes);
      const efectivo = recomendado ? descuentoSeguro(recomendado, solicitado, ajustes) : solicitado;
      return <div className="catalogo-panel-tarjeta" key={clave}>
        <div className="catalogo-panel-fila">
          {p?.imagen ? <img src={p.imagen} alt="" /> : <div className="catalogo-panel-sinfoto">Sin foto</div>}
          <div className="catalogo-panel-detalle">
            <strong>{p?.nombre || "Sin productos coincidentes"}</strong>
            <small>{p?.stock === 0 ? "Sin stock · " : ""}{regla.nombre}{!regla.activa && " · Inactiva"}</small>
            <div><b className="catalogo-panel-descuento">{efectivo}% descuento</b>{recomendado && <span> {pesos(round2(recomendado.precioFinal * (1 - efectivo / 100)))}</span>}</div>
            {efectivo < solicitado && <small>Configurado: {solicitado}% · reducido por margen o tope</small>}
            <button className="enlace" ref={abierta ? botonEdicion : null} aria-expanded={abierta} aria-controls={abierta ? editorId : undefined}
              disabled={edicion?.ocupado} onClick={() => abrirEditor(clave, regla, idDescuento)}>{abierta ? "Cerrar editor" : "Editar descuento"}</button>
          </div>
        </div>
        {abierta && <EditorDescuento id={editorId} edicion={edicion} nombre={vista === "donde" ? producto.nombre : p.nombre}
          general={ajustes.descuentoGeneralPct} cambiar={cambiarDescuento} cancelar={cancelar} actualizarReglas={actualizarReglas} />}
      </div>;
    })}</div>
    {paginas > 1 && <div className="catalogo-panel-paginas"><button disabled={pagina === 0 || edicion?.ocupado} onClick={() => cambiarPagina(pagina - 1)}>Anterior</button><span>{pagina + 1} / {paginas} · {relaciones.length} productos</span><button disabled={pagina + 1 >= paginas || edicion?.ocupado} onClick={() => cambiarPagina(pagina + 1)}>Siguiente</button></div>}
    <p className="catalogo-panel-nota">Las sugerencias dependen del carrito y la disponibilidad. El precio online puede variar.</p>
  </aside>;
}

function EditorDescuento({ id, edicion, nombre, general, cambiar, cancelar, actualizarReglas }) {
  const { valor, ocupado, error, conflicto } = edicion;
  const campoId = `${id}-porcentaje`;
  const ayudaId = `${id}-ayuda`;
  return <form id={id} className="catalogo-editor" aria-label="Editar descuento" aria-busy={ocupado} onSubmit={(e) => {
    e.preventDefault();
    if (!ocupado && !conflicto && tieneCambios(edicion)) actualizarReglas(false);
  }}>
    <label htmlFor={campoId}>Descuento de {nombre} (%)</label>
    <div className="catalogo-editor-controles">
      <input id={campoId} aria-describedby={ayudaId} autoFocus type="number" min="0" max="100" step="any"
        placeholder={String(general)} value={valor} disabled={ocupado} onChange={(e) => cambiar(e.target.value)} />
      <div className="catalogo-editor-acciones">
        <button type="button" disabled={ocupado} onClick={cancelar}>Cancelar</button>
        {conflicto
          ? <button type="button" disabled={ocupado} onClick={() => actualizarReglas(true)}>{ocupado ? "Recargando…" : "Descartar y recargar"}</button>
          : <button type="submit" className="primario" disabled={ocupado || !tieneCambios(edicion)}>{ocupado ? "Guardando…" : "Guardar"}</button>}
      </div>
    </div>
    <p id={ayudaId} className="metrica">Dejá el campo vacío para usar el descuento por defecto ({general}%).</p>
    {error && <p className="aviso error" role="alert">{error}</p>}
  </form>;
}
