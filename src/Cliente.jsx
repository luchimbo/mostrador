import { useCallback, useEffect, useRef, useState } from "react";
import { pesos, useEstado } from "./lib.js";
import { esOferta, secuenciaReposo } from "../shared/display.js";
import YouTube from "./YouTube.jsx";

export default function Cliente() {
  const { estado } = useEstado();
  if (!estado) return <div className="cliente idle" />;

  return (
    <div className="cliente">
      {estado.fase !== "gracias" && (
        <header className="marca">
          <img className="logo" src="/logo.png" alt="PC MIDI Center" />
          <span className="web">pcmidi.com.ar</span>
        </header>
      )}
      {estado.fase === "idle" && <Reposo key={JSON.stringify(estado.reposo)} estado={estado} />}
      {["venta", "facturando", "cobranza", "cobrando"].includes(estado.fase) && <Venta estado={estado} />}
      {estado.fase === "gracias" && <Gracias factura={estado.factura} opinionUrl={estado.opinionUrl} />}
      {estado.fase === "facturando" && (
        <div className="overlay">
          <div className="spinner" />
          <p>{estado.sinFactura ? "Registrando tu compra…" : "Emitiendo tu factura…"}</p>
        </div>
      )}
    </div>
  );
}

function Reposo({ estado }) {
  const [i, setI] = useState(0);
  const [fallidos, setFallidos] = useState(() => new Set());
  const reposo = estado.reposo;
  const slides = secuenciaReposo(reposo?.productos || estado.destacados, (reposo?.videos || []).filter((v) => !fallidos.has(v.id)), reposo?.productosEntreVideos);
  const slide = slides[i % slides.length];
  const avanzar = useCallback(() => setI((n) => n + 1), []);
  const fallar = () => {
    setFallidos((prev) => new Set([...prev, slide.video.id]));
    avanzar();
  };
  useEffect(() => {
    if (slide.tipo === "video" || slides.length < 2) return;
    const t = setTimeout(avanzar, estado.segundosPorSlide * 1000);
    return () => clearTimeout(t);
  }, [i, slide.tipo, slides.length, estado.segundosPorSlide, avanzar]);

  const p = slide.producto;
  const pct = estado.totales.descuentoContadoPct;
  return (
    <div className={`reposo ${slide.tipo === "video" ? "reposo-video" : ""}`}>
      {slide.tipo === "video" ? (
        <div className={`video-slide ${slide.video.producto ? "con-producto" : ""}`}>
          <YouTube key={`${slide.id}-${i}`} video={slide.video} segundos={reposo.segundosPorVideo} onFin={avanzar} onError={fallar} />
          {slide.video.producto && <aside className="video-producto">
            <span className="rubro">Conocé tu próximo equipo</span>
            {slide.video.producto.imagen && <img src={slide.video.producto.imagen} alt="" />}
            <h1>{slide.video.producto.nombre}</h1>
            <p className="precio">{pesos(slide.video.producto.precioFinal)}</p>
            <p className="contado">{pesos(slide.video.producto.precioFinal * (1 - pct / 100))} en efectivo o transferencia</p>
          </aside>}
          <span className="video-etiqueta">{slide.video.titulo || "Conocé nuestros equipos"} · Sin sonido</span>
        </div>
      ) : p ? (
        <div className="slide producto-slide" key={`${p.id}-${i}`}>
          {p.imagen && (
            <div className="foto-grande">
              <img src={p.imagen} alt="" />
            </div>
          )}
          <div className="slide-info">
          <span className="rubro">{esOferta(p) ? "Oferta en nuestra tienda" : p.rubro}</span>
          <h1>{p.nombre}</h1>
          {esOferta(p) && <div className="oferta-anterior"><s>{pesos(p.precioLista)}</s><span className="oferta-badge">−{Math.round((1 - p.precioFinal / p.precioLista) * 100)}%</span></div>}
          <p className="precio">{pesos(p.precioFinal)}</p>
          {esOferta(p) && <p className="oferta-ahorro">Ahorrás {pesos(p.precioLista - p.precioFinal)}</p>}
          <p className="contado">
            {pesos(p.precioFinal * (1 - pct / 100))} en efectivo o transferencia
          </p>
          </div>
        </div>
      ) : (
        <img className="logo-grande" src="/logo.png" alt="PC MIDI Center" />
      )}
      <p className="pie">{pct}% de descuento pagando en efectivo o transferencia</p>
    </div>
  );
}

function Venta({ estado }) {
  const { totales } = estado;
  // Si la lista no entra en pantalla, mostrar siempre lo último que se agregó.
  const lista = useRef(null);
  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [estado.lines.length]);
  return (
    <div className={`venta ${estado.lines.length >= 3 ? "compacta" : ""} ${estado.lines.length >= 5 ? "larga" : ""}`}>
      <section className="items">
        <h2>Tu compra</h2>
        <ul ref={lista}>
          {estado.lines.map((l) => (
            <li key={l.lineId} className={l.recomendado && l.descuentoPct > 0 ? "con-descuento" : ""}>
              <span className="miniatura">{l.imagen && <img src={l.imagen} alt="" />}</span>
              <span className="cant">{l.cantidad}×</span>
              <span className="nombre">
                <span className="texto">{l.nombre}</span>
                {l.descuentoPct > 0 && <span className="badge">-{l.descuentoPct}% combo</span>}
              </span>
              <span className="importe">
                {l.descuento > 0 && <s>{pesos(l.bruto)}</s>}
                {pesos(l.total)}
              </span>
            </li>
          ))}
        </ul>
        <div className="totales-cliente">
          {totales.descuentoRecomendaciones > 0 && (
            <div className="ahorro">Ahorrás {pesos(totales.descuentoRecomendaciones + totales.descuentoContado - Math.min(totales.ajuste || 0, 0))}</div>
          )}
          {totales.aplicaContado || totales.ajuste < 0 ? (
            <>
              {totales.aplicaContado && (
                <div className="fila">
                  <span>Descuento {estado.transferencia ? "transferencia" : estado.metodoPago} {totales.descuentoContadoPct}%</span>
                  <span>−{pesos(totales.descuentoContado)}</span>
                </div>
              )}
              {totales.ajuste < 0 && (
                <div className="fila">
                  <span>Redondeo</span>
                  <span>−{pesos(-totales.ajuste)}</span>
                </div>
              )}
              <div className="total">
                <span>Total</span>
                <span>{pesos(totales.totalAPagar)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="total">
                <span>Total</span>
                <span>{pesos(totales.total)}</span>
              </div>
              {!estado.metodoPago && (
                <div className="fila contado">
                  <span>En efectivo o transferencia</span>
                  <span>{pesos(totales.totalContado)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {estado.sugerencias.length > 0 && (
        <section className="recomendados">
          <h2>Para completar tu equipo</h2>
          {estado.sugerencias.map((s) => (
            <div key={s.productId} className="card">
              {s.imagen && <img src={s.imagen} alt="" />}
              <div>
                <span className="motivo">{s.motivo}</span>
                <span className="nombre">{s.nombre}</span>
                {s.precioFinal > s.precioConDescuento && (
                  <span className="ahorro-sugerencia">Te ahorrás <strong>{pesos(s.precioFinal - s.precioConDescuento)}</strong></span>
                )}
                <span className="precio">
                  {s.descuentoPct > 0 && <s>{pesos(s.precioFinal)}</s>}
                  {pesos(s.precioConDescuento)}
                </span>
              </div>
              {s.descuentoPct > 0 && <span className="off">-{s.descuentoPct}%</span>}
            </div>
          ))}
          <p className="aclaracion">Descuento válido llevándolo en esta compra. ¡Pedíselo al vendedor!</p>
        </section>
      )}
    </div>
  );
}

function Gracias({ factura, opinionUrl }) {
  return (
    <div className="gracias">
      <img className="logo-gracias" src="/logo.png" alt="PC MIDI Center" />
      <h1>¡Gracias por tu compra{factura.cliente.nombre && factura.cliente.nombre !== "Consumidor Final" ? `, ${factura.cliente.nombre}` : ""}!</h1>
      <div className="gracias-codigos">
      {opinionUrl && <div className="qr qr-opinion">
        <div className="estrellas" aria-label="Cinco estrellas decorativas">★★★★★</div>
        <h2>¿Cómo fue tu experiencia?</h2>
        <img src={`/api/opinion/qr?v=${encodeURIComponent(opinionUrl)}`} alt="QR para dejar una opinión en Google" />
        <span>Escaneá y dejá tu opinión en Google</span>
      </div>}
      </div>
    </div>
  );
}
