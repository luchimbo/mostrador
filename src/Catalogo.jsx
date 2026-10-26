import { useEffect, useState } from "react";
import { api, buscar, pesos } from "./lib.js";
import { Cabecera, Segmentos, fechaHora } from "./ui.jsx";

const VISIBLES = 50;

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
  const [solapa, setSolapa] = useState("faltan");
  const [busqueda, setBusqueda] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => {
    api("/tienda/estado").then(setEstado).catch(() => {});
    api("/tienda/faltantes").then(setFaltantes).catch(() => {});
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

  const sinStock = productos.filter((p) => p.stock === 0);
  const sinFoto = productos.filter((p) => !p.imagen);
  const aLaVenta = productos.length - sinStock.length;
  const total = productos.length + faltantes.length;
  const listas = {
    faltan: { nombre: "Falta en Contabilium", filas: faltantes.map((f) => ({ id: f.sku, codigo: f.sku, nombre: f.nombre })), aviso: true,
      ayuda: "Están publicados en la tienda pero ningún producto de Contabilium tiene ese código. Para venderlos en el mostrador, revisá el código en Contabilium." },
    stock: { nombre: "Sin stock", filas: sinStock, aviso: true,
      ayuda: "Se ven en el mostrador pero no aparecen en la pantalla del cliente ni en las sugerencias." },
    foto: { nombre: "Sin foto", filas: sinFoto, aviso: true,
      ayuda: "Se pueden vender, pero no aparecen en la pantalla del cliente. Cargá la foto en la tienda online." },
    todos: { nombre: "Todos", filas: productos, ayuda: "Los productos que hoy aparecen en el mostrador, con su categoría, precio y foto." },
  };
  const lista = listas[solapa];
  const filas = buscar(lista.filas.map((f) => ({ rubro: "", ...f })), busqueda);
  const mostradas = verTodos ? filas : filas.slice(0, VISIBLES);
  const cambiarSolapa = (s) => { setSolapa(s); setVerTodos(false); };

  return <section>
    <Cabecera titulo="Catálogo" descripcion="Productos de la tienda online (Tiendanube) emparejados por SKU con Contabilium.">
      <button disabled={cargando} onClick={actualizar}>{cargando ? "Leyendo la tienda… (tarda unos minutos)" : "Leer la tienda completa"}</button>
    </Cabecera>
    {estado?.error && <p className="aviso error" role="alert">{estado.error}</p>}

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
            {p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <div className="sin-imagen">Sin foto</div>}
            <figcaption>{p.nombre}<small>{p.rubro} · {pesos(p.precioFinal)}</small></figcaption>
          </figure>)}
        </div>
        : <ul className="lista-productos">{mostradas.map((p) => <li key={p.id}><code>{p.codigo || "sin código"}</code><span>{p.nombre}</span>{p.precioFinal != null && <small>{pesos(p.precioFinal)}</small>}</li>)}</ul>}
      {filas.length > VISIBLES && <button className="enlace" onClick={() => setVerTodos(!verTodos)}>{verTodos ? "Ver menos" : `Mostrando ${VISIBLES} de ${filas.length} · Ver todos`}</button>}
    </div>
  </section>;
}
