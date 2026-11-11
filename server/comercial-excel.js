import ExcelJS from 'exceljs';
export async function exportarComercial(informe){
 const libro=new ExcelJS.Workbook();
 const tablas={Resumen:Object.entries(informe.resumen).map(([indicador,valor])=>({indicador,valor})),Operaciones:informe.operaciones.map(v=>({fecha:v.fecha,comprobante:v.numero||v.idComprobante,total:v.total})),Pagos:informe.pagos,Combinaciones:informe.combinaciones};
 for(const [nombre,filas] of Object.entries(tablas)){const hoja=libro.addWorksheet(nombre,{views:[{state:'frozen',ySplit:1}]});const claves=[...new Set(filas.flatMap(f=>Object.keys(f)))];hoja.columns=claves.map(key=>({header:key,key,width:24}));hoja.addRows(filas);hoja.getRow(1).font={bold:true};if(claves.length)hoja.autoFilter={from:'A1',to:{row:1,column:claves.length}};}
 const cobertura=libro.addWorksheet('Cobertura');cobertura.addRow(['Canal',informe.canal]);cobertura.addRow(['Desde',informe.periodo.desde||'Todo']);cobertura.addRow(['Hasta',informe.periodo.hasta||'Todo']);for(const [k,v] of Object.entries(informe.cobertura))cobertura.addRow([k,v]);return libro.xlsx.writeBuffer();
}
