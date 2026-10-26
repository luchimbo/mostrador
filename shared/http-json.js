// No mostrar el error del parser cuando un proxy o una ruta devuelve HTML.
export async function responseJson(response, service = "El servidor") {
  let data;
  try { data = await response.json(); }
  catch {
    throw new Error(`${service} devolvió una respuesta no válida (HTTP ${response.status}). Volvé a intentar; si persiste, revisá la versión del servidor.`);
  }
  if (!response.ok) throw new Error(`${data?.error || `${service} no pudo procesar la solicitud`} (HTTP ${response.status})`);
  return data;
}
