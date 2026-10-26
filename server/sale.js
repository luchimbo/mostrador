// Estado de la venta en curso. El servidor es la única fuente de verdad:
// la pantalla del vendedor manda acciones y ambas pantallas reciben el mismo estado.
import { calcularLinea, calcularTotales, descuentoSeguro, marcarCrossSelling, METODOS_PAGO, round2 } from "./pricing.js";
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
    this.transferencia = false; // MercadoPago por transferencia: con descuento de contado
    this.totalAjustado = null; // total final escrito por el vendedor (ej. redondeo en efectivo)
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
    this.totalAjustado = null;
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
        crossSelling: null, // null = automático (todo lo que no es el más caro)
      });
    }
    this.fase = "venta";
    this.inicio ??= new Date().toISOString();
    this.error = null;
  }

  cambiarCantidad(lineId, cantidad) {
    const line = this.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    this.totalAjustado = null;
    if (cantidad <= 0) this.quitar(lineId);
    else line.cantidad = Math.floor(cantidad);
  }

  // El vendedor marca o desmarca una línea como cross-selling; null vuelve a lo automático.
  marcarCrossSelling(lineId, valor) {
    const line = this.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    line.crossSelling = typeof valor === "boolean" ? valor : null;
  }

  quitar(lineId) {
    this.lines = this.lines.filter((l) => l.lineId !== lineId);
    this.totalAjustado = null;
    if (this.lines.length === 0 && this.fase === "venta") this.reset();
  }

  setMetodoPago(metodo) {
    metodo = { debito: "mercadopago", credito: "mercadopago", transferencia: "efectivo" }[metodo] || metodo;
    this.metodoPago = METODOS_PAGO[metodo] ? metodo : null;
    this.totalAjustado = null;
    if (this.metodoPago !== "efectivo") this.sinFactura = false;
    if (this.metodoPago !== "mercadopago") this.transferencia = false;
  }

  setTransferencia(valor) {
    if (valor && this.metodoPago !== "mercadopago") throw new Error("La transferencia se registra con la condición MercadoPago.");
    this.transferencia = Boolean(valor);
    this.totalAjustado = null;
  }

  setSinFactura(valor) {
    if (valor && this.metodoPago !== "efectivo") throw new Error("La venta sin factura es solo para Efectivo.");
    this.sinFactura = Boolean(valor);
  }

  // El vendedor puede escribir el total final, menor o mayor (ej. redondear en efectivo). Se borra al cambiar la venta.
  ajustarTotal(valor, settings) {
    if (this.fase !== "venta" || !this.lines.length) throw new Error("Agregá productos antes de ajustar el total.");
    if (valor === null || valor === undefined || valor === "") { this.totalAjustado = null; return; }
    if (!this.metodoPago) throw new Error("Elegí la condición de venta antes de ajustar el total.");
    const total = round2(Number(valor));
    const sinAjuste = calcularTotales(this.lines, this.metodoPago, settings, { transferencia: this.transferencia }).totalAPagar;
    if (!Number.isFinite(total) || total <= 0) throw new Error("Ingresá un total válido.");
    this.totalAjustado = total === sinAjuste ? null : total;
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
      this.fase === "venta" && settings.crossSellingMostrador !== false ? obtenerSugerencias(this.lines, productsById, reglas, settings) : [];
    for (const s of sugerencias) this.sugerenciasMostradas.add(`${s.reglaId}:${s.productId}`);
    return {
      fase: this.fase,
      lines: marcarCrossSelling(this.lines.map((l) => ({ ...l, ...calcularLinea(l), recomendado: Boolean(l.reglaId), crossSellingManual: typeof l.crossSelling === "boolean" }))),
      totales: this.totales(settings),
      metodoPago: this.metodoPago,
      sinFactura: this.sinFactura,
      transferencia: this.transferencia,
      totalAjustado: this.totalAjustado,
      sugerencias,
      cliente: this.cliente,
      factura: this.factura,
      error: this.error,
    };
  }

  totales(settings) {
    const t = calcularTotales(this.lines, this.metodoPago, settings, { transferencia: this.transferencia });
    const ajustado = this.totalAjustado !== null
      ? { totalSinAjuste: t.totalAPagar, ajuste: round2(this.totalAjustado - t.totalAPagar), totalAPagar: this.totalAjustado }
      : {};
    return { ...t, ...ajustado, ...(comprobanteEmitido(this.factura) ? { totalAPagar: this.factura.total } : {}) };
  }

}
