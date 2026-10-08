import { useEffect, useState } from "react";
import { api } from "./lib.js";
import { esOferta, productosEnReposo, validarPantalla, youtubeId } from "../shared/display.js";

export default function PantallaReposo({ productos, porId, SelectorProducto, children }) {
  const [ajustes, setAjustes] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { api("/ajustes").then(setAjustes).catch((e) => setError(e.message)); }, []);
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
      const campos = ["modoReposo", "segundosPorSlide", "segundosPorVideo", "productosEntreVideos", "videosReposo", "excluidosReposo", "opinionUrl"];
      const res = await api("/ajustes", { method: "PUT", body: Object.fromEntries(campos.map((c) => [c, ajustes[c]])) });
      setAjustes(res); setMensaje("Guardado. La pantalla del cliente ya está actualizada.");
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }
  if (!ajustes) return <p role="status">{error || "Cargando…"}</p>;
  const ofertas = productos.filter((p) => esOferta(p) && p.imagen && p.stock !== 0 && p.activo !== false && !ajustes.excluidosReposo.includes(String(p.id)));
  const automaticos = productosEnReposo(productos, [], ajustes).length;
  return <section className="pantalla-ajustes">
    <p className="ayuda">Cuando no hay una venta, la pantalla alterna productos y videos sin sonido. Al comenzar una compra, pasa inmediatamente al ticket.</p>
    <fieldset disabled={guardando}>
      <div className="panel-reposo">
        <h2>La vidriera</h2>
        <div className="campos-reposo">
          <label>Productos para mostrar<select value={ajustes.modoReposo} onChange={(e) => cambiar({ modoReposo: e.target.value })}>
            <option value="ofertas">Ofertas automáticas</option><option value="manual">Selección manual</option><option value="mixto">Ofertas y selección manual</option>
          </select></label>
          <label>Segundos por producto<input type="number" min="3" max="120" value={ajustes.segundosPorSlide} onChange={(e) => cambiar({ segundosPorSlide: Number(e.target.value) })} /></label>
          <label>Productos entre videos<input type="number" min="1" max="20" step="1" value={ajustes.productosEntreVideos} onChange={(e) => cambiar({ productosEntreVideos: Number(e.target.value) })} /></label>
          <label>Segundos por video<input type="number" min="5" max="120" value={ajustes.segundosPorVideo} onChange={(e) => cambiar({ segundosPorVideo: Number(e.target.value) })} /></label>
        </div>
        <p className="ayuda">{ofertas.length} ofertas con foto y stock disponibles. Si no hay ofertas, se muestran los destacados. Si tampoco hay productos disponibles, aparece el logo.</p>
        {!automaticos && <p className="ayuda">Revisá que los productos tengan foto y stock para aparecer en la pantalla.</p>}
        <h3>Productos excluidos</h3>
        <div className="sugeridos">{ajustes.excluidosReposo.map((id) => <span className="chip" key={id}>{porId.get(id)?.nombre || `#${id}`}<button aria-label={`Volver a mostrar ${porId.get(id)?.nombre || id}`} onClick={() => cambiar({ excluidosReposo: ajustes.excluidosReposo.filter((x) => x !== id) })}>×</button></span>)}
          <SelectorProducto productos={productos} excluir={ajustes.excluidosReposo} onElegir={(p) => cambiar({ excluidosReposo: [...ajustes.excluidosReposo, String(p.id)] })} />
        </div>
      </div>
      <div className="panel-reposo">
        <h2>Videos de YouTube <span className="badge gris">Sin sonido</span></h2>
        <p className="ayuda">Pegá un enlace y elegí el inicio del fragmento. El final es opcional; si lo dejás vacío, usamos la duración configurada arriba. Los videos que no cargan se saltean.</p>
        {ajustes.videosReposo.length === 0 && <p className="vacio">Todavía no hay videos. La pantalla mostrará los productos.</p>}
        {ajustes.videosReposo.map((v, index) => <div className={`video-editor ${v.activo ? "" : "inactivo"}`} key={v.id}>
          <div className="video-editor-cabecera"><strong>Video {index + 1}</strong><label className="check"><input type="checkbox" checked={v.activo} onChange={(e) => editarVideo(v.id, { activo: e.target.checked })} />Activo</label>
            <button aria-label={`Subir video ${index + 1}`} disabled={index === 0} onClick={() => mover(index, -1)}>↑</button><button aria-label={`Bajar video ${index + 1}`} disabled={index === ajustes.videosReposo.length - 1} onClick={() => mover(index, 1)}>↓</button>
            <button className="peligro" onClick={() => cambiar({ videosReposo: ajustes.videosReposo.filter((x) => x.id !== v.id) })}>Quitar</button>
          </div>
          <div className="campos-reposo">
            <label className="campo-ancho">Enlace de YouTube<input type="url" placeholder="https://www.youtube.com/watch?v=…" value={v.url} onChange={(e) => editarVideo(v.id, { url: e.target.value.trim() })} /></label>
            <label>Título<input maxLength="150" value={v.titulo} onChange={(e) => editarVideo(v.id, { titulo: e.target.value })} /></label>
            <label>Producto asociado<select value={v.productId || ""} onChange={(e) => editarVideo(v.id, { productId: e.target.value || null })}><option value="">Sin producto asociado</option>{productos.map((p) => <option value={String(p.id)} key={p.id}>{p.nombre}</option>)}</select></label>
            <label>Inicio (segundos)<input type="number" min="0" max="86400" value={v.inicio} onChange={(e) => editarVideo(v.id, { inicio: Number(e.target.value) })} /></label>
            <label>Final (segundos, opcional)<input type="number" min={v.inicio + 1} max={v.inicio + 120} value={v.fin ?? ""} placeholder="Duración automática" onChange={(e) => editarVideo(v.id, { fin: e.target.value === "" ? null : Number(e.target.value) })} /></label>
          </div>
          {v.url && !youtubeId(v.url) && <p className="aviso error">Revisá el enlace: debe ser un video de YouTube.</p>}
        </div>)}
        <button disabled={ajustes.videosReposo.length >= 30} onClick={() => cambiar({ videosReposo: [...ajustes.videosReposo, { id: crypto.randomUUID(), url: "", titulo: "", inicio: 0, fin: null, productId: null, activo: true }] })}>+ Agregar video</button>
      </div>
      <div className="panel-reposo">
        <h2>Opiniones al finalizar la compra</h2>
        <label className="enlace-opinion">Enlace para dejar una opinión<input type="url" value={ajustes.opinionUrl} onChange={(e) => cambiar({ opinionUrl: e.target.value.trim() })} /></label>
        <p className="ayuda">Al finalizar la compra aparece con cinco estrellas y un QR durante 45 segundos. Dejá el enlace vacío para ocultarlo.</p>
      </div>
      <button className="primario guardar-pantalla" onClick={guardar}>{guardando ? "Guardando…" : "Guardar pantalla"}</button>
    </fieldset>
    {error && <p className="aviso error" role="alert">{error}</p>}
    {mensaje && <p className="guardado" role="status">{mensaje}</p>}
    <div className="panel-reposo"><h2>Selección manual y respaldo</h2><p className="ayuda">Esta selección se guarda al agregar o quitar un producto. También se usa cuando no hay ofertas.</p>{children}</div>
  </section>;
}
