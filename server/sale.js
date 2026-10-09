// Estado de la venta en curso. El servidor es la única fuente de verdad:
// la pantalla del vendedor manda acciones y ambas pantallas reciben el mismo estado.
import { calcularLinea, calcularTotales, descuentoSeguro, METODOS_PAGO } from "./pricing.js";
import { obtenerSugerencias, reglaSeDispara } from "./recommendations.js";
import { comprobanteEmitido } from "./cobranza.js";

let nextLineId = 1;

export class Sale {
  constructor() {
    this.reset();
  }

  reset() {
    this.lines = [];
    this.metodoPago = null;
    this.sinFactura = false; // efectivo sin factura: se registra como cotización
    this.fase = "idle"; // idle | venta | facturando | gracias
    this.cliente = null; // { nombre, documento } a mostrar
    this.factura = null;
    this.error = null;
    this.comprobantePendiente = null;
    this.sugerenciasMostradas = new Set();
    this.inicio = null;
  }

  agregar(product, { reglaId = null } = {}) {
    if (["facturando", "cobrando", "cobranza"].includes(this.fase)) throw new Error("Terminá la factura y su cobranza antes de agregar productos.");
    if (this.fase === "gracias") this.reset();
    const existente = this.lines.find((l) => String(l.productId) === String(product.id));
    if (existente) {
      existente.cantidad += 1;
    } else {
      this.lines.push({
        lineId: nextLineId++,
        productId: product.id,
        codigo: product.codigo,
        nombre: product.nombre,
        nombreFactura: product.nombreFactura || product.nombre,
        precioFinal: product.precioFinal,
        imagen: product.imagen || null,
        iva: product.iva ?? 21,
        cantidad: 1,
        reglaId,
        descuentoPct: 0,
      });
    }
    this.fase = "venta";
    this.inicio ??= new Date().toISOString();
    this.error = null;
  }

  cambiarCantidad(lineId, cantidad) {
    const line = this.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    if (cantidad <= 0) this.quitar(lineId);
    else line.cantidad = Math.floor(cantidad);
  }

  quitar(lineId) {
    this.lines = this.lines.filter((l) => l.lineId !== lineId);
    if (this.lines.length === 0 && this.fase === "venta") this.reset();
  }

  setMetodoPago(metodo) {
    metodo = { debito: "mercadopago", credito: "mercadopago", transferencia: "efectivo" }[metodo] || metodo;
    this.metodoPago = METODOS_PAGO[metodo] ? metodo : null;
    if (this.metodoPago !== "efectivo") this.sinFactura = false;
  }

  setSinFactura(valor) {
    if (valor && this.metodoPago !== "efectivo") throw new Error("La venta sin factura es solo para Efectivo.");
    this.sinFactura = Boolean(valor);
  }

  // Recalcula descuentos de los productos que entraron por recomendación:
  // el descuento vale solo mientras el producto que lo disparó siga en el carrito.
  recalcular(productsById, reglas, settings) {
    const reglasPorId = new Map(reglas.map((r) => [r.id, r]));
    for (const line of this.lines) {
      if (!line.reglaId) continue;
      const regla = reglasPorId.get(line.reglaId);
      const product = productsById.get(String(line.productId));
      const activa = regla && product && reglaSeDispara(regla, this.lines, productsById, line.lineId);
      line.descuentoPct = activa ? descuentoSeguro(product, regla.descuentoPct, settings) : 0;
    }
  }

  snapshot(productsById, reglas, settings) {
    this.recalcular(productsById, reglas, settings);
    const sugerencias =
      this.fase === "venta" ? obtenerSugerencias(this.lines, productsById, reglas, settings) : [];
    for (const s of sugerencias) this.sugerenciasMostradas.add(`${s.reglaId}:${s.productId}`);
    return {
      fase: this.fase,
      lines: this.lines.map((l) => ({ ...l, ...calcularLinea(l), recomendado: Boolean(l.reglaId) })),
      totales: { ...calcularTotales(this.lines, this.metodoPago, settings), ...(comprobanteEmitido(this.factura) ? { totalAPagar: this.factura.total } : {}) },
      metodoPago: this.metodoPago,
      sinFactura: this.sinFactura,
      sugerencias,
      cliente: this.cliente,
      factura: this.factura,
      error: this.error,
    };
  }
}
