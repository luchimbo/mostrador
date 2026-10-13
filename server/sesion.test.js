import test from "node:test";
import assert from "node:assert/strict";
import { claveCorrecta, crearLimite, crearSesion, DURACION_MS, leerCookie, sesionValida } from "./sesion.js";

test("Acceso: solo entra la contraseña exacta", () => {
  assert.equal(claveCorrecta("secreta", "secreta"), true);
  assert.equal(claveCorrecta("secreta", "Secreta"), false);
  assert.equal(claveCorrecta("secreta", ""), false);
  assert.equal(claveCorrecta("secreta", undefined), false);
  assert.equal(claveCorrecta("secreta", ["secreta"]), false);
});

test("Acceso: la sesión vale hasta que vence o cambia la contraseña", () => {
  const ahora = Date.parse("2026-10-13T12:00:00Z");
  const sesion = crearSesion("secreta", ahora);
  assert.equal(sesionValida("secreta", sesion, ahora + 1000), true);
  assert.equal(sesionValida("secreta", sesion, ahora + DURACION_MS + 1), false);
  assert.equal(sesionValida("otra", sesion, ahora + 1000), false);
});

test("Acceso: una sesión alterada o vacía no vale", () => {
  const ahora = Date.parse("2026-10-13T12:00:00Z");
  const [vence, firma] = crearSesion("secreta", ahora).split(".");
  assert.equal(sesionValida("secreta", `${Number(vence) + DURACION_MS}.${firma}`, ahora), false);
  assert.equal(sesionValida("secreta", `${vence}.`, ahora), false);
  assert.equal(sesionValida("secreta", vence, ahora), false);
  assert.equal(sesionValida("secreta", "", ahora), false);
  assert.equal(sesionValida("secreta", undefined, ahora), false);
});

test("Acceso: lee la cookie de sesión entre otras", () => {
  assert.equal(leerCookie("a=1; mostrador_sesion=123.abc; b=2"), "123.abc");
  assert.equal(leerCookie("a=1"), "");
  assert.equal(leerCookie(undefined), "");
});

test("Acceso: tras varios intentos fallidos hay que esperar", () => {
  const limite = crearLimite({ maximo: 3, esperaMs: 1000 });
  for (let i = 0; i < 3; i++) limite.fallo("1.1.1.1", 0);
  assert.equal(limite.bloqueado("1.1.1.1", 500), true);
  assert.equal(limite.bloqueado("2.2.2.2", 500), false);
  assert.equal(limite.bloqueado("1.1.1.1", 1500), false);
  limite.fallo("1.1.1.1", 2000);
  limite.acierto("1.1.1.1");
  assert.equal(limite.bloqueado("1.1.1.1", 2000), false);
});
