import { useEffect, useState } from "react";
import { socket } from "./lib.js";

export default function MensajeVendedor() {
  const [mensaje, setMensaje] = useState(null);
  useEffect(() => {
    const recibir = (datos) => setMensaje(datos.texto);
    socket.on("mensaje-vendedor", recibir);
    return () => socket.off("mensaje-vendedor", recibir);
  }, []);
  if (!mensaje) return null;
  return <aside className="mensaje-vendedor" aria-label="Mensaje de supervisión">
    <div role="status"><strong>Un mensaje para vos 👀</strong><p>{mensaje}</p></div>
    <button type="button" onClick={() => setMensaje(null)} aria-label="Cerrar mensaje">×</button>
  </aside>;
}
