import assert from "node:assert/strict";
import { test } from "node:test";
import { crearDetectorProductos } from "../shared/voz.js";

const estado = (lines, fase = "venta") => ({ lines, fase });
const linea = (lineId, cantidad = 1) => ({ lineId, cantidad });

test("Voz: anuncia agregados y aumentos, no precios, descuentos ni eliminaciones", () => {
  const detector = crearDetectorProductos();
  assert.equal(detector.recibir(estado([linea(1)])), false);
  assert.equal(detector.recibir(estado([linea(1), linea(2)])), true);
  assert.equal(detector.recibir(estado([linea(1), linea(2, 2)])), true);
  assert.equal(detector.recibir(estado([{ ...linea(1), precioFinal: 50 }, linea(2, 2)])), false);
  assert.equal(detector.recibir(estado([linea(1), linea(2)])), false);
  assert.equal(detector.recibir(estado([linea(1)])), false);
  // Un reemplazo con igual cantidad total también cuenta como producto agregado.
  assert.equal(detector.recibir(estado([linea(3)])), true);
});

test("Voz: no anuncia la entrada ni la reconexión, sí la primera nueva venta", () => {
  const detector = crearDetectorProductos();
  assert.equal(detector.recibir(estado([], "idle")), false);
  assert.equal(detector.recibir(estado([linea(1)])), true);
  detector.reiniciar();
  assert.equal(detector.recibir(estado([linea(1, 5), linea(2)])), false);
  assert.equal(detector.recibir(estado([linea(1, 5), linea(2, 2)])), true);
  assert.equal(detector.recibir(estado([linea(3)], "cobranza")), false);
  assert.equal(detector.recibir(estado([], "idle")), false);
  assert.equal(detector.recibir(estado([linea(4)])), true);
});
