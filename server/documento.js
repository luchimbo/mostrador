// Clasificación y validación de DNI / CUIT.

export function validarCuit(cuit) {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(cuit[10]);
}

// Devuelve { tipo: "DNI" | "CUIT", documento } o lanza un error legible.
export function clasificarDocumento(entrada) {
  const documento = String(entrada || "").replace(/\D/g, "");
  if (!documento) throw new Error("Ingresá el DNI o CUIT del cliente para facturar.");
  if (documento.length === 7 || documento.length === 8) return { tipo: "DNI", documento };
  if (documento.length === 11) {
    if (!validarCuit(documento)) throw new Error("El CUIT ingresado no es válido (revisá los números).");
    return { tipo: "CUIT", documento };
  }
  throw new Error("Ingresá un DNI (7-8 dígitos) o un CUIT (11 dígitos).");
}

// Emisor Responsable Inscripto: Factura A a RI y Monotributistas (RG 5003), B al resto.
export function tipoFactura(condicionIvaReceptor) {
  return condicionIvaReceptor === "RI" || condicionIvaReceptor === "MO" ? "FCA" : "FCB";
}

export function formatearDocumento({ tipo, documento }) {
  if (tipo === "CUIT") return `CUIT ${documento.slice(0, 2)}-${documento.slice(2, 10)}-${documento.slice(10)}`;
  if (tipo === "DNI") return `DNI ${Number(documento).toLocaleString("es-AR")}`;
  return "";
}
