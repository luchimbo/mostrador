import { SelectorProducto } from "./ui.jsx";

export default function EditorRegla({ r, cs, productos, porId, rubros, subrubros, general, cambiar, children }) {
  const d = r.disparador;
  const opciones = d.tipo === "rubro" ? rubros : subrubros;
  return <div className="editor-regla">
    <label className="campo">Nombre de la regla<input value={r.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} /></label>
    <div className="campo">Si lleva
      <div className="fila-botones">
        <select aria-label="Tipo de disparador" value={d.tipo} onChange={(e) => cambiar({ disparador: { tipo: e.target.value, valor: "" } })}>
          <option value="rubro">cualquier producto de la categoría</option>
          <option value="subrubro">cualquier producto de la subcategoría</option>
          <option value="producto">el producto</option>
          <option value="nombre">un producto cuyo nombre contenga</option>
        </select>
        {d.tipo === "nombre" ? <>
          <input placeholder="minifuse, studio m" title="Separá con comas. Si ponés varias palabras juntas, el nombre tiene que tener todas."
            aria-label="Nombre del producto contiene" value={d.valor} onChange={(e) => cambiar({ disparador: { ...d, valor: e.target.value } })} />
          <span>salvo que contenga</span>
          <input aria-label="Nombre del producto excluye" placeholder="funda, soporte" value={d.excluir || ""} onChange={(e) => cambiar({ disparador: { ...d, excluir: e.target.value } })} />
        </> : d.tipo === "producto" ? (d.valor
          ? <span className="chip">{porId.get(String(d.valor))?.nombre || `#${d.valor}`}<button aria-label="Quitar producto disparador" onClick={() => cambiar({ disparador: { tipo: "producto", valor: "" } })}>×</button></span>
          : <SelectorProducto productos={productos} placeholder="Buscar producto disparador…" onElegir={(p) => cambiar({ disparador: { tipo: "producto", valor: String(p.id) } })} />)
          : <select aria-label={d.tipo === "rubro" ? "Categoría" : "Subcategoría"} value={d.valor} onChange={(e) => cambiar({ disparador: { tipo: d.tipo, valor: e.target.value } })}>
            <option value="">Elegir…</option>
            {opciones.map((x) => <option key={x}>{x}</option>)}
            {d.valor && !opciones.includes(d.valor) && <option>{d.valor}</option>}
          </select>}
      </div>
    </div>
    {d.valor && <details className="metrica">
      <summary>{cs.length} productos coinciden con el disparador</summary>
      {cs.length > 0 ? <ul>{cs.map((p) => <li key={p.id}>{p.nombre}</li>)}</ul> : <p>Revisá el disparador: ningún producto del catálogo coincide.</p>}
    </details>}
    <p className="metrica">Cada producto usa el descuento por defecto ({general}%) salvo que elijas uno personalizado. El personalizado se conserva aunque cambies el descuento por defecto. Para volver a usarlo, elegí «Por defecto».</p>
    <div className="sugeridos">
      {r.sugeridos.map((id) => {
        const nombre = porId.get(String(id))?.nombre || `#${id} (no está en el catálogo)`;
        const personalizado = Object.hasOwn(r.descuentosPorProducto, String(id));
        return <span key={id} className="chip">
          <span>{nombre}</span>
          <label>Descuento <select aria-label={`Tipo de descuento de ${nombre}`} value={personalizado ? "propio" : "general"} onChange={(e) => {
            const descuentos = { ...r.descuentosPorProducto };
            if (e.target.value === "general") delete descuentos[String(id)];
            else descuentos[String(id)] = general;
            cambiar({ descuentosPorProducto: descuentos });
          }}><option value="general">Por defecto: {general}%</option><option value="propio">Personalizado</option></select></label>
          {personalizado && <input aria-label={`Descuento de ${nombre}`} type="number" min="0" max="100" step="any" className="pct" value={r.descuentosPorProducto[String(id)]} onChange={(e) => cambiar({ descuentosPorProducto: { ...r.descuentosPorProducto, [String(id)]: Number(e.target.value) } })} />}
          <button aria-label={`Quitar ${nombre} de los sugeridos`} onClick={() => {
            const descuentos = { ...r.descuentosPorProducto };
            delete descuentos[String(id)];
            cambiar({ sugeridos: r.sugeridos.filter((x) => x !== id), descuentosPorProducto: descuentos });
          }}>×</button>
        </span>;
      })}
      <SelectorProducto productos={productos} excluir={r.sugeridos.map(String)} onElegir={(p) => cambiar({ sugeridos: [...r.sugeridos, String(p.id)] })} />
    </div>
    <label className="campo">Frase para el vendedor
      <textarea rows="2" placeholder="¿Tenés la funda para protegerlo y transportarlo?" value={r.mensaje || ""} onChange={(e) => cambiar({ mensaje: e.target.value })} />
    </label>
    {children}
  </div>;
}
