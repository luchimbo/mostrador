// Motor de recomendaciones (cross-selling) basado en reglas.
//
// Regla:
// {
//   id, nombre, activa,
//   disparador: { tipo: "producto" | "rubro" | "subrubro", valor },  // qué tiene que haber en el carrito
//   sugeridos: [productId, ...],                          // qué se sugiere
//   descuentoPct                                          // descuento si lo lleva en esta compra
// }
import { descuentoSeguro, round2 } from "./pricing.js";

const comparable = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function coincide(disparador, p) {
  const valor = comparable(disparador.valor);
  if (disparador.tipo === "producto") return String(p.id) === String(disparador.valor);
  if (disparador.tipo === "subrubro") return comparable(p.subrubro) === valor;
  return comparable(p.rubro) === valor;
}

export function reglaSeDispara(regla, lines, productsById, excluirLineId = null) {
  if (!regla.activa) return null;
  for (const line of lines) {
    if (line.lineId === excluirLineId) continue;
    const p = productsById.get(String(line.productId));
    if (p && coincide(regla.disparador, p)) return p;
  }
  return null;
}

export function obtenerSugerencias(lines, productsById, reglas, settings) {
  const enCarrito = new Set(lines.map((l) => String(l.productId)));
  const vistas = new Map();
  for (const regla of reglas) {
    const disparador = reglaSeDispara(regla, lines, productsById);
    if (!disparador) continue;
    for (const id of regla.sugeridos) {
      const key = String(id);
      if (enCarrito.has(key) || vistas.has(key)) continue;
      const p = productsById.get(key);
      if (!p || p.productoPrueba || p.stock === 0) continue;
      const pct = descuentoSeguro(p, regla.descuentoPct, settings);
      vistas.set(key, {
        productId: p.id,
        nombre: p.nombre,
        imagen: p.imagen || null,
        precioFinal: p.precioFinal,
        descuentoPct: pct,
        precioConDescuento: round2(p.precioFinal * (1 - pct / 100)),
        reglaId: regla.id,
        motivo: `Ideal para tu ${disparador.nombre}`,
      });
    }
  }
  return [...vistas.values()].slice(0, settings.maxSugerencias);
}
