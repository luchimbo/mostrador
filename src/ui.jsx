import { useState } from "react";
import { buscar, pesos } from "./lib.js";

// Piezas compartidas por las secciones de Ajustes.

export function Cabecera({ titulo, descripcion, children }) {
  return <div className="cabecera-seccion">
    <div><h2>{titulo}</h2>{descripcion && <p>{descripcion}</p>}</div>
    {children && <div className="cabecera-acciones">{children}</div>}
  </div>;
}

export function Interruptor({ activo, onCambiar, etiqueta, disabled }) {
  return <button type="button" role="switch" aria-checked={Boolean(activo)} aria-label={etiqueta} title={etiqueta}
    className={`interruptor ${activo ? "on" : ""}`} disabled={disabled} onClick={(e) => { e.preventDefault(); onCambiar(!activo); }} />;
}

// Selector de pocas opciones excluyentes: [[valor, etiqueta], …].
export function Segmentos({ opciones, valor, onCambiar, etiqueta }) {
  return <div className="segmentos" role="group" aria-label={etiqueta}>
    {opciones.map(([v, nombre]) => <button type="button" key={v} aria-pressed={v === valor} className={v === valor ? "activo" : ""} onClick={() => onCambiar(v)}>{nombre}</button>)}
  </div>;
}

export function Kpis({ items }) {
  return <div className="kpis">
    {items.map((k) => <div key={k.etiqueta} className={k.aviso ? "aviso-kpi" : ""} onClick={k.onClick} role={k.onClick ? "button" : undefined}>
      <span>{k.etiqueta}</span><b>{k.valor}</b>{k.detalle && <small>{k.detalle}</small>}
    </div>)}
  </div>;
}

// Barra al pie de la sección: avisa si hay cambios sin guardar o sin publicar.
export function BarraCambios({ pendiente, texto, alDia, boton, onClick, ocupado }) {
  if (!pendiente && !alDia) return null;
  return <div className={`barra-cambios ${pendiente ? "" : "al-dia"}`} role="status">
    <span>{pendiente ? texto : alDia}</span>
    {pendiente && <button className="primario" disabled={ocupado} onClick={onClick}>{ocupado ? "Guardando…" : boton}</button>}
  </div>;
}

export function Pildora({ tipo = "gris", children }) {
  return <span className={`pildora ${tipo}`}>{children}</span>;
}

export function SelectorProducto({ productos, onElegir, excluir = [], placeholder = "Buscar producto para agregar…" }) {
  const [texto, setTexto] = useState("");
  const resultados = texto
    ? buscar(productos, texto)
        .filter((p) => !excluir.includes(String(p.id)))
        .slice(0, 8)
    : [];
  return (
    <div className="selector">
      <input placeholder={placeholder} value={texto} onChange={(e) => setTexto(e.target.value)} />
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

export const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : null);
