// Modo prueba: catálogo de ejemplo y Contabilium simulado.
// Nada de lo que pasa acá llega a Contabilium ni a ARCA.

// Productos reales de pcmidi.com.ar (SKU, nombre y precio de la tienda; el costo es ficticio).
const p = (id, codigo, nombre, rubro, precioFinal) => ({
  id: String(id), codigo, nombre, rubro, precioFinal, iva: 21, costo: Math.round(precioFinal * 0.55), stock: 5, imagen: null, activo: true,
});

export const CATALOGO_DEMO = [
  p(101, "ZTO115", "Arturia MiniLab 3 Controlador MIDI 25 Teclas", "Controladores MIDI", 208260),
  p(102, "ZTO120", "Arturia KeyLab Essential 61 MK3 Black", "Controladores MIDI", 568324),
  p(103, "ZTT058", "Midiplus AKM320 Controlador MIDI 32 Teclas", "Controladores MIDI", 112931),
  p(104, "SYN007", "Synido TempoPAD P-16 Controlador MIDI", "Controladores MIDI", 241404),
  p(201, "KRE001", "Piano Digital Kressmer LM-200 88 Teclas", "Órganos y Pianos", 237710),
  p(202, "MKT012", "Piano Digital 88 Teclas MK885", "Órganos y Pianos", 326666),
  p(203, "MKT007", "Teclado Musical MK922 61 Teclas", "Órganos y Pianos", 135467),
  p(301, "ZTO116", "Arturia MiniFreak Sintetizador Híbrido", "Sintetizadores", 826465),
  p(302, "ZTO065", "Arturia BeatStep Controlador y Secuenciador", "Sintetizadores", 204869),
  p(401, "AUA006", "Micrófono Condensador Midiplus MC1", "Micrófonos", 189728),
  p(402, "PAT001", "Micrófono Condensador Audio-Technica AT2020", "Micrófonos", 248642),
  p(403, "PAC004", "Micrófono Condensador USB Alctron K5", "Micrófonos", 56449),
  p(501, "ZAT201", "Placa de Sonido USB Midiplus Studio 2", "Interfaces", 153078),
  p(502, "ZTO017", "Placa de Sonido Arturia MiniFuse 1 Black", "Interfaces", 242761),
  p(601, "PAC027", "Auriculares de Monitoreo Alctron HP1200", "Auriculares y monitores", 48248),
  p(602, "OAC010", "Auricular Profesional de Estudio Alctron HE580", "Auriculares y monitores", 86132),
  p(701, "ZRR087", "Monitores de Estudio Midiplus MI3 V2 (par)", "Auriculares y monitores", 421021),
  p(801, "YOS003", "Guitarra Criolla Midiplus MC100 4/4 con Funda", "Instrumentos de Cuerda", 93877),
  p(802, "ENP035", "Ukelele Soprano Acústico Midiplus", "Instrumentos de Cuerda", 44506),
  p(901, "ZCS001", "Soporte de Mesa Tijera para Teclado", "Accesorios", 34648),
  p(902, "ZCT004", "Banqueta Meike para Piano Regulable", "Accesorios", 34000),
  p(903, "ZCT006", "Funda para Teclado MK", "Accesorios", 35800),
  p(904, "FZC020", "Cable MIDI 2 m Midiplus", "Accesorios", 11934),
  p(905, "PAC020", "Brazo Articulado para Micrófono Alctron MA614B", "Accesorios", 109047),
  p(906, "AIS020", "Filtro Antipop PF-08 Cuello de Ganso", "Accesorios", 7392),
  p(907, "ZCH004", "Cable XLR Canon Balanceado para Micrófono", "Accesorios", 11334),
  p(908, "CAC004", "Pie de Micrófono de Mesa Alctron SM316", "Accesorios", 27298),
  p(909, "AIS022", "Afinador Digital Cromático Clip Midiplus", "Accesorios", 6839),
  p(910, "AIS021", "Capotraste Midiplus AC8", "Accesorios", 12628),
  p(911, "ENP038", "Soporte de Pared para Guitarra", "Accesorios", 19712),
  p(912, "ZFO002", "Software Arturia Analog Lab (licencia)", "Software", 127772),
];

// Reglas de ejemplo. Los productos sugeridos se identifican por Id del catálogo de prueba;
// en modo real se traducen a productos de Contabilium por SKU (ver reglasInicialesReales).
export const REGLAS_DEMO = [
  { id: "r1", nombre: "Controladores MIDI", activa: true, disparador: { tipo: "rubro", valor: "Controladores MIDI" }, sugeridos: ["912", "601", "901"], descuentoPct: 10 },
  { id: "r2", nombre: "Pianos", activa: true, disparador: { tipo: "subrubro", valor: "Organos y Pianos › Pianos" }, sugeridos: ["902", "901", "903", "601"], descuentoPct: 10 },
  { id: "r3", nombre: "Sintetizadores", activa: true, disparador: { tipo: "subrubro", valor: "Sintetizadores › Sintes Analógicos e híbridos" }, sugeridos: ["904", "602", "912"], descuentoPct: 10 },
  { id: "r4", nombre: "Micrófonos", activa: true, disparador: { tipo: "rubro", valor: "Micrófonos" }, sugeridos: ["905", "906", "907", "501"], descuentoPct: 10 },
  { id: "r5", nombre: "Interfaces", activa: true, disparador: { tipo: "rubro", valor: "Interfaces" }, sugeridos: ["701", "602", "907"], descuentoPct: 8 },
  { id: "r6", nombre: "Instrumentos de Cuerda", activa: true, disparador: { tipo: "rubro", valor: "Instrumentos de Cuerda" }, sugeridos: ["909", "910", "911"], descuentoPct: 15 },
];

export function reglasInicialesReales(productosReales) {
  const idPorSku = new Map(productosReales.map((p) => [String(p.codigo).toUpperCase(), String(p.id)]));
  const skuDemo = new Map(CATALOGO_DEMO.map((p) => [p.id, p.codigo]));
  return REGLAS_DEMO.map((r) => ({
    ...r,
    sugeridos: r.sugeridos.map((id) => idPorSku.get(skuDemo.get(id))).filter(Boolean),
  })).filter((r) => r.sugeridos.length);
}

const CLIENTES_DEMO = [
  { Id: 1, RazonSocial: "Estudio Sonoro SRL", TipoDoc: "CUIT", NroDoc: "30712345671", CondicionIva: "RI" },
  { Id: 2, RazonSocial: "Juan Pérez", TipoDoc: "CUIT", NroDoc: "20123456786", CondicionIva: "MO" },
];
let nextClienteId = 100;
let nextNumero = 1;
const comprobantesPrueba = new Map();

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function descargarCatalogo() {
  return CATALOGO_DEMO;
}

export async function buscarClientePorDocumento(documento) {
  return CLIENTES_DEMO.find((c) => c.NroDoc === documento) || null;
}

export async function crearCliente(datos) {
  const cliente = { Id: nextClienteId++, RazonSocial: datos.razonSocial, TipoDoc: datos.tipoDoc, NroDoc: datos.documento, CondicionIva: datos.condicionIva };
  CLIENTES_DEMO.push(cliente);
  return cliente.Id;
}

export async function emitirFactura(payload) {
  await esperar(1500);
  const numero = String(nextNumero++).padStart(8, "0");
  const cae = `PRUEBA${Date.now()}`.slice(0, 14);
  const total = payload.Items.reduce((sum, l) => sum + l.Cantidad * l.PrecioUnitario * (1 + l.Iva / 100) * (1 - l.Bonificacion / 100), 0);
  comprobantesPrueba.set(900000 + Number(numero), { Cae: cae, ImporteTotalNeto: Math.round(total * 100) / 100, Saldo: Math.round(total * 100) / 100 });
  return {
    idComprobante: 900000 + Number(numero),
    cae,
    numero: `${payload.TipoFc === "FCA" ? "A" : "B"}-0099-${numero}`,
    vencimientoCae: null,
    url: "https://pcmidi.com.ar",
    errores: "",
    total: Math.round(total * 100) / 100,
  };
}

export const emitirFacturaCobrada = emitirFactura;
export async function obtenerConfiguracionFacturacion(metodo) {
  return { condicionVenta: metodo === "mercadopago" ? "MercadoPago" : metodo === "otros" ? "Otro" : "Efectivo", automatico: metodo === "mercadopago" };
}
export async function consultarComprobante(id) { return comprobantesPrueba.get(id); }
export async function cobrarComprobante(payload) { comprobantesPrueba.get(payload.Id).Saldo = 0; }
