// El código es un easter egg dentro de la sesión del mostrador, no otra contraseña.
export function registrarMensajes(io, socket) {
  if (socket.handshake.auth.pantalla === "vendedor" && !socket.handshake.auth.soloLectura) socket.join("vendedores");
  let ultimoEnvio = 0;
  socket.on("mensaje-vendedor", (datos, ack = () => {}) => {
    if (typeof ack !== "function") return;
    if (!socket.handshake.auth.soloLectura || datos?.codigo !== "joaquito") return ack({ ok: false, error: "Código incorrecto o pantalla no habilitada." });
    const texto = typeof datos.texto === "string" ? datos.texto.trim() : "";
    if (!texto || texto.length > 280) return ack({ ok: false, error: "Escribí un mensaje de hasta 280 caracteres." });
    if (Date.now() - ultimoEnvio < 3000) return ack({ ok: false, error: "Esperá unos segundos antes de enviar otro mensaje." });
    const destinos = io.sockets.adapter.rooms.get("vendedores")?.size || 0;
    if (!destinos) return ack({ ok: false, error: "No hay una pantalla del vendedor conectada." });
    ultimoEnvio = Date.now();
    io.to("vendedores").emit("mensaje-vendedor", { texto });
    ack({ ok: true, pantallas: destinos });
  });
}
