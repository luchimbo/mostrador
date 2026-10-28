import test from "node:test";
import assert from "node:assert/strict";
import { texto } from "./tiendanube.js";

const url = "https://tienda.example/productos/";
const fallo = () => new TypeError("fetch failed", { cause: Object.assign(new Error("socket cerrado"), { code: "ECONNRESET" }) });

test("recupera conexión y descarga interrumpidas con esperas progresivas", async () => {
  let llamadas = 0;
  const esperas = [];
  const resultado = await texto(url, {
    solicitar: async (_url, opciones) => {
      assert.ok(opciones.signal instanceof AbortSignal);
      llamadas++;
      if (llamadas === 1) throw fallo();
      if (llamadas === 2) return { ok: true, text: async () => { throw fallo(); } };
      return new Response("catálogo");
    },
    esperar: async (ms) => { esperas.push(ms); },
  });
  assert.equal(resultado, "catálogo");
  assert.deepEqual(esperas, [3000, 10000]);
});

test("limita los intentos y conserva causa y dirección", async () => {
  let llamadas = 0;
  await assert.rejects(texto(url, {
    solicitar: async () => { llamadas++; throw fallo(); },
    esperar: async () => {},
  }), (err) => err.message.includes("3 intentos (ECONNRESET)") && err.message.includes(url) && err.cause?.message === "fetch failed");
  assert.equal(llamadas, 3);
});

test("mantiene reintentos HTTP y no repite errores definitivos", async () => {
  for (const estado of [503, 404]) {
    let llamadas = 0;
    const solicitar = async () => { llamadas++; return llamadas === 1 ? new Response("error", { status: estado }) : new Response("ok"); };
    const peticion = texto(url, { solicitar, esperar: async () => {} });
    if (estado === 404) await assert.rejects(peticion, /HTTP 404/);
    else assert.equal(await peticion, "ok");
    assert.equal(llamadas, estado === 404 ? 1 : 2);
  }
});
