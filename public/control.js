// Control del show para tablet (admin y producción): el chat siempre a la vista y, al costado,
// avisos, encuestas, lo que se ve en la pantalla y la moderación. Todo con el dedo:
// deslizar un mensaje (➜ destacar, ⬅ borrar), mantenerlo apretado (más opciones),
// pasar las pestañas deslizando y acomodar la pantalla arrastrando y pellizcando.
// Usa las mismas cuentas y la misma API que el panel.
(function () {
  "use strict";
  const { Conexion, urlWs, esc, nTinta, servidor, iconoRol, ROLES, guardado } = window.Comun;
  const $ = (id) => document.getElementById(id);
  const tintaDe = (nick) => `var(--t${nTinta(nick)})`;
  const vibrar = (ms = 12) => {
    try {
      navigator.vibrate && navigator.vibrate(ms);
    } catch {}
  };
  const hora = (ts) => new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  const S = {
    yo: null,
    programas: [],
    aire: null,
    pausa: false,
    aprobacion: false,
    ajustes: null,
    intervalo: 3,
    destacado: null,
    encuestaPantalla: null,
    encuestas: [],
    sanciones: [],
    conteo: { pantallas: 0, publico: 0 },
    ahora: 0,
  };
  const feed = new Map(); // id -> { m, li }
  let con = null;
  let desfase = 0; // reloj del servidor menos el de la tablet
  let editandoHasta = 0; // mientras se mueve algo, no se pisa con lo que llega

  // ---------- avisos en pantalla (con "Deshacer" cuando se puede) ----------

  let tToast;
  function toast(texto, { malo = false, deshacer = null, ms } = {}) {
    $("toastTexto").textContent = texto;
    $("toast").className = "toast" + (malo ? " malo" : "");
    $("toastDeshacer").hidden = !deshacer;
    $("toastDeshacer").onclick = () => {
      $("toast").hidden = true;
      deshacer && deshacer();
    };
    $("toast").hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(() => ($("toast").hidden = true), ms || (deshacer ? 6000 : malo ? 4500 : 2200));
  }

  async function api(ruta, datos) {
    let r;
    try {
      r = await fetch("/api/" + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos || {}) });
    } catch {
      toast("Sin conexión con el servidor", { malo: true });
      throw new Error("red");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && ruta !== "login") mostrarLogin();
      const e = new Error(j.error || "Error " + r.status);
      if (ruta !== "login") toast(e.message, { malo: true });
      throw e;
    }
    return j;
  }

  const accion = (ruta, datos, ok) =>
    api(ruta, datos).then(
      (j) => (ok && toast(ok), j),
      () => null
    );

  // Botones que piden un segundo toque para confirmar (en una tablet se toca sin querer).
  function dosToques(boton, texto, alConfirmar) {
    if (boton.dataset.armado) {
      delete boton.dataset.armado;
      clearTimeout(boton.tArmado);
      boton.innerHTML = boton.dataset.original;
      boton.classList.remove("armado");
      return alConfirmar();
    }
    boton.dataset.original = boton.innerHTML;
    boton.dataset.armado = "1";
    boton.textContent = texto;
    boton.classList.add("armado");
    vibrar(8);
    boton.tArmado = setTimeout(() => {
      delete boton.dataset.armado;
      boton.innerHTML = boton.dataset.original;
      boton.classList.remove("armado");
    }, 3000);
  }

  // ---------- tema ----------

  function ponerTema(t) {
    document.documentElement.dataset.tema = t;
    document.querySelector('meta[name="theme-color"]').content = t === "oscuro" ? "#1c1a19" : "#f8efe8";
    $("btnTema").textContent = t === "oscuro" ? "☀️ Tema claro" : "🌙 Tema oscuro";
  }
  ponerTema(document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro");
  $("btnTema").addEventListener("click", () => {
    const t = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
    guardado("chat.tema", t);
    ponerTema(t);
  });

  // ---------- sesión ----------

  async function arrancar() {
    let r = null;
    try {
      r = await fetch("/api/yo");
    } catch {}
    if (!r) {
      toast("Sin conexión, reintentando…", { malo: true });
      return setTimeout(arrancar, 3000);
    }
    if (r.ok) iniciar(await r.json());
    else mostrarLogin();
  }

  function mostrarLogin() {
    if (con) {
      con.cerrar();
      con = null;
    }
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    $("app").hidden = true;
    $("login").hidden = false;
    ($("lUsuario").value ? $("lClave") : $("lUsuario")).focus();
  }

  $("formLogin").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("lError").textContent = "";
    try {
      await api("login", { usuario: $("lUsuario").value.trim(), clave: $("lClave").value });
      $("lClave").value = "";
      arrancar();
    } catch (e) {
      $("lError").textContent = e.message;
    }
  });

  $("btnSalir").addEventListener("click", async () => {
    $("hojaMenu").close();
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    mostrarLogin();
  });

  function iniciar(yo) {
    // Conducción usa el chat del celu; esta app es para admin y producción.
    if (yo && yo.rol === "conductor") return location.replace("/");
    $("login").hidden = true;
    $("app").hidden = false;
    requestAnimationFrame(() => irA(tabActual, false)); // recién ahora las hojas tienen ancho
    pedirPantallaPrendida();
    if (con) return;
    con = new Conexion(urlWs("rol=panel"), { alRecibir, alCambiarEstado });
  }

  function alCambiarEstado(estado, fallos) {
    $("cConexion").className = "punto " + (estado === "conectado" ? "ok" : "mal");
    $("cConexion").title = estado === "conectado" ? "En línea" : "Reconectando…";
    if (estado === "desconectado" && fallos >= 2)
      fetch("/api/yo")
        .then((r) => r.status === 401 && mostrarLogin())
        .catch(() => {});
  }

  // ---------- lo que llega del servidor ----------

  function alRecibir(m) {
    switch (m.t) {
      case "estado":
        aplicarConfig(m);
        feed.clear();
        $("feed").innerHTML = "";
        m.mensajes.forEach((x) => agregarAlFeed(x));
        pintarFeedVacio();
        break;
      case "config":
        aplicarConfig(m);
        break;
      case "msg":
        agregarAlFeed(m.m, true);
        pintarFeedVacio();
        break;
      case "msgEstado": {
        const f = feed.get(m.id);
        if (f) {
          f.m.estado = m.estado;
          if (m.ts) f.m.ts = m.ts;
          pintarMensaje(f.li, f.m);
          contarPendientes();
        }
        break;
      }
      case "conteo":
        S.conteo = m;
        pintarContadores();
        break;
      case "votos": {
        const e = S.encuestas.find((x) => x.id === m.encuesta);
        if (e) {
          e.conteos = m.conteos;
          pintarEncuestas();
        }
        break;
      }
      case "respuesta":
        if (respuestas[m.encuesta]) {
          respuestas[m.encuesta].unshift(m.r);
          pintarEncuestas();
        }
        break;
      case "respuestas": {
        const e = S.encuestas.find((x) => x.id === m.encuesta);
        if (e) {
          e.respuestas = m.n;
          pintarEncuestas();
        }
        break;
      }
      case "salir":
        mostrarLogin();
        break;
    }
  }

  function aplicarConfig(m) {
    const editando = Date.now() < editandoHasta;
    for (const k of Object.keys(S)) {
      if (!(k in m)) continue;
      if (editando && (k === "ajustes" || k === "intervalo")) continue;
      S[k] = m[k];
    }
    if (m.ahora) desfase = m.ahora - Date.now();
    pintarBarra();
    pintarContadores();
    pintarDestacado();
    marcarEnPantalla();
    pintarSanciones();
    pintarEncuestas();
    pintarPantalla();
    $("menuQuien").textContent = S.yo ? `${S.yo.usuario} · ${(ROLES[S.yo.rol] || ["", S.yo.rol])[1]}` : "";
  }

  // ---------- barra de arriba ----------

  function pintarBarra() {
    const p = S.programas.find((x) => x.id === S.aire);
    $("txtPrograma").textContent = p ? p.nombre : "Sin programa";
    $("btnPausa").setAttribute("aria-pressed", S.pausa);
    $("btnPausa").textContent = S.pausa ? "▶ Chat en pausa" : "⏸ Pausar chat";
    $("btnAprob").setAttribute("aria-pressed", S.aprobacion);
  }

  function pintarContadores() {
    const n = S.conteo.pantallas;
    $("cPantallas").textContent = `🖥 ${n}`;
    $("cPantallas").title = `${n} ${n === 1 ? "pantalla conectada" : "pantallas conectadas"}`;
    $("cPantallas").classList.toggle("malo", n === 0);
    $("cPublico").textContent = `👥 ${S.conteo.publico}`;
    $("cPublico").title = `${S.conteo.publico} en el chat`;
  }

  $("btnPausa").addEventListener("click", () => accion("pausa", { valor: !S.pausa }, S.pausa ? "Chat abierto" : "Chat en pausa"));
  $("btnAprob").addEventListener("click", () =>
    accion("aprobacion", { valor: !S.aprobacion }, S.aprobacion ? "Los mensajes salen solos" : "Ahora cada mensaje espera tu OK")
  );
  $("btnLimpiar").addEventListener("click", (ev) => dosToques(ev.currentTarget, "¿Limpiar? Tocá de nuevo", () => accion("limpiar", {}, "Pantalla limpia")));

  $("btnPrograma").addEventListener("click", () => {
    const opciones = [{ id: null, nombre: "Sin programa" }, ...S.programas];
    $("listaProgramas").innerHTML = opciones
      .map((p) => `<button class="boton grande ${p.id === S.aire ? "" : "secundario"}" data-id="${p.id ?? ""}">${p.id === S.aire ? "● " : ""}${esc(p.nombre)}</button>`)
      .join("");
    $("hojaPrograma").showModal();
  });
  $("listaProgramas").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-id]");
    if (!b) return;
    $("hojaPrograma").close();
    const id = b.dataset.id ? Number(b.dataset.id) : null;
    accion("aire", { programa: id }, id ? "Ahora: " + b.textContent.replace("● ", "") : "Sin programa");
  });

  $("btnMenu").addEventListener("click", () => $("hojaMenu").showModal());
  document.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  // Tocar afuera de una hoja la cierra (sólo si el toque empezó afuera, no el que la abrió).
  document.querySelectorAll("dialog.hoja").forEach((d) => {
    d.addEventListener("pointerdown", (ev) => (d.toqueAfuera = ev.target === d));
    d.addEventListener("click", (ev) => {
      if (ev.target === d && d.toqueAfuera) d.close();
      d.toqueAfuera = false;
    });
  });

  // ---------- el chat ----------

  const delPublico = (m) => typeof m.autor === "string" && m.autor.startsWith("c:");
  const delEquipo = (m) => typeof m.autor === "string" && m.autor.startsWith("u:");
  const destacadoVigente = () => {
    const d = S.destacado;
    return d && (!d.hasta || Date.now() + desfase < d.hasta) ? d : null;
  };

  function agregarAlFeed(m, nuevo) {
    const ya = feed.get(m.id);
    if (ya) {
      Object.assign(ya.m, m);
      pintarMensaje(ya.li, ya.m);
      return;
    }
    const li = document.createElement("li");
    li.dataset.id = m.id;
    li.innerHTML = '<div class="detras"><span class="izq"></span><span class="der">🗑 Borrar</span></div><div class="msj"></div>';
    pintarMensaje(li, m);
    $("feed").prepend(li);
    feed.set(m.id, { m, li });
    while (feed.size > 300) {
      const viejo = feed.keys().next().value;
      feed.get(viejo).li.remove();
      feed.delete(viejo);
    }
    if (nuevo && m.estado === "pendiente") vibrar(20);
    contarPendientes();
  }

  const CHIPS = {
    pendiente: '<span class="chip amarillo">espera tu OK</span>',
    borrado: '<span class="chip">borrado</span>',
    bloqueado: '<span class="chip">bloqueado</span>',
    vetado: '<span class="chip">vetado</span>',
  };

  function pintarMensaje(li, m) {
    const d = destacadoVigente();
    li.className = (m.estado || "ok") + (m.prod ? " prod" : "") + (d && d.id === m.id ? " en-pantalla" : "");
    const etiqueta = m.prod
      ? '<span class="chip verde">📢 producción</span>'
      : m.disp === "simulacion"
        ? '<span class="chip">simulado</span>'
        : delEquipo(m)
          ? `<span class="chip amarillo">${iconoRol(m.rol)} ${(ROLES[m.rol] || ROLES.productor)[1]}</span>`
          : "";
    li.querySelector(".izq").textContent = m.estado === "pendiente" ? "✓ Aprobar" : m.estado === "borrado" ? "↩ Restaurar" : "★ Destacar";
    li.querySelector(".msj").innerHTML =
      `<div class="meta"><span class="nick" style="color:${m.prod ? "var(--acento)" : tintaDe(m.nick)}">${esc(m.nick)}</span>` +
      `<span class="hora">${hora(m.ts)}</span>${CHIPS[m.estado] || ""}${etiqueta}${d && d.id === m.id ? '<span class="chip amarillo">★ en pantalla</span>' : ""}</div>` +
      `<div class="texto">${esc(m.texto)}</div>` +
      (m.estado === "pendiente" ? '<button class="boton aprobar" data-acc="aprobar">✓ Aprobar</button>' : "");
  }

  function marcarEnPantalla() {
    for (const { li, m } of feed.values()) {
      const tenia = li.classList.contains("en-pantalla");
      const d = destacadoVigente();
      if (tenia !== !!(d && d.id === m.id)) pintarMensaje(li, m);
    }
  }

  function pintarFeedVacio() {
    $("feedVacio").hidden = feed.size > 0;
  }

  function contarPendientes() {
    let n = 0;
    for (const { m } of feed.values()) if (m.estado === "pendiente") n++;
    $("nPendientes").hidden = !n;
    $("nPendientes").textContent = `${n} ${n === 1 ? "espera" : "esperan"} tu OK`;
  }

  // Deslizar y mantener apretado, para el chat y para las respuestas de las cajas anónimas.
  function hacerDeslizable(contenedor, selector, { puede, alDeslizar, alApretar, alTocar }) {
    let g = null;
    contenedor.addEventListener("contextmenu", (ev) => ev.target.closest(selector) && ev.preventDefault());
    contenedor.addEventListener("pointerdown", (ev) => {
      if (ev.button > 0) return;
      const carta = ev.target.closest(selector);
      if (!carta || ev.target.closest("button, a, input, select, textarea")) return;
      const li = carta.parentElement;
      g = { li, carta, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, modo: null, dx: 0, listo: false, ancho: carta.offsetWidth };
      if (alApretar)
        g.tApretar = setTimeout(() => {
          if (!g || g.modo) return;
          g.modo = "apretado";
          li.classList.add("apretado");
          vibrar(25);
          alApretar(li);
        }, 520);
    });
    contenedor.addEventListener("pointermove", (ev) => {
      if (!g || ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x0;
      const dy = ev.clientY - g.y0;
      if (!g.modo) {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          g.modo = "desliza";
          clearTimeout(g.tApretar);
          g.li.classList.add("arrastrando");
          try {
            g.carta.setPointerCapture(ev.pointerId);
          } catch {}
        } else if (Math.abs(dy) > 12) {
          clearTimeout(g.tApretar);
          g = null;
          return;
        }
      }
      if (g.modo !== "desliza") return;
      const der = puede(g.li, "der");
      const izq = puede(g.li, "izq");
      let d = dx;
      if ((d > 0 && !der) || (d < 0 && !izq)) d *= 0.15; // no se puede: se resiste
      g.dx = d;
      g.carta.style.transform = `translateX(${d}px)`;
      g.li.classList.toggle("hacia-der", d > 0 && der);
      g.li.classList.toggle("hacia-izq", d < 0 && izq);
      const umbral = Math.min(140, g.ancho * 0.32);
      const listo = (d > umbral && der) || (d < -umbral && izq);
      if (listo !== g.listo) {
        g.listo = listo;
        g.li.classList.toggle("listo", listo);
        if (listo) vibrar(12);
      }
    });
    const fin = (ev, cancelado) => {
      if (!g || ev.pointerId !== g.id) return;
      clearTimeout(g.tApretar);
      const { li, carta, modo, listo, dx } = g;
      g = null;
      li.classList.remove("arrastrando", "apretado");
      if (modo === "desliza") {
        const limpiar = () => {
          carta.style.transform = "";
          li.classList.remove("hacia-der", "hacia-izq", "listo");
        };
        if (listo && !cancelado) {
          const dir = dx > 0 ? "der" : "izq";
          carta.style.transform = `translateX(${dir === "der" ? "" : "-"}105%)`;
          setTimeout(() => {
            limpiar();
            alDeslizar(li, dir);
          }, 170);
        } else limpiar();
      } else if (!modo && !cancelado && alTocar) alTocar(li);
    };
    contenedor.addEventListener("pointerup", (ev) => fin(ev, false));
    contenedor.addEventListener("pointercancel", (ev) => fin(ev, true));
  }

  const mensajeDe = (li) => (feed.get(Number(li.dataset.id)) || {}).m;

  hacerDeslizable($("feed"), ".msj", {
    puede: (li, dir) => {
      const m = mensajeDe(li);
      if (!m) return false;
      if (dir === "der") return m.estado === "ok" || m.estado === "pendiente" || m.estado === "borrado";
      return m.estado === "ok" || m.estado === "pendiente";
    },
    alDeslizar: (li, dir) => {
      const m = mensajeDe(li);
      if (!m) return;
      if (dir === "izq") return borrar(m);
      if (m.estado === "pendiente") return accion("mensaje/aprobar", { id: m.id }, "Aprobado");
      if (m.estado === "borrado") return accion("mensaje/restaurar", { id: m.id }, "Restaurado");
      accion("mensaje/destacar", { id: m.id }, "★ Destacado en la pantalla");
    },
    alApretar: (li) => abrirHojaMensaje(mensajeDe(li)),
    alTocar: (li) => abrirHojaMensaje(mensajeDe(li)),
  });

  $("feed").addEventListener("click", (ev) => {
    const b = ev.target.closest('button[data-acc="aprobar"]');
    if (!b) return;
    const m = mensajeDe(b.closest("li"));
    if (m) accion("mensaje/aprobar", { id: m.id }, "Aprobado");
  });

  function borrar(m) {
    api("mensaje/borrar", { id: m.id }).then(
      () => toast(`Borrado: «${m.texto.slice(0, 40)}${m.texto.length > 40 ? "…" : ""}»`, { deshacer: () => accion("mensaje/restaurar", { id: m.id }, "Restaurado") }),
      () => {}
    );
  }

  let elegido = null;
  function abrirHojaMensaje(m) {
    if (!m) return;
    elegido = m;
    const d = destacadoVigente();
    const enPantalla = d && d.id === m.id;
    const visible = m.estado === "ok" || m.estado === "pendiente";
    const h = $("hojaMsj");
    h.querySelector('[data-acc="aprobar"]').hidden = m.estado !== "pendiente";
    h.querySelector('[data-acc="destacar"]').hidden = !visible || enPantalla;
    h.querySelector('[data-acc="quitar"]').hidden = !enPantalla;
    h.querySelector('[data-acc="borrar"]').hidden = !visible;
    h.querySelectorAll(".sancion").forEach((x) => (x.hidden = !delPublico(m) || m.estado === "vetado"));
    $("hojaMsjTexto").innerHTML = `<b style="color:${tintaDe(m.nick)}">${esc(m.nick)}</b> <span class="nota">${hora(m.ts)}</span><br>${esc(m.texto)}`;
    h.showModal();
  }

  $("hojaMsj").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const m = elegido;
    const a = b.dataset.acc;
    $("hojaMsj").close();
    if (!m || a === "cerrar") return;
    if (a === "aprobar") accion("mensaje/aprobar", { id: m.id }, "Aprobado");
    else if (a === "destacar") accion("mensaje/destacar", { id: m.id }, "★ Destacado en la pantalla");
    else if (a === "quitar") accion("destacado/quitar", {}, "Destacado quitado");
    else if (a === "borrar") borrar(m);
    else if (a === "silencio") {
      const min = Number(b.dataset.min);
      accion("sancionar", { id: m.id, tipo: "silencio", minutos: min }, `${m.nick}: silenciado ${min === 60 ? "1 hora" : min + " minutos"}`);
    } else if (a === "veto" && confirm(`¿Vetar a "${m.nick}" para siempre?\n\nSe borra todo lo que mandó y lo que mande después no lo ve nadie (esa persona no se entera).`)) {
      accion("sancionar", { id: m.id, tipo: "veto" }, `${m.nick}: vetado`);
    }
  });

  // Lo que está destacado ahora en la pantalla, arriba del chat (se va solo cuando vence).
  function pintarDestacado() {
    const d = destacadoVigente();
    const el = $("destacadoAhora");
    el.hidden = !d;
    if (!d) return;
    const quien = d.anonima ? "📮 Respuesta anónima" : d.prod ? "📢 " + esc(d.nick) : esc(d.nick);
    const firma = JSON.stringify([d.id, d.texto, d.hasta]);
    if (el.dataset.firma === firma) return;
    el.dataset.firma = firma;
    el.innerHTML = `<div class="que"><small>★ En pantalla · ${quien}</small><span class="txt">${esc(d.texto)}</span></div><button class="boton" type="button">Quitar</button>`;
    el.querySelector("button").onclick = () => accion("destacado/quitar", {}, "Destacado quitado");
  }
  setInterval(() => {
    const vivo = !!destacadoVigente();
    if (vivo === $("destacadoAhora").hidden) {
      pintarDestacado();
      marcarEnPantalla();
    }
  }, 1000);

  // ---------- pestañas: tocarlas o deslizar de costado ----------

  const TABS = ["avisos", "encuestas", "pantalla", "moderar"];
  const vertical = () => matchMedia("(max-width: 899px)").matches;
  let tabActual = guardado("control.tab") || (vertical() ? "chat" : "avisos");

  function irA(tab, suave = true) {
    if (tab === "chat" && !vertical()) tab = "avisos";
    tabActual = tab;
    guardado("control.tab", tab);
    document.body.dataset.tab = tab;
    document.querySelectorAll("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.tab === tab));
    if (tab === "pantalla") prepararVista();
    const i = TABS.indexOf(tab);
    if (i >= 0) {
      const hojas = $("hojas");
      hojas.scrollTo({ left: i * hojas.clientWidth, behavior: suave ? "smooth" : "auto" });
    }
  }
  $("pestanas").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-tab]");
    if (b) irA(b.dataset.tab);
  });
  let tScroll;
  $("hojas").addEventListener("scroll", () => {
    clearTimeout(tScroll);
    tScroll = setTimeout(() => {
      const hojas = $("hojas");
      const i = Math.round(hojas.scrollLeft / Math.max(1, hojas.clientWidth));
      const tab = TABS[Math.max(0, Math.min(TABS.length - 1, i))];
      if (tab !== tabActual && document.body.dataset.tab !== "chat") {
        tabActual = tab;
        guardado("control.tab", tab);
        document.body.dataset.tab = tab;
        document.querySelectorAll("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.tab === tab));
        if (tab === "pantalla") prepararVista();
      }
    }, 90);
  });
  window.addEventListener("resize", () => irA(tabActual, false));

  // ---------- 📢 avisos de la producción ----------

  const RAPIDOS_INICIALES = [
    "¡Arranca el programa! 🎙️",
    "Pausa de 10 minutos 🍻",
    "¡Último bloque!",
    "Escaneá el QR y mandá tu pregunta 📱",
    "¡Gracias por venir! 🥂",
  ];
  const rapidos = () => {
    try {
      const r = JSON.parse(guardado("control.rapidos") || "null");
      if (Array.isArray(r)) return r;
    } catch {}
    return RAPIDOS_INICIALES;
  };
  const hechos = [];

  function pintarRapidos() {
    $("rapidos").innerHTML =
      rapidos()
        .map((t, i) => `<button class="pastilla" data-i="${i}">${esc(t)}</button>`)
        .join("") + '<button class="pastilla" data-guardar>＋ Guardar el de arriba</button>';
  }
  pintarRapidos();

  async function mandarAviso(texto) {
    texto = String(texto || "").trim();
    if (!texto) return false;
    const ok = await api("mensaje/produccion", { texto }).then(
      () => true,
      () => false
    );
    if (!ok) return false;
    toast("📢 Aviso en la pantalla");
    hechos.unshift({ texto, ts: Date.now() });
    hechos.splice(8);
    $("avisosHechos").innerHTML = hechos
      .map((h, i) => `<li><span>${esc(h.texto)} <span class="nota">· ${hora(h.ts)}</span></span><button class="boton secundario" data-i="${i}">Repetir</button></li>`)
      .join("");
    return true;
  }

  $("formAviso").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (await mandarAviso($("avisoTexto").value)) {
      $("avisoTexto").value = "";
      $("avisoLargo").textContent = "0 / 280";
    }
  });
  $("avisoTexto").addEventListener("input", () => ($("avisoLargo").textContent = `${Array.from($("avisoTexto").value).length} / 280`));

  // Tocar un rápido: dos toques para mandarlo. Mantenerlo apretado: pasarlo arriba para editarlo.
  let tRapido = null;
  $("rapidos").addEventListener("pointerdown", (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b) return;
    tRapido = setTimeout(() => {
      tRapido = "largo";
      vibrar(25);
      $("avisoTexto").value = rapidos()[Number(b.dataset.i)];
      $("avisoTexto").dispatchEvent(new Event("input"));
      $("avisoTexto").focus();
      toast("Editalo y mandalo con el botón");
    }, 520);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((e) =>
    $("rapidos").addEventListener(e, () => {
      if (tRapido !== "largo") clearTimeout(tRapido);
    })
  );
  $("rapidos").addEventListener("contextmenu", (ev) => ev.preventDefault());
  $("rapidos").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (tRapido === "largo") return (tRapido = null);
    if ("guardar" in b.dataset) {
      const t = $("avisoTexto").value.trim();
      if (!t) return toast("Escribí el aviso arriba y después guardalo acá");
      const lista = [...rapidos(), t].slice(-12);
      guardado("control.rapidos", JSON.stringify(lista));
      pintarRapidos();
      return toast("Guardado en los rápidos");
    }
    const texto = rapidos()[Number(b.dataset.i)];
    dosToques(b, "Tocá de nuevo para mandarlo", () => mandarAviso(texto));
  });
  $("avisosHechos").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b) dosToques(b, "¿Repetir?", () => mandarAviso(hechos[Number(b.dataset.i)].texto));
  });

  // ---------- 📊 encuestas y 📮 cajas anónimas ----------

  const respuestas = {}; // caja anónima abierta -> sus respuestas
  const nombrePrograma = (id) => (S.programas.find((p) => p.id === id) || {}).nombre || "—";
  let firmaEnc = "";

  function pintarEncuestas() {
    const lista = [...S.encuestas].sort((a, b) => (b.id === S.encuestaPantalla) - (a.id === S.encuestaPantalla) || (a.programa === S.aire ? -1 : 0) - (b.programa === S.aire ? -1 : 0) || b.id - a.id);
    const d = destacadoVigente();
    const html =
      lista
        .map((e) => {
          const enPantalla = S.encuestaPantalla === e.id;
          const anonima = e.tipo === "anonima";
          const total = (e.conteos || []).reduce((a, b) => a + b, 0);
          const estado = enPantalla
            ? `<span class="chip amarillo">EN PANTALLA · ${e.estado === "abierta" ? (anonima ? "respondiendo" : "votando") : anonima ? "cerrada" : "resultados"}</span>`
            : { borrador: '<span class="chip">preparada</span>', abierta: '<span class="chip amarillo">abierta</span>', cerrada: '<span class="chip">cerrada</span>' }[e.estado] || "";
          const b = [];
          if (e.estado === "borrador") {
            b.push('<button data-acc="abrir" class="boton">▶ Lanzar</button>', '<button data-acc="editar" class="boton secundario">Editar</button>', '<button data-acc="borrar" class="boton peligro">Borrar</button>');
          } else if (enPantalla && e.estado === "abierta") {
            b.push(`<button data-acc="cerrar" class="boton">${anonima ? "Dejar de recibir" : "Cerrar votación"}</button>`, '<button data-acc="ocultar" class="boton secundario">Sacar de la pantalla</button>');
          } else if (enPantalla) {
            b.push('<button data-acc="ocultar" class="boton">Sacar de la pantalla</button>', `<button data-acc="abrir" class="boton secundario">${anonima ? "Volver a abrir" : "Reabrir votación"}</button>`);
          } else {
            b.push(
              `<button data-acc="mostrar" class="boton">${anonima ? "Mostrar la pregunta" : "Mostrar resultados"}</button>`,
              `<button data-acc="abrir" class="boton secundario">${anonima ? "Volver a abrir" : "Reabrir votación"}</button>`,
              '<button data-acc="borrar" class="boton peligro">Borrar</button>'
            );
          }
          if (anonima && e.estado !== "borrador") b.push(`<button data-acc="respuestas" class="boton secundario">${respuestas[e.id] ? "Ocultar respuestas" : `Ver respuestas (${e.respuestas || 0})`}</button>`);
          const opciones = anonima
            ? ""
            : e.opciones
                .map((o, i) => {
                  if (!e.conteos) return `<div class="opc"><span>${esc(o)}</span></div>`;
                  const pct = total ? Math.round((e.conteos[i] * 100) / total) : 0;
                  return `<div class="opc"><div class="barra-voto" style="width:${pct}%"></div><span>${esc(o)}</span><span class="pct">${e.conteos[i]} · ${pct}%</span></div>`;
                })
                .join("");
          const resp = respuestas[e.id];
          const listaResp = !resp
            ? ""
            : `<p class="nota">Deslizá una respuesta a la derecha (o tocá ★) para mostrarla en la pantalla, sin nombre.</p><ul class="respuestas">${
                resp
                  .map(
                    (r) =>
                      `<li data-resp="${r.id}" class="${d && d.id === "r" + r.id ? "en-pantalla" : ""}"><div class="detras">★ A la pantalla</div><div class="resp"><span>${esc(r.texto)}</span><small>${hora(r.ts)}</small><button class="boton secundario" data-acc="dest-resp" data-resp="${r.id}">★</button></div></li>`
                  )
                  .join("") || '<li class="vacio">Todavía no respondió nadie.</li>'
              }</ul>`;
          const contador = anonima ? `<span class="nota">${e.respuestas || 0} ${e.respuestas === 1 ? "respuesta" : "respuestas"}</span>` : e.conteos ? `<span class="nota">${total} votos</span>` : "";
          return (
            `<div class="tarjeta enc${enPantalla ? " en-pantalla" : ""}" data-id="${e.id}">` +
            `<div class="cabeza"><span class="chip">${anonima ? "📮 Caja anónima" : "📊 Encuesta"}</span><span class="chip">${esc(nombrePrograma(e.programa))}</span>${estado}${contador}</div>` +
            `<div class="pregunta">${esc(e.pregunta)}</div>${opciones}${listaResp}<div class="botones">${b.join("")}</div></div>`
          );
        })
        .join("") || '<p class="vacio">Todavía no hay encuestas. Armalas antes del programa y lanzalas cuando quieras.</p>';
    if (html === firmaEnc) return;
    firmaEnc = html;
    // Sin perder dónde estaba mirando la lista de respuestas
    const scrolls = {};
    $("listaEnc").querySelectorAll(".enc").forEach((x) => {
      const ul = x.querySelector(".respuestas");
      if (ul) scrolls[x.dataset.id] = ul.scrollTop;
    });
    $("listaEnc").innerHTML = html;
    for (const [id, top] of Object.entries(scrolls)) {
      const ul = $("listaEnc").querySelector(`.enc[data-id="${id}"] .respuestas`);
      if (ul) ul.scrollTop = top;
    }
  }

  $("listaEnc").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const id = Number(b.closest("[data-id]").dataset.id);
    const e = S.encuestas.find((x) => x.id === id);
    const a = b.dataset.acc;
    if (a === "abrir") accion("encuesta/abrir", { id }, e && e.tipo === "anonima" ? "📮 Caja anónima en la pantalla" : "📊 Encuesta en la pantalla");
    else if (a === "cerrar") accion("encuesta/cerrar", { id }, "Cerrada");
    else if (a === "mostrar") accion("encuesta/mostrar", { id }, "En la pantalla");
    else if (a === "ocultar") accion("encuesta/ocultar", {}, "Sacada de la pantalla");
    else if (a === "borrar") dosToques(b, "¿Borrar? Tocá de nuevo", () => accion("encuesta/borrar", { id }, "Borrada"));
    else if (a === "editar" && e) abrirFormEnc(e);
    else if (a === "dest-resp") accion("respuesta/destacar", { id: Number(b.dataset.resp) }, "📮 Respuesta en la pantalla");
    else if (a === "respuestas") {
      if (respuestas[id]) {
        delete respuestas[id];
        firmaEnc = "";
        return pintarEncuestas();
      }
      fetch("/api/respuestas?encuesta=" + id)
        .then((r) => r.json())
        .then((dat) => {
          respuestas[id] = dat.respuestas || [];
          firmaEnc = "";
          pintarEncuestas();
        })
        .catch(() => toast("Sin conexión", { malo: true }));
    }
  });

  hacerDeslizable($("listaEnc"), ".resp", {
    puede: (li, dir) => dir === "der" && !!li.dataset.resp,
    alDeslizar: (li) => accion("respuesta/destacar", { id: Number(li.dataset.resp) }, "📮 Respuesta en la pantalla"),
  });

  // Hoja para armar o editar
  let editandoEnc = null;
  let tipoEnc = "opciones";

  function ponerTipo(t) {
    tipoEnc = t;
    document.querySelectorAll("#formEnc [data-tipo]").forEach((b) => b.classList.toggle("activa", b.dataset.tipo === t));
    $("encConOpciones").hidden = t === "anonima";
    $("encPregunta").placeholder = t === "anonima" ? "¿Qué le preguntarías al invitado?" : "¿Quién tiene razón?";
  }
  document.querySelectorAll("#formEnc [data-tipo]").forEach((b) => b.addEventListener("click", () => ponerTipo(b.dataset.tipo)));

  function ponerOpciones(lista) {
    $("encOpciones").innerHTML = "";
    lista.forEach((t) => agregarOpcion(t));
  }

  function agregarOpcion(texto = "") {
    const n = $("encOpciones").children.length;
    if (n >= 6) return toast("Hasta 6 opciones");
    const div = document.createElement("div");
    div.className = "op";
    div.innerHTML = `<input maxlength="60" placeholder="Opción ${n + 1}" autocomplete="off"><button type="button" class="boton secundario" aria-label="Quitar opción">✕</button>`;
    div.querySelector("input").value = texto;
    div.querySelector("button").onclick = () => {
      if ($("encOpciones").children.length > 2) div.remove();
    };
    $("encOpciones").appendChild(div);
  }
  $("encAgregar").addEventListener("click", () => agregarOpcion());

  function abrirFormEnc(e, tipo) {
    editandoEnc = e ? e.id : null;
    $("tituloEnc").textContent = e ? "Editar" : tipo === "anonima" ? "Nueva caja anónima" : "Nueva encuesta";
    $("encPrograma").innerHTML = S.programas.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    $("encPrograma").value = String(e ? e.programa : S.aire ?? (S.programas[0] || {}).id ?? "");
    $("encPrograma").disabled = !!e;
    $("encPregunta").value = e ? e.pregunta : "";
    ponerTipo(e ? e.tipo || "opciones" : tipo || "opciones");
    ponerOpciones(e && e.opciones.length ? e.opciones : ["", ""]);
    $("encError").textContent = S.programas.length ? "" : "Primero hay que crear un programa (en el panel completo).";
    $("hojaEnc").showModal();
  }
  $("btnNuevaEnc").addEventListener("click", () => abrirFormEnc(null, "opciones"));
  $("btnNuevaCaja").addEventListener("click", () => abrirFormEnc(null, "anonima"));
  $("encCancelar").addEventListener("click", () => $("hojaEnc").close());

  async function guardarEnc(lanzar) {
    $("encError").textContent = "";
    const datos = {
      tipo: tipoEnc,
      pregunta: $("encPregunta").value.trim(),
      opciones: [...$("encOpciones").querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean),
    };
    if (!datos.pregunta) return ($("encError").textContent = "Falta la pregunta");
    if (tipoEnc === "opciones" && datos.opciones.length < 2) return ($("encError").textContent = "Poné al menos dos opciones");
    try {
      let id = editandoEnc;
      if (id) await api("encuesta/editar", { id, ...datos });
      else id = (await api("encuesta/crear", { programa: Number($("encPrograma").value), ...datos })).id;
      if (lanzar && id) await api("encuesta/abrir", { id });
      $("hojaEnc").close();
      toast(lanzar ? (tipoEnc === "anonima" ? "📮 Caja anónima en la pantalla" : "📊 Encuesta en la pantalla") : "Guardada para después");
    } catch (e) {
      $("encError").textContent = e.message;
    }
  }
  $("encGuardar").addEventListener("click", () => guardarEnc(false));
  $("encLanzar").addEventListener("click", () => guardarEnc(true));

  // ---------- 🖥 la pantalla ----------

  const pct = (v) => Math.round(v * 100) + "%";
  const DEF = [
    { k: "opacidad", rotulo: "Opacidad del chat", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "fondoVentana", rotulo: "Fondo de la ventana", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "fondoGlobo", rotulo: "Fondo de cada mensaje", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "fondoEncuesta", rotulo: "Fondo de la encuesta", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "letra", rotulo: "Letra del chat", min: 12, max: 90, paso: 1, fmt: (v) => v + " px" },
    { k: "maxMensajes", rotulo: "Mensajes a la vez", min: 1, max: 30, paso: 1, fmt: (v) => v },
    { k: "duracion", rotulo: "Cada mensaje queda", min: 0, max: 300, paso: 5, fmt: (v) => (v ? v + " s" : "hasta que lo empujen") },
    { k: "destacadoSeg", rotulo: "El destacado queda", min: 0, max: 120, paso: 5, fmt: (v) => (v ? v + " s" : "hasta quitarlo") },
    { k: "qr.tam", rotulo: "Tamaño del QR", min: 5, max: 70, paso: 1, fmt: (v) => v + "%" },
    { k: "intervalo", rotulo: "Espera entre mensajes", min: 0, max: 60, paso: 1, fmt: (v) => (v ? v + " s por persona" : "sin espera") },
  ];
  const leer = (obj, ruta) => ruta.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  const parcial = (ruta, v) => {
    const p = ruta.split(".");
    return p.length === 1 ? { [ruta]: v } : { [p[0]]: { [p[1]]: v } };
  };

  $("ajustes").innerHTML = DEF.map(
    (d) =>
      `<label class="ajuste"><span class="rotulo">${d.rotulo}<span class="valor" data-valor="${d.k}"></span></span>` +
      `<input type="range" data-k="${d.k}" min="${d.min}" max="${d.max}" step="${d.paso}"></label>`
  ).join("");

  let pendiente = {};
  let tAjustes = null;
  function enviarAjustes(p) {
    for (const [k, v] of Object.entries(p)) pendiente[k] = v && typeof v === "object" ? { ...(pendiente[k] || {}), ...v } : v;
    if (tAjustes) return;
    tAjustes = setTimeout(() => {
      const datos = pendiente;
      pendiente = {};
      tAjustes = null;
      api("ajustes", { ajustes: datos }).catch(() => {});
    }, 120);
  }

  function cambiarAjuste(p) {
    if (!S.ajustes) return;
    editandoHasta = Date.now() + 1500;
    for (const [k, v] of Object.entries(p)) S.ajustes[k] = v && typeof v === "object" ? { ...S.ajustes[k], ...v } : v;
    enviarAjustes(p);
    pintarPantalla();
  }

  function pintarPantalla() {
    const a = S.ajustes;
    if (!a) return;
    document.querySelectorAll("#visibles button").forEach((b) => {
      let on;
      if (b.dataset.caja) on = !!a[b.dataset.caja].visible;
      else if (b.dataset.k === "titulo") on = a.titulo !== false;
      else if (b.dataset.k === "contador") on = a.contador !== false;
      else if (b.dataset.k === "fijos") on = a.duracion === 0;
      else if (b.dataset.k === "oscuro") on = a.tema === "oscuro";
      b.classList.toggle("prendido", on);
      b.setAttribute("aria-pressed", on);
    });
    for (const d of DEF) {
      const v = d.k === "intervalo" ? S.intervalo : leer(a, d.k);
      const i = $("ajustes").querySelector(`[data-k="${d.k}"]`);
      if (document.activeElement !== i && !arrastreSlider) i.value = v;
      $("ajustes").querySelector(`[data-valor="${d.k}"]`).textContent = d.fmt(Number(i.value));
    }
    const L = a.lienzo || { ancho: 1920, alto: 1080 };
    document.querySelectorAll("#formatos button").forEach((b) => b.classList.toggle("activa", b.dataset.f === L.ancho + "x" + L.alto));
    $("txtFormato").textContent = `Ahora: ${L.ancho} × ${L.alto}${L.fijo ? ` · dibujando en un recuadro desde ${L.x}, ${L.y}` : ""}. Lo demás del tamaño se cambia en el panel completo.`;
    escalarVista();
  }

  $("visibles").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !S.ajustes) return;
    vibrar(8);
    const on = !b.classList.contains("prendido");
    if (b.dataset.caja) cambiarAjuste({ [b.dataset.caja]: { visible: on } });
    else if (b.dataset.k === "titulo") cambiarAjuste({ titulo: on });
    else if (b.dataset.k === "contador") cambiarAjuste({ contador: on });
    else if (b.dataset.k === "fijos") cambiarAjuste({ duracion: on ? 0 : 45 });
    else if (b.dataset.k === "oscuro") cambiarAjuste({ tema: on ? "oscuro" : "claro" });
  });

  let arrastreSlider = false;
  let tIntervalo;
  $("ajustes").addEventListener("pointerdown", () => (arrastreSlider = true));
  ["pointerup", "pointercancel"].forEach((e) => $("ajustes").addEventListener(e, () => setTimeout(() => (arrastreSlider = false), 300)));
  $("ajustes").addEventListener("input", (ev) => {
    const k = ev.target.dataset.k;
    if (!k || !S.ajustes) return;
    const v = Number(ev.target.value);
    $("ajustes").querySelector(`[data-valor="${k}"]`).textContent = DEF.find((d) => d.k === k).fmt(v);
    editandoHasta = Date.now() + 1500;
    if (k === "intervalo") {
      S.intervalo = v;
      clearTimeout(tIntervalo);
      tIntervalo = setTimeout(() => accion("intervalo", { valor: v }), 300);
      return;
    }
    const p = parcial(k, v);
    for (const [kk, vv] of Object.entries(p)) S.ajustes[kk] = vv && typeof vv === "object" ? { ...S.ajustes[kk], ...vv } : vv;
    enviarAjustes(p);
    posicionarMarcos();
  });

  $("formatos").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-f]");
    if (!b) return;
    const [ancho, alto] = b.dataset.f.split("x").map(Number);
    cambiarAjuste({ lienzo: { ancho, alto } });
  });

  $("btnSimular").addEventListener("click", (ev) => dosToques(ev.currentTarget, "¿Simular? Tocá de nuevo", () => accion("simular", {}, "Llegan 8 mensajes de prueba…")));

  // Vista previa: la pantalla real a escala, con cajas para arrastrar (un dedo) y pellizcar (dos).
  function prepararVista() {
    if (!$("vista").src) $("vista").src = "pantalla?vista=1";
    requestAnimationFrame(escalarVista);
  }
  function tamLienzo() {
    const L = (S.ajustes && S.ajustes.lienzo) || {};
    return { ancho: L.ancho || 1920, alto: L.alto || 1080 };
  }
  function escalarVista() {
    const { ancho, alto } = tamLienzo();
    $("lienzo").style.aspectRatio = `${ancho} / ${alto}`;
    const v = $("vista");
    v.style.width = ancho + "px";
    v.style.height = alto + "px";
    const visible = $("lienzo").clientWidth;
    if (visible) v.style.transform = `scale(${visible / ancho})`;
    posicionarMarcos();
  }
  new ResizeObserver(escalarVista).observe($("lienzo"));

  const CAJAS = ["destacado", "ventana", "encuesta", "qr"];
  const marco = (c) => document.querySelector(`.marco[data-caja="${c}"]`);
  const r1 = (v) => Math.round(v * 10) / 10;
  const propQR = () => tamLienzo().alto / tamLienzo().ancho;
  const ALTO_QR = 1.12; // el QR lleva el texto abajo

  function rectDe(c) {
    const a = S.ajustes[c];
    if (c === "qr") return { x: a.x, y: a.y, w: a.tam * propQR(), h: a.tam * ALTO_QR };
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
  function ubicar(c, r) {
    const el = marco(c);
    el.style.left = r.x + "%";
    el.style.top = r.y + "%";
    el.style.width = r.w + "%";
    el.style.height = r.h + "%";
  }
  function posicionarMarcos() {
    if (!S.ajustes || gesto) return;
    for (const c of CAJAS) {
      ubicar(c, rectDe(c));
      marco(c).classList.toggle("oculto", !S.ajustes[c].visible);
    }
  }

  // Gesto sobre la vista previa: el primer dedo elige la caja; con uno se mueve, con dos se escala.
  let gesto = null;
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));
  function rebasar() {
    const r = $("lienzo").getBoundingClientRect();
    const ps = [...gesto.punteros.values()];
    gesto.base = rectDe(gesto.caja);
    gesto.baseTam = S.ajustes.qr.tam;
    gesto.caja0 = { ancho: r.width, alto: r.height };
    gesto.centro0 = { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
    gesto.dist0 = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
  }
  $("lienzo").addEventListener("pointerdown", (ev) => {
    if (!S.ajustes) return;
    if (!gesto) {
      const el = ev.target.closest(".marco");
      if (!el) return;
      gesto = { caja: el.dataset.caja, el, punteros: new Map() };
      el.classList.add("activo");
      vibrar(8);
    }
    gesto.punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      $("lienzo").setPointerCapture(ev.pointerId);
    } catch {}
    rebasar();
    ev.preventDefault();
  });
  $("lienzo").addEventListener("pointermove", (ev) => {
    if (!gesto || !gesto.punteros.has(ev.pointerId)) return;
    gesto.punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const ps = [...gesto.punteros.values()];
    const centro = { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
    const dx = ((centro.x - gesto.centro0.x) / gesto.caja0.ancho) * 100;
    const dy = ((centro.y - gesto.centro0.y) / gesto.caja0.alto) * 100;
    const b = gesto.base;
    let r;
    if (ps.length > 1 && gesto.dist0 > 0) {
      // Pellizco: escala alrededor del centro de la caja (el QR sigue cuadrado).
      const f = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / gesto.dist0;
      const min = gesto.caja === "ventana" ? 5 : 8;
      let w = lim(b.w * f, min, 100);
      let h = lim(b.h * f, min, 100);
      if (gesto.caja === "qr") {
        const tam = lim(gesto.baseTam * f, 5, 70);
        w = tam * propQR();
        h = tam * ALTO_QR;
      }
      const cx = b.x + b.w / 2 + dx;
      const cy = b.y + b.h / 2 + dy;
      r = { x: lim(cx - w / 2, 0, 100 - w), y: lim(cy - h / 2, 0, 100 - h), w, h };
    } else {
      r = { ...b, x: lim(b.x + dx, 0, 100 - b.w), y: lim(b.y + dy, 0, 100 - b.h) };
    }
    ubicar(gesto.caja, r);
    const valores = gesto.caja === "qr" ? { x: r1(r.x), y: r1(r.y), tam: r1(r.w / propQR()) } : { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
    Object.assign(S.ajustes[gesto.caja], valores);
    editandoHasta = Date.now() + 1500;
    enviarAjustes({ [gesto.caja]: valores });
  });
  const soltar = (ev) => {
    if (!gesto || !gesto.punteros.has(ev.pointerId)) return;
    gesto.punteros.delete(ev.pointerId);
    if (gesto.punteros.size) return rebasar(); // queda un dedo: sigue moviendo desde ahí
    gesto.el.classList.remove("activo");
    gesto = null;
    editandoHasta = Date.now() + 800;
  };
  $("lienzo").addEventListener("pointerup", soltar);
  $("lienzo").addEventListener("pointercancel", soltar);

  // ---------- 🛡 moderar ----------

  let firmaBloq = "";
  function pintarSanciones() {
    const html =
      S.sanciones
        .map((x) => {
          const que = x.tipo === "veto" ? "vetado" : "silenciado hasta las " + hora(x.hasta);
          return `<li><span><b>${esc(x.nick)}</b> <span class="nota">· ${que}</span></span><button class="boton secundario" data-autor="${esc(x.autor)}">Perdonar</button></li>`;
        })
        .join("") || '<li class="vacio">Nadie silenciado ni vetado.</li>';
    if (html === firmaBloq) return;
    firmaBloq = html;
    $("listaBloq").innerHTML = html;
  }
  $("listaBloq").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-autor]");
    if (b) dosToques(b, "¿Perdonar?", () => accion("perdonar", { autor: b.dataset.autor }, "Perdonado"));
  });

  // ---------- tablet: pantalla prendida, pantalla completa, instalar ----------

  let candado = null;
  async function pedirPantallaPrendida() {
    try {
      if ("wakeLock" in navigator && document.visibilityState === "visible" && !candado) {
        candado = await navigator.wakeLock.request("screen");
        candado.addEventListener("release", () => (candado = null));
      }
    } catch {}
  }
  document.addEventListener("visibilitychange", () => !$("app").hidden && pedirPantallaPrendida());

  $("btnPantallaCompleta").addEventListener("click", () => {
    $("hojaMenu").close();
    const d = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (d.requestFullscreen) d.requestFullscreen().catch(() => toast("Este navegador no deja", { malo: true }));
  });

  let instalador = null;
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    instalador = ev;
    $("btnInstalar").hidden = false;
  });
  $("btnInstalar").addEventListener("click", async () => {
    $("hojaMenu").close();
    if (!instalador) return;
    instalador.prompt();
    await instalador.userChoice.catch(() => {});
    instalador = null;
    $("btnInstalar").hidden = true;
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/control-sw.js", { scope: "/control" }).catch(() => {});

  irA(tabActual, false);
  arrancar();
})();
