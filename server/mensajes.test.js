import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { Server } from "socket.io";
import { io as cliente } from "socket.io-client";
import { registrarMensajes } from "./mensajes.js";

test("Mensajes ocultos: código, destinatarios, validación y límite de envíos", async () => {
  const server = http.createServer();
  const io = new Server(server);
  io.on("connection", (socket) => registrarMensajes(io, socket));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const sockets = [];
  async function conectar(auth) {
    const socket = cliente(`http://127.0.0.1:${server.address().port}`, { auth, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    await once(socket, "connect");
    return socket;
  }
  const enviar = (socket, texto, codigo = "joaquito") => socket.timeout(2000).emitWithAck("mensaje-vendedor", { texto, codigo });
  try {
    const supervisor = await conectar({ soloLectura: true });
    assert.match((await enviar(supervisor, "Hola")).error, /No hay/);
    const vendedor = await conectar({ pantalla: "vendedor" });
    const pantallaCliente = await conectar({});
    const otroSupervisor = await conectar({ soloLectura: true, pantalla: "vendedor" });
    const recibidos = [];
    for (const socket of [pantallaCliente, supervisor, otroSupervisor]) socket.on("mensaje-vendedor", () => recibidos.push(socket.id));
    assert.equal((await enviar(supervisor, "Hola", "incorrecto")).ok, false);
    assert.equal((await enviar(pantallaCliente, "Hola")).ok, false);
    assert.equal((await enviar(supervisor, " ")).ok, false);
    assert.equal((await enviar(supervisor, "x".repeat(281))).ok, false);
    assert.equal((await enviar(supervisor, { texto: "no es texto" })).ok, false);
    const recibido = once(vendedor, "mensaje-vendedor");
    assert.deepEqual(await enviar(supervisor, "  Hola Joaquito 👀  "), { ok: true, pantallas: 1 });
    assert.deepEqual((await recibido)[0], { texto: "Hola Joaquito 👀" });
    assert.match((await enviar(supervisor, "Otro mensaje")).error, /Esperá/);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(recibidos, []);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise(resolve => io.close(resolve));
  }
});
