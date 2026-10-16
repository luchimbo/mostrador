import assert from "node:assert/strict";
import { test } from "node:test";
import { facturar } from "./invoice.js";
import { DEFAULT_SETTINGS } from "./store.js";
import { configurarCondicionVenta } from "./contabilium.js";

const snapshot = {
  lines: [{ productId: "26604", codigo: "1", nombre: "PRODUCTO DEMO", cantidad: 1, precioFinal: 3946.8, iva: 21, descuentoPct: 0 }],
  metodoPago: "debito", totales: { totalAPagar: 3946.8 },
};

function escenario(existente = null) {
  const llamadas = { busquedas: [], altas: [], facturas: [] };
  const backend = {
    consultarDatosArca: async () => ({ nombre: existente?.RazonSocial || "Persona registrada en ARCA" }),
    buscarClientePorDocumento: async (documento) => { llamadas.busquedas.push(documento); return existente; },
    crearCliente: async (datos) => { llamadas.altas.push(datos); return 123; },
    emitirFactura: async (datos) => { llamadas.facturas.push(datos); return { cae: "PRUEBA", numero: "0001", idComprobante: 1 }; },
  };
  const emitir = (datosCliente) => facturar({ backend, snapshot, settings: DEFAULT_SETTINGS, datosCliente });
  return { llamadas, emitir };
}

test("Factura: documento y condición obligatorios antes de consultar o crear clientes", async () => {
  const { llamadas, emitir } = escenario();
  await assert.rejects(emitir({ documento: "", condicionIva: "CF" }), /DNI o CUIT/);
  await assert.rejects(emitir({ documento: "30123456" }), /Elegí la condición/);
  await assert.rejects(emitir({ documento: "30123456", condicionIva: "RI" }), /ingresá su CUIT/);
  assert.deepEqual(llamadas, { busquedas: [], altas: [], facturas: [] });
});

test("Factura: Consumidor Final con DNI conserva el documento al dar de alta y emite B", async () => {
  const { llamadas, emitir } = escenario();
  const resultado = await emitir({ documento: "30.123.456", condicionIva: "CF" });
  assert.equal(resultado.tipo, "Factura B");
  assert.deepEqual(llamadas.busquedas, ["30123456"]);
  assert.equal(llamadas.altas[0].documento, "30123456");
  assert.equal(llamadas.altas[0].tipoDoc, "DNI");
  assert.equal(llamadas.altas[0].condicionIva, "CF");
  assert.equal(llamadas.altas[0].razonSocial, "Persona registrada en ARCA");
  assert.equal(resultado.cliente.nombre, "Persona registrada en ARCA");
  assert.equal(llamadas.facturas[0].IdCliente, 123);
});

test("Factura: reutiliza el cliente identificado y rechaza una condición distinta a la registrada", async () => {
  const existente = { Id: 45, RazonSocial: "Cliente de prueba", CondicionIva: "RI" };
  const { llamadas, emitir } = escenario(existente);
  await assert.rejects(emitir({ documento: "20123456786", condicionIva: "CF" }), /registrado como Responsable Inscripto/);
  assert.equal(llamadas.altas.length, 0);
  assert.equal(llamadas.facturas.length, 0);
  const resultado = await emitir({ documento: "20123456786", condicionIva: "RI" });
  assert.equal(resultado.tipo, "Factura A");
  assert.equal(llamadas.facturas[0].IdCliente, 45);
});

test("Factura: CUIT nuevo toma la razón social de ARCA e ignora el nombre ingresado", async () => {
  const { llamadas, emitir } = escenario();
  const resultado = await emitir({ documento: "20123456786", condicionIva: "MO", nombre: "Cliente de prueba" });
  assert.equal(resultado.tipo, "Factura A");
  assert.equal(llamadas.altas[0].condicionIva, "MO");
  assert.equal(llamadas.altas[0].razonSocial, "Persona registrada en ARCA");
});

test("Factura: corrige el cliente genérico o desactualizado antes de emitir por cualquier modalidad", async () => {
  for (const automatico of [false, true]) {
    for (const anterior of ["Consumidor Final", "NOMBRE ANTERIOR", "", "   "]) {
      const pasos = [];
      const backend = {
        obtenerConfiguracionFacturacion: async () => ({ automatico }),
        buscarClientePorDocumento: async () => ({ Id: 45, RazonSocial: anterior, CondicionIva: "CF" }),
        consultarDatosArca: async () => ({ nombre: "NOMBRE DE ARCA" }),
        crearCliente: async () => assert.fail("No duplicar el cliente"),
        actualizarNombreCliente: async (...args) => { assert.deepEqual(args, [45, "NOMBRE DE ARCA", "30123456"]); pasos.push("actualizar"); },
        emitirFactura: async () => { pasos.push("manual"); return { cae: "TEST" }; },
        emitirFacturaCobrada: async () => { pasos.push("automatica"); return { cae: "TEST" }; },
      };
      const resultado = await facturar({ backend, snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF", nombre: "Nombre manual" } });
      assert.equal(resultado.cliente.nombre, "NOMBRE DE ARCA");
      assert.deepEqual(pasos, ["actualizar", automatico ? "automatica" : "manual"]);
    }
  }
});

test("Factura: sin nombre de ARCA o si falla la actualización no crea ni emite comprobantes", async () => {
  for (const existente of [null, { Id: 45, RazonSocial: "Consumidor Final", CondicionIva: "CF" }]) {
    const backend = {
      buscarClientePorDocumento: async () => existente,
      crearCliente: async () => assert.fail("No crear cliente"),
      actualizarNombreCliente: async () => { throw new Error("No se pudo guardar el nombre"); },
      emitirFactura: async () => assert.fail("No emitir factura"),
    };
    const datos = { backend, snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF", nombre: "Nombre manual" } };
    for (const nombre of [undefined, "", "Consumidor Final", "C.F."]) {
      backend.consultarDatosArca = async () => ({ nombre });
      await assert.rejects(facturar(datos), /ARCA no devolvió un nombre válido/);
    }
    backend.consultarDatosArca = async () => { throw new Error("Padrón no disponible"); };
    await assert.rejects(facturar(datos), /Padrón no disponible/);
    if (existente) {
      backend.consultarDatosArca = async () => ({ nombre: "NOMBRE DE ARCA" });
      await assert.rejects(facturar(datos), /No se pudo guardar/);
    }
  }
});

test("Factura: no emite si el alta no devuelve un cliente válido", async () => {
  await assert.rejects(facturar({ backend: {
    buscarClientePorDocumento: async () => null,
    consultarDatosArca: async () => ({ nombre: "PERSONA DE ARCA" }),
    crearCliente: async () => null,
    emitirFactura: async () => assert.fail("No emitir con un cliente inválido"),
  }, snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } }), /cliente identificado válido/);
});

test("Factura sin cobro: admite caja sin configurar y rechaza condiciones automáticas", () => {
  const condiciones = [{ Nombre: "Efectivo", Activa: true, CobranzaAutomatica: false }];
  assert.deepEqual(configurarCondicionVenta("efectivo", condiciones), { condicionVenta: "Efectivo", automatico: false });
  assert.throws(() => configurarCondicionVenta("efectivo", [{ ...condiciones[0], CobranzaAutomatica: true }]), /debe tener cobranza manual/);
  assert.throws(() => configurarCondicionVenta("efectivo", [{ ...condiciones[0], Activa: false }]), /condición de venta/);
});

test("Factura: prevalidación fallida no crea clientes ni comprobantes", async () => {
  await assert.rejects(facturar({ backend: {
    obtenerConfiguracionFacturacion: async () => { throw new Error("Condición automática"); },
    buscarClientePorDocumento: async () => assert.fail("No consultar clientes"),
    crearCliente: async () => assert.fail("No crear clientes"),
    emitirFactura: async () => assert.fail("No emitir"),
  }, snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } }), /Condición automática/);
});

test("Factura: mantiene ID del borrador rechazado y cobranza manual en la emisión autorizada", async () => {
  const backend = {
    consultarDatosArca: async () => ({ nombre: "Persona registrada en ARCA" }),
    buscarClientePorDocumento: async () => ({ Id: 4, RazonSocial: "Persona registrada en ARCA", CondicionIva: "CF" }),
    emitirFactura: async () => ({ idComprobante: 1234, cae: "", errores: "Rechazado" }),
  };
  const datos = { backend, snapshot, settings: DEFAULT_SETTINGS, datosCliente: { documento: "30123456", condicionIva: "CF" } };
  await assert.rejects(facturar(datos), (e) => e.idComprobante === 1234 && /Comprobante creado: 1234/.test(e.message));
  backend.emitirFactura = async (payload) => { assert.equal(payload.Pagos, null); return { cae: "PRUEBA", idComprobante: 1234 }; };
  const res = await facturar(datos);
  assert.equal(res.cobranza.estado, "pendiente");
  assert.equal(res.metodoPago, "debito");
});
