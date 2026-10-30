// La Sala: un único Durable Object que guarda todo en SQLite y reparte en vivo
// a tres tipos de conexión: el público (celulares), las pantallas y el panel.
import { DurableObject } from "cloudflare:workers";
import { hashClave, verificarClave, compararTexto, tokenAleatorio } from "./clave.js";

const MAX_LARGO = 280;
const MAX_NICK = 24;
const DURACION_SESION = 30 * 86400000;

const AJUSTES_INICIALES = {
  opacidad: 1, // toda la capa del chat
  fondoVentana: 0.3, // fondo de la ventana que contiene los mensajes
  fondoGlobo: 0.55, // fondo de cada mensaje
  letra: 30, // en píxeles sobre una pantalla de 1080 de alto
  maxMensajes: 7,
  duracion: 45, // segundos en pantalla; 0 = no se van solos
  destacadoSeg: 10, // segundos en pantalla; 0 = queda hasta que lo saquen
  titulo: true, // "Brindis Bravo · programa" arriba de la ventana del chat
  contador: true, // cuánta gente está en el chat ahora (en la pantalla y en los celus)
  // Cada caja de la pantalla: visible o no, posición y tamaño en % de la pantalla.
  // El QR es cuadrado: su tamaño (tam) es un % del alto.
  ventana: { visible: true, x: 64, y: 6, w: 33, h: 86 },
  encuesta: { visible: true, x: 4, y: 8, w: 36, h: 36 },
  destacado: { visible: true, x: 14, y: 30, w: 72, h: 40 },
  qr: { visible: true, x: 3, y: 68, tam: 24 },
  urlQR: "",
};
const CAJAS = ["ventana", "encuesta", "destacado", "qr"];

// Rango permitido de cada ajuste: [mín, máx] para números, "bool" o "texto".
const LIMITES = {
  opacidad: [0, 1],
  fondoVentana: [0, 1],
  fondoGlobo: [0, 1],
  letra: [12, 90],
  maxMensajes: [1, 30],
  duracion: [0, 900],
  destacadoSeg: [0, 600],
  titulo: "bool",
  contador: "bool",
  ventana: { visible: "bool", x: [0, 95], y: [0, 95], w: [5, 100], h: [5, 100] },
  encuesta: { visible: "bool", x: [0, 95], y: [0, 95], w: [8, 100], h: [8, 100] },
  destacado: { visible: "bool", x: [0, 95], y: [0, 95], w: [8, 100], h: [8, 100] },
  qr: { visible: "bool", x: [0, 95], y: [0, 95], tam: [5, 70] },
  urlQR: "texto",
};

// Roles del equipo. El conductor lee el chat completo en su celu, escribe y destaca; no modera.
const ROLES = ["admin", "productor", "conductor"];
const rolValido = (r) => (ROLES.includes(r) ? r : "productor");
const PUEDE_CONDUCTOR = new Set(["yo", "logout", "mi-clave", "mensaje/destacar", "respuesta/destacar", "destacado/quitar", "respuestas"]);

// Apodos que nadie del público puede usar (además de los usuarios del equipo).
const RESERVADOS = new Set(["admin", "produccion", "brindis bravo"]);

const SIMULADOS = [
  ["La Colo", "¡Arrancó! Saludos desde la mesa del fondo 🙌"],
  ["Tincho", "Subí el volumen que acá atrás no se escucha nada"],
  ["Pato", "Esto es mejor que el streaming, hay cerveza"],
  ["Mery", "Pregunta para los conductores: ¿quién eligió la música?"],
  ["El Ruso", "Jajaja no puedo más"],
  ["Lu", "Mesa 4 presente 🍻"],
  ["Gonza", "Pidan otra ronda que esto se pone bueno"],
  ["Anónimo", "Una opinión polémica pero necesaria: el fernet va con hielo"],
];

class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

export class Sala extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.crearTablas();
    this.kv = new Map(this.sql.exec("SELECT k, v FROM kv").toArray().map((r) => [r.k, JSON.parse(r.v)]));
    this.migrar();
    this.sanciones = new Map(this.sql.exec("SELECT * FROM sanciones").toArray().map((r) => [r.autor, r]));
    this.ultimoEnvio = new Map(); // disp -> ms del último mensaje (para el intervalo)
    this.fallosLogin = new Map(); // usuario -> { n, hasta }
    this.conteos = new Map(); // encuesta -> [votos por opción]
    this.nRespuestas = new Map(); // caja anónima -> cuántas respuestas tiene
    this.cache = {}; // listas de mensajes que se piden muy seguido (ver ultimosVisibles)
    this.temporizadores = {};
    // Los celulares mandan "ping" cada tanto; se contesta sin despertar a la sala.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  crearTablas() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS programas (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, creado INTEGER);
      CREATE TABLE IF NOT EXISTS usuarios (usuario TEXT PRIMARY KEY, hash TEXT, sal TEXT, rol TEXT, programas TEXT, creado INTEGER);
      CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, usuario TEXT, vence INTEGER);
      CREATE TABLE IF NOT EXISTS mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, programa INTEGER, disp TEXT, cid TEXT,
        nick TEXT, texto TEXT, ts INTEGER, estado TEXT, prod INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS mensajes_programa ON mensajes (programa, ts);
      CREATE UNIQUE INDEX IF NOT EXISTS mensajes_cid ON mensajes (disp, cid);
      CREATE TABLE IF NOT EXISTS bloqueados (disp TEXT PRIMARY KEY, nick TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS encuestas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, programa INTEGER, pregunta TEXT, opciones TEXT,
        estado TEXT, creada INTEGER);
      CREATE TABLE IF NOT EXISTS votos (encuesta INTEGER, disp TEXT, opcion INTEGER, PRIMARY KEY (encuesta, disp));
      CREATE TABLE IF NOT EXISTS cuentas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nick TEXT, nick_norm TEXT UNIQUE, hash TEXT, sal TEXT, disp TEXT, creada INTEGER);
      CREATE INDEX IF NOT EXISTS cuentas_disp ON cuentas (disp);
      CREATE TABLE IF NOT EXISTS sesiones_chat (token TEXT PRIMARY KEY, cuenta INTEGER, vence INTEGER);
      CREATE TABLE IF NOT EXISTS sanciones (autor TEXT PRIMARY KEY, nick TEXT, tipo TEXT, hasta INTEGER, ts INTEGER);
      CREATE TABLE IF NOT EXISTS respuestas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, encuesta INTEGER, autor TEXT, disp TEXT, cid TEXT,
        texto TEXT, ts INTEGER, oculta INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS respuestas_encuesta ON respuestas (encuesta, ts);
      CREATE UNIQUE INDEX IF NOT EXISTS respuestas_cid ON respuestas (disp, cid);
    `);
  }

  // Cambios de estructura sobre datos que ya existían.
  migrar() {
    if (this.leer("version", 1) < 2) {
      // Quién mandó cada mensaje: "c:<id>" (cuenta del público) o "u:<usuario>" (equipo).
      try {
        this.sql.exec("ALTER TABLE mensajes ADD COLUMN autor TEXT");
      } catch {}
      this.guardar("version", 2);
    }
    if (this.leer("version", 1) < 3) {
      // El rol del equipo al escribir (para mostrar su ícono: conducción, producción, admin).
      try {
        this.sql.exec("ALTER TABLE mensajes ADD COLUMN rol TEXT");
      } catch {}
      this.guardar("version", 3);
    }
    if (this.leer("version", 1) < 4) {
      // Encuestas de dos tipos: con opciones, o "caja anónima" (pregunta abierta).
      try {
        this.sql.exec("ALTER TABLE encuestas ADD COLUMN tipo TEXT DEFAULT 'opciones'");
      } catch {}
      // El destacado quedaba hasta que lo sacaran: pasa a durar 10 segundos (se cambia en el panel).
      const a = this.leer("ajustes");
      if (a && !a.destacadoSeg) this.guardar("ajustes", { ...a, destacadoSeg: 10 });
      this.guardar("version", 4);
    }
    if (this.leer("version", 1) < 5) {
      // Jorge pidió destacados más cortos (estaba en 40 s): de una vez, 10 s. Se sigue cambiando en el panel.
      const a = this.leer("ajustes");
      if (a && (!a.destacadoSeg || a.destacadoSeg > 10)) this.guardar("ajustes", { ...a, destacadoSeg: 10 });
      this.guardar("version", 5);
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS mensajes_autor ON mensajes (autor)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS mensajes_ts ON mensajes (ts)");
    this.sql.exec("DROP INDEX IF EXISTS mensajes_produccion"); // de cuando el público veía lo de la producción
  }

  // ---------- estado simple (clave/valor en memoria + SQLite) ----------

  leer(k, def = null) {
    return this.kv.has(k) ? this.kv.get(k) : def;
  }

  guardar(k, v) {
    this.kv.set(k, v);
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v));
  }

  ajustes() {
    const g = this.leer("ajustes", {});
    const a = { ...AJUSTES_INICIALES, ...g };
    for (const k of CAJAS) a[k] = { ...AJUSTES_INICIALES[k], ...(g[k] || {}) };
    return a;
  }

  intervalo() {
    return this.leer("intervalo", 3);
  }

  aire() {
    return this.leer("aire", null);
  }

  programaActual() {
    const id = this.aire();
    if (!id) return null;
    const p = this.sql.exec("SELECT id, nombre FROM programas WHERE id = ?", id).toArray()[0];
    return p || null;
  }

  destacadoVigente() {
    return this.leer("destacado", null);
  }

  // ---------- conexiones ----------

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") return this.abrirSocket(req, url);
    try {
      return await this.api(req, url);
    } catch (e) {
      if (e instanceof ErrorApi) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Error interno" }, 500);
    }
  }

  abrirSocket(req, url) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Esperaba un WebSocket", { status: 426 });
    const rol = url.searchParams.get("rol");
    let adj;
    if (rol === "publico") {
      const disp = url.searchParams.get("disp") || "";
      if (!/^[A-Za-z0-9-]{8,64}$/.test(disp)) return new Response("Dispositivo inválido", { status: 400 });
      const yo = origenValido(req) ? this.identidadChat(req) : null;
      adj = yo ? { rol, disp, autor: yo.autor, nick: yo.nick, nivel: yo.rol } : { rol, disp, nivel: "publico" };
    } else if (rol === "pantalla") {
      adj = { rol: url.searchParams.get("vista") === "1" ? "vista" : "pantalla" };
    } else if (rol === "panel") {
      if (!origenValido(req)) return new Response("Origen inválido", { status: 403 });
      const u = this.usuarioDeSesion(req);
      if (!u) return new Response("Sin sesión", { status: 401 });
      if (u.rol === "conductor") return new Response("Los conductores usan el chat", { status: 403 });
      adj = { rol, usuario: u.usuario };
    } else {
      return new Response("Rol inválido", { status: 400 });
    }
    const [cliente, servidor] = Object.values(new WebSocketPair());
    // Etiquetas: el tipo de conexión; en los celus, además, qué chat ve ("completo" el equipo,
    // "propio" el público) y de quién es, para mandarle lo suyo sin recorrer a todos.
    const etiquetas = [adj.rol];
    if (adj.rol === "publico") {
      etiquetas.push(adj.nivel === "publico" ? "propio" : "completo");
      if (adj.autor) etiquetas.push("a:" + adj.autor);
    }
    this.ctx.acceptWebSocket(servidor, etiquetas);
    servidor.serializeAttachment(adj);
    servidor.send(JSON.stringify(this.estadoPara(adj)));
    if (adj.rol === "publico" || adj.rol === "pantalla") this.avisarConteo();
    return new Response(null, { status: 101, webSocket: cliente });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > 5000) return;
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    const adj = ws.deserializeAttachment() || {};
    if (adj.rol !== "publico") return;
    if (m.t === "msg") this.recibirMensaje(ws, adj, m);
    else if (m.t === "voto") this.recibirVoto(ws, adj, m);
    else if (m.t === "respuesta") this.recibirRespuesta(ws, adj, m);
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {}
    this.avisarConteo();
  }

  async webSocketError() {
    this.avisarConteo();
  }

  abiertos(rol) {
    return this.ctx.getWebSockets(rol).filter((ws) => ws.readyState === 1);
  }

  enviarA(roles, obj) {
    const s = JSON.stringify(obj);
    for (const rol of roles) for (const ws of this.abiertos(rol)) {
      try {
        ws.send(s);
      } catch {}
    }
  }

  aPantallas(obj) {
    this.enviarA(["pantalla", "vista"], obj);
  }

  // A todos los celus (equipo y público).
  aPublico(obj) {
    this.enviarA(["publico"], obj);
  }

  aSocketsDe(autor, obj) {
    if (autor) this.enviarA(["a:" + autor], obj);
  }

  // Algo de un mensaje (que llegó, que se borró): el equipo lo ve siempre. Del público, sólo
  // quien lo escribió (para saber que salió); los avisos 📢 le llegan como destacado.
  // Al vetado no se le avisa que lo borraron.
  aChat(obj, m, { vetado = false } = {}) {
    this.enviarA(["completo"], obj);
    if (!vetado && !esEquipo(m.autor)) this.aSocketsDe(m.autor, obj);
  }

  aPaneles(obj) {
    this.enviarA(["panel"], obj);
  }

  // Ejecuta fn una sola vez dentro de los próximos ms aunque se pida muchas veces.
  agrupar(clave, ms, fn) {
    if (this.temporizadores[clave]) return;
    this.temporizadores[clave] = setTimeout(() => {
      delete this.temporizadores[clave];
      fn();
    }, ms);
  }

  avisarConteo() {
    this.agrupar("conteo", 1000, () => {
      const c = this.conteoConexiones();
      this.aPaneles({ t: "conteo", ...c });
      if (c.publico !== this.ultimaGente) this.avisarGente(c.publico);
    });
  }

  // Cuánta gente hay en el chat: celus distintos conectados (una persona con dos pestañas cuenta una vez).
  conteoConexiones() {
    const celus = new Set(this.abiertos("publico").map((ws) => (ws.deserializeAttachment() || {}).disp));
    return { pantallas: this.abiertos("pantalla").length, publico: celus.size };
  }

  avisarGente(n = this.conteoConexiones().publico) {
    this.ultimaGente = n;
    const msg = { t: "gente", n, visible: this.ajustes().contador };
    this.aPantallas(msg);
    this.aPublico(msg);
  }

  // ---------- lo que recibe cada uno al conectarse ----------

  estadoPara(adj) {
    if (adj.rol === "publico") return this.estadoPublico(adj);
    if (adj.rol === "pantalla" || adj.rol === "vista") return this.estadoPantalla();
    const u = this.usuario(adj.usuario);
    return u ? { t: "estado", ...this.configPanel(u), mensajes: this.mensajesPanel() } : { t: "salir" };
  }

  estadoPublico(adj) {
    const equipo = esEquipo(adj.autor);
    const s = adj.autor && !equipo ? this.sancionDe(adj.autor) : null;
    return {
      t: "estado",
      ahora: Date.now(),
      programa: this.programaActual(),
      pausa: this.leer("pausa", false),
      maxLargo: MAX_LARGO,
      intervalo: this.intervalo(),
      encuesta: this.encuestaParaPublico(adj.disp),
      yo: adj.autor ? { autor: adj.autor, nick: adj.nick, equipo, rol: adj.nivel } : null,
      vista: adj.nivel === "publico" ? "propio" : "completo",
      cajaAnonima: adj.nivel === "publico" ? null : this.cajaAnonima(),
      destacado: this.destacadoVigente(),
      gente: { n: this.ultimaGente ?? this.conteoConexiones().publico, visible: this.ajustes().contador },
      silencio: s && s.tipo === "silencio" ? s.hasta : null,
      mensajes: this.mensajesPublico(adj),
    };
  }

  // Lo último del chat, para el equipo (el chat es uno solo, de corrido). Se guarda en memoria
  // y se rehace sólo cuando cambia algo, para no leer la base cada vez que alguien se reconecta.
  ultimosVisibles() {
    this.cache.completo ??= this.sql.exec("SELECT id, nick, texto, ts, prod, autor, rol, estado FROM mensajes WHERE estado = 'ok' ORDER BY ts DESC LIMIT 100").toArray().reverse();
    return this.cache.completo;
  }

  olvidarListas() {
    this.cache.completo = null;
  }

  // El equipo ve todo el chat. El público no ve el chat: escribe, ve los destacados un rato
  // (los avisos 📢 saltan solos como destacado) y las encuestas.
  mensajesPublico(adj) {
    return adj.nivel === "publico" ? [] : this.ultimosVisibles().map(paraPublico);
  }

  estadoPantalla() {
    return {
      t: "estado",
      ahora: Date.now(),
      ajustes: this.ajustes(),
      programa: this.programaActual(),
      gente: this.conteoConexiones().publico,
      mensajes: this.mensajesPantalla(),
      destacado: this.destacadoVigente(),
      encuesta: this.encuestaPublica(this.encuestaEnPantalla()),
    };
  }

  mensajesPantalla() {
    const filas = this.sql
      .exec(
        "SELECT id, nick, texto, ts, prod, autor, rol FROM mensajes WHERE estado = 'ok' AND ts > ? ORDER BY ts DESC LIMIT ?",
        this.leer("limpieza", 0),
        Math.min(60, this.ajustes().maxMensajes * 2)
      )
      .toArray();
    return filas.reverse().map(paraPantalla);
  }

  mensajesPanel() {
    return this.sql.exec("SELECT * FROM mensajes ORDER BY ts DESC LIMIT 300").toArray().reverse();
  }

  configPanel(u) {
    const esAdmin = u.rol === "admin";
    const programas = this.sql.exec("SELECT id, nombre FROM programas ORDER BY id").toArray();
    const encuestas = this.sql
      .exec("SELECT * FROM encuestas ORDER BY id")
      .toArray()
      .map((e) => this.encuestaPublica(e));
    return {
      yo: { usuario: u.usuario, rol: u.rol, claveDebil: this.leer("clavesDebiles", []).includes(u.usuario) },
      programas,
      aire: this.aire(),
      pausa: this.leer("pausa", false),
      aprobacion: this.leer("aprobacion", false),
      ajustes: this.ajustes(),
      intervalo: this.intervalo(),
      destacado: this.destacadoVigente(),
      encuestaPantalla: this.leer("encuestaPantalla", null),
      encuestas,
      usuarios: esAdmin
        ? this.sql
            .exec("SELECT usuario, rol FROM usuarios ORDER BY usuario")
            .toArray()
            .map((r) => ({ ...r, debil: this.leer("clavesDebiles", []).includes(r.usuario) }))
        : [],
      sanciones: this.sancionesVigentes(),
      conteo: this.conteoConexiones(),
      ahora: Date.now(),
    };
  }

  // Manda a cada panel su configuración (y los mensajes, si cambió el programa).
  refrescarPaneles(conMensajes = false) {
    const mensajes = conMensajes ? this.mensajesPanel() : null;
    for (const ws of this.abiertos("panel")) {
      const adj = ws.deserializeAttachment() || {};
      const u = this.usuario(adj.usuario);
      try {
        if (!u) ws.send(JSON.stringify({ t: "salir" }));
        else ws.send(JSON.stringify(conMensajes ? { t: "estado", ...this.configPanel(u), mensajes } : { t: "config", ...this.configPanel(u) }));
      } catch {}
    }
  }

  refrescarPanelesPronto() {
    this.agrupar("paneles", 250, () => this.refrescarPaneles());
  }

  refrescarPublico() {
    for (const ws of this.abiertos("publico")) {
      const adj = ws.deserializeAttachment() || {};
      try {
        ws.send(JSON.stringify(this.estadoPublico(adj)));
      } catch {}
    }
  }

  avisarPrograma() {
    const msg = { t: "programa", programa: this.programaActual() };
    this.aPantallas(msg);
    this.aPublico(msg);
    this.refrescarPaneles();
  }

  refrescarTodo() {
    this.aPantallas(this.estadoPantalla());
    this.refrescarPublico();
    this.refrescarPaneles(true);
  }

  // ---------- mensajes del público ----------

  recibirMensaje(ws, adj, m) {
    const cid = String(m.cid || "").slice(0, 60);
    const responder = (ok, extra = {}) => ws.send(JSON.stringify({ t: "ack", cid, ok, ...extra }));
    const equipo = esEquipo(adj.autor);
    const delEquipo = equipo ? this.usuario(adj.nick) : null;
    if (!adj.autor || (equipo && !delEquipo)) return responder(false, { error: "sin-cuenta" });
    if (this.leer("pausa", false) && !equipo) return responder(false, { error: "pausa" });
    const texto = limpiarTexto(m.texto, MAX_LARGO, false);
    if (!texto || !cid) return responder(false, { error: "vacio" });
    // Si el celu reintenta un mensaje que ya llegó, se confirma sin duplicarlo.
    const ya = this.sql.exec("SELECT id, estado FROM mensajes WHERE disp = ? AND cid = ?", adj.disp, cid).toArray()[0];
    if (ya) return responder(true, { id: ya.id, estado: ya.estado === "pendiente" ? "pendiente" : "ok" });
    const sancion = equipo ? null : this.sancionDe(adj.autor);
    if (sancion && sancion.tipo === "silencio") return responder(false, { error: "silencio", hasta: sancion.hasta, ahora: Date.now() });
    const ahora = Date.now();
    if (!equipo) {
      const espera = this.intervalo() * 1000 - (ahora - (this.ultimoEnvio.get(adj.disp) || 0));
      if (espera > 0) return responder(false, { error: "espera", espera: Math.ceil(espera / 1000) });
      this.ultimoEnvio.set(adj.disp, ahora);
    }
    const estado = sancion ? "vetado" : !equipo && this.leer("aprobacion", false) ? "pendiente" : "ok";
    const msg = this.insertarMensaje({ programa: this.aire(), disp: adj.disp, cid, nick: adj.nick, texto, ts: ahora, estado, prod: 0, autor: adj.autor, rol: delEquipo ? delEquipo.rol : null });
    // Al vetado se le confirma como si nada: no se entera.
    responder(true, { id: msg.id, estado: estado === "pendiente" ? "pendiente" : "ok" });
    this.difundirMensaje(msg);
  }

  insertarMensaje(m) {
    const fila = this.sql
      .exec(
        "INSERT INTO mensajes (programa, disp, cid, nick, texto, ts, estado, prod, autor, rol) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        m.programa,
        m.disp,
        m.cid,
        m.nick,
        m.texto,
        m.ts,
        m.estado,
        m.prod,
        m.autor ?? null,
        m.rol ?? null
      )
      .one();
    const msg = { ...m, id: fila.id };
    this.olvidarListas();
    return msg;
  }

  difundirMensaje(msg) {
    if (msg.estado === "ok") {
      const m = paraPantalla(msg);
      this.aPantallas({ t: "msg", m });
      this.aChat({ t: "msg", m }, msg);
    }
    this.aPaneles({ t: "msg", m: msg });
  }

  mensaje(id) {
    const m = this.sql.exec("SELECT * FROM mensajes WHERE id = ?", Number(id)).toArray()[0];
    if (!m) throw new ErrorApi(404, "Ese mensaje no existe");
    return m;
  }

  cambiarEstado(m, estado, extra = {}) {
    this.sql.exec("UPDATE mensajes SET estado = ? WHERE id = ?", estado, m.id);
    this.olvidarListas();
    this.aPaneles({ t: "msgEstado", id: m.id, estado, ...extra });
    if (estado !== "ok") {
      this.aPantallas({ t: "borrar", id: m.id });
      this.aChat({ t: "borrar", id: m.id }, m, { vetado: estado === "vetado" });
      const d = this.destacadoVigente();
      if (d && d.id === m.id) this.ponerDestacado(null);
    }
  }

  ponerDestacado(d) {
    // Hasta cuándo se ve en la pantalla (para que los celus sepan cuándo dejó de estar).
    if (d) {
      const seg = this.ajustes().destacadoSeg;
      d = { ...d, hasta: seg > 0 ? d.desde + seg * 1000 : null };
    }
    this.guardar("destacado", d);
    this.aPantallas({ t: "destacado", d });
    this.aPublico({ t: "destacado", d }); // el público también ve lo que se destaca
    this.refrescarPanelesPronto();
  }

  // ---------- encuestas ----------

  // Lo que necesita el chat del productor para armar y lanzar encuestas desde el celu.
  encuestasParaChat() {
    return {
      encuestas: this.sql.exec("SELECT * FROM encuestas ORDER BY id DESC LIMIT 30").toArray().map((e) => this.encuestaPublica(e)),
      enPantalla: this.leer("encuestaPantalla", null),
    };
  }

  encuesta(id) {
    const e = this.sql.exec("SELECT * FROM encuestas WHERE id = ?", Number(id)).toArray()[0];
    if (!e) throw new ErrorApi(404, "Esa encuesta no existe");
    return e;
  }

  encuestaEnPantalla() {
    const id = this.leer("encuestaPantalla", null);
    if (!id) return null;
    return this.sql.exec("SELECT * FROM encuestas WHERE id = ?", id).toArray()[0] || null;
  }

  conteosDe(e) {
    if (!this.conteos.has(e.id)) {
      const opciones = JSON.parse(e.opciones);
      const c = opciones.map(() => 0);
      for (const r of this.sql.exec("SELECT opcion, COUNT(*) AS n FROM votos WHERE encuesta = ? GROUP BY opcion", e.id)) {
        if (r.opcion < c.length) c[r.opcion] = r.n;
      }
      this.conteos.set(e.id, c);
    }
    return this.conteos.get(e.id);
  }

  respuestasDe(e) {
    if (!this.nRespuestas.has(e.id)) this.nRespuestas.set(e.id, this.sql.exec("SELECT COUNT(*) AS n FROM respuestas WHERE encuesta = ? AND oculta = 0", e.id).one().n);
    return this.nRespuestas.get(e.id);
  }

  encuestaPublica(e) {
    if (!e) return null;
    const anonima = e.tipo === "anonima";
    return {
      id: e.id,
      programa: e.programa,
      tipo: anonima ? "anonima" : "opciones",
      pregunta: e.pregunta,
      opciones: JSON.parse(e.opciones),
      estado: e.estado,
      conteos: e.estado === "borrador" || anonima ? null : this.conteosDe(e),
      respuestas: anonima ? this.respuestasDe(e) : null,
    };
  }

  encuestaParaPublico(disp) {
    const e = this.encuestaPublica(this.encuestaEnPantalla());
    if (!e) return null;
    const v = this.sql.exec("SELECT opcion FROM votos WHERE encuesta = ? AND disp = ?", e.id, disp).toArray()[0];
    return { ...e, miVoto: v ? v.opcion : null };
  }

  // Caja anónima: las respuestas las lee el equipo (sin nombres); al público sólo le llega el total.
  cajaAnonima() {
    const e = this.sql.exec("SELECT * FROM encuestas WHERE id = ?", this.leer("ultimaAnonima", 0)).toArray()[0];
    if (!e) return null;
    return { encuesta: this.encuestaPublica(e), respuestas: this.respuestasLista(e.id, 200) };
  }

  // El registro completo de una caja anónima, con quién escribió cada respuesta (sólo admin).
  // Incluye las que no se ven (de vetados), marcadas.
  registroAnonimo(encuesta) {
    const filas = this.sql.exec("SELECT id, texto, ts, oculta, autor FROM respuestas WHERE encuesta = ? ORDER BY ts DESC LIMIT 1000", encuesta).toArray();
    const nicks = new Map();
    return filas.map((r) => {
      if (!nicks.has(r.autor)) nicks.set(r.autor, this.nickDe(r.autor));
      return { id: r.id, texto: r.texto, ts: r.ts, oculta: r.oculta, quien: nicks.get(r.autor), equipo: esEquipo(r.autor) };
    });
  }

  nickDe(autor) {
    if (esEquipo(autor)) return autor.slice(2);
    const c = this.sql.exec("SELECT nick FROM cuentas WHERE id = ?", Number(String(autor).slice(2))).toArray()[0];
    return c ? c.nick : "(cuenta borrada)";
  }

  respuestasLista(encuesta, cuantas) {
    return this.sql.exec("SELECT id, texto, ts FROM respuestas WHERE encuesta = ? AND oculta = 0 ORDER BY ts DESC LIMIT ?", encuesta, cuantas).toArray();
  }

  recibirRespuesta(ws, adj, m) {
    const cid = String(m.cid || "").slice(0, 60);
    const responder = (ok, extra = {}) => ws.send(JSON.stringify({ t: "respuestaOk", cid, ok, ...extra }));
    if (!adj.autor) return responder(false, { error: "sin-cuenta" });
    const e = this.encuestaEnPantalla();
    if (!e || e.id !== m.encuesta || e.tipo !== "anonima" || e.estado !== "abierta") return responder(false, { error: "cerrada" });
    const texto = limpiarTexto(m.texto, MAX_LARGO, false);
    if (!texto || !cid) return responder(false, { error: "vacio" });
    if (this.sql.exec("SELECT id FROM respuestas WHERE disp = ? AND cid = ?", adj.disp, cid).toArray().length) return responder(true);
    const equipo = esEquipo(adj.autor);
    const sancion = equipo ? null : this.sancionDe(adj.autor);
    if (sancion && sancion.tipo === "silencio") return responder(false, { error: "silencio", hasta: sancion.hasta, ahora: Date.now() });
    const ahora = Date.now();
    if (!equipo) {
      const espera = this.intervalo() * 1000 - (ahora - (this.ultimoEnvio.get(adj.disp) || 0));
      if (espera > 0) return responder(false, { error: "espera", espera: Math.ceil(espera / 1000) });
      this.ultimoEnvio.set(adj.disp, ahora);
    }
    // Al vetado se le dice que salió, pero su respuesta no la ve nadie.
    const oculta = sancion ? 1 : 0;
    const { id } = this.sql
      .exec("INSERT INTO respuestas (encuesta, autor, disp, cid, texto, ts, oculta) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id", e.id, adj.autor, adj.disp, cid, texto, ahora, oculta)
      .one();
    responder(true);
    if (oculta) return;
    this.nRespuestas.set(e.id, this.respuestasDe(e) + 1);
    const r = { t: "respuesta", encuesta: e.id, r: { id, texto, ts: ahora } };
    this.enviarA(["completo"], r);
    this.aPaneles(r);
    this.agrupar("respuestas", 500, () => {
      const msg = { t: "respuestas", encuesta: e.id, n: this.respuestasDe(e) };
      this.aPantallas(msg);
      this.aPaneles(msg);
    });
  }

  recibirVoto(ws, adj, m) {
    const e = this.encuestaEnPantalla();
    const responder = (ok, extra = {}) => ws.send(JSON.stringify({ t: "voto", encuesta: m.encuesta, ok, ...extra }));
    if (!e || e.id !== m.encuesta || e.estado !== "abierta" || e.tipo === "anonima") return responder(false, { error: "cerrada" });
    const opcion = Number(m.opcion);
    const c = this.conteosDe(e);
    if (!Number.isInteger(opcion) || opcion < 0 || opcion >= c.length) return responder(false, { error: "opcion" });
    const previo = this.sql.exec("SELECT opcion FROM votos WHERE encuesta = ? AND disp = ?", e.id, adj.disp).toArray()[0];
    if (previo && previo.opcion === opcion) return responder(true, { opcion });
    this.sql.exec("INSERT OR REPLACE INTO votos (encuesta, disp, opcion) VALUES (?, ?, ?)", e.id, adj.disp, opcion);
    if (previo && previo.opcion < c.length) c[previo.opcion]--;
    c[opcion]++;
    responder(true, { opcion });
    this.agrupar("votos", 300, () => {
      const msg = { t: "votos", encuesta: e.id, conteos: this.conteosDe(e) };
      this.aPantallas(msg);
      this.aPublico(msg);
      this.aPaneles(msg);
    });
  }

  difundirEncuesta() {
    this.aPantallas({ t: "encuesta", e: this.encuestaPublica(this.encuestaEnPantalla()) });
    this.enviarA(["completo"], { t: "cajaAnonima", c: this.cajaAnonima() });
    for (const ws of this.abiertos("publico")) {
      const adj = ws.deserializeAttachment() || {};
      try {
        ws.send(JSON.stringify({ t: "encuesta", e: this.encuestaParaPublico(adj.disp) }));
      } catch {}
    }
    this.refrescarPanelesPronto();
  }

  // ---------- silenciados y vetados ----------

  sancionDe(autor) {
    const s = this.sanciones.get(autor);
    if (!s || (s.tipo === "silencio" && s.hasta <= Date.now())) return null;
    return s;
  }

  sancionesVigentes() {
    return [...this.sanciones.values()].filter((s) => this.sancionDe(s.autor)).sort((a, b) => b.ts - a.ts);
  }

  // ---------- cuentas del público ----------

  // Quién escribe desde el celu: alguien del equipo (con su sesión) o una cuenta del público.
  identidadChat(req) {
    const u = this.usuarioDeSesion(req);
    if (u) return { autor: "u:" + u.usuario, nick: u.usuario, equipo: true, rol: u.rol };
    const token = leerCookie(req, "chat");
    if (!token) return null;
    const c = this.sql
      .exec("SELECT c.id, c.nick FROM sesiones_chat s JOIN cuentas c ON c.id = s.cuenta WHERE s.token = ? AND s.vence > ?", token, Date.now())
      .toArray()[0];
    return c ? { autor: "c:" + c.id, nick: c.nick, equipo: false, rol: "publico" } : null;
  }

  nickOcupado(norm) {
    return (
      RESERVADOS.has(norm) ||
      this.sql.exec("SELECT usuario FROM usuarios WHERE usuario = ?", norm).toArray().length > 0 ||
      this.sql.exec("SELECT id FROM cuentas WHERE nick_norm = ?", norm).toArray().length > 0
    );
  }

  abrirSesionChat(cuenta, nick, url) {
    this.sql.exec("DELETE FROM sesiones_chat WHERE vence < ?", Date.now());
    const token = tokenAleatorio();
    this.sql.exec("INSERT INTO sesiones_chat (token, cuenta, vence) VALUES (?, ?, ?)", token, cuenta, Date.now() + DURACION_SESION);
    return json({ ok: true, yo: { autor: "c:" + cuenta, nick, equipo: false, rol: "publico" } }, 200, { "Set-Cookie": cookie("chat", token, url, DURACION_SESION / 1000) });
  }

  async apiChat(ruta, req, url) {
    if (ruta === "yo") return json({ yo: this.identidadChat(req) });
    if (req.method !== "POST") throw new ErrorApi(405, "Método no permitido");
    const b = await req.json().catch(() => ({}));
    if (ruta === "registro") return this.registrarCuenta(b, url);
    if (ruta === "entrar") return this.entrarChat(b, url);
    if (ruta === "salir") {
      this.sql.exec("DELETE FROM sesiones_chat WHERE token = ?", leerCookie(req, "chat"));
      this.sql.exec("DELETE FROM sesiones WHERE token = ?", leerCookie(req, "sesion"));
      const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });
      h.append("Set-Cookie", cookie("chat", "", url, 0));
      h.append("Set-Cookie", cookie("sesion", "", url, 0));
      return new Response(JSON.stringify({ ok: true }), { headers: h });
    }
    throw new ErrorApi(404, "No existe esa acción");
  }

  // Un celu, una cuenta: así nadie aparece con dos apodos desde el mismo teléfono.
  async registrarCuenta(b, url) {
    const nick = limpiarTexto(b.nick, MAX_NICK, true);
    const norm = normalizarNick(nick);
    const disp = String(b.disp || "");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(disp)) throw new ErrorApi(400, "Recargá la página y probá de nuevo");
    if (Array.from(norm).length < 2) throw new ErrorApi(400, "El apodo tiene que tener al menos 2 letras");
    const clave = validarClave(b.clave);
    const revisar = () => {
      const previa = this.sql.exec("SELECT nick FROM cuentas WHERE disp = ?", disp).toArray()[0];
      if (previa) throw new ErrorApi(409, `Este celu ya tiene la cuenta «${previa.nick}». Entrá con esa.`);
      if (this.nickOcupado(norm)) throw new ErrorApi(409, "Ese apodo ya lo tiene otra persona. Probá con otro.");
    };
    revisar();
    const { sal, hash } = await hashClave(clave);
    revisar(); // mientras se calculaba la clave pudo entrar otro con el mismo apodo
    const { id } = this.sql
      .exec("INSERT INTO cuentas (nick, nick_norm, hash, sal, disp, creada) VALUES (?, ?, ?, ?, ?, ?) RETURNING id", nick, norm, hash, sal, disp, Date.now())
      .one();
    return this.abrirSesionChat(id, nick, url);
  }

  async entrarChat(b, url) {
    const norm = normalizarNick(limpiarTexto(b.nick, 40, true));
    const clave = String(b.clave || "").slice(0, 200);
    const llave = "chat:" + norm;
    const f = this.fallosLogin.get(llave);
    if (f && f.hasta > Date.now()) throw new ErrorApi(429, "Demasiados intentos. Probá en un minuto.");
    // Alguien del equipo entra con su usuario de siempre.
    if (this.usuario(norm) && (await this.claveOk(norm, clave))) {
      this.fallosLogin.delete(llave);
      return this.abrirSesion(norm, url, { yo: { autor: "u:" + norm, nick: norm, equipo: true, rol: this.usuario(norm).rol } });
    }
    const c = this.sql.exec("SELECT id, nick, hash, sal FROM cuentas WHERE nick_norm = ?", norm).toArray()[0];
    if (c && (await verificarClave(clave, c.sal, c.hash))) {
      this.fallosLogin.delete(llave);
      return this.abrirSesionChat(c.id, c.nick, url);
    }
    const n = (f ? f.n : 0) + 1;
    this.fallosLogin.set(llave, { n, hasta: n >= 5 ? Date.now() + 60000 : 0 });
    throw new ErrorApi(401, "Apodo o clave incorrectos");
  }

  // ---------- usuarios y sesiones ----------

  usuario(nombre) {
    if (nombre === "admin") return { usuario: "admin", rol: "admin", programas: [] };
    const r = this.sql.exec("SELECT usuario, rol, programas FROM usuarios WHERE usuario = ?", nombre).toArray()[0];
    return r ? { usuario: r.usuario, rol: r.rol, programas: JSON.parse(r.programas || "[]") } : null;
  }

  usuarioDeSesion(req) {
    const token = leerCookie(req, "sesion");
    if (!token) return null;
    const s = this.sql.exec("SELECT usuario, vence FROM sesiones WHERE token = ?", token).toArray()[0];
    if (!s || s.vence < Date.now()) return null;
    return this.usuario(s.usuario);
  }

  // La clave del admin se elige desde el panel la primera vez (queda en la sala).
  // ADMIN_PASSWORD en Cloudflare sirve sólo mientras no se haya elegido una.
  hayClaveAdmin() {
    return !!this.leer("claveAdmin") || !!this.env.ADMIN_PASSWORD;
  }

  async claveOk(usuario, clave) {
    if (usuario === "admin") {
      const k = this.leer("claveAdmin");
      if (k) return verificarClave(clave, k.sal, k.hash);
      return !!this.env.ADMIN_PASSWORD && compararTexto(clave, this.env.ADMIN_PASSWORD);
    }
    const r = this.sql.exec("SELECT hash, sal FROM usuarios WHERE usuario = ?", usuario).toArray()[0];
    return r ? verificarClave(clave, r.sal, r.hash) : false;
  }

  // Claves fáciles (cortas o con el nombre adentro): el panel avisa que conviene cambiarlas.
  marcarDebil(usuario, clave) {
    const lista = new Set(this.leer("clavesDebiles", []));
    if (clave.length < 8 || clave.toLowerCase().includes(usuario)) lista.add(usuario);
    else lista.delete(usuario);
    this.guardar("clavesDebiles", [...lista]);
  }

  abrirSesion(usuario, url, extra = {}) {
    this.sql.exec("DELETE FROM sesiones WHERE vence < ?", Date.now());
    const token = tokenAleatorio();
    this.sql.exec("INSERT INTO sesiones (token, usuario, vence) VALUES (?, ?, ?)", token, usuario, Date.now() + DURACION_SESION);
    return json({ ok: true, ...extra }, 200, { "Set-Cookie": cookie("sesion", token, url, DURACION_SESION / 1000) });
  }

  async login(req, url) {
    const b = await req.json().catch(() => ({}));
    const usuario = String(b.usuario || "").trim().toLowerCase().slice(0, 40);
    const clave = String(b.clave || "").slice(0, 200);
    const f = this.fallosLogin.get(usuario);
    if (f && f.hasta > Date.now()) throw new ErrorApi(429, "Demasiados intentos. Probá en un minuto.");
    if (!(await this.claveOk(usuario, clave))) {
      const n = (f ? f.n : 0) + 1;
      this.fallosLogin.set(usuario, { n, hasta: n >= 5 ? Date.now() + 60000 : 0 });
      throw new ErrorApi(401, "Usuario o clave incorrectos");
    }
    this.fallosLogin.delete(usuario);
    return this.abrirSesion(usuario, url);
  }

  // Primera vez: el primero que entra elige la clave del admin. Después esta puerta no existe más.
  async primeraVez(req, url) {
    if (this.hayClaveAdmin()) throw new ErrorApi(403, "La clave del admin ya está elegida. Entrá con usuario y clave.");
    const b = await req.json().catch(() => ({}));
    const clave = validarClave(b.clave);
    const { sal, hash } = await hashClave(clave);
    if (this.hayClaveAdmin()) throw new ErrorApi(403, "La clave del admin ya está elegida. Entrá con usuario y clave.");
    this.guardar("claveAdmin", { sal, hash });
    this.marcarDebil("admin", clave);
    if (!this.sql.exec("SELECT id FROM programas LIMIT 1").toArray().length) {
      for (const nombre of ["Programa 1", "Programa 2", "Programa 3"]) this.sql.exec("INSERT INTO programas (nombre, creado) VALUES (?, ?)", nombre, Date.now());
    }
    return this.abrirSesion("admin", url);
  }

  async cambiarMiClave(req, u) {
    const b = await req.json().catch(() => ({}));
    if (!(await this.claveOk(u.usuario, String(b.actual || "").slice(0, 200)))) throw new ErrorApi(400, "La clave actual no es esa");
    const clave = validarClave(b.nueva);
    const { sal, hash } = await hashClave(clave);
    if (u.usuario === "admin") this.guardar("claveAdmin", { sal, hash });
    else this.sql.exec("UPDATE usuarios SET hash = ?, sal = ? WHERE usuario = ?", hash, sal, u.usuario);
    this.marcarDebil(u.usuario, clave);
    // Se cierran las otras sesiones de esa persona; ésta sigue abierta.
    this.sql.exec("DELETE FROM sesiones WHERE usuario = ? AND token != ?", u.usuario, leerCookie(req, "sesion"));
    this.refrescarPaneles();
    return json({ ok: true });
  }

  exigirAdmin(u) {
    if (u.rol !== "admin") throw new ErrorApi(403, "Sólo el admin puede hacer esto");
  }

  // ---------- API del panel ----------

  async api(req, url) {
    const ruta = url.pathname.slice("/api/".length);
    if (req.method === "POST" && !origenValido(req)) throw new ErrorApi(403, "Origen inválido");
    if (ruta === "login" && req.method === "POST") return this.login(req, url);
    if (ruta.startsWith("chat/")) return this.apiChat(ruta.slice("chat/".length), req, url);
    if (ruta === "primera-vez") return req.method === "POST" ? this.primeraVez(req, url) : json({ primeraVez: !this.hayClaveAdmin() });
    const u = this.usuarioDeSesion(req);
    if (!u) throw new ErrorApi(401, "Iniciá sesión");
    if (ruta === "logout") {
      this.sql.exec("DELETE FROM sesiones WHERE token = ?", leerCookie(req, "sesion"));
      return json({ ok: true }, 200, { "Set-Cookie": cookie("sesion", "", url, 0) });
    }
    if (u.rol === "conductor" && !PUEDE_CONDUCTOR.has(ruta)) throw new ErrorApi(403, "Los conductores sólo pueden destacar mensajes");
    if (ruta === "yo") return json({ usuario: u.usuario, rol: u.rol });
    if (ruta === "mi-clave" && req.method === "POST") return this.cambiarMiClave(req, u);
    if (ruta === "estado" && req.method === "GET") return json(this.configPanel(u));
    if (ruta === "encuestas" && req.method === "GET") return json(this.encuestasParaChat());
    if (ruta === "respuestas" && req.method === "GET") {
      const encuesta = Number(url.searchParams.get("encuesta"));
      if (url.searchParams.get("autores") !== "1") return json({ respuestas: this.respuestasLista(encuesta, 500) });
      // Quién escribió cada respuesta: sólo el admin, para casos de producción.
      this.exigirAdmin(u);
      return json({ respuestas: this.registroAnonimo(encuesta) });
    }
    if (ruta === "exportar" && req.method === "GET") return this.exportar(u, url);
    if (req.method !== "POST") throw new ErrorApi(405, "Método no permitido");
    const accion = this.acciones[ruta];
    if (!accion) throw new ErrorApi(404, "No existe esa acción");
    const b = await req.json().catch(() => ({}));
    const r = await accion.call(this, u, b || {});
    return json({ ok: true, ...(r || {}) });
  }

  acciones = {
    // El programa que se está viendo (o ninguno): sólo cambia el título del chat.
    // No borra mensajes, ni el destacado, ni la encuesta.
    aire(u, b) {
      const p = b.programa == null || b.programa === "" ? null : Number(b.programa);
      if (p !== null && !this.sql.exec("SELECT id FROM programas WHERE id = ?", p).toArray().length) throw new ErrorApi(404, "Ese programa no existe");
      if (p === this.aire()) return;
      this.guardar("aire", p);
      this.avisarPrograma();
    },

    pausa(u, b) {
      this.guardar("pausa", !!b.valor);
      this.aPublico({ t: "pausa", valor: !!b.valor });
      this.refrescarPanelesPronto();
    },

    aprobacion(u, b) {
      this.guardar("aprobacion", !!b.valor);
      this.refrescarPanelesPronto();
    },

    limpiar(u) {
      const ts = Date.now();
      this.guardar("limpieza", ts);
      this.guardar("destacado", null);
      this.aPantallas({ t: "limpiar" });
      this.refrescarPanelesPronto();
    },

    "mensaje/borrar"(u, b) {
      this.cambiarEstado(this.mensaje(b.id), "borrado");
    },

    // Deshace un "Borrar": el mensaje vuelve a la pantalla y a los celus.
    "mensaje/restaurar"(u, b) {
      const m = this.mensaje(b.id);
      if (m.estado !== "borrado") return;
      this.sql.exec("UPDATE mensajes SET estado = 'ok' WHERE id = ?", m.id);
      this.olvidarListas();
      const pm = paraPantalla(m);
      this.aPantallas({ t: "msg", m: pm });
      this.aChat({ t: "msg", m: pm }, m);
      this.aPaneles({ t: "msgEstado", id: m.id, estado: "ok" });
    },

    "mensaje/aprobar"(u, b) {
      const m = this.mensaje(b.id);
      if (m.estado !== "pendiente") return;
      const ts = Date.now();
      this.sql.exec("UPDATE mensajes SET estado = 'ok', ts = ? WHERE id = ?", ts, m.id);
      this.olvidarListas();
      const pm = paraPantalla({ ...m, ts });
      this.aPantallas({ t: "msg", m: pm });
      this.aChat({ t: "msg", m: pm }, m);
      this.aPaneles({ t: "msgEstado", id: m.id, estado: "ok", ts });
    },

    "mensaje/destacar"(u, b) {
      const m = this.mensaje(b.id);
      if (m.estado !== "ok" && m.estado !== "pendiente") throw new ErrorApi(400, "Ese mensaje está borrado");
      this.ponerDestacado({ id: m.id, nick: m.nick, texto: m.texto, prod: m.prod, autor: m.autor, desde: Date.now() });
    },

    // Una respuesta de la caja anónima en el destacado de la pantalla, sin nombre y con la
    // pregunta como contexto. Sólo quien la escribió se entera de que es la suya.
    "respuesta/destacar"(u, b) {
      const r = this.sql
        .exec("SELECT r.id, r.texto, r.autor, r.oculta, e.pregunta FROM respuestas r JOIN encuestas e ON e.id = r.encuesta WHERE r.id = ?", Number(b.id))
        .toArray()[0];
      if (!r || r.oculta) throw new ErrorApi(404, "Esa respuesta no existe");
      this.ponerDestacado({ id: "r" + r.id, anonima: 1, nick: "Anónimo", pregunta: r.pregunta, texto: r.texto, desde: Date.now() });
      this.aSocketsDe(r.autor, { t: "tuRespuesta" });
    },

    "destacado/quitar"(u) {
      this.ponerDestacado(null);
    },

    "mensaje/produccion"(u, b) {
      const texto = limpiarTexto(b.texto, MAX_LARGO, false);
      if (!texto) throw new ErrorApi(400, "Escribí algo");
      const nick = limpiarTexto(b.nick, MAX_NICK, true) || "Producción";
      const msg = this.insertarMensaje({
        programa: this.aire(),
        disp: "panel-" + u.usuario,
        cid: tokenAleatorio(),
        nick,
        texto,
        ts: Date.now(),
        estado: "ok",
        prod: 1,
        autor: "u:" + u.usuario,
        rol: u.rol,
      });
      this.difundirMensaje(msg);
      // Un aviso de la producción salta solo como destacado (en la pantalla y en los celus).
      this.ponerDestacado({ id: msg.id, nick, texto, prod: 1, autor: msg.autor, desde: msg.ts });
    },

    simular(u) {
      SIMULADOS.forEach(([nick, texto], i) => {
        setTimeout(() => {
          const msg = this.insertarMensaje({ programa: this.aire(), disp: "simulacion", cid: tokenAleatorio(), nick, texto, ts: Date.now(), estado: "ok", prod: 0, autor: "simulacion" });
          this.difundirMensaje(msg);
        }, i * 900);
      });
    },

    // Silenciar (unos minutos, la persona ve hasta cuándo) o vetar (para siempre, no se entera).
    // Por un mensaje (b.id) o, sólo el admin, por una respuesta de la caja anónima (b.respuesta).
    sancionar(u, b) {
      let m;
      if (b.respuesta != null) {
        this.exigirAdmin(u);
        const r = this.sql.exec("SELECT autor FROM respuestas WHERE id = ?", Number(b.respuesta)).toArray()[0];
        if (!r) throw new ErrorApi(404, "Esa respuesta no existe");
        m = { autor: r.autor, nick: this.nickDe(r.autor) };
      } else m = this.mensaje(b.id);
      if (!m.autor || !m.autor.startsWith("c:")) throw new ErrorApi(400, "A esa persona no se la puede sancionar");
      const tipo = b.tipo === "veto" ? "veto" : "silencio";
      const minutos = Math.max(1, Math.min(1440, Math.round(Number(b.minutos) || 5)));
      const s = { autor: m.autor, nick: m.nick, tipo, hasta: tipo === "veto" ? null : Date.now() + minutos * 60000, ts: Date.now() };
      this.sql.exec("INSERT OR REPLACE INTO sanciones (autor, nick, tipo, hasta, ts) VALUES (?, ?, ?, ?, ?)", s.autor, s.nick, s.tipo, s.hasta, s.ts);
      this.sanciones.set(s.autor, s);
      this.aSocketsDe(s.autor, { t: "silencio", hasta: s.hasta, ahora: Date.now() });
      if (tipo === "veto") {
        // Lo que ya mandó sale de la pantalla y de los otros celus.
        for (const x of this.sql.exec("SELECT * FROM mensajes WHERE autor = ? AND estado IN ('ok', 'pendiente')", s.autor).toArray()) {
          this.cambiarEstado(x, "vetado");
        }
        // Sus respuestas anónimas dejan de verse (quedan en el registro del admin).
        const ocultas = this.sql.exec("UPDATE respuestas SET oculta = 1 WHERE autor = ? AND oculta = 0 RETURNING id", s.autor).toArray();
        const d = this.destacadoVigente();
        if (d && d.anonima && ocultas.some((r) => "r" + r.id === d.id)) this.ponerDestacado(null);
        if (ocultas.length) {
          this.nRespuestas.clear();
          this.enviarA(["completo"], { t: "cajaAnonima", c: this.cajaAnonima() });
        }
      }
      this.refrescarPanelesPronto();
      return { nick: m.nick };
    },

    perdonar(u, b) {
      const autor = String(b.autor || "");
      this.sql.exec("DELETE FROM sanciones WHERE autor = ?", autor);
      this.sanciones.delete(autor);
      this.aSocketsDe(autor, { t: "silencio", hasta: null, ahora: Date.now() });
      this.refrescarPanelesPronto();
    },

    // Para la prueba de carga: borra las cuentas y los mensajes que dejó.
    "cuentas/borrar-carga"(u) {
      this.exigirAdmin(u);
      const ids = this.sql.exec("SELECT id FROM cuentas WHERE disp LIKE 'carga-%'").toArray().map((r) => r.id);
      for (const id of ids) {
        this.sql.exec("DELETE FROM sesiones_chat WHERE cuenta = ?", id);
        this.sql.exec("DELETE FROM sanciones WHERE autor = ?", "c:" + id);
        this.sanciones.delete("c:" + id);
      }
      this.sql.exec("DELETE FROM cuentas WHERE disp LIKE 'carga-%'");
      this.sql.exec("DELETE FROM mensajes WHERE disp LIKE 'carga-%'");
      this.olvidarListas();
      this.refrescarTodo();
      return { borradas: ids.length };
    },

    ajustes(u, b) {
      const antes = this.ajustes().contador;
      const nuevos = sanear(this.ajustes(), b.ajustes || {}, LIMITES);
      this.guardar("ajustes", nuevos);
      this.aPantallas({ t: "ajustes", ajustes: nuevos });
      if (nuevos.contador !== antes) this.avisarGente(); // los celus también lo muestran u ocultan
      this.refrescarPanelesPronto();
    },

    "ajustes/restablecer"(u) {
      const nuevos = { ...AJUSTES_INICIALES, urlQR: this.ajustes().urlQR };
      this.guardar("ajustes", nuevos);
      this.aPantallas({ t: "ajustes", ajustes: this.ajustes() });
      this.refrescarPanelesPronto();
    },

    intervalo(u, b) {
      const s = Math.max(0, Math.min(120, Math.round(Number(b.valor) || 0)));
      this.guardar("intervalo", s);
      this.aPublico({ t: "intervalo", valor: s });
      this.refrescarPanelesPronto();
    },

    // Sin programa elegido, la encuesta queda en el programa de ahora (o en ninguno).
    "encuesta/crear"(u, b) {
      const programa = b.programa == null || b.programa === "" ? this.aire() : Number(b.programa);
      if (programa != null && !this.sql.exec("SELECT id FROM programas WHERE id = ?", programa).toArray().length) throw new ErrorApi(404, "Ese programa no existe");
      const { pregunta, opciones, tipo } = validarEncuesta(b);
      const { id } = this.sql
        .exec(
          "INSERT INTO encuestas (programa, pregunta, opciones, estado, creada, tipo) VALUES (?, ?, ?, 'borrador', ?, ?) RETURNING id",
          programa,
          pregunta,
          JSON.stringify(opciones),
          Date.now(),
          tipo
        )
        .one();
      this.refrescarPanelesPronto();
      return { id };
    },

    "encuesta/editar"(u, b) {
      const e = this.encuesta(b.id);
      if (e.estado !== "borrador") throw new ErrorApi(400, "Sólo se puede editar antes de lanzarla");
      const { pregunta, opciones, tipo } = validarEncuesta(b);
      this.sql.exec("UPDATE encuestas SET pregunta = ?, opciones = ?, tipo = ? WHERE id = ?", pregunta, JSON.stringify(opciones), tipo, e.id);
      this.conteos.delete(e.id);
      this.refrescarPanelesPronto();
    },

    "encuesta/borrar"(u, b) {
      const e = this.encuesta(b.id);
      if (this.leer("encuestaPantalla", null) === e.id) throw new ErrorApi(400, "Primero ocultala de la pantalla");
      // Las respuestas de una caja anónima son el registro del admin: sólo él puede borrarlas.
      if (e.tipo === "anonima" && u.rol !== "admin" && this.sql.exec("SELECT id FROM respuestas WHERE encuesta = ? LIMIT 1", e.id).toArray().length) {
        throw new ErrorApi(403, "Una caja anónima con respuestas sólo la puede borrar un admin (queda como registro)");
      }
      this.sql.exec("DELETE FROM votos WHERE encuesta = ?", e.id);
      this.sql.exec("DELETE FROM respuestas WHERE encuesta = ?", e.id);
      this.sql.exec("DELETE FROM encuestas WHERE id = ?", e.id);
      this.conteos.delete(e.id);
      this.nRespuestas.delete(e.id);
      this.refrescarPanelesPronto();
    },

    // Lanza (o reabre) una encuesta: aparece en pantalla y en los celulares.
    "encuesta/abrir"(u, b) {
      const e = this.encuesta(b.id);
      const actual = this.encuestaEnPantalla();
      if (actual && actual.id !== e.id && actual.estado === "abierta") this.sql.exec("UPDATE encuestas SET estado = 'cerrada' WHERE id = ?", actual.id);
      this.sql.exec("UPDATE encuestas SET estado = 'abierta' WHERE id = ?", e.id);
      this.guardar("encuestaPantalla", e.id);
      if (e.tipo === "anonima") this.guardar("ultimaAnonima", e.id);
      this.difundirEncuesta();
    },

    "encuesta/cerrar"(u, b) {
      const e = this.encuesta(b.id);
      if (e.estado !== "abierta") return;
      this.sql.exec("UPDATE encuestas SET estado = 'cerrada' WHERE id = ?", e.id);
      this.difundirEncuesta();
    },

    "encuesta/mostrar"(u, b) {
      const e = this.encuesta(b.id);
      if (e.estado === "borrador") throw new ErrorApi(400, "Todavía no se lanzó");
      const actual = this.encuestaEnPantalla();
      if (actual && actual.id !== e.id && actual.estado === "abierta") this.sql.exec("UPDATE encuestas SET estado = 'cerrada' WHERE id = ?", actual.id);
      this.guardar("encuestaPantalla", e.id);
      this.difundirEncuesta();
    },

    "encuesta/ocultar"(u) {
      const e = this.encuestaEnPantalla();
      if (e && e.estado === "abierta") this.sql.exec("UPDATE encuestas SET estado = 'cerrada' WHERE id = ?", e.id);
      this.guardar("encuestaPantalla", null);
      this.difundirEncuesta();
    },

    "programa/crear"(u, b) {
      this.exigirAdmin(u);
      const nombre = limpiarTexto(b.nombre, 60, true);
      if (!nombre) throw new ErrorApi(400, "Poné un nombre");
      const { id } = this.sql.exec("INSERT INTO programas (nombre, creado) VALUES (?, ?) RETURNING id", nombre, Date.now()).one();
      this.refrescarPaneles();
      return { id };
    },

    "programa/renombrar"(u, b) {
      this.exigirAdmin(u);
      const nombre = limpiarTexto(b.nombre, 60, true);
      if (!nombre) throw new ErrorApi(400, "Poné un nombre");
      this.sql.exec("UPDATE programas SET nombre = ? WHERE id = ?", nombre, Number(b.id));
      if (Number(b.id) === this.aire()) this.avisarPrograma();
      else this.refrescarPaneles();
    },

    "programa/borrar"(u, b) {
      this.exigirAdmin(u);
      const id = Number(b.id);
      if (id === this.aire()) throw new ErrorApi(400, "Es el programa de ahora: elegí otro (o ninguno) antes de borrarlo");
      for (const e of this.sql.exec("SELECT id FROM encuestas WHERE programa = ?", id).toArray()) {
        this.sql.exec("DELETE FROM votos WHERE encuesta = ?", e.id);
        this.sql.exec("DELETE FROM respuestas WHERE encuesta = ?", e.id);
        this.conteos.delete(e.id);
      }
      this.sql.exec("DELETE FROM encuestas WHERE programa = ?", id);
      this.sql.exec("UPDATE mensajes SET programa = NULL WHERE programa = ?", id); // los mensajes quedan
      this.sql.exec("DELETE FROM programas WHERE id = ?", id);
      for (const r of this.sql.exec("SELECT usuario, programas FROM usuarios").toArray()) {
        const lista = JSON.parse(r.programas || "[]").filter((p) => p !== id);
        this.sql.exec("UPDATE usuarios SET programas = ? WHERE usuario = ?", JSON.stringify(lista), r.usuario);
      }
      this.refrescarPaneles();
    },

    async "usuario/crear"(u, b) {
      this.exigirAdmin(u);
      const usuario = String(b.usuario || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,30}$/.test(usuario)) throw new ErrorApi(400, "Usuario: de 2 a 30 letras minúsculas, números, punto o guion");
      if (usuario === "admin") throw new ErrorApi(400, "Ese nombre está reservado");
      if (this.sql.exec("SELECT usuario FROM usuarios WHERE usuario = ?", usuario).toArray().length) throw new ErrorApi(400, "Ese usuario ya existe");
      if (this.sql.exec("SELECT id FROM cuentas WHERE nick_norm = ?", usuario).toArray().length) throw new ErrorApi(400, "Ese nombre ya lo usa alguien del público en el chat");
      const clave = validarClave(b.clave);
      const { sal, hash } = await hashClave(clave);
      this.sql.exec(
        "INSERT INTO usuarios (usuario, hash, sal, rol, programas, creado) VALUES (?, ?, ?, ?, ?, ?)",
        usuario,
        hash,
        sal,
        rolValido(b.rol),
        "[]",
        Date.now()
      );
      this.marcarDebil(usuario, clave);
      this.refrescarPaneles();
    },

    async "usuario/editar"(u, b) {
      this.exigirAdmin(u);
      const usuario = String(b.usuario || "");
      if (!this.sql.exec("SELECT usuario FROM usuarios WHERE usuario = ?", usuario).toArray().length) throw new ErrorApi(404, "Ese usuario no existe");
      if (b.clave != null) {
        const clave = validarClave(b.clave);
        const { sal, hash } = await hashClave(clave);
        this.sql.exec("UPDATE usuarios SET hash = ?, sal = ? WHERE usuario = ?", hash, sal, usuario);
        this.sql.exec("DELETE FROM sesiones WHERE usuario = ?", usuario);
        this.marcarDebil(usuario, clave);
      }
      if (b.programas != null) this.sql.exec("UPDATE usuarios SET programas = ? WHERE usuario = ?", JSON.stringify(this.programasValidos(b.programas)), usuario);
      if (b.rol != null) this.sql.exec("UPDATE usuarios SET rol = ? WHERE usuario = ?", rolValido(b.rol), usuario);
      this.refrescarPaneles();
    },

    "usuario/borrar"(u, b) {
      this.exigirAdmin(u);
      const usuario = String(b.usuario || "");
      this.sql.exec("DELETE FROM usuarios WHERE usuario = ?", usuario);
      this.sql.exec("DELETE FROM sesiones WHERE usuario = ?", usuario);
      this.refrescarPaneles();
    },
  };

  programasValidos(lista) {
    const existentes = new Set(this.sql.exec("SELECT id FROM programas").toArray().map((r) => r.id));
    return [...new Set((Array.isArray(lista) ? lista : []).map(Number))].filter((id) => existentes.has(id));
  }

  exportar(u, url) {
    const nombres = new Map(this.sql.exec("SELECT id, nombre FROM programas").toArray().map((p) => [p.id, p.nombre]));
    const fecha = new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const celda = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const lineas = [["Fecha y hora", "Programa", "Apodo", "Mensaje", "Estado", "Quién"].map(celda).join(";")];
    for (const m of this.sql.exec("SELECT * FROM mensajes WHERE disp != 'simulacion' ORDER BY id")) {
      const quien = esEquipo(m.autor) ? "equipo" : m.autor ? "público" : "";
      lineas.push([fecha.format(new Date(m.ts)), nombres.get(m.programa) || "", m.nick, m.texto, m.prod ? "producción" : m.estado, quien].map(celda).join(";"));
    }
    return new Response("\uFEFF" + lineas.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="chat - Brindis Bravo.csv"',
      },
    });
  }
}

// ---------- utilidades ----------

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function origenValido(req) {
  const origen = req.headers.get("Origin");
  if (!origen) return true;
  try {
    return new URL(origen).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

function leerCookie(req, nombre) {
  const c = req.headers.get("Cookie") || "";
  for (const parte of c.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return null;
}

function cookie(nombre, valor, url, maxAge) {
  const seguro = url.protocol === "https:" ? "; Secure" : "";
  return `${nombre}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge)}${seguro}`;
}

const esEquipo = (autor) => typeof autor === "string" && autor.startsWith("u:");


// Para comparar apodos: sin acentos, sin mayúsculas, sin espacios de más.
function normalizarNick(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Sin filtros de contenido: sólo se limpia lo que rompería la pantalla
// (caracteres de control, montañas de acentos combinados, saltos de más).
function limpiarTexto(valor, max, unaLinea) {
  let s = String(valor ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]/g, "")
    .replace(/(\p{M}{2})\p{M}+/gu, "$1");
  s = unaLinea ? s.replace(/\s+/g, " ") : s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  const letras = Array.from(s);
  if (letras.length > max) s = letras.slice(0, max).join("").trim();
  return s;
}

function paraPantalla(m) {
  const equipo = !m.prod && esEquipo(m.autor);
  return { id: m.id, nick: m.nick, texto: m.texto, ts: m.ts, prod: m.prod, equipo: equipo ? 1 : 0, rol: equipo ? m.rol || "productor" : null, autor: m.autor || null };
}

function paraPublico(m) {
  const r = paraPantalla(m);
  if (m.estado === "pendiente") r.revision = 1;
  return r;
}

function validarEncuesta(b) {
  const tipo = b.tipo === "anonima" ? "anonima" : "opciones";
  const pregunta = limpiarTexto(b.pregunta, 140, true);
  if (!pregunta) throw new ErrorApi(400, "Falta la pregunta");
  if (tipo === "anonima") return { pregunta, opciones: [], tipo };
  const opciones = (Array.isArray(b.opciones) ? b.opciones : []).map((o) => limpiarTexto(o, 60, true)).filter(Boolean);
  if (opciones.length < 2 || opciones.length > 6) throw new ErrorApi(400, "Tiene que tener entre 2 y 6 opciones");
  return { pregunta, opciones, tipo };
}

function validarClave(c) {
  const clave = String(c || "");
  if (clave.length < 4 || clave.length > 200) throw new ErrorApi(400, "La clave tiene que tener al menos 4 caracteres");
  return clave;
}

function sanear(actual, parcial, limites) {
  const r = { ...actual };
  for (const [k, lim] of Object.entries(limites)) {
    if (!(k in parcial)) continue;
    const v = parcial[k];
    if (lim === "bool") r[k] = !!v;
    else if (lim === "texto") r[k] = String(v ?? "").trim().slice(0, 300);
    else if (Array.isArray(lim)) {
      const n = Number(v);
      if (Number.isFinite(n)) r[k] = Math.max(lim[0], Math.min(lim[1], n));
    } else if (v && typeof v === "object") r[k] = sanear(actual[k] || {}, v, lim);
  }
  return r;
}
