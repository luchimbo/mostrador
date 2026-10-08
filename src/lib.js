import { useEffect, useState } from "react";
import { io } from "socket.io-client";

export const socket = io();

// El servidor manda el estado apenas conecta, a veces antes de que React monte:
// guardamos el último recibido para no perderlo.
let ultimoEstado = null;
socket.on("estado", (e) => (ultimoEstado = e));

export function useEstado() {
  const [estado, setEstado] = useState(ultimoEstado);
  const [conectado, setConectado] = useState(socket.connected);
  useEffect(() => {
    const onEstado = (e) => setEstado(e);
    const onConnect = () => setConectado(true);
    const onDisconnect = () => setConectado(false);
    socket.on("estado", onEstado);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (ultimoEstado) setEstado(ultimoEstado);
    setConectado(socket.connected);
    return () => {
      socket.off("estado", onEstado);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);
  return { estado, conectado };
}

export function accion(tipo, datos = {}) {
  return new Promise((resolve) => socket.emit("accion", { tipo, ...datos }, resolve));
}

const formato = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
export const pesos = (n) => formato.format(n || 0).replace(/,00$/, "");

const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function buscar(productos, texto) {
  const tokens = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!tokens.length) return productos;
  return productos.filter((p) => {
    const hay = normalizar(`${p.nombre} ${p.nombreFactura || ""} ${p.codigo} ${p.rubro} ${p.subrubro || ""}`);
    return tokens.every((t) => hay.includes(t));
  });
}

export async function api(ruta, opciones = {}) {
  const res = await fetch(`/api${ruta}`, {
    headers: { "Content-Type": "application/json" },
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error del servidor");
  return data;
}
