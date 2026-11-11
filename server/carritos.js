import crypto from 'node:crypto';
export function capturarCarrito(sale, referencia){
 if(sale.fase!=='venta'||!sale.lines.length)throw new Error('Agregá productos antes de guardar.');
 if(typeof referencia!=='string'||!referencia.trim()||referencia.length>120)throw new Error('Ingresá una referencia de hasta 120 caracteres.');
 return {id:crypto.randomUUID(),referencia:referencia.trim(),fecha:new Date().toISOString(),lineas:sale.lines.map(l=>({productId:l.productId,cantidad:l.cantidad,precioFinal:l.precioFinal,nombre:l.nombre})),metodoPago:sale.metodoPago,transferencia:sale.transferencia,sinFactura:sale.sinFactura};
}
export function recuperarCarrito(sale,carrito,productos,reemplazar){
 if(['facturando','cobranza','cobrando'].includes(sale.fase)||sale.comprobantePendiente)throw new Error('Terminá el comprobante y su cobranza antes de recuperar un carrito.');
 if(sale.fase==='venta'&&sale.lines.length&&!reemplazar)throw new Error('Confirmá el reemplazo de la venta actual.');
 const cambios = [];
 const entradas = carrito.lineas.map(l => {
   const p = productos.get(String(l.productId));
   if (!p || p.activo === false || (p.stock != null && p.stock < l.cantidad)) {
     throw new Error(`${l.nombre}: producto no disponible o stock insuficiente. El carrito guardado se conserva.`);
   }
   if (p.precioFinal !== l.precioFinal) cambios.push(`${p.nombre}: se actualizó el precio`);
   return { p, cantidad: l.cantidad };
 });
 sale.reset();for(const {p,cantidad} of entradas){sale.agregar(p);sale.lines.at(-1).cantidad=cantidad;}sale.setMetodoPago(carrito.metodoPago);sale.transferencia=Boolean(carrito.transferencia);sale.sinFactura=Boolean(carrito.sinFactura);return cambios;
}
