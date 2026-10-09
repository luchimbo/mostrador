// Datos de la tienda online (Tiendanube): precio, categoría e imagen de cada producto por SKU.
// Recorre el sitemap público y lee los datos estructurados (JSON-LD) de cada página de producto.
// El catálogo del mostrador = productos de Contabilium cuyo código (SKU) está publicado en la tienda.
import { config } from "./config.js";
import { readJson, writeJson } from "./store.js";

const ARCHIVO = "tiendanube.json";
const UA = "Mozilla/5.0 (MostradorPCMIDI)";

let indice = readJson(ARCHIVO, { porSku: {}, porNombre: {}, actualizado: null, paginas: 0 });

export const normalizarNombre = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizarSku = (s) => String(s || "").trim().toUpperCase();

// Tiendanube sirve la misma imagen en varios tamaños: pedimos la de 1024 px.
const imagenGrande = (url) => String(url).replace(/^http:/, "https:").replace(/-\d+-\d+\.(webp|jpe?g|png)$/i, "-1024-1024.$1");

// Los textos del JSON-LD vienen con entidades HTML (&quot;, &amp;...).
const decodificar = (s) =>
  String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

async function texto(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

// Variantes del producto principal (atributo data-variants). Ojo: el precio del JSON-LD es el de LISTA;
// el precio real de venta (con oferta) es price_number, y el de lista compare_at_price_number.
function extraerVariantes(html) {
  const variantes = [];
  for (const [, crudo] of html.matchAll(/data-variants="([^"]+)"/g)) {
    try {
      variantes.push(...JSON.parse(decodificar(crudo)));
    } catch {
      // atributo mal formado: lo salteamos
    }
  }
  return variantes.filter((v) => v.sku && v.price_number > 0);
}

// Devuelve los productos de una página: el principal (con categoría, del breadcrumb) y los relacionados.
export function extraerProductos(html) {
  const productos = [];
  const visitar = (nodo, categorias = null) => {
    if (!nodo || typeof nodo !== "object") return;
    if (Array.isArray(nodo)) return nodo.forEach((n) => visitar(n));
    if (nodo["@type"] === "WebPage" && nodo.mainEntity) {
      // Breadcrumb: Inicio > Categoría > Subcategoría > Producto
      const migas = (nodo.breadcrumb?.itemListElement || []).map((i) => decodificar(i.name));
      return visitar(nodo.mainEntity, migas.slice(1, -1));
    }
    if (nodo["@type"] === "Product" && nodo.sku) {
      const imagen = Array.isArray(nodo.image) ? nodo.image[0] : nodo.image;
      const precio = Number(nodo.offers?.price);
      productos.push({
        sku: normalizarSku(nodo.sku),
        nombre: decodificar(nodo.name),
        imagen: imagen ? imagenGrande(imagen?.url || imagen) : null,
        precio: precio > 0 ? precio : null,
        ...(categorias && { categoria: categorias[0] || null, subcategoria: categorias[1] || null }),
      });
      return;
    }
    Object.values(nodo).forEach((n) => visitar(n));
  };
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      visitar(JSON.parse(json));
    } catch {
      // bloque mal formado: lo salteamos
    }
  }

  // Precio real y de lista de cada variante. Las variantes con SKU propio que no figuran en el JSON-LD
  // (ej. otro color) se agregan como productos con los datos del principal.
  const principal = productos.find((p) => p.categoria !== undefined);
  for (const v of extraerVariantes(html)) {
    const sku = normalizarSku(v.sku);
    const precios = {
      precio: v.price_number,
      precioLista: v.compare_at_price_number > v.price_number ? v.compare_at_price_number : null,
    };
    const existente = productos.find((p) => p.sku === sku);
    if (existente) Object.assign(existente, precios);
    else if (principal) {
      const opciones = [v.option0, v.option1, v.option2].filter(Boolean).join(" ");
      productos.push({
        ...principal,
        sku,
        nombre: opciones ? `${principal.nombre} ${opciones}` : principal.nombre,
        imagen: v.image_url ? imagenGrande(`https:${String(v.image_url).replace(/^https?:/, "")}`) : principal.imagen,
        ...precios,
      });
    }
  }
  return productos;
}

export async function sincronizarTienda() {
  const base = config.tiendanubeUrl.replace(/\/+$/, "");
  const sitemap = await texto(`${base}/sitemap.xml`);
  const urls = [...sitemap.matchAll(/<loc>([^<]+\/productos\/[^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!urls.length) throw new Error("No se encontraron productos en el sitemap de Tiendanube.");

  const porSku = {};
  const porNombre = {};
  const cola = [...urls];
  let fallidas = 0;
  // Pocas conexiones a la vez para no sobrecargar la tienda.
  const trabajador = async () => {
    while (cola.length) {
      const url = cola.shift();
      try {
        for (const p of extraerProductos(await texto(url))) {
          // El producto principal de su propia página tiene prioridad sobre las menciones como relacionado.
          const previo = porSku[p.sku];
          porSku[p.sku] = p.categoria !== undefined || !previo ? { ...previo, ...p } : { ...p, ...previo };
          if (p.imagen) porNombre[normalizarNombre(p.nombre)] ??= p.imagen;
        }
      } catch (err) {
        fallidas++;
        console.error("[tiendanube]", err.message);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, trabajador));
  if (fallidas > urls.length / 2) throw new Error(`No se pudieron leer ${fallidas} de ${urls.length} páginas de la tienda.`);

  indice = { porSku, porNombre, actualizado: new Date().toISOString(), paginas: urls.length };
  writeJson(ARCHIVO, indice);
  console.log(`[tiendanube] ${urls.length} páginas · ${Object.keys(porSku).length} SKUs`);
  return estadoTienda();
}

// Precios del listado de productos (/productos/?page=N). Las páginas de producto quedan hasta 24 h
// en el caché de Cloudflare, pero el listado con un parámetro desconocido se genera en el momento.
// Cada tarjeta trae su SKU (JSON-LD), el precio de venta en centavos y el precio tachado si hay oferta.
export function extraerPreciosListado(html) {
  const precios = [];
  for (const tarjeta of html.split(/(?=<div class="js-item-product)/).slice(1)) {
    const sku = tarjeta.match(/"sku":\s*"([^"]+)"/)?.[1];
    const centavos = Number(tarjeta.match(/data-product-price="(\d+)"/)?.[1]);
    if (!sku || !(centavos > 0)) continue;
    const tachado = tarjeta.match(/js-compare-price-display[^"]*"(?![^>]*display:\s*none)[^>]*>\s*\$?\s*([\d.,]+)/)?.[1];
    const lista = tachado ? Number(tachado.replace(/\./g, "").replace(",", ".")) : 0;
    const precio = centavos / 100;
    precios.push({ sku: normalizarSku(decodificar(sku)), precio, precioLista: lista > precio ? lista : null });
  }
  return precios;
}

export async function actualizarPreciosTienda() {
  const base = config.tiendanubeUrl.replace(/\/+$/, "");
  const marca = Date.now();
  const nuevos = {};
  for (let pagina = 1; pagina <= 100; pagina++) {
    const precios = extraerPreciosListado(await texto(`${base}/productos/?page=${pagina}&mostrador=${marca}`));
    if (!precios.length) break;
    for (const p of precios) nuevos[p.sku] ??= p;
  }
  if (!Object.keys(nuevos).length) throw new Error("No se pudieron leer los precios del listado de la tienda.");
  let cambiados = 0;
  for (const p of Object.values(nuevos)) {
    const actual = indice.porSku[p.sku];
    if (!actual) continue; // producto nuevo: aparece en la próxima lectura completa
    if (actual.precio !== p.precio || (actual.precioLista ?? null) !== p.precioLista) cambiados++;
    Object.assign(actual, { precio: p.precio, precioLista: p.precioLista });
  }
  indice = { ...indice, preciosActualizados: new Date().toISOString() };
  writeJson(ARCHIVO, indice);
  console.log(`[tiendanube] precios del listado: ${Object.keys(nuevos).length} productos, ${cambiados} cambiaron`);
  return { leidos: Object.keys(nuevos).length, cambiados };
}

export function estadoTienda() {
  return { actualizado: indice.preciosActualizados || indice.actualizado, completo: indice.actualizado, skus: Object.keys(indice.porSku).length };
}

// Combina el catálogo de Contabilium con la tienda:
// - solo quedan los productos publicados en la tienda (por SKU)
// - precio y categoría salen de la tienda; Id, IVA y costo de Contabilium
// Si todavía no se pudo leer la tienda, se usa el catálogo de Contabilium tal cual.
export function combinarConTienda(productos) {
  const tienda = indice.porSku;
  if (!Object.keys(tienda).length) {
    return productos.map((p) => ({ ...p, imagen: p.imagen || indice.porNombre[normalizarNombre(p.nombre)] || null }));
  }
  const vistos = new Set();
  const resultado = [];
  for (const p of productos) {
    const sku = normalizarSku(p.codigo);
    const t = tienda[sku];
    if (!t || vistos.has(sku)) continue;
    vistos.add(sku);
    resultado.push({
      ...p,
      nombre: t.nombre || p.nombre, // el de la tienda es más prolijo para mostrar al cliente
      nombreFactura: p.nombre, // en la factura va el nombre de Contabilium
      precioFinal: t.precio ?? p.precioFinal,
      precioLista: t.precioLista ?? null, // si está en oferta en la tienda: precio antes de la oferta
      precioContabilium: p.precioFinal,
      rubro: t.categoria || p.rubro,
      subrubro: t.categoria && t.subcategoria ? `${t.categoria} › ${t.subcategoria}` : null,
      imagen: p.imagen || t.imagen || null,
    });
  }
  return resultado;
}

// Productos publicados en la tienda que no tienen un código igual en Contabilium.
export function tiendaSinContabilium(productos) {
  const codigos = new Set(productos.map((p) => normalizarSku(p.codigo)));
  return Object.values(indice.porSku)
    .filter((t) => !codigos.has(t.sku))
    .map((t) => ({ sku: t.sku, nombre: t.nombre }));
}
