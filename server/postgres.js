// Almacenamiento en PostgreSQL (Railway). Dos tipos de datos, separados por modo (real / mock):
// - documentos: un valor por nombre (ajustes, reglas, destacados, copias del catálogo y de la tienda).
// - registros: historial que solo crece (ventas, cobranzas, facturas pendientes).
import crypto from "node:crypto";
import pg from "pg";

const TABLAS = { ventas: "ventas", cobranzas: "cobranzas", "facturas-pendientes": "facturas_pendientes" };

const ESQUEMA = `
  create table if not exists documentos (
    modo text not null,
    nombre text not null,
    valor jsonb,
    actualizado timestamptz not null default now(),
    primary key (modo, nombre)
  );
  ${Object.values(TABLAS).map((tabla) => `
  create table if not exists ${tabla} (
    id bigserial primary key,
    uid uuid not null unique,
    modo text not null,
    fecha timestamptz not null default now(),
    id_comprobante text,
    datos jsonb not null
  );`).join("")}
`;

// Ante un corte de conexión se reintenta; los errores de datos o de SQL no cambian al repetir.
const ESPERAS_MS = [500, 2000];
const errorDefinitivo = (err) => /^(22|23|42)/.test(err.code || "");

export async function abrirPostgres(url, modo) {
  const pool = new pg.Pool({ connectionString: url, max: 5, allowExitOnIdle: true });
  pool.on("error", (err) => console.error("[postgres]", err.message));

  async function consulta(sql, params) {
    for (let intento = 0; ; intento++) {
      try {
        return await pool.query(sql, params);
      } catch (err) {
        if (errorDefinitivo(err) || intento >= ESPERAS_MS.length) throw err;
        await new Promise((r) => setTimeout(r, ESPERAS_MS[intento]));
      }
    }
  }

  function tabla(registro) {
    if (!TABLAS[registro]) throw new Error(`Registro desconocido: ${registro}`);
    return TABLAS[registro];
  }

  await consulta(ESQUEMA);
  const { rows } = await consulta("select nombre, valor from documentos where modo = $1", [modo]);
  let cola = Promise.resolve();

  return {
    documentos: new Map(rows.map((r) => [r.nombre, r.valor])),

    // Los guardados van de a uno para que el último valor escrito sea el que queda.
    guardarDocumento(nombre, valor) {
      cola = cola.catch(() => {}).then(() => consulta(
        `insert into documentos (modo, nombre, valor) values ($1, $2, $3::jsonb)
         on conflict (modo, nombre) do update set valor = excluded.valor, actualizado = now()`,
        [modo, nombre, JSON.stringify(valor ?? null)],
      ));
      return cola;
    },

    // El uid evita duplicar la fila si un reintento repite un guardado que sí había llegado.
    async agregar(registro, entrada, uid = crypto.randomUUID()) {
      const fecha = Number.isNaN(Date.parse(entrada.fecha)) ? null : entrada.fecha;
      const res = await consulta(
        `insert into ${tabla(registro)} (uid, modo, fecha, id_comprobante, datos)
         values ($1, $2, coalesce($3::timestamptz, now()), $4, $5::jsonb) on conflict (uid) do nothing`,
        [uid, modo, fecha, entrada.idComprobante == null ? null : String(entrada.idComprobante), JSON.stringify(entrada)],
      );
      return res.rowCount > 0;
    },

    async leer(registro) {
      const res = await consulta(`select datos from ${tabla(registro)} where modo = $1 order by fecha, id`, [modo]);
      return res.rows.map((r) => r.datos);
    },

    cerrar: () => pool.end(),
  };
}
