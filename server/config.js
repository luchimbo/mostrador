import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const env = process.env;

const mode = env.CONTABILIUM_MODE === "real" ? "real" : "mock";

export const config = {
  port: Number(env.PORT) || 3000,
  mode,
  // Con FACTURACION=simulada se usa el catálogo real pero las facturas son de prueba (no van a Contabilium).
  facturacionSimulada: mode === "mock" || env.FACTURACION === "simulada",
  productosPruebaIds: (env.PRODUCTOS_PRUEBA_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
  contabilium: {
    baseUrl: env.CONTABILIUM_BASE_URL || "https://rest.contabilium.com",
    clientId: (env.CONTABILIUM_CLIENT_ID || "").trim(),
    clientSecret: (env.CONTABILIUM_CLIENT_SECRET || "").trim(),
    puntoVenta: Number(env.CONTABILIUM_PUNTO_VENTA) || null,
    inventario: Number(env.CONTABILIUM_INVENTARIO) || null,
    condicionesVenta: Object.fromEntries(["mercadopago", "efectivo", "otros"].map((metodo) => {
      const prefijo = `CONTABILIUM_${metodo.toUpperCase()}`;
      return [metodo, env[`${prefijo}_CONDICION`] || null];
    })),
    idClienteConsumidorFinal: Number(env.CONTABILIUM_ID_CLIENTE_CF) || null,
  },
  // Datos separados por modo: las reglas de prueba no se mezclan con las reales.
  tiendanubeUrl: env.TIENDANUBE_URL || "https://www.pcmidi.com.ar",
  dataDir: path.join(ROOT, "data", mode),
  catalogRefreshMinutes: 10,
  tiendaRefreshMinutes: 30,
};
