import { useEffect, useMemo, useState } from "react";
import { api } from "./lib.js";
import Catalogo from "./Catalogo.jsx";
import CrossSelling from "./CrossSelling.jsx";
import Facturas, { cobranzaPendiente } from "./Facturas.jsx";
import Informes from "./Informes.jsx";
import PantallaReposo from "./PantallaReposo.jsx";
import ReviewsOnline from "./ReviewsOnline.jsx";

const GRUPOS = [
  [null, [["cross-selling", "Cross-selling"]]],
  ["Mostrador", [["pantalla", "Pantalla del cliente"]]],
  ["Tienda online", [["catalogo", "Catálogo"], ["resenas", "Reseñas"]]],
  ["Ventas", [["informes", "Informes"], ["facturas", "Facturas"]]],
];
const SECCIONES = GRUPOS.flatMap(([, s]) => s.map(([id]) => id));
const desdeHash = () => (SECCIONES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "cross-selling");

export default function Admin() {
  const [seccion, setSeccion] = useState(desdeHash);
  const [productos, setProductos] = useState([]);
  const [avisos, setAvisos] = useState({});
  const cargarCatalogo = () => api("/catalogo").then((c) => setProductos(c.productos));
  useEffect(() => {
    cargarCatalogo();
    const onHash = () => setSeccion(desdeHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Contadores del menú: lo que espera una acción en cada sección.
  useEffect(() => {
    const aviso = (clave, n) => setAvisos((a) => ({ ...a, [clave]: n }));
    api("/tienda/faltantes").then((f) => aviso("catalogo", f.length)).catch(() => {});
    api("/resenas?limit=1").then((r) => aviso("resenas", r.pendientes)).catch(() => {});
    api("/facturas").then((f) => aviso("facturas", f.filter(cobranzaPendiente).length)).catch(() => {});
  }, [seccion]);
  const porId = useMemo(() => new Map(productos.map((p) => [String(p.id), p])), [productos]);
  const ir = (id) => { window.location.hash = id; setSeccion(id); };

  return (
    <div className="admin">
      <aside className="admin-menu">
        <h1>Mostrador · Ajustes</h1>
        <nav>
          {GRUPOS.map(([grupo, items]) => <div key={grupo || "inicio"} className="grupo-menu">
            {grupo && <span className="grupo-nombre">{grupo}</span>}
            {items.map(([id, nombre]) => <button key={id} className={seccion === id ? "activo" : ""} aria-current={seccion === id ? "page" : undefined} onClick={() => ir(id)}>
              {nombre}{avisos[id] > 0 && <span className="contador aviso">{avisos[id]}</span>}
            </button>)}
          </div>)}
        </nav>
        <a className="volver" href="/">← Volver al inicio</a>
      </aside>
      <main className="admin-contenido">
        {seccion === "cross-selling" && <CrossSelling productos={productos} porId={porId} />}
        {seccion === "pantalla" && <PantallaReposo productos={productos} porId={porId} />}
        {seccion === "catalogo" && <Catalogo productos={productos} onActualizado={cargarCatalogo} />}
        {seccion === "resenas" && <ReviewsOnline productos={productos} />}
        {seccion === "informes" && <Informes />}
        {seccion === "facturas" && <Facturas />}
      </main>
    </div>
  );
}
