import { round2 } from './pricing.js';
const dia = d => new Date(new Date(d).getTime()-10800000).toISOString().slice(0,10);
const dentro = (d,r) => Boolean(d) && (!r.desde || dia(d)>=r.desde) && (!r.hasta || dia(d)<=r.hasta);
export function informeComercial(ventas, cobranzas, productos, rango={}, opciones={}) {
 const latest=new Map(cobranzas.map(c=>[String(c.idComprobante),c]));
 const operaciones=ventas.filter(v=>!v.prueba||opciones.incluirPruebas).map(v=>({...v, cobranza:latest.get(String(v.idComprobante))||v.cobranza}));
 const vendidas=operaciones.filter(v=>dentro(v.fecha,rango)&&(!(v.factura?.cotizacion||v.tipo==='COT')||v.cobranza?.estado==='registrada'));
 const pagos=operaciones.flatMap(v=>{const c=v.cobranza;if(c?.estado!=='registrada'||!c.fecha)return [];return (c.pagos?.length?c.pagos:[{Importe:v.total,FormaDePago:v.transferencia?'Transferencia':v.metodoPago}]).map(p=>({idComprobante:v.idComprobante,fecha:c.fecha,medio:p.FormaDePago,importe:Number(p.Importe)}));}).filter(p=>dentro(p.fecha,rango));
 const facturas=operaciones.filter(v=>v.cae&&dentro(v.fecha,rango));
 const pendientes=operaciones.filter(v=>v.cobranza?.estado!=='registrada').map(v=>({id:v.idComprobante,numero:v.numero,total:v.total,estado:v.cobranza?.estado||'sin información',dias:Math.max(0,Math.floor((Date.now()-Date.parse(v.fecha))/86400000)),url:v.url}));
 const total=round2(vendidas.reduce((s,v)=>s+v.total,0));
 const unidades=vendidas.reduce((s,v)=>s+(v.lineas||[]).reduce((a,l)=>a+l.cantidad,0),0);
 const base=new Map(), pares=new Map();
 for(const v of vendidas){const ls=[...new Map((v.lineas||[]).map(l=>[String(l.productId),l])).values()];for(const a of ls){base.set(String(a.productId),(base.get(String(a.productId))||0)+1);for(const b of ls){if(String(a.productId)===String(b.productId))continue;const key=JSON.stringify([String(a.productId),String(b.productId)]);const p=pares.get(key)||{producto:a.nombre,acompanante:b.nombre,productId:String(a.productId),ventas:0};p.ventas++;pares.set(key,p);}}}
 const ventana=opciones.ventana||90,objetivo=opciones.objetivo||30;
 const desde=new Date(Date.now()-ventana*86400000).toISOString();const demanda=new Map();
 for(const v of operaciones.filter(v=>v.fecha>=desde&&(!(v.factura?.cotizacion||v.tipo==='COT')||v.cobranza?.estado==='registrada')))for(const l of v.lineas||[])demanda.set(String(l.productId),(demanda.get(String(l.productId))||0)+l.cantidad);
 const reposicion=productos.filter(p=>!p.productoPrueba).map(p=>{const u=demanda.get(String(p.id))||0,stock=p.stock==null?null:Number(p.stock),cobertura=u&&stock!==null?stock/(u/ventana):null;return {id:p.id,nombre:p.nombre,stock,unidades:u,cobertura: cobertura===null?null:round2(cobertura),sugeridas:cobertura===null?null:Math.max(0,Math.ceil(u/ventana*objetivo-stock)),estado:stock===null?'Stock desconocido':!u?'Sin historial suficiente':stock<=0?'Agotado con demanda':cobertura<objetivo?'Cobertura baja':'Stock suficiente'};});
 return {periodo:rango,canal:'mostrador',actualizado:new Date().toISOString(),cobertura:{online:'Pendiente de conexión a pedidos y pagos',cobrosSinFecha:operaciones.filter(v=>v.cobranza?.estado==='registrada'&&!v.cobranza.fecha).length,stock:opciones.stockActualizado||null},resumen:{vendido:total,facturado:round2(facturas.reduce((s,v)=>s+v.total,0)),cobrado:round2(pagos.reduce((s,p)=>s+p.importe,0)),operaciones:vendidas.length,unidades,ticket:vendidas.length?round2(total/vendidas.length):0,unidadesPorOperacion:vendidas.length?round2(unidades/vendidas.length):0},operaciones:vendidas,pagos,facturas,pendientes,combinaciones:[...pares.values()].map(p=>({...p,porcentaje:round2(100*p.ventas/base.get(p.productId))})).sort((a,b)=>b.ventas-a.ventas),reposicion,ventana,objetivo};
}

export function compararComercial(actual,anterior){
 const a=actual.resumen,b=anterior.resumen;
 const porOperaciones=round2((a.operaciones-b.operaciones)*b.ticket);
 const variacion=round2(a.vendido-b.vendido);
 return {anterior:b,variacion,porOperaciones,porTicket:round2(variacion-porOperaciones),porcentaje:b.vendido?round2(variacion/b.vendido*100):null};
}
