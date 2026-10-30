// Punto de entrada: la API y el WebSocket van a la Sala (un único Durable Object
// que guarda todo y reparte los mensajes); lo demás son archivos de public/.
export { Sala } from "./sala.js";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" || url.pathname.startsWith("/api/")) {
      const id = env.SALA.idFromName("principal");
      // "sam" = Sudamérica: la sala se crea cerca del público la primera vez.
      return env.SALA.get(id, { locationHint: "sam" }).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
