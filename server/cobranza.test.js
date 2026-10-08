import assert from "node:assert/strict";
import { test } from "node:test";
import { armarCobranza, importeContabilium, registrarCobranza } from "./cobranza.js";
import { facturar } from "./invoice.js";
import { DEFAULT_SETTINGS } from "./store.js";

const factura = { idComprobante: 123, cae: "CAE-PRUEBA", total: 1000, metodoPago: "otros", cobranza: { estado: "pendiente", modalidad: "manual" } };
const destinos = [
  { key: "almagro", idCaja: 1326, medios: ["efectivo"] },
  { key: "bbva", idBanco: 2068, medios: ["transferencia"] },
  { key: "mp", idBanco: 2075, medios: ["mercadopago"], formaDePago: "Transferencia" },
];
const pagos = [{ medio: "efectivo", destino: "almagro", importe: 300 }, { medio: "transferencia", destino: "bbva", importe: 400 }, { medio: "mercadopago", destino: "mp", importe: 300 }];

test("Cobranza: distribuye efectivo, transferencia y tarjeta en destinos reales por separado", () => {
  const p = armarCobranza(factura, pagos, destinos);
  assert.equal(p.Id, 123);
  assert.equal(p.Saldo, "0");
  assert.equal(p.ImporteTotalNeto, "1000.00");
  assert.deepEqual(p.Pagos.map(p => [p.FormaDePago, p.IDCaja, p.IDBanco, p.Importe]), [["Efectivo", 1326, null, 300], ["Transferencia", null, 2068, 400], ["Transferencia", null, 2075, 300]]);
});

test("Cobranza: valida sumas, destinos, precisión, modalidad y medios permitidos", () => {
  for (const p of [[{ ...pagos[0], importe: 999 }], [{ ...pagos[0], importe: -1000 }], [{ ...pagos[0], importe: 1000.001 }], [{ ...pagos[0], destino: "inexistente", importe: 1000 }]]) assert.throws(() => armarCobranza(factura, p, destinos));
  assert.throws(() => armarCobranza({ ...factura, metodoPago: "efectivo" }, pagos, destinos), /condición Otros/);
  assert.throws(() => armarCobranza({ ...factura, cobranza: { estado: "registrada", modalidad: "manual" } }, pagos, destinos), /ya fue registrada/);
  assert.throws(() => armarCobranza({ ...factura, cobranza: { estado: "registrada", modalidad: "automatica" } }, pagos, destinos), /no admite/);
  assert.equal(importeContabilium("1.000,00"), 1000);
  assert.equal(importeContabilium("1000.50"), 1000.5);
  assert.throws(() => importeContabilium(null), /no informó/);
});

test("Cobranza: verifica saldo antes de enviar y persiste intento antes de cobrar", async () => {
  const pasos = [];
  const res = await registrarCobranza({ factura, pagos, destinos, antesDeEnviar: () => pasos.push("persistir"), backend: {
    consultarComprobante: async () => { pasos.push("consultar"); return { Cae: factura.cae, ImporteTotalNeto: "1.000,00", Saldo: "1.000,00" }; },
    cobrarComprobante: async () => pasos.push("cobrar"),
  } });
  assert.deepEqual(pasos, ["consultar", "persistir", "cobrar"]);
  assert.equal(res.estado, "registrada");
});

test("Cobranza: no reemplaza recibos existentes ni cobra facturas o totales distintos", async () => {
  for (const cambios of [{ Saldo: "0,00" }, { Saldo: "500,00" }, { Cae: "OTRA" }, { ImporteTotalNeto: "1001,00" }]) {
    await assert.rejects(registrarCobranza({ factura, pagos, destinos, backend: {
      consultarComprobante: async () => ({ Cae: factura.cae, ImporteTotalNeto: "1000,00", Saldo: "1000,00", ...cambios }),
      cobrarComprobante: async () => assert.fail("No debe enviar cobranza"),
    } }));
  }
});

test("Cobranza: un fallo al guardar queda incierto y nunca se reintenta automáticamente", async () => {
  let llamadas = 0;
  await assert.rejects(registrarCobranza({ factura, pagos, destinos, backend: {
    consultarComprobante: async () => ({ Cae: factura.cae, ImporteTotalNeto: 1000, Saldo: 1000 }),
    cobrarComprobante: async () => { llamadas++; throw new Error("Timeout"); },
  } }), e => e.cobranzaIncierta === true);
  assert.equal(llamadas, 1);
});

test("Cobranza: usa el total autorizado cuando el redondeo de la factura difiere", async () => {
  const res = await facturar({ backend: {
    buscarClientePorDocumento: async () => ({ Id: 4, CondicionIva: "CF" }),
    emitirFactura: async () => ({ idComprobante: 123, cae: "PRUEBA", total: "999,99" }),
  }, snapshot: { metodoPago: "efectivo", totales: { totalAPagar: 1000 }, lines: [{ productId: "1", precioFinal: 1000, cantidad: 1, iva: 21 }] }, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } });
  assert.equal(res.total, 999.99);
});
