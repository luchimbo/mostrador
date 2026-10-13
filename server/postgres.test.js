// Necesita una base PostgreSQL de prueba: TEST_DATABASE_URL=postgres://... npm test
// Sin esa variable se saltea. Usa modos propios para no mezclarse con datos reales.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { abrirPostgres } from "./postgres.js";

const url = process.env.TEST_DATABASE_URL;
const modo = `test-${crypto.randomUUID()}`;

test("PostgreSQL guarda documentos y registros separados por modo", { skip: !url && "sin TEST_DATABASE_URL" }, async () => {
  const db = await abrirPostgres(url, modo);
  try {
    assert.equal(db.documentos.size, 0);
    await db.guardarDocumento("reglas", [{ id: "r1" }]);
    await db.guardarDocumento("reglas", [{ id: "r2" }]);
    await db.guardarDocumento("factura-en-cobranza", null);

    const uid = crypto.randomUUID();
    assert.equal(await db.agregar("ventas", { fecha: "2026-10-02T12:00:00.000Z", idComprobante: 20, total: 200 }, uid), true);
    assert.equal(await db.agregar("ventas", { fecha: "2026-10-02T12:00:00.000Z", idComprobante: 20, total: 200 }, uid), false);
    await db.agregar("ventas", { fecha: "2026-10-01T12:00:00.000Z", idComprobante: 10, total: 100 });
    await db.agregar("cobranzas", { idComprobante: 10, estado: "registrada" });
    await assert.rejects(db.agregar("otra", {}), /Registro desconocido/);

    // Las ventas salen por fecha aunque se hayan cargado en otro orden.
    assert.deepEqual((await db.leer("ventas")).map((v) => v.idComprobante), [10, 20]);
    assert.equal((await db.leer("cobranzas")).length, 1);

    const reabierta = await abrirPostgres(url, modo);
    assert.deepEqual(reabierta.documentos.get("reglas"), [{ id: "r2" }]);
    assert.equal(reabierta.documentos.has("factura-en-cobranza"), true);
    assert.equal(reabierta.documentos.get("factura-en-cobranza"), null);
    await reabierta.cerrar();

    const otroModo = await abrirPostgres(url, `${modo}-b`);
    assert.equal(otroModo.documentos.size, 0);
    assert.deepEqual(await otroModo.leer("ventas"), []);
    await otroModo.cerrar();
  } finally {
    await db.cerrar();
  }
});
