import assert from "node:assert/strict";
import { test } from "node:test";
import { emitirFactura, emitirFacturaCobrada, configurarCondicionVenta } from "./contabilium.js";

test("Emisión: crea borrador sin pagos, emite su mismo ID y conserva CAE y enlace", async () => {
  const llamadas = [];
  const res = await emitirFactura({ TipoFc: "FCB", Pagos: [{ Importe: 100 }] }, {
    crear: async (payload) => { llamadas.push(["crear", payload]); return 123; },
    emitir: async (id) => { llamadas.push(["emitir", id]); return { ID: 123, CAE: "CAE-PRUEBA", Numero: "0007-123", LinkPublico: "https://example.com/factura", ObservacionesAFIP: "Aviso" }; },
  });
  assert.deepEqual(llamadas, [["crear", { TipoFc: "FCB", Pagos: null }], ["emitir", 123]]);
  assert.equal(res.idComprobante, 123);
  assert.equal(res.cae, "CAE-PRUEBA");
  assert.equal(res.url, "https://example.com/factura");
  assert.equal(res.observaciones, "Aviso");
  assert.deepEqual(res.cobranza, { estado: "pendiente", modalidad: "manual" });
});

test("Emisión: error después de crear preserva ID y no reintenta emisión", async () => {
  let emisiones = 0;
  await assert.rejects(emitirFactura({}, {
    crear: async () => 123,
    emitir: async () => { emisiones++; throw new Error("Timeout"); },
  }), (e) => e.idComprobante === 123 && /Revisalo/.test(e.message));
  assert.equal(emisiones, 1);
});

test("Emisión: respuesta sin CAE conserva borrador y error de ARCA", async () => {
  const res = await emitirFactura({}, { crear: async () => ({ Id: 123 }), emitir: async () => ({ CAE: null, Error: "Rechazado" }) });
  assert.equal(res.idComprobante, 123);
  assert.equal(res.cae, "");
  assert.equal(res.errores, "Rechazado");
  await assert.rejects(emitirFactura({}, { crear: async () => null, emitir: async () => assert.fail("No emitir sin ID") }), /no devolvió el ID/);
});

test("Condición de venta: Efectivo y Otros admiten cobranza manual sin caja", () => {
  for (const [metodo, Nombre] of [["efectivo", "Efectivo"], ["otros", "Otro"]]) {
    assert.equal(configurarCondicionVenta(metodo, [{ Nombre, Activa: "Si", CobranzaAutomatica: "No", IdCaja: null, IdBanco: null }]).condicionVenta, Nombre);
  }
  assert.throws(() => configurarCondicionVenta("efectivo", [{ Nombre: "Efectivo", Activa: true, CobranzaAutomatica: "Si" }]), /manual/);
});

test("MercadoPago: exige cobranza automática configurada en su cuenta", () => {
  const mp = { Nombre: "MercadoPago", Activa: true, CobranzaAutomatica: true, IdBanco: 2075, FormaDePago: "Transferencia" };
  assert.deepEqual(configurarCondicionVenta("mercadopago", [mp]), { condicionVenta: "MercadoPago", automatico: true });
  assert.throws(() => configurarCondicionVenta("mercadopago", [{ ...mp, CobranzaAutomatica: false }]), /automática/);
  assert.throws(() => configurarCondicionVenta("mercadopago", [{ ...mp, IdBanco: null }]), /cuenta y forma/);
});

test("MercadoPago: emite y cobra con Pagos null usando la condición existente", async () => {
  let enviado;
  const res = await emitirFacturaCobrada({ CondicionVenta: "MercadoPago" }, async (ruta, payload) => {
    enviado = { ruta, payload }; return { idComprobante: 123, cae: "PRUEBA", numero: "0007-1", errores: "" };
  });
  assert.equal(enviado.ruta, "/comprobantes/emitirFECobrada");
  assert.deepEqual(enviado.payload, { CondicionVenta: "MercadoPago", Pagos: null });
  assert.equal(res.cae, "PRUEBA");
});
