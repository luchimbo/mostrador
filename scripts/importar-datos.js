// Copia los datos guardados en archivos (data/<modo>/) a la base PostgreSQL indicada en DATABASE_URL.
// Uso: npm run importar-datos   (con el servidor cerrado)
// Se puede correr más de una vez: las ventas y cobranzas ya importadas no se duplican.
// Los documentos (reglas, ajustes, destacados, destinos de cobranza...) REEMPLAZAN a los de la base.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { abrirPostgres } from "../server/postgres.js";

const DOCUMENTOS = ["ajustes", "reglas", "destacados", "destinos-cobranza", "factura-en-cobranza", "catalogo", "tiendanube"];
const REGISTROS = ["ventas", "cobranzas", "facturas-pendientes"];

if (!config.databaseUrl) {
  console.error("Falta DATABASE_URL en el archivo .env: es la dirección de la base PostgreSQL de destino.");
  process.exit(1);
}

// El mismo renglón del mismo archivo siempre recibe el mismo identificador.
function uidDeRenglon(registro, numero, renglon) {
  const h = crypto.createHash("sha1").update(`${config.mode}/${registro}/${numero}/${renglon}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const db = await abrirPostgres(config.databaseUrl, config.mode);
console.log(`Importando ${config.dataDir} (modo ${config.mode}) a PostgreSQL`);

for (const nombre of DOCUMENTOS) {
  const archivo = path.join(config.dataDir, `${nombre}.json`);
  if (!fs.existsSync(archivo)) continue;
  await db.guardarDocumento(nombre, JSON.parse(fs.readFileSync(archivo, "utf8")));
  console.log(`  ✓ ${nombre}`);
}

for (const registro of REGISTROS) {
  const archivo = path.join(config.dataDir, `${registro}.jsonl`);
  if (!fs.existsSync(archivo)) continue;
  const renglones = fs.readFileSync(archivo, "utf8").split("\n").filter(Boolean);
  let nuevos = 0;
  for (const [i, renglon] of renglones.entries()) {
    if (await db.agregar(registro, JSON.parse(renglon), uidDeRenglon(registro, i, renglon))) nuevos++;
  }
  console.log(`  ✓ ${registro}: ${nuevos} nuevos de ${renglones.length}`);
}

await db.cerrar();
