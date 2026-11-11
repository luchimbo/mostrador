import test from 'node:test';
import assert from 'node:assert/strict';
import {analizarRecomendaciones} from './recomendaciones-informe.js';
import {Sale} from './sale.js';
test('sesiones nuevas y retiro de recomendaciones',()=>{const eventos=[],s=new Sale(e=>eventos.push(e));const id=s.sessionId;s.agregar({id:1,nombre:'Cable',precioFinal:100},{reglaId:'r'});s.quitar(s.lines[0].lineId);assert.deepEqual(eventos.map(e=>e.tipo),['agregada','retirada']);assert.notEqual(s.sessionId,id);});
test('exposiciones repetidas no se multiplican y reglas eliminadas conservan nombre',()=>{const e={fecha:'2026-10-01T12:00:00Z',tipo:'mostrada',sessionId:'s',reglaId:'r',productId:'1',reglaNombre:'Cable con piano'};const r=analizarRecomendaciones([e,e],[]);assert.equal(r.reglas[0].mostradas,1);assert.equal(r.reglas[0].nombre,'Cable con piano');assert.equal(r.reglas[0].margen,null);});
test('margen usa costo guardado e IVA, no costo actual',()=>{const v={sessionId:'s',fecha:'2026-10-01T12:00:00Z',total:121,lineas:[{reglaId:'r',cantidad:1,total:121,bruto:140,costo:60,iva:21}]};const r=analizarRecomendaciones([], [v]);assert.equal(r.reglas[0].margen,40);assert.equal(r.reglas[0].descuento,19);assert.equal(r.reglas[0].compras,1);});
