// Excepciones explícitas al filtro de la tienda para probar con conceptos de Contabilium.
// Disponibles en ambos modos de facturación, según los IDs habilitados explícitamente.
export function incluirProductosPrueba(visibles, catalogo, ids) {
  if (!ids.length) return visibles;
  const habilitados = new Set(ids.map(String));
  const resultado = new Map(visibles.map((p) => [String(p.id), p]));
  for (const p of catalogo) {
    if (!habilitados.has(String(p.id)) || p.activo === false || !(p.precioFinal > 0)) continue;
    resultado.set(String(p.id), { ...p, productoPrueba: true });
  }
  return [...resultado.values()];
}
