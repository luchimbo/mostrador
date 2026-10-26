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
export function readJson(name, fallback) {
  if (db) return db.documentos.has(clave(name)) ? structuredClone(db.documentos.get(clave(name))) : fallback;
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(name, value) {
  if (db) {
    db.documentos.set(clave(name), structuredClone(value));
    await db.guardarDocumento(clave(name), value);
    return;
  }
  const target = file(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

// Para copias que se pueden volver a descargar (catálogo, tienda): si no se guardan, se avisa y se sigue.
export function guardarCopia(name, value) {
  return writeJson(name, value).catch((err) => console.error(`[datos] no se pudo guardar ${name}:`, err.message));
}

export async function appendLog(name, entry) {
  if (db) await db.agregar(clave(name), entry);
  else fs.appendFileSync(file(name), JSON.stringify(entry) + "\n");
}

export async function readLog(name) {
  if (db) return db.leer(clave(name));
  try {
    return fs
      .readFileSync(file(name), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export const DEFAULT_SETTINGS = {
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
  if (typeof next.crossSellingMostrador !== "boolean" || typeof next.mostrarOpinion !== "boolean") throw new Error("Los interruptores de ajustes no son válidos.");
  validarPantalla(next);
  await writeJson("ajustes.json", next);
  return next;
}
