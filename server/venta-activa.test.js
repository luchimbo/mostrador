import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { detalleConfirmado } from "../shared/confirmacion-venta.js";

const root = fileURLToPath(new URL("../", import.meta.url));

async function esperarHasta(leer) {
  for (let i = 0; i < 250; i++) {
    const valor = leer();
    if (valor) return valor;
    await esperar(20);
  }
  assert.fail("El estado esperado no llegó.");
}

async function entorno(t, databaseUrl = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mostrador-activa-"));
  const datos = path.join(dir, "data", "preview");
  fs.mkdirSync(datos, { recursive: true });
  for (const carpeta of ["server", "shared"]) fs.cpSync(path.join(root, carpeta), path.join(dir, carpeta), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "junction");
  const listener = net.createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  let proceso, socket, estado, salida;
  async function parar() {
    socket?.disconnect();
    if (proceso && proceso.exitCode === null && proceso.signalCode === null) {
      const termino = once(proceso, "exit");
      proceso.kill();
      await termino;
    }
  }
  t.after(async () => {
    await parar();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    datos,
    estado: () => estado,
    async iniciar() {
      salida = "";
      estado = null;
      proceso = spawn(process.execPath, ["server/index.js"], {
        cwd: dir, windowsHide: true,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CONTABILIUM_|CROSS_SELLING_|RAILWAY_|CLAVE_ACCESO$|FACTURACION$)/i.test(k))),
          MOSTRADOR_PREVIEW: "1", CONTABILIUM_MODE: "mock", PORT: String(port), DATABASE_URL: databaseUrl,
          TIENDANUBE_URL: "http://127.0.0.1:1", CROSS_SELLING_AUTO: "no",
        },
      });
      for (const stream of [proceso.stdout, proceso.stderr]) stream.on("data", bytes => { salida += bytes; });
      await esperarHasta(() => {
        assert.equal(proceso.exitCode, null, salida);
        return salida.includes("[catálogo]") && salida.includes("Vendedor:");
      });
      socket = io(url, { reconnection: false, transports: ["websocket"] });
      socket.on("estado", valor => { estado = valor; });
      const error = once(socket, "connect_error").then(([fallo]) => { throw new Error(`${fallo.message} ${fallo.description?.message ?? ""}\n${salida}`); });
      await Promise.race([esperarHasta(() => estado), error]);
    },
    parar,
    async accion(tipo, datos = {}) {
      return socket.timeout(6000).emitWithAck("accion", { tipo, ...datos });
    },
    async api(ruta, datos) {
      const res = await fetch(`${url}/api${ruta}`, datos && {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos),
      });
      assert.ok(res.ok, await res.clone().text());
      return res.json();
    },
  };
}

test("restaura el carrito confirmado y descarta cambios que no pudieron guardarse", async t => {
  const app = await entorno(t);
  await app.iniciar();
  assert.ok((await app.accion("agregar", { productId: "101" })).ok);
  const [{ lineId }] = app.estado().lines;
  const bloqueo = path.join(app.datos, "venta-activa.json.tmp");
  fs.mkdirSync(bloqueo);
  const cambios = await Promise.all([3, 4].map(cantidad => app.accion("cantidad", { lineId, cantidad })));
  assert.ok(cambios.every(cambio => !cambio.ok));
  assert.equal(app.estado().lines[0].cantidad, 1);
  fs.rmdirSync(bloqueo);
  assert.ok((await app.accion("cantidad", { lineId, cantidad: 2 })).ok);
  const carrito = await app.api("/carritos", { referencia: "Prueba de recuperación" });
  assert.ok((await app.accion("cancelar")).ok);
  await app.api(`/carritos/${carrito.id}/recuperar`, {});
  const restaurada = app.estado().lines[0];
  await app.parar();
  await app.iniciar();
  assert.equal(app.estado().recuperada, true);
  assert.equal(app.estado().lines[0].lineId, restaurada.lineId);
  assert.equal(app.estado().lines[0].cantidad, 2);
  assert.ok((await app.accion("agregar", { productId: "102" })).ok);
  assert.notEqual(app.estado().lines[1].lineId, restaurada.lineId);
  assert.ok((await app.accion("cancelar")).ok);
  await app.parar();
  await app.iniciar();
  assert.equal(app.estado().fase, "idle");
});

test("recupera una emisión confirmada con fallo local y verifica el cobro sin repetirlo", async t => {
  const app = await entorno(t);
  await app.iniciar();
  assert.ok((await app.accion("agregar", { productId: "101" })).ok);
  assert.ok((await app.accion("metodoPago", { metodo: "efectivo" })).ok);
  assert.ok((await app.accion("sinFactura", { valor: true })).ok);
  const registroVentas = path.join(app.datos, "ventas.jsonl");
  fs.mkdirSync(registroVentas);
  const emision = await app.accion("facturar", { confirmacion: detalleConfirmado(app.estado()) });
  assert.equal(emision.ok, false);
  assert.equal(app.estado().fase, "revision");
  const id = app.estado().revision.id;
  assert.ok(id);
  assert.equal((await app.accion("cancelar")).ok, false);
  fs.rmdirSync(registroVentas);
  await app.parar();
  await app.iniciar();
  const recuperacion = await app.accion("verificarOperacion");
  assert.ok(recuperacion.ok, recuperacion.error);
  assert.equal(app.estado().fase, "cobranza");
  const registroCobros = path.join(app.datos, "cobranzas.jsonl");
  fs.mkdirSync(registroCobros);
  assert.equal((await app.accion("cobrar", {
    pagos: [{ medio: "efectivo", destino: "almagro", importe: app.estado().factura.total }],
  })).ok, false);
  assert.equal(app.estado().fase, "revision");
  fs.rmdirSync(registroCobros);
  await app.parar();
  await app.iniciar();
  assert.ok((await app.accion("verificarOperacion")).ok);
  assert.equal((await app.accion("verificarOperacion")).ok, false);
  assert.equal((await app.api("/facturas")).filter(f => f.idComprobante === id).length, 1);
  assert.equal(fs.readFileSync(registroCobros, "utf8").trim().split("\n").length, 1);
  await app.parar();
  await app.iniciar();
  assert.equal(app.estado().fase, "idle");
});


test("una emisión interrumpida exige un ID verificable y rechaza comprobantes ajenos", async t => {
  const app = await entorno(t);
  await app.iniciar();
  assert.ok((await app.accion("agregar", { productId: "101" })).ok);
  assert.ok((await app.accion("metodoPago", { metodo: "efectivo" })).ok);
  assert.ok((await app.accion("sinFactura", { valor: true })).ok);
  const activa = path.join(app.datos, "venta-activa.json");
  const solicitud = app.accion("facturar", { confirmacion: detalleConfirmado(app.estado()) }).catch(() => {});
  const esperado = await esperarHasta(() => JSON.parse(fs.readFileSync(activa, "utf8")).operacion?.esperado);
  await app.parar();
  await solicitud;
  const base = { TipoFc: esperado.tipoFc, ImporteTotalNeto: esperado.total, Saldo: esperado.total, IdCliente: esperado.clienteId };
  fs.writeFileSync(path.join(app.datos, "comprobantes-simulados.json"), JSON.stringify([
    [900001, { ...base, IdCliente: 2 }],
    [900002, base],
    [900003, base],
  ]));
  fs.writeFileSync(path.join(app.datos, "ventas.jsonl"), JSON.stringify({ idComprobante: 900002, sessionId: "otra-venta" }) + "\n");
  await app.iniciar();
  assert.equal(app.estado().fase, "revision");
  assert.equal(app.estado().revision.id, null);
  assert.equal((await app.accion("facturar")).ok, false);
  assert.equal((await app.accion("verificarOperacion", { id: "900004" })).ok, false);
  assert.match((await app.accion("verificarOperacion", { id: "900001" })).error, /Cliente/);
  assert.match((await app.accion("verificarOperacion", { id: "900002" })).error, /otra venta/);
  const verificada = await app.accion("verificarOperacion", { id: "900003" });
  assert.ok(verificada.ok, verificada.error);
  assert.equal(app.estado().fase, "cobranza");
});

test("retoma una cobranza anterior y solo la concilia con saldo cero", async t => {
  const app = await entorno(t);
  const id = 900001;
  fs.writeFileSync(path.join(app.datos, "factura-en-cobranza.json"), JSON.stringify({
    idComprobante: id, cotizacion: true, tipoFc: "COT", total: 100,
    metodoPago: "efectivo", cobranza: { modalidad: "manual", estado: "revisar" },
  }));
  const documento = path.join(app.datos, "comprobantes-simulados.json");
  for (const saldo of [100, 50, 0]) {
    fs.writeFileSync(documento, JSON.stringify([[id, { TipoFc: "COT", ImporteTotalNeto: 100, Saldo: saldo }]]));
    await app.iniciar();
    assert.equal(app.estado().fase, "revision");
    const verificada = await app.accion("verificarOperacion");
    if (saldo) {
      assert.match(verificada.error, /Saldo en Contabilium/);
      assert.equal(app.estado().fase, "revision");
    } else {
      assert.ok(verificada.ok, verificada.error);
      const cobro = JSON.parse(fs.readFileSync(path.join(app.datos, "cobranzas.jsonl"), "utf8"));
      assert.equal(cobro.estado, "registrada");
      assert.equal(cobro.fecha, undefined);
      assert.equal(cobro.pagos, undefined);
    }
    await app.parar();
  }
  await app.iniciar();
  assert.equal(app.estado().fase, "idle");
});

test("restaura la venta activa después de reiniciar con PostgreSQL", {
  skip: !process.env.TEST_DATABASE_URL && "sin TEST_DATABASE_URL",
}, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  const esquema = `venta_${crypto.randomBytes(8).toString("hex")}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  await pool.query(`create schema ${esquema}`);
  url.searchParams.set("options", `-c search_path=${esquema}`);
  const app = await entorno(t, url.toString());
  t.after(async () => {
    await pool.query(`drop schema ${esquema} cascade`);
    await pool.end();
  });
  await app.iniciar();
  assert.ok((await app.accion("agregar", { productId: "101" })).ok);
  const [{ lineId }] = app.estado().lines;
  assert.ok((await app.accion("cantidad", { lineId, cantidad: 3 })).ok);
  await app.parar();
  await app.iniciar();
  assert.equal(app.estado().recuperada, true);
  assert.equal(app.estado().lines[0].lineId, lineId);
  assert.equal(app.estado().lines[0].cantidad, 3);
  assert.ok((await app.accion("cancelar")).ok);
  await app.parar();
  await app.iniciar();
  assert.equal(app.estado().fase, "idle");
});
