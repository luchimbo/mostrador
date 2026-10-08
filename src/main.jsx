import { createRoot } from "react-dom/client";
import Admin from "./Admin.jsx";
import Cliente from "./Cliente.jsx";
import Vendedor from "./Vendedor.jsx";
import "./styles.css";

const pantallas = { "/vendedor": Vendedor, "/cliente": Cliente, "/admin": Admin };
const Pantalla = pantallas[window.location.pathname] || Inicio;

function Inicio() {
  return (
    <div className="inicio">
      <h1>Mostrador · PC MIDI Center</h1>
      <a href="/vendedor">Pantalla del vendedor</a>
      <a href="/cliente">Pantalla del cliente</a>
      <a href="/admin">Recomendaciones y ajustes</a>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Pantalla />);
