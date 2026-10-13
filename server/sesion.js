// Acceso con una contraseña compartida (CLAVE_ACCESO en el .env).
// La sesión es una cookie firmada con la contraseña: no se guarda en el servidor, así que sobrevive
// a reinicios y despliegues. Cambiar la contraseña cierra todas las sesiones abiertas.
import crypto from "node:crypto";

export const COOKIE = "mostrador_sesion";
export const DURACION_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (texto) => crypto.createHash("sha256").update(String(texto)).digest();
const firmar = (clave, vence) => crypto.createHmac("sha256", hash(`mostrador-sesion:${clave}`)).update(String(vence)).digest("hex");

export function claveCorrecta(clave, ingresada) {
  return typeof ingresada === "string" && crypto.timingSafeEqual(hash(clave), hash(ingresada));
}

export function crearSesion(clave, ahora = Date.now()) {
  const vence = ahora + DURACION_MS;
  return `${vence}.${firmar(clave, vence)}`;
}

export function sesionValida(clave, sesion, ahora = Date.now()) {
  const [vence, firma] = String(sesion || "").split(".");
  if (!/^\d+$/.test(vence) || Number(vence) <= ahora) return false;
  return crypto.timingSafeEqual(hash(firma), hash(firmar(clave, vence)));
}

export function leerCookie(cabecera, nombre = COOKIE) {
  for (const parte of String(cabecera || "").split(";")) {
    const [clave, ...valor] = parte.trim().split("=");
    if (clave === nombre) return valor.join("=");
  }
  return "";
}

// Freno a quien prueba contraseñas: después de varios intentos fallidos desde una misma dirección, hay que esperar.
export function crearLimite({ maximo = 8, esperaMs = 15 * 60_000 } = {}) {
  const fallos = new Map();
  return {
    bloqueado(ip, ahora = Date.now()) {
      const f = fallos.get(ip);
      if (f && ahora - f.ultimo > esperaMs) fallos.delete(ip);
      return (fallos.get(ip)?.cantidad || 0) >= maximo;
    },
    fallo(ip, ahora = Date.now()) {
      fallos.set(ip, { cantidad: (fallos.get(ip)?.cantidad || 0) + 1, ultimo: ahora });
    },
    acierto(ip) {
      fallos.delete(ip);
    },
  };
}
