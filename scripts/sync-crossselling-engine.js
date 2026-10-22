// Copia reproducible: Logitrack se despliega sin depender de rutas de esta computadora.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) throw new Error("Uso: node scripts/sync-crossselling-engine.js <carpeta de Logitrack> [--check]");
const destination = path.resolve(target, "src/lib/crossselling/engine");
const files = ["pricing.js", "recommendations.js", "reglas.js", "online-crossselling.js", "publish-protocol.js", "reviews.js"];
const check = process.argv.includes("--check");
const hashes = {};
if (!check) await fs.mkdir(destination, { recursive: true });
for (const file of files) {
  const body = await fs.readFile(path.join(root, "shared", file));
  hashes[file] = createHash("sha256").update(body).digest("hex");
  if (check) {
    const copy = await fs.readFile(path.join(destination, file));
    if (!body.equals(copy)) throw new Error(`Motor desactualizado en Logitrack: ${file}`);
  } else await fs.writeFile(path.join(destination, file), body);
}
const manifest = JSON.stringify({ source: "mostrador/shared", files: hashes }, null, 2) + "\n";
if (check) {
  if (await fs.readFile(path.join(destination, "manifest.json"), "utf8") !== manifest) throw new Error("Manifest del motor desactualizado");
} else await fs.writeFile(path.join(destination, "manifest.json"), manifest);
console.log(check ? "Motor compartido verificado" : "Motor compartido sincronizado");
