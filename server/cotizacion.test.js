import assert from "node:assert/strict";
import { test } from "node:test";
import { comprobanteEmitido, registrarCobranza } from "./cobranza.js";
import { emitirCotizacion } from "./contabilium.js";
import { facturar } from "./invoice.js";
import { calcularTotales } from "./pricing.js";
import { Sale } from "./sale.js";
import { DEFAULT_SETTINGS } from "./store.js";

const lines = [{ productId: "1", nombre: "Producto", precioFinal: 12100, iva: 21, cantidad: 1, descuentoPct: 0 }];
const snapshot = { lines, metodoPago: "efectivo", sinFactura: true, totales: calcularTotales(lines, "efectivo", DEFAULT_SETTINGS) };
const backendBase = {
  obtenerConfiguracionFacturacion: async () => ({ condicionVenta: "Efectivo", automatico: false, inventario: 1662, idMoneda: 1659 }),
  buscarClientePorDocumento: async () => ({ Id: 4, RazonSocial: "Cliente", CondicionIva: "RI" }),
  emitirFactura: async () => assert.fail("Sin factura no debe ir a ARCA"),
  emitirFacturaCobrada: async () => assert.fail("Sin factura no debe ir a ARCA"),
};

test("Sin factura: registra una cotización con condición Efectivo y cobranza manual", async () => {
  let enviado;
  const res = await facturar({ backend: { ...backendBase, emitirCotizacion: async (p) => { enviado = p; return { idComprobante: 55, numero: "0001-00000012" }; } },
    snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "20123456786", condicionIva: "RI" } });
  assert.equal(enviado.TipoFc, "COT");
  assert.equal(enviado.CondicionVenta, "Efectivo");
  assert.equal(enviado.Items[0].Bonificacion, DEFAULT_SETTINGS.descuentoContadoPct);
  assert.equal(res.tipo, "Cotización");
  assert.equal(res.cae, null);
  assert.equal(res.total, 11495);
  assert.deepEqual(res.cobranza, { estado: "pendiente", modalidad: "manual" });
  assert.ok(comprobanteEmitido(res));
});

test("Sin factura: el documento es opcional y usa el Consumidor Final genérico", async () => {
  let enviado;
  const res = await facturar({ backend: { ...backendBase, buscarClientePorDocumento: async () => assert.fail("No debe buscar cliente"), emitirCotizacion: async (p) => { enviado = p; return { idComprobante: 56 }; } },
    snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "" } });
  assert.equal(enviado.TipoFc, "COT");
  assert.equal(res.cliente.nombre, "Consumidor Final");
  assert.equal(res.numero, "ID 56");
});

test("Sin factura: solo con Efectivo", async () => {
  await assert.rejects(facturar({ backend: backendBase, snapshot: { ...snapshot, metodoPago: "otros" }, settings: DEFAULT_SETTINGS, datosCliente: {} }), /solo para Efectivo/);
  const sale = new Sale();
  assert.throws(() => sale.setSinFactura(true), /solo para Efectivo/);
  sale.setMetodoPago("efectivo");
  sale.setSinFactura(true);
  assert.equal(sale.sinFactura, true);
  sale.setMetodoPago("mercadopago");
  assert.equal(sale.sinFactura, false);
});

test("Sin factura: crea la cotización sin emitir ni reintentar, y lee el número", async () => {
  const llamadas = [];
  const res = await emitirCotizacion({ TipoFc: "COT", Pagos: [{ Importe: 1 }] }, {
    crear: async (p) => { llamadas.push(["crear", p]); return { Id: 77 }; },
    consultar: async (id) => { llamadas.push(["consultar", id]); return { Numero: "0001-00000003", ImporteTotalNeto: "1.000,00" }; },
  });
  assert.deepEqual(llamadas, [["crear", { TipoFc: "COT", Pagos: null }], ["consultar", 77]]);
  assert.deepEqual(res, { idComprobante: 77, numero: "0001-00000003", url: "", total: "1.000,00" });
  await assert.rejects(emitirCotizacion({}, { crear: async () => ({}), consultar: async () => null }), /ID de la cotización/);
});

test("Sin factura: la cobranza es la misma y verifica que el comprobante sea la cotización", async () => {
  const cotizacion = { idComprobante: 55, cae: null, cotizacion: true, tipoFc: "COT", total: 1000, metodoPago: "efectivo", cliente: {}, cobranza: { estado: "pendiente", modalidad: "manual" } };
  const destinos = [{ key: "almagro", idCaja: 1326, medios: ["efectivo"] }];
  const pagos = [{ medio: "efectivo", destino: "almagro", importe: 1000 }];
  let cobrado;
  const res = await registrarCobranza({ factura: cotizacion, pagos, destinos, backend: {
    consultarComprobante: async () => ({ TipoFc: "COT", ImporteTotalNeto: "1.000,00", Saldo: "1.000,00" }),
    cobrarComprobante: async (p) => { cobrado = p; },
  } });
  assert.equal(res.estado, "registrada");
  assert.equal(cobrado.Id, 55);
  for (const otro of [{ TipoFc: "FCB" }, { Cae: "123" }]) {
    await assert.rejects(registrarCobranza({ factura: cotizacion, pagos, destinos, backend: {
      consultarComprobante: async () => ({ TipoFc: "COT", ImporteTotalNeto: 1000, Saldo: 1000, ...otro }),
      cobrarComprobante: async () => assert.fail("No debe cobrar"),
    } }), /no coincide/);
  }
});
