// Mismo destino que el QR provisto, sin parámetros de campaña para facilitar su lectura.
export const REVIEW_URL = "https://g.page/r/CS4Uwp4lHZTOEAE/review";

export function youtubeId(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === "youtu.be") id = url.pathname.split("/")[1];
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)) {
      id = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}

export function esOferta(p) {
  return Number(p.precioLista) > Number(p.precioFinal) && Number(p.precioFinal) > 0;
}

export function productosEnReposo(productos, destacados, settings) {
  const excluidos = new Set((settings.excluidosReposo || []).map(String));
  const disponibles = productos.filter((p) => !p.productoPrueba && p.activo !== false && p.stock !== 0 && p.imagen && p.precioFinal > 0 && !excluidos.has(String(p.id)));
  const porId = new Map(disponibles.map((p) => [String(p.id), p]));
  let manuales = destacados.map((id) => porId.get(String(id))).filter(Boolean);
  if (!manuales.length) {
    const categorias = new Map();
    for (const p of disponibles) {
      if (!categorias.has(p.rubro) || p.precioFinal > categorias.get(p.rubro).precioFinal) categorias.set(p.rubro, p);
    }
    manuales = [...categorias.values()];
  }
  const ofertas = disponibles.filter(esOferta);
  const modo = settings.modoReposo || "ofertas";
  const elegidos = modo === "manual" ? manuales : modo === "mixto" ? [...ofertas, ...manuales] : ofertas.length ? ofertas : manuales;
  return [...new Map(elegidos.map((p) => [String(p.id), p])).values()];
}

// Incluye todos los productos y videos, aun cuando haya más videos que grupos de productos.
export function secuenciaReposo(productos, videos, cada = 3) {
  const activos = videos.filter((v) => v.activo !== false && youtubeId(v.url));
  const base = productos.length ? productos.map((producto) => ({ tipo: "producto", id: `p-${producto.id}`, producto })) : [{ tipo: "marca", id: "marca" }];
  if (!activos.length) return base;
  const frecuencia = Math.max(1, Math.floor(Number(cada) || 3));
  const grupos = Math.max(Math.ceil(base.length / frecuencia), activos.length);
  const slides = [];
  for (let g = 0; g < grupos; g++) {
    for (let j = 0; j < frecuencia; j++) slides.push(base[(g * frecuencia + j) % base.length]);
    const video = activos[g % activos.length];
    slides.push({ tipo: "video", id: `v-${video.id}`, video });
  }
  return slides;
}

export function validarPantalla(settings) {
  const limites = { segundosPorSlide: [3, 120], segundosPorVideo: [5, 120], productosEntreVideos: [1, 20] };
  for (const [campo, [min, max]] of Object.entries(limites)) {
    if (!Number.isFinite(settings[campo]) || settings[campo] < min || settings[campo] > max) throw new Error(`${campo}: elegí un valor entre ${min} y ${max}.`);
  }
  if (!Number.isInteger(settings.productosEntreVideos)) throw new Error("La cantidad de productos entre videos debe ser un número entero.");
  if (!["ofertas", "manual", "mixto"].includes(settings.modoReposo)) throw new Error("Elegí un modo de pantalla válido.");
  if (!Array.isArray(settings.excluidosReposo) || settings.excluidosReposo.some((id) => typeof id !== "string")) throw new Error("La lista de exclusiones no es válida.");
  if (!Array.isArray(settings.videosReposo) || settings.videosReposo.length > 30) throw new Error("Podés cargar hasta 30 videos.");
  const ids = new Set();
  for (const v of settings.videosReposo) {
    if (!v || typeof v.id !== "string" || !v.id || ids.has(v.id) || !youtubeId(v.url)) throw new Error("Revisá el enlace de cada video de YouTube.");
    ids.add(v.id);
    if (!Number.isFinite(v.inicio) || v.inicio < 0 || v.inicio > 86400) throw new Error("El inicio del video debe estar entre 0 y 86400 segundos.");
    if (v.fin != null && (!Number.isFinite(v.fin) || v.fin <= v.inicio || v.fin - v.inicio > 120)) throw new Error("El final debe ser posterior al inicio y el fragmento no puede superar 120 segundos.");
    if (typeof v.titulo !== "string" || v.titulo.length > 150 || typeof v.activo !== "boolean" || (v.productId != null && typeof v.productId !== "string")) throw new Error("Los datos del video no son válidos.");
  }
  if (settings.opinionUrl !== "") {
    let url;
    try { url = new URL(settings.opinionUrl); } catch { throw new Error("Ingresá un enlace válido para dejar una opinión."); }
    if (url.protocol !== "https:" || settings.opinionUrl.length > 2000) throw new Error("El enlace para opiniones debe empezar con https://.");
  }
  return settings;
}
