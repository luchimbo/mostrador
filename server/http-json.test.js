import test from "node:test";
import assert from "node:assert/strict";
import { responseJson } from "../shared/http-json.js";

test("las respuestas HTML no exponen un error del parser JSON", async () => {
  for (const status of [200, 404, 502]) {
    await assert.rejects(responseJson(new Response("<!DOCTYPE html><html>Error</html>", { status }), "Logitrack"),
      new RegExp(`Logitrack.*respuesta no válida.*HTTP ${status}`));
  }
});

test("conserva el detalle y estado de errores JSON y devuelve los datos válidos", async () => {
  await assert.rejects(responseJson(Response.json({ error: "No autorizado" }, { status: 401 })), /No autorizado \(HTTP 401\)/);
  assert.deepEqual(await responseJson(Response.json({ revision: "abc" })), { revision: "abc" });
});
