import { useEffect, useState } from "react";
import { api, pesos } from "./lib.js";
import { esOferta, productosEnReposo, secuenciaReposo, validarPantalla, youtubeId } from "../shared/display.js";
import { BarraCambios, Cabecera, Interruptor, Pildora, Segmentos, SelectorProducto } from "./ui.jsx";

const CAMPOS = ["modoReposo", "segundosPorSlide", "segundosPorVideo", "productosEntreVideos", "videosReposo", "excluidosReposo", "opinionUrl", "mostrarOpinion"];
const MODOS = [["ofertas", "Ofertas"], ["mixto", "Ofertas y elegidos"], ["manual", "Solo elegidos"]];
const VISIBLES = 12;
const duracion = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ""}` : `${s} s`);

export default function PantallaReposo({ productos, porId }) {
  const [ajustes, setAjustes] = useState(null);
  const [destacados, setDestacados] = useState(null);
  const [guardado, setGuardado] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const foto = (aj, ds) => JSON.stringify([CAMPOS.map((c) => aj[c]), ds]);
  useEffect(() => {
    Promise.all([api("/ajustes"), api("/destacados")]).then(([aj, ds]) => {
      setAjustes(aj); setDestacados(ds); setGuardado(foto(aj, ds));
    }).catch((e) => setError(e.message));
  }, []);
  function cambiar(parcial) {
    setAjustes((prev) => ({ ...prev, ...parcial }));
    setMensaje(""); setError("");
  }
  function editarVideo(id, parcial) {
    cambiar({ videosReposo: ajustes.videosReposo.map((v) => v.id === id ? { ...v, ...parcial } : v) });
  }
  function mover(index, delta) {
    const next = [...ajustes.videosReposo];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    cambiar({ videosReposo: next });
  }
  async function guardar() {
    setGuardando(true); setError(""); setMensaje("");
    try {
      validarPantalla(ajustes);
      const aj = await api("/ajustes", { method: "PUT", body: Object.fromEntries(CAMPOS.map((c) => [c, ajustes[c]])) });
      const ds = await api("/destacados", { method: "PUT", body: destacados });
      setAjustes(aj); setDestacados(ds); setGuardado(foto(aj, ds));
      setMensaje("Guardado. La pantalla del cliente ya está actualizada.");
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }
  if (!ajustes || !destacados) return <p role="status">{error || "Cargando…"}</p>;

  const enPantalla = productosEnReposo(productos, destacados, ajustes);
  const slides = secuenciaReposo(enPantalla, ajustes.videosReposo, ajustes.productosEntreVideos);
  const segundosVideo = (v) => (v.fin != null ? v.fin - v.inicio : ajustes.segundosPorVideo);
  const vuelta = slides.reduce((t, s) => t + (s.tipo === "video" ? segundosVideo(s.video) : ajustes.segundosPorSlide), 0);
  const usaElegidos = ajustes.modoReposo !== "ofertas";
  // En modo «Ofertas» los elegidos no cuentan: lo que se ve es por estar en oferta.
  const elegidos = new Set(usaElegidos ? destacados.map(String) : []);
  const ofertas = productos.filter((p) => esOferta(p) && p.imagen && p.stock !== 0 && p.activo !== false && !ajustes.excluidosReposo.includes(String(p.id)));
  const sinElegidos = usaElegidos && !enPantalla.some((p) => elegidos.has(String(p.id)));
  const quitar = (p) => (elegidos.has(String(p.id))
    ? setDestacados(destacados.filter((id) => String(id) !== String(p.id)))
    : cambiar({ excluidosReposo: [...ajustes.excluidosReposo, String(p.id)] }));

  return <section className="pantalla-ajustes">
    <Cabecera titulo="Pantalla del cliente" descripcion="Lo que ve el cliente cuando no hay una venta y al terminar la compra.">
      <a className="boton" href="/cliente" target="_blank" rel="noreferrer">Ver pantalla ↗</a>
    </Cabecera>
    <fieldset disabled={guardando}>
      <div className="tarjeta">
        <div className="tarjeta-titulo"><h3>Secuencia</h3><span className="metrica">{enPantalla.length ? `Una vuelta completa: ${duracion(vuelta)}` : "Sin productos: se muestra el logo"}</span></div>
        <div className="secuencia" aria-label="Orden en que pasan productos y videos">
          {slides.map((s, i) => <i key={i} className={s.tipo} style={{ flexGrow: s.tipo === "video" ? segundosVideo(s.video) : ajustes.segundosPorSlide }}
            title={s.tipo === "video" ? `Video: ${s.video.titulo || "sin título"}` : s.producto?.nombre || "Logo"} />)}
        </div>
        <p className="metrica">Al comenzar una venta pasa al ticket enseguida. Si no hay productos con foto y stock, aparece el logo.</p>
      </div>

      <div className="tarjeta">
        <div className="tarjeta-titulo"><h3>Productos</h3><Segmentos etiqueta="Qué productos mostrar" opciones={MODOS} valor={ajustes.modoReposo} onCambiar={(modoReposo) => cambiar({ modoReposo })} /></div>
        <div className="tarjeta-titulo">
          <span className="metrica">{enPantalla.length} productos rotando{ajustes.modoReposo !== "manual" && ` · ${ofertas.length} ofertas con foto y stock`}</span>
          <label className="campo-corto">Cada producto <input type="number" min="3" max="120" value={ajustes.segundosPorSlide} onChange={(e) => cambiar({ segundosPorSlide: Number(e.target.value) })} /> s</label>
        </div>
        {sinElegidos && <p className="metrica">Todavía no elegiste productos: se usa el más caro con foto de cada categoría.</p>}
        <div className="grilla-reposo">
          {(verTodos ? enPantalla : enPantalla.slice(0, VISIBLES)).map((p) => {
            const tipo = elegidos.has(String(p.id)) ? "Elegido" : esOferta(p) ? "Oferta" : "Automático";
            return <figure key={p.id}>
              <Pildora tipo={tipo === "Oferta" ? "acento" : "gris"}>{tipo}{tipo === "Oferta" && p.precioLista ? ` -${Math.round((1 - p.precioFinal / p.precioLista) * 100)}%` : ""}</Pildora>
              <button className="quitar-producto" aria-label={tipo === "Elegido" ? `Sacar ${p.nombre} de los elegidos` : `No mostrar ${p.nombre}`} title={tipo === "Elegido" ? "Sacar de los elegidos" : "No mostrar en la pantalla"} onClick={() => quitar(p)}>×</button>
              <img src={p.imagen} alt="" loading="lazy" />
              <figcaption>{p.nombre}<small>{pesos(p.precioFinal)}</small></figcaption>
            </figure>;
          })}
          {usaElegidos && <div className="agregar-producto"><SelectorProducto productos={productos} excluir={destacados.map(String)} placeholder="+ Elegir producto"
            onElegir={(p) => setDestacados([...destacados, String(p.id)])} /></div>}
        </div>
        {enPantalla.length > VISIBLES && <button className="enlace" onClick={() => setVerTodos(!verTodos)}>{verTodos ? "Ver menos" : `Ver los ${enPantalla.length}`}</button>}
        {ajustes.modoReposo !== "manual" && <div className="excluidos-reposo">
          <span className="metrica">No se muestran:</span>
          {ajustes.excluidosReposo.length === 0 && <span className="metrica">ninguno</span>}
          {ajustes.excluidosReposo.map((id) => <span className="chip" key={id}>{porId.get(id)?.nombre || `#${id}`}<button aria-label={`Volver a mostrar ${porId.get(id)?.nombre || id}`} title="Volver a mostrar" onClick={() => cambiar({ excluidosReposo: ajustes.excluidosReposo.filter((x) => x !== id) })}>×</button></span>)}
        </div>}
      </div>

      <div className="tarjeta">
        <div className="tarjeta-titulo"><h3>Videos de YouTube <Pildora>Sin sonido</Pildora></h3>
          <span className="fila-botones">
            <label className="campo-corto">Uno cada <input type="number" min="1" max="20" step="1" value={ajustes.productosEntreVideos} onChange={(e) => cambiar({ productosEntreVideos: Number(e.target.value) })} /> productos</label>
            <button disabled={ajustes.videosReposo.length >= 30} onClick={() => {
              const id = crypto.randomUUID();
              setAbiertos(new Set(abiertos).add(id));
              cambiar({ videosReposo: [...ajustes.videosReposo, { id, url: "", titulo: "", inicio: 0, fin: null, productId: null, activo: true }] });
            }}>+ Video</button>
          </span></div>
        {ajustes.videosReposo.length === 0 && <p className="vacio">Todavía no hay videos. Pegá un enlace de YouTube con «+ Video».</p>}
        {ajustes.videosReposo.map((v, index) => {
          const id = youtubeId(v.url);
          return <details className={`video-fila ${v.activo ? "" : "inactivo"}`} key={v.id} open={abiertos.has(v.id)}
            onToggle={(e) => { const next = new Set(abiertos); if (e.currentTarget.open) next.add(v.id); else next.delete(v.id); setAbiertos(next); }}>
            <summary>
              <Interruptor activo={v.activo} onCambiar={(activo) => editarVideo(v.id, { activo })} etiqueta={`Video ${index + 1} activo`} />
              {id ? <img src={`https://i.ytimg.com/vi/${id}/default.jpg`} alt="" /> : <span className="miniatura-vacia" />}
              <span className="video-texto"><b>{v.titulo || `Video ${index + 1}`}</b>
                <small>{v.inicio}s → {v.fin != null ? `${v.fin}s` : `${ajustes.segundosPorVideo}s después`} · {porId.get(String(v.productId))?.nombre || "Sin producto asociado"}</small></span>
              {v.url && !id && <Pildora tipo="aviso">Revisar enlace</Pildora>}
              <span className="fila-botones">
                <button aria-label={`Subir video ${index + 1}`} disabled={index === 0} onClick={(e) => { e.preventDefault(); mover(index, -1); }}>↑</button>
                <button aria-label={`Bajar video ${index + 1}`} disabled={index === ajustes.videosReposo.length - 1} onClick={(e) => { e.preventDefault(); mover(index, 1); }}>↓</button>
                <button className="peligro" onClick={(e) => { e.preventDefault(); cambiar({ videosReposo: ajustes.videosReposo.filter((x) => x.id !== v.id) }); }}>Quitar</button>
              </span>
            </summary>
            <div className="campos-reposo">
              <label className="campo-ancho">Enlace de YouTube<input type="url" placeholder="https://www.youtube.com/watch?v=…" value={v.url} onChange={(e) => editarVideo(v.id, { url: e.target.value.trim() })} /></label>
              <label>Título<input maxLength="150" value={v.titulo} onChange={(e) => editarVideo(v.id, { titulo: e.target.value })} /></label>
              <label>Producto asociado<select value={v.productId || ""} onChange={(e) => editarVideo(v.id, { productId: e.target.value || null })}><option value="">Sin producto asociado</option>{productos.map((p) => <option value={String(p.id)} key={p.id}>{p.nombre}</option>)}</select></label>
              <label>Inicio (segundos)<input type="number" min="0" max="86400" value={v.inicio} onChange={(e) => editarVideo(v.id, { inicio: Number(e.target.value) })} /></label>
              <label>Final (segundos, opcional)<input type="number" min={v.inicio + 1} max={v.inicio + 120} value={v.fin ?? ""} placeholder={`Dura ${ajustes.segundosPorVideo} s`} onChange={(e) => editarVideo(v.id, { fin: e.target.value === "" ? null : Number(e.target.value) })} /></label>
            </div>
          </details>;
        })}
        {ajustes.videosReposo.length > 0 && <label className="campo-corto metrica">Los videos sin final duran <input type="number" min="5" max="120" value={ajustes.segundosPorVideo} onChange={(e) => cambiar({ segundosPorVideo: Number(e.target.value) })} /> s. Los que no cargan se saltean.</label>}
      </div>

      <div className="tarjeta">
        <div className="tarjeta-titulo"><h3>Al terminar la compra</h3><Interruptor activo={ajustes.mostrarOpinion !== false} onCambiar={(mostrarOpinion) => cambiar({ mostrarOpinion })} etiqueta="Mostrar el QR para dejar una opinión" /></div>
        <label className="enlace-opinion">Enlace para dejar una opinión<input type="url" value={ajustes.opinionUrl} disabled={ajustes.mostrarOpinion === false} onChange={(e) => cambiar({ opinionUrl: e.target.value.trim() })} /></label>
        <p className="metrica">Aparece con cinco estrellas y un QR durante 45 segundos.</p>
      </div>
    </fieldset>
    {error && <p className="aviso error" role="alert">{error}</p>}
    <BarraCambios pendiente={foto(ajustes, destacados) !== guardado} ocupado={guardando} onClick={guardar} boton="Guardar pantalla"
      texto="Hay cambios sin guardar en la pantalla del cliente" alDia={mensaje} />
  </section>;
}
