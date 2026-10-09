import assert from "node:assert/strict";
import { test } from "node:test";
import { facturar } from "./invoice.js";
import { calcularTotales } from "./pricing.js";
import { Sale } from "./sale.js";
import { DEFAULT_SETTINGS } from "./store.js";

test("Condiciones: MercadoPago cobra; Efectivo y Otros emiten con cobranza pendiente", async () => {
  for (const [metodo, condicionVenta, automatico] of [["mercadopago", "MercadoPago", true], ["efectivo", "Efectivo", false], ["otros", "Otro", false]]) {
    const lines = [{ productId: "1", nombre: "Producto", precioFinal: 12100, iva: 21, cantidad: 1, descuentoPct: 0 }];
    const totales = calcularTotales(lines, metodo, DEFAULT_SETTINGS);
    let ruta;
    const respuesta = { idComprobante: 123, cae: "PRUEBA", errores: "" };
    const resultado = await facturar({ backend: {
      obtenerConfiguracionFacturacion: async () => ({ condicionVenta, automatico, inventario: 1662 }),
      buscarClientePorDocumento: async () => ({ Id: 4, CondicionIva: "CF" }),
      emitirFactura: async (p) => { ruta = "manual"; assert.equal(p.Pagos, null); assert.equal(p.CondicionVenta, condicionVenta); return respuesta; },
      emitirFacturaCobrada: async (p) => { ruta = "automatica"; assert.equal(p.Pagos, null); assert.equal(p.CondicionVenta, condicionVenta); return respuesta; },
    }, snapshot: { lines, metodoPago: metodo, totales }, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } });
    assert.equal(ruta, automatico ? "automatica" : "manual");
    assert.equal(resultado.cobranza.estado, automatico ? "registrada" : "pendiente");
    assert.equal(resultado.total, metodo === "efectivo" ? 11495 : 12100);
  }
});

test("MercadoPago: CAE con error de cobranza se conserva como emitida para revisar", async () => {
  const res = await facturar({ backend: {
    obtenerConfiguracionFacturacion: async () => ({ condicionVenta: "MercadoPago", automatico: true }),
    buscarClientePorDocumento: async () => ({ Id: 4, CondicionIva: "CF" }),
    emitirFacturaCobrada: async () => ({ idComprobante: 123, cae: "PRUEBA", errores: "Error en cobranza" }),
  }, snapshot: { lines: [{ productId: "1", precioFinal: 12100, iva: 21, cantidad: 1 }], metodoPago: "mercadopago", totales: { totalAPagar: 12100 } }, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } });
  assert.equal(res.cae, "PRUEBA");
  assert.equal(res.cobranza.estado, "revisar");
  assert.equal(res.advertencia, "Error en cobranza");
});

test("Condiciones: convierte las selecciones anteriores a las tres opciones actuales", () => {
  const sale = new Sale();
  for (const [anterior, actual] of [["debito", "mercadopago"], ["credito", "mercadopago"], ["transferencia", "efectivo"], ["otros", "otros"]]) {
    sale.setMetodoPago(anterior); assert.equal(sale.metodoPago, actual);
  }
});

test("Comprobante en pesos aunque el producto esté cargado en dólares", async () => {
  const { monedaPesos } = await import("./contabilium.js");
  const monedas = [
    { IDMoneda: 1659, DescripcionMoneda: "Pesos Argentinos", CodigoMoneda: "$", EsMonedaPorDefecto: true, Activa: true },
    { IDMoneda: 7732, DescripcionMoneda: "Dolar Estadounidense", CodigoMoneda: "U$S", EsMonedaPorDefecto: false, Activa: true },
  ];
  assert.equal(monedaPesos(monedas), 1659);
  assert.throws(() => monedaPesos(monedas.slice(1)), /moneda Pesos/);

  const lines = [{ productId: "26604", nombre: "PRODUCTO DEMO", precioFinal: 3946.8, iva: 21, cantidad: 1, descuentoPct: 0 }];
  let enviado;
  await facturar({ backend: {
    obtenerConfiguracionFacturacion: async () => ({ condicionVenta: "Efectivo", automatico: false, inventario: 1662, idMoneda: 1659 }),
    buscarClientePorDocumento: async () => ({ Id: 4, CondicionIva: "CF" }),
    emitirFactura: async (p) => { enviado = p; return { idComprobante: 123, cae: "PRUEBA", errores: "" }; },
  }, snapshot: { lines, metodoPago: "efectivo", totales: calcularTotales(lines, "efectivo", DEFAULT_SETTINGS) }, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } });
  assert.equal(enviado.IDMoneda, 1659);
});
