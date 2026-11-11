// La vista previa no hereda credenciales, base de datos ni destinos de publicación.
import {spawn} from 'node:child_process';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!(/^(CONTABILIUM_|CROSS_SELLING_|DATABASE_URL$|CLAVE_ACCESO$|RAILWAY_|FACTURACION$|TIENDANUBE_URL$|PRODUCTOS_PRUEBA_IDS$)/i.test(k))));
Object.assign(env,{MOSTRADOR_PREVIEW:'1',CONTABILIUM_MODE:'mock',FACTURACION:'simulada',PORT:'3100',CROSS_SELLING_AUTO:'no'});
const {default:fs}=await import('node:fs');
const {CATALOGO_DEMO}=await import('../server/mock.js');
fs.mkdirSync('data/preview',{recursive:true});
if(!fs.existsSync('data/preview/ventas.jsonl')){
 const ventas=Array.from({length:36},(_,i)=>{const fecha=new Date(Date.now()-i*2*86400000).toISOString(),productos=[CATALOGO_DEMO[i%3],CATALOGO_DEMO[14]];const lineas=productos.map(p=>({productId:p.id,nombre:p.nombre,cantidad:1,total:p.precioFinal,iva:p.iva,costo:p.costo}));const total=lineas.reduce((s,l)=>s+l.total,0);return {fecha,numero:`DEMO-${i+1}`,idComprobante:`preview-${i}`,cae:'SIMULADO',total,lineas,metodoPago:'efectivo',cobranza:i%5?{estado:'registrada',modalidad:'manual',fecha,pagos:[{FormaDePago:'Efectivo',Importe:total}]}:{estado:'pendiente',modalidad:'manual'}};});
 fs.writeFileSync('data/preview/ventas.jsonl',ventas.map(v=>JSON.stringify(v)).join('\n')+'\n');
}
const child=spawn(process.execPath,['server/index.js'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code||0;});
