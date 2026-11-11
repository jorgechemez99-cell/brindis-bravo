// Service worker mínimo de la app de control: no guarda nada (el show tiene que ser siempre en vivo),
// sólo existe para que la tablet la pueda instalar como app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (ev) => {
  if (ev.request.mode !== "navigate") return;
  ev.respondWith(
    fetch(ev.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:20px system-ui;background:#1c1a19;color:#f8efe8;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">Sin conexión.<br>Revisá el wifi de la tablet y volvé a abrir la app.</body>',
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        )
    )
  );
});
