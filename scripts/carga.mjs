// Prueba de carga: simula N celulares (cada uno con su cuenta) mandando mensajes,
// leyendo el chat y votando, más una pantalla que mide cuánto tarda cada mensaje
// en aparecer.
//
//   npm run carga                                  (contra el servidor local)
//   BASE=https://... N=150 SEG=45 npm run carga    (pide la clave del admin)
//
// Crea un programa "Prueba de carga" y lo pone como programa de ahora. Al terminar
// vuelve al programa que estaba, lo borra (con sus mensajes y su encuesta) y borra
// las cuentas de prueba. Si hay gente conectada no corre, para no meterse en un show.
import { readFileSync } from "node:fs";
import { pedirClave, clienteApi } from "./util.mjs";

const BASE = (process.env.BASE || "http://localhost:8790").replace(/\/$/, "");
const N = Number(process.env.N || 150);
const SEG = Number(process.env.SEG || 45);
let CLAVE = process.env.ADMIN_PASSWORD;
if (!CLAVE && BASE.includes("localhost")) {
  try {
    CLAVE = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/ADMIN_PASSWORD=(.*)/)[1].trim();
  } catch {}
}
if (!CLAVE) CLAVE = await pedirClave("Clave del admin: ");
const WS = BASE.replace(/^http/, "ws") + "/ws?";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const api = clienteApi(BASE);

function abrir(consulta, alMensaje, cookie) {
  return new Promise((resolver, rechazar) => {
    const ws = new WebSocket(WS + consulta, cookie ? { headers: { Cookie: cookie, Origin: BASE } } : undefined);
    ws.onopen = () => resolver(ws);
    ws.onerror = () => rechazar(new Error("no conectó"));
    ws.onmessage = (ev) => ev.data !== "pong" && alMensaje(JSON.parse(ev.data));
  });
}

const r = { enviados: 0, ok: 0, errores: {}, reenvios: 0, enPantalla: 0, latencias: [], conexionesFallidas: 0, leidosEnCelus: 0 };

await api.post("login", { usuario: "admin", clave: CLAVE });
const inicial = await api.get("estado");
if (inicial.conteo.publico > 0 && !process.env.FORZAR) {
  console.log(`Hay ${inicial.conteo.publico} celulares conectados: no corro para no meterme en un show (FORZAR=1 para correr igual).`);
  process.exit(1);
}
const { id: programa } = await api.post("programa/crear", { nombre: "Prueba de carga" });
await api.post("aire", { programa });
await api.post("intervalo", { valor: 2 });

// Pantalla que mide cuánto tarda cada mensaje en aparecer.
let votosPantalla = null;
let encuestaId = null;
const pantalla = await abrir("rol=pantalla", (m) => {
  if (m.t === "msg") {
    const t = /@(\d+)$/.exec(m.m.texto);
    if (t) {
      r.enPantalla++;
      r.latencias.push(Date.now() - Number(t[1]));
    }
  }
  if (m.t === "votos" && m.encuesta === encuestaId) votosPantalla = m.conteos;
});

try {
  console.log(`${N} celulares · ${SEG} s · ${BASE}`);
  const celus = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const disp = "carga-" + i.toString().padStart(4, "0") + "-" + Math.random().toString(36).slice(2, 8);
    const celu = { i, ws: null, ultimo: null };
    try {
      // Cada celu se crea su cuenta, como la gente al escanear el QR.
      const resp = await fetch(BASE + "/api/chat/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE },
        body: JSON.stringify({ nick: "Carga " + disp.slice(6), clave: "carga-" + i, disp }),
      });
      if (!resp.ok) throw new Error("no se pudo crear la cuenta");
      const cookie = resp.headers.getSetCookie()[0].split(";")[0];
      celu.ws = await abrir(
        "rol=publico&disp=" + disp,
        (m) => {
          if (m.t === "msg") r.leidosEnCelus++;
          if (m.t !== "ack") return;
          if (m.ok) r.ok++;
          else r.errores[m.error] = (r.errores[m.error] || 0) + 1;
        },
        cookie
      );
      celus.push(celu);
    } catch {
      r.conexionesFallidas++;
    }
    if (i % 25 === 0) await espera(50);
  }
  console.log(`Conectados ${celus.length}/${N} en ${Date.now() - t0} ms`);

  function mandar(celu, reenviar) {
    if (celu.ws.readyState !== 1) return;
    if (reenviar && celu.ultimo) {
      // Reenvío del mismo mensaje: el servidor no lo tiene que duplicar.
      celu.ws.send(JSON.stringify({ t: "msg", cid: celu.ultimo.cid, texto: celu.ultimo.texto }));
      r.reenvios++;
      return;
    }
    const cid = "c" + celu.i + "-" + Date.now();
    const texto = `Mensaje de prueba del celu ${celu.i} @${Date.now()}`;
    celu.ultimo = { cid, texto };
    celu.ws.send(JSON.stringify({ t: "msg", cid, texto }));
    r.enviados++;
  }

  // Cada celu manda un mensaje cada 6 a 20 s (con 150 celus, ~11 mensajes por segundo).
  const fin = Date.now() + SEG * 1000;
  for (const celu of celus) {
    const tick = () => {
      if (Date.now() > fin) return;
      mandar(celu, Math.random() < 0.05);
      celu.t = setTimeout(tick, 6000 + Math.random() * 14000);
    };
    celu.t = setTimeout(tick, Math.random() * 5000);
  }

  // A mitad de la prueba: encuesta, todos votan y todos cambian el voto una vez.
  await espera((SEG * 1000) / 3);
  ({ id: encuestaId } = await api.post("encuesta/crear", { programa, pregunta: "¿Prueba de carga?", opciones: ["Sí", "No", "Ni idea"] }));
  await api.post("encuesta/abrir", { id: encuestaId });
  await espera(500);
  const votosEsperados = [0, 0, 0];
  for (const celu of celus) {
    const op = celu.i % 3;
    celu.ws.send(JSON.stringify({ t: "voto", encuesta: encuestaId, opcion: (op + 1) % 3 }));
    celu.ws.send(JSON.stringify({ t: "voto", encuesta: encuestaId, opcion: op }));
    votosEsperados[op]++;
  }
  await espera(2500);
  await api.post("encuesta/cerrar", { id: encuestaId });
  await api.post("encuesta/ocultar");

  await espera(Math.max(0, fin - Date.now()) + 3000);
  for (const c of celus) {
    clearTimeout(c.t);
    c.ws.close();
  }

  const lat = r.latencias.sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] ?? 0;
  const votosOk = JSON.stringify(votosEsperados) === JSON.stringify(votosPantalla);
  console.log("\n--- Resultado ---");
  console.log(`Mensajes enviados: ${r.enviados} · confirmados: ${r.ok} (incluye ${r.reenvios} reenvíos a propósito)`);
  console.log(`Rechazados: ${Object.keys(r.errores).length ? JSON.stringify(r.errores) : "ninguno"}`);
  console.log(`Llegaron a la pantalla: ${r.enPantalla} de ${r.enviados} · duplicados: ${r.enPantalla > r.enviados ? "SÍ" : "ninguno"}`);
  console.log(`Chat en los celus: ${r.leidosEnCelus} entregas (esperadas ${r.enPantalla * celus.length})`);
  console.log(`Demora hasta la pantalla: mediana ${p(0.5)} ms · p95 ${p(0.95)} ms · máx ${lat[lat.length - 1] ?? 0} ms`);
  console.log(`Encuesta: esperados ${JSON.stringify(votosEsperados)} · en pantalla ${JSON.stringify(votosPantalla)} · ${votosOk ? "OK" : "NO COINCIDE"}`);
  console.log(`Conexiones fallidas: ${r.conexionesFallidas}`);
} finally {
  pantalla.close();
  await api.post("aire", { programa: inicial.aire });
  await api.post("intervalo", { valor: inicial.intervalo });
  await api.post("programa/borrar", { id: programa });
  const { borradas } = await api.post("cuentas/borrar-carga");
  console.log(`\nLimpieza: volví al programa de antes, borré "Prueba de carga" con todo lo que dejó y ${borradas} cuentas de prueba.`);
}
process.exit(0);
