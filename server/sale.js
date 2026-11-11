import crypto from 'node:crypto';
// Estado de la venta en curso. El servidor es la única fuente de verdad:
// la pantalla del vendedor manda acciones y ambas pantallas reciben el mismo estado.
import { calcularLinea, calcularTotales, descuentoSeguro, marcarCrossSelling, METODOS_PAGO } from "./pricing.js";
import { obtenerSugerencias, reglaSeDispara, descuentoRegla } from "../shared/recommendations.js";
import { comprobanteEmitido } from "./cobranza.js";

let nextLineId = 1;

export class Sale {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.sessionId = crypto.randomUUID();
    this.lines = [];
    this.metodoPago = null;
    this.sinFactura = false; // efectivo sin factura: se registra como cotización
    this.transferencia = false; // MercadoPago por transferencia: con descuento de contado
    this.fase = "idle"; // idle | venta | facturando | gracias
    this.cliente = null; // { nombre, documento } a mostrar
    this.factura = null;
    this.error = null;
    this.operacion = null;
    this.totalesEmitidos = null;
    this.recuperada = false;
    this.comprobantePendiente = null;
    this.sugerenciasMostradas = new Set();
    this.inicio = null;
  }

  persistible() {
    const { onEvent, sugerenciasMostradas, ...datos } = this;
    return structuredClone({ ...datos, sugerenciasMostradas: [...sugerenciasMostradas] });
  }

  restaurar(datos) {
    const { sugerenciasMostradas = [], ...estado } = datos;
    Object.assign(this, estado);
    this.sugerenciasMostradas = new Set(sugerenciasMostradas);
    nextLineId = this.lines.reduce((max, linea) => Math.max(max, Number(linea.lineId) + 1), nextLineId);
  }

  actualizarProductos(productos) {
    if (this.fase !== "venta") return;
    for (const linea of this.lines) {
      const producto = productos.get(String(linea.productId));
      linea.noDisponible = !producto || producto.activo === false;
      if (linea.noDisponible) continue;
      for (const campo of ["precioFinal", "iva", "nombre", "nombreFactura", "codigo", "imagen"]) {
        if (producto[campo] != null) linea[campo] = producto[campo];
      }
    }
  }

  agregar(product, { reglaId = null } = {}) {
    if (["facturando", "cobrando", "cobranza"].includes(this.fase)) throw new Error("Terminá la factura y su cobranza antes de agregar productos.");
    if (this.fase === "gracias") this.reset();
    if (this.lines.some((l) => String(l.productId) === String(product.id))) {
      throw new Error("Este producto ya está en el ticket. Ajustá la cantidad con − y +.");
    }
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
    if (reglaId) this.onEvent({tipo:'agregada',sessionId:this.sessionId,productId:String(product.id),reglaId});
    this.fase = "venta";
    this.inicio ??= new Date().toISOString();
    this.error = null;
  }

  cambiarCantidad(lineId, cantidad) {
    const line = this.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    if (!Number.isSafeInteger(cantidad) || cantidad < 0) throw new Error("Ingresá una cantidad entera válida.");
    if (cantidad === 0) this.quitar(lineId);
    else line.cantidad = Math.floor(cantidad);
  }

  // El vendedor marca o desmarca una línea como cross-selling; null vuelve a lo automático.
  marcarCrossSelling(lineId, valor) {
    const line = this.lines.find((l) => l.lineId === lineId);
    if (!line) return;
    line.crossSelling = typeof valor === "boolean" ? valor : null;
  }

  quitar(lineId) {
    const retirada=this.lines.find(l=>l.lineId===lineId);
    if(retirada?.reglaId)this.onEvent({tipo:'retirada',sessionId:this.sessionId,productId:String(retirada.productId),reglaId:retirada.reglaId});
    this.lines = this.lines.filter((l) => l.lineId !== lineId);
    if (this.lines.length === 0 && this.fase === "venta") this.reset();
  }

  setMetodoPago(metodo) {
    metodo = { debito: "mercadopago", credito: "mercadopago", transferencia: "efectivo" }[metodo] || metodo;
    this.metodoPago = METODOS_PAGO[metodo] ? metodo : null;
    if (this.metodoPago !== "efectivo") this.sinFactura = false;
    if (this.metodoPago !== "mercadopago") this.transferencia = false;
  }

  setTransferencia(valor) {
    if (valor && this.metodoPago !== "mercadopago") throw new Error("La transferencia se registra con la condición MercadoPago.");
    this.transferencia = Boolean(valor);
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
      const activa = line.precioOriginal == null && regla && product && reglaSeDispara(regla, this.lines, productsById, line.lineId);
      line.descuentoPct = activa ? descuentoSeguro(product, descuentoRegla(regla, line.productId, settings), settings) : 0;
    }
  }

  snapshot(productsById, reglas, settings) {
    if (this.fase === "venta") this.recalcular(productsById, reglas, settings);
    const sugerencias =
      this.fase === "venta" && settings.crossSellingMostrador !== false ? obtenerSugerencias(this.lines, productsById, reglas, settings) : [];
    for (const s of sugerencias) {
      const key=`${s.reglaId}:${s.productId}`;
      if(!this.sugerenciasMostradas.has(key))this.onEvent({tipo:'mostrada',sessionId:this.sessionId,productId:String(s.productId),reglaId:s.reglaId,reglaNombre:reglas.find(r=>r.id===s.reglaId)?.nombre,condiciones:s});
      this.sugerenciasMostradas.add(key);
    }
    return {
      fase: this.fase,
      lines: marcarCrossSelling(this.lines.map((l) => ({ ...l, ...calcularLinea(l), recomendado: Boolean(l.reglaId), crossSellingManual: typeof l.crossSelling === "boolean" }))),
      totales: this.totales(settings),
      metodoPago: this.metodoPago,
      sinFactura: this.sinFactura,
      transferencia: this.transferencia,
      sugerencias,
      cliente: this.cliente,
      factura: this.factura,
      error: this.error,
      recuperada: this.recuperada,
      revision: this.fase === "revision" ? { id: this.factura?.idComprobante ?? this.comprobantePendiente, numero: this.factura?.numero } : null,
    };
  }

  totales(settings) {
    const t = this.totalesEmitidos ? { ...this.totalesEmitidos } : calcularTotales(this.lines, this.metodoPago, settings, { transferencia: this.transferencia });
    if (comprobanteEmitido(this.factura)) t.totalAPagar = this.factura.total;
    return t;
  }

}
