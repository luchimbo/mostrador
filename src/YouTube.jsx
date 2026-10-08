import { useEffect, useRef, useState } from "react";
import { youtubeId } from "../shared/display.js";

let apiPromise;
function cargarYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => fail(), 10000);
    function fail() {
      clearTimeout(timeout);
      script.remove();
      apiPromise = null;
      reject(new Error("YouTube no está disponible"));
    }
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve(window.YT);
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return apiPromise;
}

export default function YouTube({ video, segundos, onFin, onError }) {
  const contenedor = useRef(null);
  const callbacks = useRef({ onFin, onError });
  const [cargando, setCargando] = useState(true);
  useEffect(() => { callbacks.current = { onFin, onError }; }, [onFin, onError]);
  const { url, inicio, fin } = video;
  useEffect(() => {
    let player, timer, watchdog, terminado = false, desmontado = false, iniciado = false;
    const duracion = fin != null ? fin - inicio : segundos;
    const terminar = (error = false) => {
      if (terminado || desmontado) return;
      terminado = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      if (error) callbacks.current.onError();
      else callbacks.current.onFin();
    };
    watchdog = setTimeout(() => terminar(true), 12000);
    const mount = document.createElement("div");
    contenedor.current.appendChild(mount);
    cargarYouTube().then((YT) => {
      if (desmontado || terminado) return;
      player = new YT.Player(mount, {
        videoId: youtubeId(url),
        width: "100%", height: "100%",
        playerVars: { controls: 0, playsinline: 1, rel: 0, disablekb: 1, origin: window.location.origin },
        events: {
          onReady: ({ target }) => {
            target.mute();
            target.getIframe().setAttribute("title", "Demostración del producto sin sonido");
            target.getIframe().setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
            target.loadVideoById({ videoId: youtubeId(url), startSeconds: inicio, endSeconds: inicio + duracion });
          },
          onStateChange: ({ data }) => {
            if (data === YT.PlayerState.PLAYING) {
              clearTimeout(watchdog);
              setCargando(false);
              if (!iniciado) {
                iniciado = true;
                timer = setTimeout(() => terminar(), duracion * 1000);
              }
            } else if (data === YT.PlayerState.ENDED) terminar();
            else if (data === YT.PlayerState.BUFFERING || data === YT.PlayerState.PAUSED) {
              clearTimeout(watchdog);
              watchdog = setTimeout(() => terminar(true), 12000);
            }
          },
          onError: () => terminar(true),
          onAutoplayBlocked: () => terminar(true),
        },
      });
    }).catch(() => terminar(true));
    return () => {
      desmontado = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      player?.destroy();
      mount.remove();
    };
  }, [url, inicio, fin, segundos]);
  return <div className="video-player">
    <div ref={contenedor} className="video-mount" />
    {cargando && <div className="video-cargando"><div className="spinner" /><span>Cargando demostración…</span></div>}
  </div>;
}
