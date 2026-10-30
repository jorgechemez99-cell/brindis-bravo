// La puerta de entrada (la abre el QR): entrar o crear la cuenta, y cada uno ve lo suyo.
//   - Público: no ve el chat. Escribe, ve los destacados un rato y las encuestas (que saltan).
//   - Conductor: el chat completo; escribe y destaca.
//   - Productor: el chat completo con todo para moderar y armar encuestas.
//   - Admin: va al panel (con ?chat=1 se queda en el chat, como productor).
(function () {
  "use strict";
  const { Conexion, urlWs, idAleatorio, esc, largo, guardado, colorDe, iconoRol } = window.Comun;
  const $ = (id) => document.getElementById(id);

  let disp = guardado("chat.disp");
  if (!disp || !/^[A-Za-z0-9-]{8,64}$/.test(disp)) {
    disp = idAleatorio();
    guardado("chat.disp", disp);
  }
  let yo = null; // { autor, nick, equipo, rol }
  let estado = { programa: null, pausa: false, maxLargo: 280, intervalo: 3, encuesta: null, silencio: null };
  let con = null;
  let recibido = false;
  let conectado = false;
  let desfase = 0; // reloj del servidor menos reloj local
  let ultimoEnvio = 0;
  let miVoto = null;
  let encuestaVista = null;
  let emergenteVista = null;
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
  const rol = () => (yo && yo.rol) || "publico";
  const esModerador = () => rol() === "admin" || rol() === "productor";
  const veTodo = () => rol() !== "publico";
  const DESTACADO_PUBLICO_MS = 15000; // cuánto le queda a la vista al público un destacado
  const enRevision = new Set(); // ids de mensajes propios que esperan aprobación (vista del público)

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
    document.body.classList.remove("moderador", "conductor", "propia");
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
    // El admin trabaja en el panel; desde ahí puede volver al chat con ?chat=1.
    if (rol() === "admin" && !new URLSearchParams(location.search).has("chat")) return location.replace("/panel");
    $("acceso").hidden = true;
    $("chat").hidden = false;
    $("zonaYo").hidden = false;
    $("miNick").innerHTML = (yo.equipo ? iconoRol(yo.rol) : "") + esc(yo.nick);
    $("miNick").style.color = yo.equipo ? "var(--acento2)" : colorDe(yo.nick);
    $("btnProd").hidden = !esModerador();
    document.body.classList.toggle("moderador", esModerador());
    document.body.classList.toggle("conductor", rol() === "conductor");
    document.body.classList.toggle("propia", !veTodo());
    $("linkPanel").hidden = !esModerador();
    $("herramientas").hidden = !veTodo();
    $("btnEncuestas").hidden = !esModerador();
    $("rolTexto").textContent = { admin: "Admin: tocá un mensaje para moderarlo", productor: "Productor: tocá un mensaje para moderarlo", conductor: "Conducción: tocá un mensaje para destacarlo" }[rol()] || "";
    $("feedVacio").textContent = "Todavía no hay mensajes.";
    $("feed").hidden = !veTodo();
    $("panelPublico").hidden = veTodo();
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
      (m.equipo ? iconoRol(m.rol) : "") +
      `<span class="nick"${color}>${esc(m.nick)}</span>` +
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
    li.className = clasesDe(m);
    li.innerHTML = htmlMensaje(m, m.revision ? "En revisión: sale cuando lo aprueben" : "");
    insertarEnOrden(li, m.ts);
    porId.set(m.id, { m, li });
    marcarDestacado();
    if (pegado) alFinal();
    else $("nuevos").hidden = false;
  }

  // En orden de hora: un mensaje que vuelve (Deshacer) se ubica donde estaba.
  function insertarEnOrden(li, ts) {
    li.dataset.ts = ts;
    let antesDe = null;
    for (let el = $("lista").lastElementChild; el; el = el.previousElementSibling) {
      if (Number(el.dataset.ts || Infinity) > ts) antesDe = el;
      else break;
    }
    $("lista").insertBefore(li, antesDe);
    recortar();
    $("feedVacio").hidden = true;
  }

  // Lo destacado en la pantalla: el equipo lo ve marcado con ★ en el chat; al público le
  // aparece una tarjeta un rato (y si es su mensaje, se entera).
  let tDestacado;
  function ponerDestacado(d) {
    estado.destacado = d;
    marcarDestacado();
    if (veTodo()) return;
    const el = $("destacadoPublico");
    clearTimeout(tDestacado);
    const queda = d ? DESTACADO_PUBLICO_MS - (ahora() - d.desde) : 0;
    if (queda <= 0) {
      el.hidden = true;
      return;
    }
    const mio = yo && d.autor === yo.autor;
    el.className = "destacado-publico" + (mio ? " mio" : "");
    el.innerHTML =
      `<span class="etiqueta-dest">${mio ? "⭐ ¡Destacaron tu mensaje en la pantalla!" : "⭐ Destacado en la pantalla"}</span>` +
      `<span class="nick" style="color:${d.prod ? "var(--acento2)" : colorDe(d.nick)}">${esc(d.nick)}</span><span class="txt">${esc(d.texto)}</span>`;
    el.hidden = false;
    tDestacado = setTimeout(() => {
      el.classList.add("sale");
      tDestacado = setTimeout(() => (el.hidden = true), 600);
    }, queda);
  }

  // 📢 Aviso de la producción: al público le aparece un rato, como un destacado.
  let tAviso;
  function mostrarAviso(m) {
    const el = $("avisoPublico");
    clearTimeout(tAviso);
    el.className = "destacado-publico aviso-prod";
    el.dataset.id = m.id;
    el.innerHTML = `<span class="etiqueta-dest">📢 ${esc(m.nick)}</span><span class="txt">${esc(m.texto)}</span>`;
    el.hidden = false;
    tAviso = setTimeout(() => {
      el.classList.add("sale");
      tAviso = setTimeout(() => (el.hidden = true), 600);
    }, DESTACADO_PUBLICO_MS);
  }

  // Al público, en vez de una lista, una línea que le dice cómo le fue a lo que mandó.
  let tEnvio;
  function estadoEnvio(texto, tipo = "", ms = 4000) {
    const el = $("estadoEnvio");
    clearTimeout(tEnvio);
    el.textContent = texto;
    el.className = "estado-envio " + tipo;
    el.hidden = false;
    if (ms) tEnvio = setTimeout(() => (el.hidden = true), ms);
  }

  function marcarDestacado() {
    if (!veTodo()) return;
    const d = estado.destacado;
    for (const { m, li } of porId.values()) li.classList.toggle("es-destacado", !!d && d.id === m.id);
  }

  function recortar() {
    const lista = $("lista");
    while (lista.children.length > 200) {
      const viejo = lista.firstElementChild;
      if (viejo.dataset.id) porId.delete(Number(viejo.dataset.id));
      viejo.remove();
    }
  }

  function sacarMensaje(id) {
    const ya = porId.get(id);
    if (!ya) return;
    ya.li.remove();
    porId.delete(id);
    $("feedVacio").hidden = $("lista").children.length > 0;
  }

  function rearmarFeed(mensajes) {
    $("lista").innerHTML = "";
    porId.clear();
    mensajes.forEach(ponerMensaje);
    ponerDestacado(estado.destacado);
    // Lo que todavía no se confirmó queda al final, esperando.
    if (veTodo()) for (const p of pendientes.values()) $("lista").appendChild(p.li);
    $("feedVacio").hidden = $("lista").children.length > 0;
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

  // 📢 Mensaje de la producción (como el del panel): sale resaltado en la pantalla y le llega a todos.
  let modoProd = false;
  $("btnProd").addEventListener("click", () => {
    modoProd = !modoProd;
    $("btnProd").classList.toggle("activo", modoProd);
    $("btnProd").setAttribute("aria-pressed", String(modoProd));
    $("formMsj").classList.toggle("modo-prod", modoProd);
    $("texto").placeholder = modoProd ? "Mensaje de la producción (sale resaltado)…" : "Escribí tu comentario…";
    $("texto").focus();
  });

  async function enviarProduccion(texto) {
    $("texto").value = "";
    actualizarContador();
    try {
      await post("mensaje/produccion", { texto });
      toast("📢 Salió como mensaje de la producción");
    } catch (e) {
      $("texto").value = texto;
      actualizarContador();
      toast(e.message, true);
    }
  }

  function enviar() {
    const texto = $("texto").value.trim();
    if (!texto || largo(texto) > (estado.maxLargo || 280) || silenciadoPor() > 0) return;
    if (modoProd && esModerador()) return enviarProduccion(texto);
    if (estado.pausa && !yo.equipo) return avisoFugaz("El chat está en pausa un ratito");
    const falta = yo.equipo ? 0 : estado.intervalo * 1000 - (Date.now() - ultimoEnvio);
    if (falta > 0) return avisoFugaz(`Esperá ${Math.ceil(falta / 1000)} s para mandar otro`);
    const cid = idAleatorio();
    const li = document.createElement("li");
    li.className = "propio enviando";
    li.innerHTML = htmlMensaje({ nick: yo.nick, texto, equipo: yo.equipo, rol: yo.rol }, "Enviando…");
    if (veTodo()) {
      $("lista").appendChild(li);
      $("feedVacio").hidden = true;
    } else estadoEnvio("Enviando…", "espera", 0);
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
    if (m.ok && !veTodo()) {
      if (m.estado === "pendiente") enRevision.add(m.id);
      estadoEnvio(m.estado === "pendiente" ? "Lo están revisando: sale en la pantalla cuando lo aprueben" : "✓ Tu mensaje salió en la pantalla", m.estado === "pendiente" ? "espera" : "", m.estado === "pendiente" ? 0 : 4000);
      return;
    }
    if (m.ok) {
      if (porId.has(m.id)) {
        p.li.remove(); // ya llegó por el chat
        return;
      }
      const msg = { id: m.id, nick: yo.nick, texto: p.texto, equipo: yo.equipo ? 1 : 0, rol: yo.rol, autor: yo.autor, revision: m.estado === "pendiente" ? 1 : 0 };
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
    if (!veTodo()) estadoEnvio("No salió: " + (MOTIVOS[m.error] || (() => "no se pudo enviar"))(m), "malo", 6000);
    p.li.className = "propio error";
    p.li.innerHTML = htmlMensaje({ nick: yo.nick, texto: p.texto, equipo: yo.equipo, rol: yo.rol }, "No salió: " + (MOTIVOS[m.error] || (() => "no se pudo enviar"))(m));
    if (!$("texto").value.trim() && m.error !== "silencio") $("texto").value = p.texto; // se lo devolvemos para reintentar
    pintar();
  }

  // ---------- encuesta ----------

  function htmlOpciones(e) {
    const conteos = e.conteos || e.opciones.map(() => 0);
    const total = conteos.reduce((a, b) => a + b, 0);
    const abierta = e.estado === "abierta";
    const resultados = !abierta || miVoto != null;
    return (
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
      `<div class="pie">${abierta ? (miVoto == null ? "Tocá una opción para votar" : "¡Votaste! Podés cambiar tu voto") : "Votación cerrada"} · ${total} ${total === 1 ? "voto" : "votos"}</div>`
    );
  }

  function pintarEncuesta() {
    const e = estado.encuesta;
    const el = $("encuesta");
    if (!e) {
      el.hidden = true;
      encuestaVista = null;
      if ($("emergente").open) $("emergente").close();
      return;
    }
    const abierta = e.estado === "abierta";
    el.innerHTML = `<summary><span class="etiqueta">${abierta ? "Encuesta en vivo" : "Resultados"}</span>${esc(e.pregunta)}</summary>` + htmlOpciones(e);
    const clave = e.id + ":" + e.estado;
    // Al público, una encuesta nueva (o que se vuelve a abrir) le salta en el medio de la pantalla.
    if (!veTodo() && abierta && miVoto == null && clave !== emergenteVista && !$("emergente").open) {
      emergenteVista = clave;
      $("emergente").showModal();
    }
    if ($("emergente").open) $("emergenteCuerpo").innerHTML = `<span class="etiqueta">Encuesta en vivo</span><h3>${esc(e.pregunta)}</h3>` + htmlOpciones(e);
    // Arriba queda la tarjeta: desplegada para el equipo, cerrada para el público (ya le saltó).
    if (clave !== encuestaVista) el.open = veTodo();
    encuestaVista = clave;
    el.hidden = false;
  }

  function votar(ev) {
    const b = ev.target.closest(".opcion");
    const e = estado.encuesta;
    if (!b || !e || e.estado !== "abierta") return;
    const opcion = Number(b.dataset.i);
    if (!con.enviar({ t: "voto", encuesta: e.id, opcion })) return avisoFugaz("Sin conexión: probá de nuevo en un segundo");
    miVoto = opcion;
    pintarEncuesta();
    // Después de votar, la que saltó se va sola (quedan los resultados arriba).
    if ($("emergente").open) setTimeout(() => $("emergente").open && $("emergente").close(), 1500);
  }
  $("encuesta").addEventListener("click", votar);
  $("emergente").addEventListener("click", (ev) => {
    if (ev.target === $("emergente")) return $("emergente").close(); // tocar afuera cierra
    votar(ev);
  });
  $("emergenteCerrar").addEventListener("click", () => $("emergente").close());

  // ---------- acciones del equipo ----------

  let elegido = null;

  $("lista").addEventListener("click", async (ev) => {
    if (!veTodo()) return;
    const li = ev.target.closest("li[data-id]");
    const x = li && porId.get(Number(li.dataset.id));
    if (!x) return;
    // La ✕: borra de una, con la posibilidad de deshacerlo.
    if (ev.target.closest(".borrar-rapido") && esModerador()) {
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
    $("hoja").querySelectorAll(".moderar").forEach((b) => (b.hidden = !esModerador()));
    $("hoja").querySelectorAll(".sancion").forEach((b) => (b.hidden = !esModerador() || !sancionable));
    const yaDestacado = !!estado.destacado && estado.destacado.id === elegido.id;
    $("hoja").querySelector('[data-acc="destacar"]').hidden = yaDestacado;
    $("hoja").querySelector('[data-acc="quitar"]').hidden = !yaDestacado;
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
      } else if (b.dataset.acc === "quitar") {
        await post("destacado/quitar");
        toast("Se sacó el destacado");
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

  // ---------- armar encuestas (productores) ----------

  function ponerOpcionesEnc(n) {
    $("encOpciones").innerHTML = "";
    for (let i = 0; i < n; i++) agregarOpcionEnc();
  }

  function agregarOpcionEnc() {
    const n = $("encOpciones").children.length;
    if (n >= 6) return;
    const i = document.createElement("input");
    i.maxLength = 60;
    i.placeholder = "Opción " + (n + 1);
    $("encOpciones").appendChild(i);
  }

  async function cargarEncuestas() {
    let d;
    try {
      d = await (await fetch("/api/encuestas")).json();
    } catch {
      return;
    }
    const actual = (d.encuestas || []).find((e) => e.id === d.enPantalla);
    $("encActual").innerHTML = actual
      ? `<h3>En pantalla</h3><div class="enc-item"><div class="pregunta-enc">${esc(actual.pregunta)}</div>` +
        `<div class="estado-enc">${actual.estado === "abierta" ? "Votando ahora" : "Mostrando resultados"} · ${(actual.conteos || []).reduce((a, b) => a + b, 0)} votos</div>` +
        (actual.estado === "abierta" ? `<button type="button" data-enc="cerrar" data-id="${actual.id}" class="principal">Cerrar la votación</button>` : "") +
        `<button type="button" data-enc="ocultar" class="secundario">Sacarla de la pantalla</button></div>`
      : "";
    const preparadas = (d.encuestas || []).filter((e) => e.estado === "borrador");
    $("encLista").innerHTML = preparadas.length
      ? "<h3>Preparadas</h3>" +
        preparadas
          .map(
            (e) =>
              `<div class="enc-item"><div class="pregunta-enc">${esc(e.pregunta)}</div><div class="estado-enc">${e.opciones.map(esc).join(" · ")}</div>` +
              `<button type="button" data-enc="lanzar" data-id="${e.id}" class="principal">Lanzar</button></div>`
          )
          .join("")
      : "";
  }

  $("btnEncuestas").addEventListener("click", () => {
    $("encError").textContent = "";
    if (!$("encPregunta").value) ponerOpcionesEnc(2);
    $("dlgEncuestas").showModal();
    cargarEncuestas();
  });
  $("encCerrarDlg").addEventListener("click", () => $("dlgEncuestas").close());
  $("encMas").addEventListener("click", agregarOpcionEnc);

  async function crearEncuesta(lanzar) {
    $("encError").textContent = "";
    const datos = { pregunta: $("encPregunta").value, opciones: [...$("encOpciones").querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean) };
    try {
      const { id } = await post("encuesta/crear", datos);
      if (lanzar) await post("encuesta/abrir", { id });
      $("encPregunta").value = "";
      ponerOpcionesEnc(2);
      toast(lanzar ? "¡Encuesta lanzada!" : "Encuesta guardada");
      if (lanzar) $("dlgEncuestas").close();
      else cargarEncuestas();
    } catch (e) {
      $("encError").textContent = e.message;
    }
  }

  $("formEncuesta").addEventListener("submit", (ev) => {
    ev.preventDefault();
    crearEncuesta(true);
  });
  $("encGuardar").addEventListener("click", () => crearEncuesta(false));

  $("dlgEncuestas").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-enc]");
    if (!b) return;
    const id = Number(b.dataset.id);
    try {
      if (b.dataset.enc === "lanzar") {
        await post("encuesta/abrir", { id });
        toast("¡Encuesta lanzada!");
        $("dlgEncuestas").close();
      } else if (b.dataset.enc === "cerrar") {
        await post("encuesta/cerrar", { id });
        toast("Votación cerrada");
      } else if (b.dataset.enc === "ocultar") {
        await post("encuesta/ocultar");
        toast("Encuesta fuera de la pantalla");
      }
      cargarEncuestas();
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
          $("miNick").innerHTML = (yo.equipo ? iconoRol(yo.rol) : "") + esc(yo.nick);
        }
        miVoto = m.encuesta ? m.encuesta.miVoto : null;
        if (m.encuesta && m.encuesta.miVoto != null) emergenteVista = m.encuesta.id + ":" + m.encuesta.estado; // ya votó: no salta
        recibido = true;
        rearmarFeed(m.mensajes || []);
        pintarEncuesta();
        pintar();
        if (!m.yo) mostrarAcceso(); // la sesión venció
        break;
      case "msg":
        // Al público sólo le llega lo suyo, cuando lo aprueban (si estaba en revisión).
        if (veTodo()) ponerMensaje(m.m);
        else if (m.m.prod) mostrarAviso(m.m);
        else if (enRevision.delete(m.m.id)) estadoEnvio("✓ Aprobaron tu mensaje: salió en la pantalla");
        break;
      case "borrar":
        if (veTodo()) sacarMensaje(m.id);
        else if ($("avisoPublico").dataset.id === String(m.id)) $("avisoPublico").hidden = true; // borraron el aviso
        break;
      case "destacado":
        ponerDestacado(m.d);
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
        if ($("dlgEncuestas").open) cargarEncuestas();
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
