import { useState } from "react";

export default function Login() {
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave }) });
      if (res.ok) return window.location.reload();
      setError((await res.json()).error || "No se pudo iniciar sesión.");
    } catch {
      setError("No se pudo conectar con el servidor.");
    }
    setEnviando(false);
  }

  return (
    <form className="inicio" onSubmit={entrar}>
      <h1>Mostrador · PC MIDI Center</h1>
      <label htmlFor="clave">Contraseña</label>
      <input id="clave" type="password" autoComplete="current-password" autoFocus value={clave} onChange={(e) => setClave(e.target.value)} />
      {error && <div className="aviso error">{error}</div>}
      <button type="submit" className="primario" disabled={enviando || !clave}>Entrar</button>
    </form>
  );
}
