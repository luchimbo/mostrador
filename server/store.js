// Persistencia simple en archivos JSON dentro de data/.
// Para ~200 artículos y un solo mostrador no hace falta una base de datos.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { REVIEW_URL, validarPantalla } from "../shared/display.js";

fs.mkdirSync(config.dataDir, { recursive: true });

function file(name) {
  return path.join(config.dataDir, name);
}

export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  const target = file(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

export function appendLog(name, entry) {
  fs.appendFileSync(file(name), JSON.stringify(entry) + "\n");
}

export function readLog(name) {
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
  segundosPorSlide: 10,
  modoReposo: "ofertas",
  segundosPorVideo: 30,
  productosEntreVideos: 3,
  videosReposo: [],
  excluidosReposo: [],
  opinionUrl: REVIEW_URL,
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson("ajustes.json", {}) };
}

export function saveSettings(partial) {
  const next = { ...getSettings(), ...partial };
  validarPantalla(next);
  writeJson("ajustes.json", next);
  return next;
}
