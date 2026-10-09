import assert from "node:assert/strict";
import { test } from "node:test";
import { obtenerSugerencias, reglaSeDispara } from "./recommendations.js";
import { coincideNombre } from "../shared/reglas.js";
import { DEFAULT_SETTINGS } from "./store.js";

const producto = (id, nombre) => ({ id, nombre, rubro: "General", precioFinal: 1000, costo: 100, stock: 5, activo: true });
const catalogo = [
  producto("1", "MINIFUSE 2 WHITE"),
  producto("2", "PLACA DE SONIDO MIDIPLUS STUDIO M PRO"),
  producto("3", "ALCTRON UM900 USB STUDIO CONDENSER MICROPHONE"),
  producto("4", "GUITARRA ACÚSTICA MIDIPLUS KF110C NEGRA"),
  producto("5", "TECLADO MEIKE MK809"),
  producto("6", "FUNDA MEIKE CHICA PARA TECLADO MK2083 2061 BAG"),
  producto("7", "MICRÓFONO CONDENSADOR ALCTRON MC001"),
];
const porId = new Map(catalogo.map((p) => [p.id, p]));

test("El disparador por nombre usa palabras completas, sin acentos ni mayúsculas", () => {
  const interfaces = { tipo: "nombre", valor: "minifuse, studio m" };
  assert.deepEqual(catalogo.filter((p) => coincideNombre(interfaces, p)).map((p) => p.id), ["1", "2"]);
  assert.equal(coincideNombre({ tipo: "nombre", valor: "guitarra midiplus" }, porId.get("4")), true);
  assert.equal(coincideNombre({ tipo: "nombre", valor: "acustica" }, porId.get("4")), true);
  assert.equal(coincideNombre({ tipo: "nombre", valor: "teclado", excluir: "funda" }, porId.get("6")), false);
});

test("Un producto sugerido por la regla no la dispara", () => {
  const regla = { id: "t", activa: true, disparador: { tipo: "nombre", valor: "teclado" }, sugeridos: ["6"], descuentoPct: 10 };
  assert.equal(reglaSeDispara(regla, [{ lineId: "a", productId: "6" }], porId), null);
  assert.equal(reglaSeDispara(regla, [{ lineId: "a", productId: "5" }], porId)?.id, "5");
});

test("Las sugerencias llevan la frase para el vendedor", () => {
  const regla = { id: "i", activa: true, disparador: { tipo: "nombre", valor: "minifuse" }, sugeridos: ["7"], descuentoPct: 10, mensaje: "¿Vas a grabar voces?" };
  const [s] = obtenerSugerencias([{ lineId: "a", productId: "1" }], porId, [regla], DEFAULT_SETTINGS);
  assert.equal(s.productId, "7");
  assert.equal(s.mensaje, "¿Vas a grabar voces?");
});
