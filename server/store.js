// Persistencia de los datos del mostrador.
// Con DATABASE_URL se guarda en PostgreSQL (así corre en Railway); sin ella, en archivos JSON dentro de data/.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { abrirPostgres } from "./postgres.js";
import { REVIEW_URL, validarPantalla } from "../shared/display.js";

// En Railway el disco se borra en cada despliegue: sin base de datos se perderían las ventas.
if (!config.databaseUrl && process.env.RAILWAY_ENVIRONMENT) throw new Error("Falta DATABASE_URL: en Railway los datos se guardan en PostgreSQL.");

const db = config.databaseUrl ? await abrirPostgres(config.databaseUrl, config.mode) : null;
if (!db) fs.mkdirSync(config.dataDir, { recursive: true });

export const almacenamiento = db ? "PostgreSQL" : "archivos";

function file(name) {
  return path.join(config.dataDir, name);
}

// En la base, "ventas.jsonl" es el registro "ventas" y "ajustes.json" el documento "ajustes".
const clave = (name) => name.replace(/\.jsonl?$/, "");

// Con PostgreSQL los documentos se leen al arrancar y quedan en memoria: un cambio hecho a mano
// en la base se ve recién al reiniciar el servidor.
export function readJson(name, fallback, { estricto = false } = {}) {
  if (db) return db.documentos.has(clave(name)) ? structuredClone(db.documentos.get(clave(name))) : fallback;
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch (error) {
    if (estricto && error.code !== "ENOENT") throw error;
    return fallback;
  }
}

export async function writeJson(name, value) {
  if (db) {
    await db.guardarDocumento(clave(name), value);
    db.documentos.set(clave(name), structuredClone(value));
    return;
  }
  escribirAtomico(file(name), JSON.stringify(value, null, 2));
}

function escribirAtomico(target, contenido) {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, contenido);
  fs.renameSync(tmp, target);
}

// Para copias que se pueden volver a descargar (catálogo, tienda): si no se guardan, se avisa y se sigue.
export function guardarCopia(name, value) {
  return writeJson(name, value).catch((err) => console.error(`[datos] no se pudo guardar ${name}:`, err.message));
}

export async function appendLog(name, entry, uid) {
  if (db) return db.agregar(clave(name), entry, uid);
  const linea = JSON.stringify(entry) + "\n";
  const target = file(name);
  if (!uid) return fs.appendFileSync(target, linea);

  // Los registros recuperables quedan completos o conservan el archivo anterior.
  let anterior = "";
  try {
    anterior = fs.readFileSync(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const separador = anterior && !anterior.endsWith("\n") ? "\n" : "";
  escribirAtomico(target, anterior + separador + linea);
}

export async function readLog(name, { estricto = false } = {}) {
  if (db) return db.leer(clave(name));
  try {
    return fs
      .readFileSync(file(name), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (estricto && error.code !== "ENOENT") throw error;
    return [];
  }
}

export const DEFAULT_SETTINGS = {
  descuentoGeneralPct: 10,
  descuentoContadoPct: 5, // efectivo o transferencia
  descuentoMaximoPct: 25, // tope para cualquier descuento de recomendación
  margenMinimoPct: 10, // el precio con descuento nunca baja de costo + este %
  maxSugerencias: 3,
  crossSellingMostrador: true, // apagado, la venta del mostrador no ofrece sugerencias
  segundosPorSlide: 10,
  modoReposo: "ofertas",
  segundosPorVideo: 30,
  productosEntreVideos: 3,
  videosReposo: [],
  excluidosReposo: [],
  opinionUrl: REVIEW_URL,
  mostrarOpinion: true, // apagado, no aparece el QR de opinión aunque haya enlace
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson("ajustes.json", {}) };
}

export async function saveSettings(partial) {
  const next = { ...getSettings(), ...partial };
  if (!Number.isFinite(next.descuentoGeneralPct) || next.descuentoGeneralPct < 0 || next.descuentoGeneralPct > 100) throw new Error("El descuento general debe estar entre 0 y 100.");
  if (typeof next.crossSellingMostrador !== "boolean" || typeof next.mostrarOpinion !== "boolean") throw new Error("Los interruptores de ajustes no son válidos.");
  validarPantalla(next);
  await writeJson("ajustes.json", next);
  return next;
}
