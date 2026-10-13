import { createRoot } from "react-dom/client";
import Admin from "./Admin.jsx";
import Cliente from "./Cliente.jsx";
import Login from "./Login.jsx";
import Vendedor from "./Vendedor.jsx";
import { socket } from "./lib.js";
import "./styles.css";

const pantallas = { "/vendedor": Vendedor, "/cliente": Cliente, "/admin": Admin };
const Pantalla = pantallas[window.location.pathname] || Inicio;

// Si el servidor no responde se muestra la pantalla igual: avisa sola que está sin conexión.
const sesion = await fetch("/api/sesion").then((r) => r.json()).catch(() => ({ ok: true }));
if (sesion.ok) socket.connect();

async function salir() {
  await fetch("/api/logout", { method: "POST" });
  window.location.reload();
}

function Inicio() {
  return (
    <div className="inicio">
      <h1>Mostrador · PC MIDI Center</h1>
      <a href="/vendedor">Pantalla del vendedor</a>
      <a href="/cliente">Pantalla del cliente</a>
      <a href="/admin">Recomendaciones y ajustes</a>
      {sesion.requerida && <button type="button" className="secundario" onClick={salir}>Cerrar sesión</button>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(sesion.ok ? <Pantalla /> : <Login />);
