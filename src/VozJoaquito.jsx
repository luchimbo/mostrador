import { useEffect, useRef, useState } from "react";
import { socket } from "./lib.js";
import { crearDetectorProductos, FRASES_JOAQUITO } from "../shared/voz.js";

export default function VozJoaquito({ estado }) {
  const [activa, setActiva] = useState(false);
  const [error, setError] = useState("");
  const ultimoEstado = useRef(estado);
  const siguienteFrase = useRef(0);
  const compatible = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  useEffect(() => { ultimoEstado.current = estado; }, [estado]);

  function decir(texto) {
    const voz = new SpeechSynthesisUtterance(texto);
    voz.lang = "es-AR";
    const voces = window.speechSynthesis.getVoices();
    voz.voice = voces.find((v) => v.lang.toLowerCase() === "es-ar") || voces.find((v) => v.lang.toLowerCase().startsWith("es")) || null;
    voz.rate = 1.05;
    voz.onerror = (e) => {
      if (!["canceled", "interrupted"].includes(e.error)) setError("No se pudo reproducir la voz. Probá silenciarla y activarla de nuevo.");
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(voz);
  }

  useEffect(() => {
    if (!activa || !compatible) return;
    const detector = crearDetectorProductos();
    if (socket.connected && ultimoEstado.current) detector.recibir(ultimoEstado.current);
    const recibir = (nuevoEstado) => {
      if (detector.recibir(nuevoEstado)) {
        decir(FRASES_JOAQUITO[siguienteFrase.current % FRASES_JOAQUITO.length]);
        siguienteFrase.current += 1;
      }
    };
    const reiniciar = () => { detector.reiniciar(); window.speechSynthesis.cancel(); };
    socket.on("estado", recibir);
    socket.on("disconnect", reiniciar);
    socket.on("connect", reiniciar);
    return () => {
      socket.off("estado", recibir);
      socket.off("disconnect", reiniciar);
      socket.off("connect", reiniciar);
      window.speechSynthesis.cancel();
    };
  }, [activa, compatible]);

  function alternar() {
    setError("");
    if (activa) window.speechSynthesis.cancel();
    else decir("¡La hinchada de Joaquito está lista!");
    setActiva(!activa);
  }

  return <div className="voz-joaquito">
    <button type="button" disabled={!compatible} onClick={alternar} aria-pressed={activa}>
      {activa ? "Silenciar voz de Joaquito" : "Activar voz de Joaquito"}
    </button>
    <p>{compatible ? "Festeja los productos que se suman. Suena solo en esta pestaña de Supervisión." : "Este navegador no tiene voz disponible."}</p>
    {error && <p role="status" className="aviso error">{error}</p>}
  </div>;
}
