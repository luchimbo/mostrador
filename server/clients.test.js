import assert from "node:assert/strict";
import { test } from "node:test";
import { buscarClientePorDocumento, encontrarClientePorDocumento } from "./contabilium.js";
import { facturar } from "./invoice.js";
import { DEFAULT_SETTINGS } from "./store.js";

const registrado = { Id: 85728143, RazonSocial: "Cliente existente", TipoDoc: "DNI", NroDoc: "20-42255201-5", CondicionIva: "CF" };

test("Clientes: encuentra por DNI un registro identificado con su CUIL", () => {
  assert.equal(encontrarClientePorDocumento([registrado], "42.255.201"), registrado);
  assert.equal(encontrarClientePorDocumento([registrado], "20422552015"), registrado);
  assert.equal(encontrarClientePorDocumento([registrado], "30123456"), null);
  assert.equal(encontrarClientePorDocumento([{ ...registrado, NroDoc: "20422552016" }], "42255201"), null);
});

test("Clientes: prioriza DNI exacto y no elige entre varios registros ambiguos", () => {
  const exacto = { Id: 2, NroDoc: "42255201" };
  assert.equal(encontrarClientePorDocumento([registrado, exacto], "42255201"), exacto);
  assert.equal(encontrarClientePorDocumento([registrado, registrado], "42255201"), registrado);
  assert.throws(() => encontrarClientePorDocumento([registrado, { ...registrado, Id: 3 }], "42255201"), /más de un cliente/);
});

test("Clientes: recorre las páginas del resultado y no trata un error como cliente inexistente", async () => {
  const llamadas = [];
  const consultar = async (ruta, params) => {
    llamadas.push({ ruta, ...params });
    return { Items: params.page === 1 ? [{ Id: 5, NroDoc: "30123456" }] : [registrado], TotalPage: 2 };
  };
  assert.equal(await buscarClientePorDocumento("42.255.201", consultar), registrado);
  assert.deepEqual(llamadas.map((x) => x.page), [1, 2]);
  assert.equal(llamadas[0].filtro, "42255201");
  await assert.rejects(buscarClientePorDocumento("42255201", async () => { throw new Error("Sin conexión"); }), /Sin conexión/);
});

test("Factura: un DNI asociado a un CUIL reutiliza el ID existente sin intentar crear otro cliente", async () => {
  let payload;
  const backend = {
    buscarClientePorDocumento: (dni) => buscarClientePorDocumento(dni, async () => ({ Items: [registrado], TotalPage: 1 })),
    crearCliente: async () => { assert.fail("No debe crear un cliente duplicado"); },
    emitirFactura: async (datos) => { payload = datos; return { cae: "TEST", numero: "1" }; },
  };
  const res = await facturar({ backend, datosCliente: { documento: "42255201", condicionIva: "CF" }, settings: DEFAULT_SETTINGS, snapshot: {
    lines: [{ productId: "26604", codigo: "1", nombre: "PRODUCTO DEMO", cantidad: 1, precioFinal: 3946.8, iva: 21, descuentoPct: 0 }],
    metodoPago: "debito", totales: { totalAPagar: 3946.8 },
  } });
  assert.equal(payload.IdCliente, registrado.Id);
  assert.equal(res.tipo, "Factura B");
});
