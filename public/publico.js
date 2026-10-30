// Página del público: entrar con apodo y clave, ver el chat en vivo, escribir y votar.
// Si entra alguien del equipo (con su usuario del panel), además puede moderar
// tocando un mensaje.
(function () {
  "use strict";
  const { Conexion, urlWs, idAleatorio, esc, largo, guardado, colorDe } = window.Comun;
  const $ = (id) => document.getElementById(id);

  let disp = guardado("chat.disp");
  if (!disp || !/^[A-Za-z0-9-]{8,64}$/.test(disp)) {
    disp = idAleatorio();
    guardado("chat.disp", disp);
  }
  let yo = null; // { autor, nick, equipo }
  let estado = { programa: null, pausa: false, maxLargo: 280, intervalo: 3, encuesta: null, silencio: null };
  let con = null;
  let recibido = false;
  let conectado = false;
  let desfase = 0; // reloj del servidor menos reloj local
  let ultimoEnvio = 0;
  let miVoto = null;
  let encuestaVista = null;
  const pendientes = new Map(); // cid -> { texto, li, enviado }
  const porId = new Map(); // id -> { m, li }

  const MOTIVOS = {
    espera: (m) => `Muy rápido: esperá ${m.espera || 1} s y reintentá`,
    pausa: () => "El chat estaba en pausa",
    silencio: () => "Estás silenciado",
    vacio: () => "El mensaje estaba vacío",
    "sin-cuenta": () => "Tenés que volver a entrar",
  };

  const ahora = () => Date.now() + desfase;

  let tToast;
  function toast(texto, malo, accion) {
    const el = $("toast");
    el.textContent = texto;
    el.className = "toast" + (malo ? " malo" : "");
    if (accion) {
      const b = document.createElement("button");
      b.textContent = accion.texto;
      b.onclick = () => {
        el.hidden = true;
        accion.hacer();
      };
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(() => (el.hidden = true), accion ? 6000 : malo ? 4000 : 2200);
  }

  async function post(ruta, datos) {
    let r;
    try {
      r = await fetch("/api/" + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos || {}) });
    } catch {
      throw new Error("Sin conexión. Probá de nuevo.");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Error " + r.status);
    return j;
  }

  // ---------- entrar ----------

  function modoAcceso(modo) {
    $("formNuevo").hidden = modo !== "nuevo";
    $("formEntrar").hidden = modo !== "entrar";
    $("nError").textContent = $("eError").textContent = "";
    (modo === "nuevo" ? $("nNick") : $("eNick")).focus();
  }

  function mostrarAcceso() {
    yo = null;
    if (con) {
      con.cerrar();
      con = null;
    }
    $("chat").hidden = true;
    $("zonaYo").hidden = true;
    $("acceso").hidden = false;
    document.body.classList.remove("equipo");
    const previo = guardado("chat.nick") || "";
    $("nNick").value = $("eNick").value = previo;
    modoAcceso(guardado("chat.cuenta") ? "entrar" : "nuevo");
  }

  document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => modoAcceso(b.dataset.modo)));
  document.querySelectorAll(".verClave").forEach((c) =>
    c.addEventListener("change", () => c.closest("form").querySelectorAll("input[autocomplete$='password']").forEach((i) => (i.type = c.checked ? "text" : "password")))
  );

  $("formNuevo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("nError").textContent = "";
    try {
      const r = await post("chat/registro", { nick: $("nNick").value, clave: $("nClave").value, disp });
      $("nClave").value = "";
      entrar(r.yo);
    } catch (e) {
      $("nError").textContent = e.message;
      if (/ya tiene la cuenta/.test(e.message)) {
        const m = /«(.+)»/.exec(e.message);
        if (m) $("eNick").value = m[1];
      }
    }
  });

  $("formEntrar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("eError").textContent = "";
    try {
      const r = await post("chat/entrar", { nick: $("eNick").value, clave: $("eClave").value });
      $("eClave").value = "";
      entrar(r.yo);
    } catch (e) {
      $("eError").textContent = e.message;
    }
  });

  $("btnSalir").addEventListener("click", async () => {
    if (!confirm("¿Salir del chat? Para volver vas a necesitar tu apodo y tu clave.")) return;
    await post("chat/salir").catch(() => {});
    mostrarAcceso();
  });

  function entrar(quien) {
    yo = quien;
    guardado("chat.nick", yo.nick);
    guardado("chat.cuenta", "1");
    $("acceso").hidden = true;
    $("chat").hidden = false;
    $("zonaYo").hidden = false;
    $("miNick").textContent = yo.nick;
    $("miNick").style.color = yo.equipo ? "var(--acento2)" : colorDe(yo.nick);
    document.body.classList.toggle("equipo", !!yo.equipo);
    conectar();
    pintar();
  }

  async function arrancar() {
    try {
      const r = await (await fetch("/api/chat/yo")).json();
      if (r.yo) return entrar(r.yo);
    } catch {
      return setTimeout(arrancar, 3000);
    }
    mostrarAcceso();
  }

  // ---------- avisos ----------

  function silenciadoPor() {
    return estado.silencio ? Math.max(0, estado.silencio - ahora()) : 0;
  }

  function pintar() {
    const p = estado.programa;
    $("programa").textContent = p ? p.nombre : "";
    $("programa").hidden = !p;
    const g = estado.gente || {};
    $("gente").textContent = `👥 ${g.n || 0} en el chat`;
    $("gente").hidden = !recibido || g.visible === false;
    document.title = "Brindis Bravo" + (p ? " · " + p.nombre : "") + " · Chat en vivo";
    let aviso = "";
    const falta = silenciadoPor();
    if (falta > 0) {
      const min = Math.floor(falta / 60000);
      const seg = Math.floor((falta % 60000) / 1000);
      aviso = `Te silenciaron un rato. Podés volver a escribir en ${min}:${String(seg).padStart(2, "0")}.`;
    } else if (estado.pausa && !(yo && yo.equipo)) aviso = "El chat está en pausa un ratito. Ya vuelve.";
    else if (recibido && !conectado) aviso = "Se cortó la conexión. Reconectando… lo que mandes sale apenas vuelva.";
    const el = $("aviso");
    if (!el.classList.contains("fugaz")) {
      el.textContent = aviso;
      el.hidden = !aviso;
    }
    actualizarContador();
  }

  let tFugaz;
  function avisoFugaz(texto) {
    const el = $("aviso");
    clearTimeout(tFugaz);
    el.textContent = texto;
    el.classList.add("fugaz");
    el.hidden = false;
    tFugaz = setTimeout(() => {
      el.classList.remove("fugaz");
      pintar();
    }, 3000);
  }

  // Cuenta regresiva del silencio.
  setInterval(() => {
    if (estado.silencio) {
      if (silenciadoPor() <= 0) estado.silencio = null;
      pintar();
    }
  }, 1000);

  // ---------- el chat ----------

  const feed = $("feed");
  const cercaDelFinal = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  const alFinal = () => {
    feed.scrollTop = feed.scrollHeight;
    $("nuevos").hidden = true;
  };
  feed.addEventListener("scroll", () => {
    if (cercaDelFinal()) $("nuevos").hidden = true;
  });
  $("nuevos").addEventListener("click", alFinal);

  function htmlMensaje(m, marca) {
    const color = m.prod ? "" : ` style="color:${m.equipo ? "var(--acento2)" : colorDe(m.nick)}"`;
    return (
      '<button type="button" class="borrar-rapido" aria-label="Borrar este mensaje" title="Borrar">✕</button>' +
      `<span class="nick"${color}>${esc(m.nick)}</span>` +
      (m.equipo ? '<span class="insignia">equipo</span>' : "") +
      `<span class="txt">${esc(m.texto)}</span>` +
      (marca ? `<span class="marca-estado">${esc(marca)}</span>` : "")
    );
  }

  function clasesDe(m) {
    return [m.prod ? "prod" : "", yo && m.autor === yo.autor ? "propio" : ""].filter(Boolean).join(" ");
  }

  // Agrega o actualiza un mensaje que vino del servidor.
  function ponerMensaje(m) {
    const ya = porId.get(m.id);
    if (ya) {
      ya.m = m;
      ya.li.dataset.ts = m.ts;
      ya.li.className = clasesDe(m);
      ya.li.innerHTML = htmlMensaje(m, m.revision ? "En revisión: sale cuando lo aprueben" : "");
      return;
    }
    const pegado = cercaDelFinal();
    const li = document.createElement("li");
    li.dataset.id = m.id;
    li.dataset.ts = m.ts;
    li.className = clasesDe(m);
    li.innerHTML = htmlMensaje(m, m.revision ? "En revisión: sale cuando lo aprueben" : "");
    // En orden de hora: un mensaje que vuelve (Deshacer) se ubica donde estaba.
    let antesDe = null;
    for (let el = $("lista").lastElementChild; el; el = el.previousElementSibling) {
      if (Number(el.dataset.ts || Infinity) > m.ts) antesDe = el;
      else break;
    }
    $("lista").insertBefore(li, antesDe);
    porId.set(m.id, { m, li });
    recortar();
    $("feedVacio").hidden = true;
    if (pegado) alFinal();
    else $("nuevos").hidden = false;
  }

  function recortar() {
    const lista = $("lista");
    while (lista.children.length > 200) {
      const viejo = lista.firstElementChild;
      porId.delete(Number(viejo.dataset.id));
      viejo.remove();
    }
  }

  function sacarMensaje(id) {
    const ya = porId.get(id);
    if (!ya) return;
    ya.li.remove();
    porId.delete(id);
    $("feedVacio").hidden = porId.size > 0 || pendientes.size > 0;
  }

  function rearmarFeed(mensajes) {
    $("lista").innerHTML = "";
    porId.clear();
    mensajes.forEach(ponerMensaje);
    // Lo que todavía no se confirmó queda al final, esperando.
    for (const p of pendientes.values()) $("lista").appendChild(p.li);
    $("feedVacio").hidden = mensajes.length > 0 || pendientes.size > 0;
    alFinal();
  }

  // ---------- escribir ----------

  function actualizarContador() {
    const n = largo($("texto").value);
    const max = estado.maxLargo || 280;
    const c = $("contador");
    c.textContent = `${n}/${max}`;
    c.hidden = n < max - 40;
    c.classList.toggle("pasado", n > max);
    const bloqueado = silenciadoPor() > 0 || (estado.pausa && !(yo && yo.equipo));
    $("texto").disabled = silenciadoPor() > 0;
    $("enviar").disabled = bloqueado || !$("texto").value.trim() || n > max;
    // El cuadro crece con el texto (hasta un tope).
    const t = $("texto");
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight + 2, 140) + "px";
  }

  $("texto").addEventListener("input", actualizarContador);
  $("texto").addEventListener("keydown", (ev) => {
    // En la compu, Enter manda y Shift+Enter hace un salto de línea.
    if (ev.key === "Enter" && !ev.shiftKey && !("ontouchstart" in window)) {
      ev.preventDefault();
      enviar();
    }
  });
  $("formMsj").addEventListener("submit", (ev) => {
    ev.preventDefault();
    enviar();
    $("texto").focus();
  });

  function enviar() {
    const texto = $("texto").value.trim();
    if (!texto || largo(texto) > (estado.maxLargo || 280) || silenciadoPor() > 0) return;
    if (estado.pausa && !yo.equipo) return avisoFugaz("El chat está en pausa un ratito");
    const falta = yo.equipo ? 0 : estado.intervalo * 1000 - (Date.now() - ultimoEnvio);
    if (falta > 0) return avisoFugaz(`Esperá ${Math.ceil(falta / 1000)} s para mandar otro`);
    const cid = idAleatorio();
    const li = document.createElement("li");
    li.className = "propio enviando";
    li.innerHTML = htmlMensaje({ nick: yo.nick, texto, equipo: yo.equipo }, "Enviando…");
    $("lista").appendChild(li);
    $("feedVacio").hidden = true;
    pendientes.set(cid, { texto, li, enviado: Date.now() });
    ultimoEnvio = Date.now();
    $("texto").value = "";
    actualizarContador();
    alFinal();
    con.enviar({ t: "msg", cid, texto });
  }

  function reenviarPendientes(soloViejos) {
    for (const [cid, p] of pendientes) {
      if (soloViejos && Date.now() - p.enviado < 8000) continue;
      p.enviado = Date.now();
      con.enviar({ t: "msg", cid, texto: p.texto });
    }
  }

  function alAck(m) {
    const p = pendientes.get(m.cid);
    if (!p) return;
    pendientes.delete(m.cid);
    if (m.ok) {
      if (porId.has(m.id)) {
        p.li.remove(); // ya llegó por el chat
        return;
      }
      const msg = { id: m.id, nick: yo.nick, texto: p.texto, equipo: yo.equipo ? 1 : 0, autor: yo.autor, revision: m.estado === "pendiente" ? 1 : 0 };
      p.li.dataset.id = m.id;
      p.li.dataset.ts = ahora();
      p.li.className = clasesDe(msg);
      p.li.innerHTML = htmlMensaje(msg, msg.revision ? "En revisión: sale cuando lo aprueben" : "");
      porId.set(m.id, { m: msg, li: p.li });
      return;
    }
    if (m.error === "silencio") {
      estado.silencio = m.hasta;
      if (m.ahora) desfase = m.ahora - Date.now();
    }
    if (m.error === "sin-cuenta") return mostrarAcceso();
    p.li.className = "propio error";
    p.li.innerHTML = htmlMensaje({ nick: yo.nick, texto: p.texto, equipo: yo.equipo }, "No salió: " + (MOTIVOS[m.error] || (() => "no se pudo enviar"))(m));
    if (!$("texto").value.trim() && m.error !== "silencio") $("texto").value = p.texto; // se lo devolvemos para reintentar
    pintar();
  }

  // ---------- encuesta ----------

  function pintarEncuesta() {
    const e = estado.encuesta;
    const el = $("encuesta");
    if (!e) {
      el.hidden = true;
      encuestaVista = null;
      return;
    }
    const conteos = e.conteos || e.opciones.map(() => 0);
    const total = conteos.reduce((a, b) => a + b, 0);
    const abierta = e.estado === "abierta";
    const resultados = !abierta || miVoto != null;
    el.innerHTML =
      `<summary><span class="etiqueta">${abierta ? "Encuesta en vivo" : "Resultados"}</span>${esc(e.pregunta)}</summary>` +
      e.opciones
        .map((o, i) => {
          const pct = total ? Math.round((conteos[i] * 100) / total) : 0;
          return (
            `<button type="button" class="opcion${miVoto === i ? " elegida" : ""}" data-i="${i}"${abierta ? "" : " disabled"}>` +
            (resultados ? `<span class="barra" style="width:${pct}%"></span>` : "") +
            `<span class="txt">${esc(o)}</span>` +
            (resultados ? `<span class="pct">${pct}%</span>` : "") +
            `</button>`
          );
        })
        .join("") +
      `<div class="pie">${abierta ? (miVoto == null ? "Tocá una opción para votar" : "¡Votaste! Podés cambiar tu voto") : "Votación cerrada"} · ${total} ${total === 1 ? "voto" : "votos"}</div>`;
    // Una encuesta nueva (o que se vuelve a abrir) aparece desplegada.
    const clave = e.id + ":" + e.estado;
    if (clave !== encuestaVista) el.open = true;
    encuestaVista = clave;
    el.hidden = false;
  }

  $("encuesta").addEventListener("click", (ev) => {
    const b = ev.target.closest(".opcion");
    const e = estado.encuesta;
    if (!b || !e || e.estado !== "abierta") return;
    const opcion = Number(b.dataset.i);
    if (!con.enviar({ t: "voto", encuesta: e.id, opcion })) return avisoFugaz("Sin conexión: probá de nuevo en un segundo");
    miVoto = opcion;
    pintarEncuesta();
  });

  // ---------- acciones del equipo ----------

  let elegido = null;

  $("lista").addEventListener("click", async (ev) => {
    if (!yo || !yo.equipo) return;
    const li = ev.target.closest("li[data-id]");
    const x = li && porId.get(Number(li.dataset.id));
    if (!x) return;
    // La ✕: borra de una, con la posibilidad de deshacerlo.
    if (ev.target.closest(".borrar-rapido")) {
      const id = x.m.id;
      try {
        await post("mensaje/borrar", { id });
        toast("Borrado", false, { texto: "Deshacer", hacer: () => post("mensaje/restaurar", { id }).catch((e) => toast(e.message, true)) });
      } catch (e) {
        toast(e.message, true);
      }
      return;
    }
    elegido = x.m;
    const sancionable = typeof elegido.autor === "string" && elegido.autor.startsWith("c:");
    $("hoja").querySelectorAll(".sancion").forEach((b) => (b.hidden = !sancionable));
    $("hojaMsj").innerHTML = `<b style="color:${colorDe(elegido.nick)}">${esc(elegido.nick)}</b>: ${esc(elegido.texto)}`;
    $("hoja").showModal();
  });

  $("hoja").addEventListener("click", async (ev) => {
    if (ev.target === $("hoja")) return $("hoja").close(); // tocar afuera cierra
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const m = elegido;
    $("hoja").close();
    if (!m || b.dataset.acc === "cancelar") return;
    try {
      if (b.dataset.acc === "destacar") {
        await post("mensaje/destacar", { id: m.id });
        toast("Destacado en la pantalla");
      } else if (b.dataset.acc === "borrar") {
        await post("mensaje/borrar", { id: m.id });
        toast("Borrado");
      } else if (b.dataset.acc === "silencio") {
        await post("sancionar", { id: m.id, tipo: "silencio", minutos: Number(b.dataset.min) });
        toast(`${m.nick}: silenciado ${b.dataset.min === "60" ? "1 hora" : b.dataset.min + " minutos"}`);
      } else if (b.dataset.acc === "veto") {
        if (!confirm(`¿Vetar a "${m.nick}" para siempre?\n\nSe borra todo lo que mandó y lo que mande después no lo ve nadie (no se entera).`)) return;
        await post("sancionar", { id: m.id, tipo: "veto" });
        toast(`${m.nick}: vetado`);
      }
    } catch (e) {
      toast(e.message, true);
    }
  });

  // ---------- conexión ----------

  function alRecibir(m) {
    switch (m.t) {
      case "estado":
        desfase = m.ahora - Date.now();
        estado = { ...estado, ...m };
        if (m.yo) {
          yo = m.yo;
          $("miNick").textContent = yo.nick;
        }
        miVoto = m.encuesta ? m.encuesta.miVoto : null;
        recibido = true;
        rearmarFeed(m.mensajes || []);
        pintarEncuesta();
        pintar();
        if (!m.yo) mostrarAcceso(); // la sesión venció
        break;
      case "msg":
        ponerMensaje(m.m);
        break;
      case "borrar":
        sacarMensaje(m.id);
        break;
      case "ack":
        alAck(m);
        break;
      case "silencio":
        if (m.ahora) desfase = m.ahora - Date.now();
        estado.silencio = m.hasta;
        pintar();
        break;
      case "encuesta":
        estado.encuesta = m.e;
        miVoto = m.e ? m.e.miVoto : null;
        pintarEncuesta();
        break;
      case "votos":
        if (estado.encuesta && estado.encuesta.id === m.encuesta) {
          estado.encuesta.conteos = m.conteos;
          pintarEncuesta();
        }
        break;
      case "voto":
        if (!m.ok) {
          miVoto = null;
          avisoFugaz("La votación ya se cerró");
        }
        pintarEncuesta();
        break;
      case "programa":
        estado.programa = m.programa;
        pintar();
        break;
      case "gente":
        estado.gente = { n: m.n, visible: m.visible };
        pintar();
        break;
      case "pausa":
        estado.pausa = m.valor;
        pintar();
        break;
      case "intervalo":
        estado.intervalo = m.valor;
        break;
    }
  }

  function conectar() {
    if (con) con.cerrar();
    recibido = false;
    con = new Conexion(urlWs("rol=publico&disp=" + encodeURIComponent(disp)), {
      alRecibir,
      alAbrir: () => reenviarPendientes(false),
      alCambiarEstado: (s) => {
        conectado = s === "conectado";
        $("punto").className = "punto " + s;
        pintar();
      },
    });
  }

  // Si un mensaje quedó sin confirmar (se perdió en el camino), se reintenta.
  setInterval(() => {
    if (con && con.abierta()) reenviarPendientes(true);
  }, 4000);

  arrancar();
})();
