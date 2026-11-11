import test from 'node:test';
import assert from 'node:assert/strict';
import {informeComercial} from './comercial.js';
import {capturarCarrito,recuperarCarrito} from './carritos.js';
import {Sale} from './sale.js';
const v={fecha:'2026-10-01T13:00:00Z',total:100,idComprobante:1,cae:'123',lineas:[{productId:1,nombre:'Piano',cantidad:2,total:80},{productId:2,nombre:'Cable',cantidad:1,total:20}]};
test('fecha de pago independiente y desglose de pagos',()=>{const r=informeComercial([v],[{idComprobante:1,estado:'registrada',fecha:'2026-10-02T13:00:00Z',pagos:[{Importe:40,FormaDePago:'Efectivo'},{Importe:60,FormaDePago:'Transferencia'}]}],[],{desde:'2026-10-02',hasta:'2026-10-02'});assert.equal(r.resumen.vendido,0);assert.equal(r.resumen.cobrado,100);assert.equal(r.pagos.length,2);assert.equal(r.pendientes.length,0);});
test('cobros sin fecha no se inventan y cotizaciones pendientes no son ventas',()=>{const r=informeComercial([{...v,cae:null,tipo:'COT',cobranza:{estado:'pendiente'}},{...v,idComprobante:2,cobranza:{estado:'registrada'}}],[],[]);assert.equal(r.resumen.operaciones,1);assert.equal(r.resumen.cobrado,0);assert.equal(r.cobertura.cobrosSinFecha,1);assert.equal(r.resumen.facturado,100);});
test('combinaciones cuentan operaciones y no unidades',()=>{const r=informeComercial([v,v,v],[],[]);assert.equal(r.combinaciones[0].ventas,3);assert.equal(r.combinaciones[0].porcentaje,100);});
test('stock desconocido nunca se trata como cero',()=>{const r=informeComercial([],[],[{id:1,nombre:'Piano',stock:null}]);assert.equal(r.reposicion[0].stock,null);assert.equal(r.reposicion[0].sugeridas,null);});
test('carrito no guarda datos fiscales y no pierde venta ante producto ausente',()=>{const s=new Sale();s.agregar({id:1,nombre:'Piano',precioFinal:100});s.cliente={documento:'privado'};const c=capturarCarrito(s,'Consulta');assert.equal(c.cliente,undefined);assert.throws(()=>recuperarCarrito(s,c,new Map(),true));assert.equal(s.lines.length,1);assert.throws(()=>recuperarCarrito(s,c,new Map(),false));});
test('recuperar un carrito anterior usa el precio actual del catálogo', () => {
  const sale = new Sale();
  sale.agregar({ id: 1, nombre: 'Piano', precioFinal: 100 });
  const carrito = capturarCarrito(sale, 'Consulta');
  const productos = new Map([['1', { id: 1, nombre: 'Piano', precioFinal: 150, stock: 3 }]]);

  const cambios = recuperarCarrito(sale, carrito, productos, true);

  assert.deepEqual(cambios, ['Piano: se actualizó el precio']);
  assert.equal(sale.lines[0].precioFinal, 150);
});
