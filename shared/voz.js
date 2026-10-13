export const FRASES_JOAQUITO = [
  "¡Nueva venta de Joaquito! ¡DOOOOU!",
  "¡Joaquito, sos una máquina de vender! ¡DOOOOU!",
  "¡Otro producto para Joaquito! ¡El rey del mostrador!",
  "¡Grande, Joaquito! ¡Ese talento no se consigue en ningún catálogo!",
  "¡Joaquito está imparable! ¡Aplausos para el campeón!",
  "¡Atención! ¡Joaquito acaba de tirar magia en el mostrador! ¡DOOOOU!",
];

// El primer estado y el primero tras reconectar son una referencia, no una venta nueva.
export function crearDetectorProductos() {
  let anterior = null;
  return {
    reiniciar() { anterior = null; },
    recibir(estado) {
      const actual = new Map(estado.lines.map((linea) => [linea.lineId, linea.cantidad]));
      const agregado = anterior !== null && estado.fase === "venta" &&
        [...actual].some(([id, cantidad]) => cantidad > (anterior.get(id) || 0));
      anterior = actual;
      return agregado;
    },
  };
}
