// Panel de producción: moderar, destacar, encuestas, ajustes de pantalla y admin.
(function () {
  "use strict";
  const { Conexion, urlWs, esc, colorDe, svgQR, servidor } = window.Comun;
  const $ = (id) => document.getElementById(id);

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
    usuarios: [],
    sanciones: [],
    conteo: { pantallas: 0, publico: 0 },
  };
  const feed = new Map(); // id -> { m, li }
  const firmas = {}; // para no redibujar secciones que no cambiaron
  let con = null;
  let editandoHasta = 0; // mientras se mueve un control, no se pisa con lo que llega
  let editandoEnc = null;

  // ---------- utilidades ----------

  let tToast;
  function toast(texto, malo) {
    const el = $("toast");
    el.textContent = texto;
    el.className = "toast" + (malo ? " malo" : "");
    el.hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(() => (el.hidden = true), malo ? 4500 : 2200);
  }

  async function api(ruta, datos) {
    let r;
    try {
      r = await fetch("/api/" + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos || {}) });
    } catch {
      toast("Sin conexión con el servidor", true);
      throw new Error("red");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Estos formularios muestran el error al lado, no en un cartelito.
      const enLinea = ["login", "primera-vez", "mi-clave"].includes(ruta);
      if (r.status === 401 && !enLinea) mostrarLogin();
      const e = new Error(j.error || "Error " + r.status);
      if (!enLinea) toast(e.message, true);
      throw e;
    }
    return j;
  }

  function accion(ruta, datos, ok) {
    return api(ruta, datos).then(
      () => ok && toast(ok),
      () => {}
    );
  }

  function cambio(clave, valor) {
    const f = JSON.stringify(valor);
    if (firmas[clave] === f) return false;
    firmas[clave] = f;
    return true;
  }

  const nombrePrograma = (id) => (S.programas.find((p) => p.id === id) || {}).nombre || "—";
  const esAdmin = () => S.yo && S.yo.rol === "admin";
  const puedoControlar = () => !!S.yo;
  const misProgramas = () => S.programas;
  const hora = (ts) => new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  // ---------- sesión ----------

  async function arrancar() {
    let r = null;
    try {
      r = await fetch("/api/yo");
    } catch {}
    if (!r) {
      toast("Sin conexión, reintentando…", true);
      return setTimeout(arrancar, 3000);
    }
    if (r.ok) iniciar();
    else mostrarLogin();
  }

  async function mostrarLogin() {
    if (con) {
      con.cerrar();
      con = null;
    }
    if ($("dlgClave").open) $("dlgClave").close();
    $("app").hidden = true;
    $("login").hidden = false;
    // La primera vez que se abre el panel no hay clave de admin: se elige acá.
    let primera = false;
    try {
      primera = (await (await fetch("/api/primera-vez")).json()).primeraVez === true;
    } catch {}
    $("formPrimera").hidden = !primera;
    $("formLogin").hidden = primera;
    (primera ? $("pClave") : $("lUsuario").value ? $("lClave") : $("lUsuario")).focus();
  }

  $("formLogin").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("lError").textContent = "";
    try {
      await api("login", { usuario: $("lUsuario").value, clave: $("lClave").value });
      $("lClave").value = "";
      iniciar();
    } catch (e) {
      $("lError").textContent = e.message;
    }
  });

  $("formPrimera").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("pError").textContent = "";
    if ($("pClave").value !== $("pClave2").value) return ($("pError").textContent = "Las dos claves no son iguales");
    try {
      await api("primera-vez", { clave: $("pClave").value });
      $("pClave").value = $("pClave2").value = "";
      $("lUsuario").value = "admin";
      iniciar();
      abrirPestana("admin");
      toast("¡Listo! Ahora agregá a tu equipo");
    } catch (e) {
      $("pError").textContent = e.message;
      if (/ya está elegida/.test(e.message)) setTimeout(mostrarLogin, 2500);
    }
  });

  // "Mostrar la clave" en cada formulario
  document.querySelectorAll(".verClave").forEach((c) =>
    c.addEventListener("change", () => c.closest("form").querySelectorAll("input[autocomplete$='password']").forEach((i) => (i.type = c.checked ? "text" : "password")))
  );

  // ---------- mi clave ----------

  function abrirMiClave() {
    $("formMiClave").reset();
    $("formMiClave").querySelectorAll("input[autocomplete$='password']").forEach((i) => (i.type = "password"));
    $("mcError").textContent = "";
    $("dlgClave").showModal();
    $("mcActual").focus();
  }
  $("btnMiClave").addEventListener("click", abrirMiClave);
  document.querySelector(".abrirMiClave").addEventListener("click", abrirMiClave);
  $("mcCancelar").addEventListener("click", () => $("dlgClave").close());

  $("formMiClave").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("mcError").textContent = "";
    if ($("mcNueva").value !== $("mcNueva2").value) return ($("mcError").textContent = "Las dos claves nuevas no son iguales");
    try {
      await api("mi-clave", { actual: $("mcActual").value, nueva: $("mcNueva").value });
      $("dlgClave").close();
      toast("Clave cambiada");
    } catch (e) {
      $("mcError").textContent = e.message;
    }
  });

  $("btnSalir").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    mostrarLogin();
  });

  function iniciar() {
    $("login").hidden = true;
    $("app").hidden = false;
    if (con) return;
    if (!$("vista").src) $("vista").src = "pantalla?vista=1";
    con = new Conexion(urlWs("rol=panel"), { alRecibir, alCambiarEstado });
  }

  function alCambiarEstado(estado, fallos) {
    const el = $("cConexion");
    el.textContent = estado === "conectado" ? "● En línea" : "Reconectando…";
    el.className = "chip " + (estado === "conectado" ? "verde" : "amarillo");
    if (estado === "desconectado" && fallos >= 2) {
      fetch("/api/yo")
        .then((r) => r.status === 401 && mostrarLogin())
        .catch(() => {});
    }
  }

  // ---------- lo que llega del servidor ----------

  function alRecibir(m) {
    switch (m.t) {
      case "estado":
        aplicarConfig(m);
        feed.clear();
        $("feed").innerHTML = "";
        m.mensajes.forEach(agregarAlFeed);
        pintarFeedVacio();
        break;
      case "config":
        aplicarConfig(m);
        break;
      case "msg":
        agregarAlFeed(m.m);
        pintarFeedVacio();
        break;
      case "msgEstado": {
        const f = feed.get(m.id);
        if (f) {
          f.m.estado = m.estado;
          if (m.ts) f.m.ts = m.ts;
          pintarItem(f.li, f.m);
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
      case "salir":
        mostrarLogin();
        break;
    }
  }

  function aplicarConfig(m) {
    for (const k of Object.keys(S)) if (k in m) S[k] = m[k];
    document.body.classList.toggle("sin-control", !puedoControlar());
    pintarCabecera();
    pintarContadores();
    pintarDestacado();
    pintarSanciones();
    pintarEncuestas();
    pintarFormEncuesta();
    pintarAjustes();
    pintarAdmin();
    pintarQR();
  }

  // ---------- cabecera y controles ----------

  function pintarCabecera() {
    const actual = S.programas.find((p) => p.id === S.aire);
    $("aireEstado").textContent = "Brindis Bravo" + (actual ? " · " + actual.nombre : "");
    $("yo").textContent = S.yo.usuario + (esAdmin() ? " (admin)" : "");

    if (cambio("selAire", S.programas)) {
      $("selAire").innerHTML = `<option value="">Sin programa</option>` + S.programas.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    }
    $("selAire").value = S.aire == null ? "" : String(S.aire);

    $("chkPausa").checked = S.pausa;
    $("chkAprob").checked = S.aprobacion;
    $("avisoClave").hidden = !S.yo.claveDebil;
    $("tabAdmin").hidden = !esAdmin();
    if (!esAdmin() && !$("tab-admin").hidden) abrirPestana("chat"); // quedó abierta de una sesión de admin
    $("linkExportar").href = "/api/exportar";
  }

  function pintarContadores() {
    const p = S.conteo.pantallas;
    $("cPantallas").textContent = `🖥 ${p} ${p === 1 ? "pantalla" : "pantallas"}`;
    $("cPantallas").className = "chip " + (p > 0 ? "verde" : "amarillo");
    $("cPublico").textContent = `👥 ${S.conteo.publico} en el chat`;
  }

  // El programa de ahora sólo cambia el título del chat (y deja la pantalla limpia para arrancar).
  $("selAire").addEventListener("change", () => {
    const v = $("selAire").value;
    accion("aire", { programa: v ? Number(v) : null }, v ? "Ahora: " + nombrePrograma(Number(v)) : "Sin programa");
  });

  $("chkPausa").addEventListener("change", (ev) => accion("pausa", { valor: ev.target.checked }, ev.target.checked ? "Chat en pausa" : "Chat abierto"));
  $("chkAprob").addEventListener("change", (ev) => accion("aprobacion", { valor: ev.target.checked }));
  $("btnLimpiar").addEventListener("click", () => accion("limpiar", {}, "Pantalla limpia"));

  // ---------- pestañas ----------

  function abrirPestana(nombre) {
    document.querySelectorAll(".pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.tab === nombre));
    document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + nombre));
    Comun.guardado("panel.pestana", nombre);
    if (nombre === "pantalla") escalarVista();
  }
  document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => abrirPestana(b.dataset.tab)));
  abrirPestana(Comun.guardado("panel.pestana") || "chat");

  // ---------- chat ----------

  function agregarAlFeed(m) {
    const ya = feed.get(m.id);
    if (ya) {
      Object.assign(ya.m, m);
      pintarItem(ya.li, ya.m);
      return;
    }
    const li = document.createElement("li");
    li.dataset.id = m.id;
    pintarItem(li, m);
    $("feed").prepend(li);
    feed.set(m.id, { m, li });
    while (feed.size > 300) {
      const viejo = feed.keys().next().value;
      feed.get(viejo).li.remove();
      feed.delete(viejo);
    }
  }

  const CHIPS = {
    pendiente: '<span class="chip amarillo">esperando aprobación</span>',
    borrado: '<span class="chip">borrado</span>',
    bloqueado: '<span class="chip">bloqueado</span>',
    vetado: '<span class="chip">vetado</span>',
  };
  const delPublico = (m) => typeof m.autor === "string" && m.autor.startsWith("c:");
  const delEquipo = (m) => typeof m.autor === "string" && m.autor.startsWith("u:");

  function pintarItem(li, m) {
    li.className = "item " + m.estado + (m.prod ? " prod" : "");
    const acc = [];
    if (m.estado === "pendiente") acc.push('<button data-acc="aprobar" class="boton chico ok">Aprobar</button>');
    if (m.estado === "ok" || m.estado === "pendiente") {
      acc.push('<button data-acc="destacar" class="boton chico">★ Destacar</button>');
      acc.push('<button data-acc="borrar" class="boton chico secundario">Borrar</button>');
    }
    if (delPublico(m) && m.estado !== "vetado") {
      acc.push(
        '<select data-acc="silenciar" class="boton chico secundario" aria-label="Silenciar"><option value="">Silenciar…</option><option value="5">5 minutos</option><option value="15">15 minutos</option><option value="60">1 hora</option></select>'
      );
      acc.push('<button data-acc="vetar" class="boton chico peligro">Vetar</button>');
    }
    const etiqueta = m.prod
      ? '<span class="chip amarillo">producción</span>'
      : m.disp === "simulacion"
        ? '<span class="chip">simulado</span>'
        : delEquipo(m)
          ? '<span class="chip amarillo">equipo</span>'
          : "";
    li.innerHTML =
      `<div class="meta"><span class="nick" style="color:${m.prod ? "var(--acento2)" : colorDe(m.nick)}">${esc(m.nick)}</span>` +
      `<span>${hora(m.ts)}</span>${CHIPS[m.estado] || ""}${etiqueta}</div>` +
      `<div class="texto">${esc(m.texto)}</div>` +
      `<div class="acciones">${acc.join("")}</div>`;
  }

  function pintarFeedVacio() {
    $("feedVacio").hidden = feed.size > 0;
  }

  $("feed").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const id = Number(b.closest("li").dataset.id);
    const m = (feed.get(id) || {}).m;
    if (!m) return;
    const a = b.dataset.acc;
    if (a === "aprobar") accion("mensaje/aprobar", { id });
    else if (a === "destacar") accion("mensaje/destacar", { id }, "Destacado en pantalla");
    else if (a === "borrar") accion("mensaje/borrar", { id });
    else if (a === "vetar" && confirm(`¿Vetar a "${m.nick}" para siempre?\n\nSe borra todo lo que mandó y lo que mande después no lo ve nadie (esa persona no se entera).`)) {
      accion("sancionar", { id, tipo: "veto" }, `${m.nick}: vetado`);
    }
  });

  $("feed").addEventListener("change", (ev) => {
    const sel = ev.target.closest('select[data-acc="silenciar"]');
    if (!sel || !sel.value) return;
    const id = Number(sel.closest("li").dataset.id);
    const m = (feed.get(id) || {}).m;
    const minutos = Number(sel.value);
    sel.value = "";
    if (m) accion("sancionar", { id, tipo: "silencio", minutos }, `${m.nick}: silenciado ${minutos === 60 ? "1 hora" : minutos + " minutos"}`);
  });

  function pintarDestacado() {
    const d = S.destacado;
    const caja = $("cajaDestacado");
    caja.hidden = !d;
    if (!d) return;
    caja.innerHTML = `<div><div class="nota">En pantalla, destacado:</div><div class="texto"><span style="color:${colorDe(d.nick)}">${esc(d.nick)}:</span> ${esc(d.texto)}</div></div><button class="boton chico secundario" id="btnQuitarDest">Quitar</button>`;
    $("btnQuitarDest").onclick = () => accion("destacado/quitar");
  }

  $("formProd").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const texto = $("prodTexto").value.trim();
    if (!texto) return;
    api("mensaje/produccion", { texto }).then(
      () => ($("prodTexto").value = ""),
      () => {}
    );
  });

  function pintarSanciones() {
    $("nBloq").textContent = S.sanciones.length;
    if (!cambio("sanciones", S.sanciones)) return;
    $("listaBloq").innerHTML =
      S.sanciones
        .map((x) => {
          const que = x.tipo === "veto" ? "vetado" : "silenciado hasta las " + hora(x.hasta);
          return `<li><span><b>${esc(x.nick)}</b> <span class="nota">· ${que}</span></span><button class="link" data-autor="${esc(x.autor)}">Perdonar</button></li>`;
        })
        .join("") || '<li class="vacio">Nadie silenciado ni vetado.</li>';
  }

  $("listaBloq").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-autor]");
    if (b) accion("perdonar", { autor: b.dataset.autor }, "Perdonado");
  });

  // ---------- encuestas ----------

  function pintarFormEncuesta() {
    const opciones = misProgramas();
    if (cambio("encProgramas", opciones)) {
      const previo = $("encPrograma").value;
      $("encPrograma").innerHTML = opciones.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
      if (opciones.some((p) => String(p.id) === previo)) $("encPrograma").value = previo;
      else if (S.aire && opciones.some((p) => p.id === S.aire)) $("encPrograma").value = String(S.aire);
    }
    if (!$("encOpciones").children.length) ponerOpciones(["", ""]);
  }

  function ponerOpciones(lista) {
    $("encOpciones").innerHTML = "";
    lista.forEach((t) => agregarOpcion(t));
  }

  function agregarOpcion(texto = "") {
    const n = $("encOpciones").children.length;
    if (n >= 6) return;
    const div = document.createElement("div");
    div.className = "op";
    div.innerHTML = `<input maxlength="60" placeholder="Opción ${n + 1}"><button type="button" class="boton chico secundario" title="Quitar">✕</button>`;
    div.querySelector("input").value = texto;
    div.querySelector("button").onclick = () => {
      if ($("encOpciones").children.length > 2) div.remove();
    };
    $("encOpciones").appendChild(div);
  }

  $("encAgregar").addEventListener("click", () => agregarOpcion());

  function limpiarFormEncuesta() {
    editandoEnc = null;
    $("encPregunta").value = "";
    ponerOpciones(["", ""]);
    $("tituloFormEnc").textContent = "Nueva encuesta";
    $("encCancelar").hidden = true;
    $("encPrograma").disabled = false;
  }

  $("encCancelar").addEventListener("click", limpiarFormEncuesta);

  $("formEnc").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const datos = {
      pregunta: $("encPregunta").value,
      opciones: [...$("encOpciones").querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean),
    };
    try {
      if (editandoEnc) await api("encuesta/editar", { id: editandoEnc, ...datos });
      else await api("encuesta/crear", { programa: Number($("encPrograma").value), ...datos });
      toast(editandoEnc ? "Encuesta actualizada" : "Encuesta guardada");
      limpiarFormEncuesta();
    } catch {}
  });

  function pintarEncuestas() {
    const lista = [...S.encuestas].sort((a, b) => (a.programa === S.aire ? -1 : 0) - (b.programa === S.aire ? -1 : 0) || b.id - a.id);
    const html = lista.map((e) => {
      const enPantalla = S.encuestaPantalla === e.id;

      const total = (e.conteos || []).reduce((a, b) => a + b, 0);
      const estado = enPantalla
        ? e.estado === "abierta"
          ? '<span class="chip rojo">EN PANTALLA · votando</span>'
          : '<span class="chip rojo">EN PANTALLA · resultados</span>'
        : { borrador: '<span class="chip">preparada</span>', abierta: '<span class="chip amarillo">abierta</span>', cerrada: '<span class="chip">cerrada</span>' }[e.estado];
      const b = [];
      const dis = "";
      if (e.estado === "borrador") {
        b.push(`<button data-acc="abrir" class="boton chico"${dis}>Lanzar</button>`);
        b.push('<button data-acc="editar" class="boton chico secundario">Editar</button>');
        b.push('<button data-acc="borrar" class="boton chico peligro">Borrar</button>');
      } else if (enPantalla && e.estado === "abierta") {
        b.push(`<button data-acc="cerrar" class="boton chico"${dis}>Cerrar votación</button>`);
        b.push(`<button data-acc="ocultar" class="boton chico secundario"${dis}>Ocultar</button>`);
      } else if (enPantalla) {
        b.push(`<button data-acc="ocultar" class="boton chico"${dis}>Ocultar</button>`);
        b.push(`<button data-acc="abrir" class="boton chico secundario"${dis}>Reabrir votación</button>`);
      } else {
        b.push(`<button data-acc="mostrar" class="boton chico"${dis}>Mostrar resultados</button>`);
        b.push(`<button data-acc="abrir" class="boton chico secundario"${dis}>Reabrir votación</button>`);
        b.push('<button data-acc="borrar" class="boton chico peligro">Borrar</button>');
      }
      const opciones = e.opciones
        .map((o, i) => {
          if (!e.conteos) return `<div class="opc"><span>${esc(o)}</span></div>`;
          const pct = total ? Math.round((e.conteos[i] * 100) / total) : 0;
          return `<div class="opc"><div class="barra" style="width:${pct}%"></div><span>${esc(o)}</span><span>${e.conteos[i]} · ${pct}%</span></div>`;
        })
        .join("");
      return (
        `<div class="tarjeta enc${enPantalla ? " en-pantalla" : ""}" data-id="${e.id}">` +
        `<div class="cabeza"><span class="chip">${esc(nombrePrograma(e.programa))}</span>${estado}${e.conteos ? `<span class="nota">${total} votos</span>` : ""}</div>` +
        `<div class="pregunta">${esc(e.pregunta)}</div>${opciones}<div class="fila-botones">${b.join("")}</div></div>`
      );
    });
    const final = html.join("") || '<p class="vacio">Todavía no hay encuestas. Armalas antes del programa y lanzalas cuando quieras.</p>';
    if (cambio("listaEnc", final)) $("listaEnc").innerHTML = final;
  }

  $("listaEnc").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const id = Number(b.closest("[data-id]").dataset.id);
    const e = S.encuestas.find((x) => x.id === id);
    const a = b.dataset.acc;
    if (a === "abrir") accion("encuesta/abrir", { id }, "Encuesta en pantalla");
    else if (a === "cerrar") accion("encuesta/cerrar", { id }, "Votación cerrada");
    else if (a === "mostrar") accion("encuesta/mostrar", { id });
    else if (a === "ocultar") accion("encuesta/ocultar");
    else if (a === "borrar" && confirm("¿Borrar esta encuesta y sus votos?")) accion("encuesta/borrar", { id });
    else if (a === "editar" && e) {
      editandoEnc = id;
      $("encPrograma").value = String(e.programa);
      $("encPrograma").disabled = true;
      $("encPregunta").value = e.pregunta;
      ponerOpciones(e.opciones);
      $("tituloFormEnc").textContent = "Editar encuesta";
      $("encCancelar").hidden = false;
      $("formEnc").scrollIntoView({ behavior: "smooth" });
    }
  });

  // ---------- ajustes de pantalla ----------

  const pct = (v) => Math.round(v * 100) + "%";
  const DEF = [
    { k: "opacidad", rotulo: "Opacidad general del chat", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "fondoVentana", rotulo: "Fondo de la ventana", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "fondoGlobo", rotulo: "Fondo de cada mensaje", min: 0, max: 1, paso: 0.05, fmt: pct },
    { k: "letra", rotulo: "Tamaño de letra del chat", min: 12, max: 90, paso: 1, fmt: (v) => v + " px" },
    { k: "maxMensajes", rotulo: "Mensajes a la vez", min: 1, max: 30, paso: 1, fmt: (v) => v },
    { k: "duracion", rotulo: "Cada mensaje queda", min: 0, max: 300, paso: 5, fmt: (v) => (v ? v + " s" : "hasta que lo empujen") },
    { k: "destacadoSeg", rotulo: "El destacado queda", min: 0, max: 120, paso: 5, fmt: (v) => (v ? v + " s" : "hasta quitarlo") },
    { k: "qr.tam", rotulo: "Tamaño del QR", min: 5, max: 70, paso: 1, fmt: (v) => v + "%" },
    { k: "intervalo", rotulo: "Espera entre mensajes (por persona)", min: 0, max: 60, paso: 1, fmt: (v) => (v ? v + " s" : "sin espera") },
  ];

  function leerRuta(obj, ruta) {
    return ruta.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  }

  function parcialDe(ruta, valor) {
    const partes = ruta.split(".");
    return partes.length === 1 ? { [ruta]: valor } : { [partes[0]]: { [partes[1]]: valor } };
  }

  function armarAjustes() {
    $("ajustes").innerHTML =
      DEF.map(
        (d) =>
          `<label class="ajuste"><span class="rotulo">${d.rotulo}<span class="valor" data-valor="${d.k}"></span></span>` +
          `<input type="range" data-k="${d.k}" min="${d.min}" max="${d.max}" step="${d.paso}"></label>`
      ).join("");
  }
  armarAjustes();

  function valorDe(k) {
    return k === "intervalo" ? S.intervalo : leerRuta(S.ajustes, k);
  }

  function pintarAjustes() {
    if (!S.ajustes || Date.now() < editandoHasta) return;
    for (const d of DEF) {
      const v = valorDe(d.k);
      $("ajustes").querySelector(`[data-k="${d.k}"]`).value = v;
      $("ajustes").querySelector(`[data-valor="${d.k}"]`).textContent = d.fmt(v);
    }
    for (const c of $("visibles").querySelectorAll("input[data-caja]")) c.checked = !!S.ajustes[c.dataset.caja].visible;
    $("chkTitulo").checked = S.ajustes.titulo !== false;
    $("chkContador").checked = S.ajustes.contador !== false;
    $("chkFijos").checked = S.ajustes.duracion === 0;
    if (document.activeElement !== $("urlQR")) $("urlQR").value = S.ajustes.urlQR || "";
    posicionarMarcos();
  }

  let pendiente = {};
  let tAjustes = null;
  function enviarAjustes(parcial) {
    for (const [k, v] of Object.entries(parcial)) pendiente[k] = v && typeof v === "object" ? { ...(pendiente[k] || {}), ...v } : v;
    if (tAjustes) return;
    tAjustes = setTimeout(() => {
      const p = pendiente;
      pendiente = {};
      tAjustes = null;
      api("ajustes", { ajustes: p }).catch(() => {});
    }, 120);
  }

  let tIntervalo;
  $("ajustes").addEventListener("input", (ev) => {
    const k = ev.target.dataset.k;
    if (!k || !S.ajustes) return;
    editandoHasta = Date.now() + 1200;
    const valor = ev.target.type === "checkbox" ? ev.target.checked : Number(ev.target.value);
    const d = DEF.find((x) => x.k === k);
    if (d) $("ajustes").querySelector(`[data-valor="${k}"]`).textContent = d.fmt(valor);
    if (k === "intervalo") {
      clearTimeout(tIntervalo);
      tIntervalo = setTimeout(() => accion("intervalo", { valor }), 300);
      return;
    }
    const partes = k.split(".");
    if (partes.length === 2) S.ajustes[partes[0]][partes[1]] = valor;
    else S.ajustes[k] = valor;
    posicionarMarcos();
    enviarAjustes(parcialDe(k, valor));
  });

  $("urlQR").addEventListener("change", () => enviarAjustes({ urlQR: $("urlQR").value.trim() }));
  $("btnSimular").addEventListener("click", () => accion("simular", {}, "Llegan 8 mensajes de prueba…"));
  $("btnRestablecer").addEventListener("click", () => {
    if (confirm("¿Volver la pantalla a los valores iniciales?")) accion("ajustes/restablecer");
  });

  // Mensajes fijos: no se van por tiempo, sólo cuando los empujan otros (duración 0).
  $("chkFijos").addEventListener("change", (ev) => {
    if (!S.ajustes) return;
    editandoHasta = Date.now() + 1200;
    S.ajustes.duracion = ev.target.checked ? 0 : 45;
    $("ajustes").querySelector('[data-k="duracion"]').value = S.ajustes.duracion;
    $("ajustes").querySelector('[data-valor="duracion"]').textContent = DEF.find((d) => d.k === "duracion").fmt(S.ajustes.duracion);
    enviarAjustes({ duracion: S.ajustes.duracion });
  });

  // Mostrar u ocultar cada caja de la pantalla.
  $("visibles").addEventListener("change", (ev) => {
    const caja = ev.target.dataset.caja;
    if ((ev.target.id === "chkTitulo" || ev.target.id === "chkContador") && S.ajustes) {
      const k = ev.target.id === "chkTitulo" ? "titulo" : "contador";
      editandoHasta = Date.now() + 1200;
      S.ajustes[k] = ev.target.checked;
      return enviarAjustes({ [k]: ev.target.checked });
    }
    if (!caja || !S.ajustes) return;
    editandoHasta = Date.now() + 1200;
    S.ajustes[caja].visible = ev.target.checked;
    posicionarMarcos();
    enviarAjustes({ [caja]: { visible: ev.target.checked } });
  });

  // Vista previa: la pantalla real, a escala, con recuadros para mover y agrandar.
  function escalarVista() {
    const ancho = $("lienzo").clientWidth;
    if (ancho) $("vista").style.transform = `scale(${ancho / 1920})`;
    posicionarMarcos();
  }
  new ResizeObserver(escalarVista).observe($("lienzo"));

  const CAJAS = ["destacado", "ventana", "encuesta", "qr"];
  const PROP_QR = 9 / 16; // el QR mide tam% del alto: en ancho son tam·9/16 % (pantalla 16:9)
  const marco = (caja) => document.querySelector(`.marco[data-caja="${caja}"]`);
  const r1 = (v) => Math.round(v * 10) / 10;

  for (const caja of CAJAS) {
    const dirs = caja === "qr" ? ["nw", "ne", "sw", "se"] : ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
    marco(caja).insertAdjacentHTML("beforeend", dirs.map((d) => `<i class="tirador ${d}" data-dir="${d}"></i>`).join(""));
  }

  // Rectángulo de cada caja en % de la pantalla.
  function rectDe(caja) {
    const a = S.ajustes[caja];
    if (caja === "qr") return { x: a.x, y: a.y, w: a.tam * PROP_QR, h: a.tam * 1.12 };
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }

  function ubicarMarco(caja, r) {
    const el = marco(caja);
    el.style.left = r.x + "%";
    el.style.top = r.y + "%";
    el.style.width = r.w + "%";
    el.style.height = r.h + "%";
  }

  let arrastre = null;
  function posicionarMarcos() {
    if (!S.ajustes || arrastre) return;
    for (const caja of CAJAS) {
      ubicarMarco(caja, rectDe(caja));
      marco(caja).classList.toggle("oculto", !S.ajustes[caja].visible);
    }
  }

  // Mueve el borde (o los dos bordes de una esquina) que se está arrastrando.
  function redimensionar(b, dir, dx, dy, caja) {
    const min = caja === "ventana" ? 5 : 8;
    let x1 = b.x;
    let y1 = b.y;
    let x2 = b.x + b.w;
    let y2 = b.y + b.h;
    if (dir.includes("w")) x1 = Math.max(0, Math.min(x2 - min, x1 + dx));
    if (dir.includes("e")) x2 = Math.min(100, Math.max(x1 + min, x2 + dx));
    if (dir.includes("n")) y1 = Math.max(0, Math.min(y2 - min, y1 + dy));
    if (dir.includes("s")) y2 = Math.min(100, Math.max(y1 + min, y2 + dy));
    if (caja === "qr") {
      // Sigue siendo cuadrado: manda el lado que más se movió.
      const base = b.w / PROP_QR;
      const porAncho = (x2 - x1) / PROP_QR;
      const porAlto = (y2 - y1) / 1.12;
      const tam = Math.max(5, Math.min(70, Math.abs(porAncho - base) >= Math.abs(porAlto - base) ? porAncho : porAlto));
      const w = tam * PROP_QR;
      const h = tam * 1.12;
      if (dir.includes("w")) x1 = Math.max(0, x2 - w);
      if (dir.includes("n")) y1 = Math.max(0, y2 - h);
      x2 = x1 + w;
      y2 = y1 + h;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  $("lienzo").addEventListener("pointerdown", (ev) => {
    const el = ev.target.closest(".marco");
    if (!el || !S.ajustes || !puedoControlar()) return;
    ev.preventDefault();
    const r = $("lienzo").getBoundingClientRect();
    arrastre = {
      caja: el.dataset.caja,
      el,
      dir: ev.target.dataset.dir || "mover",
      x0: ev.clientX,
      y0: ev.clientY,
      ancho: r.width,
      alto: r.height,
      base: rectDe(el.dataset.caja),
    };
    el.setPointerCapture(ev.pointerId);
    el.classList.add("activo");
  });

  $("lienzo").addEventListener("pointermove", (ev) => {
    if (!arrastre) return;
    const A = arrastre;
    const dx = ((ev.clientX - A.x0) / A.ancho) * 100;
    const dy = ((ev.clientY - A.y0) / A.alto) * 100;
    const r =
      A.dir === "mover"
        ? { ...A.base, x: Math.max(0, Math.min(100 - A.base.w, A.base.x + dx)), y: Math.max(0, Math.min(100 - A.base.h, A.base.y + dy)) }
        : redimensionar(A.base, A.dir, dx, dy, A.caja);
    const c = A.caja === "qr" ? { x: r1(r.x), y: r1(r.y), tam: r1(r.w / PROP_QR) } : { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
    Object.assign(S.ajustes[A.caja], c);
    ubicarMarco(A.caja, r);
    editandoHasta = Date.now() + 1200;
    enviarAjustes({ [A.caja]: c });
  });

  function soltar() {
    if (!arrastre) return;
    arrastre.el.classList.remove("activo");
    arrastre = null;
    editandoHasta = Date.now() + 800;
  }
  $("lienzo").addEventListener("pointerup", soltar);
  $("lienzo").addEventListener("pointercancel", soltar);

  // ---------- admin ----------

  const urlPanel = () => servidor() + "/panel";

  function pintarAdmin() {
    if (!esAdmin()) return;
    $("urlPanel").value = urlPanel();
    if (cambio("adminProgramas", [S.programas, S.aire])) {
      $("listaProgramas").innerHTML =
        S.programas
          .map(
            (p) =>
              `<li data-id="${p.id}"><input value="${esc(p.nombre)}" maxlength="60" aria-label="Nombre del programa">` +
              `<button data-acc="renombrar" class="boton chico secundario">Guardar nombre</button>` +
              (p.id === S.aire ? '<span class="chip">es el de ahora</span>' : `<button data-acc="borrar" class="boton chico peligro">Borrar</button>`) +
              `</li>`
          )
          .join("") || '<li class="vacio">Todavía no hay programas.</li>';
    }
    if (cambio("adminUsuarios", [S.usuarios, S.programas, S.yo])) {
      const debil = '<span class="chip amarillo" title="Conviene cambiarla antes del show">clave fácil</span>';
      const yoAdmin =
        `<li><div class="u-nombre"><b>admin</b><span class="chip">Admin principal</span>${S.yo.usuario === "admin" && S.yo.claveDebil ? debil : ""}` +
        `<span class="nota">La cuenta principal. Su clave se cambia con «Mi clave», arriba.</span></div></li>`;
      $("listaUsuarios").innerHTML =
        yoAdmin +
        S.usuarios
          .map(
            (u) =>
              `<li data-usuario="${esc(u.usuario)}"><div class="u-nombre"><b>${esc(u.usuario)}</b>` +
              `<select class="u-rol" aria-label="Rol"><option value="productor"${u.rol === "productor" ? " selected" : ""}>Productor</option><option value="admin"${u.rol === "admin" ? " selected" : ""}>Admin</option></select>` +
              (u.debil ? debil : "") +
              `</div>` +
              `<div class="fila-botones"><button data-acc="clave" class="boton chico secundario">Cambiarle la clave</button><button data-acc="borrar" class="boton chico peligro">Borrar</button></div></li>`
          )
          .join("");
    }
  }

  $("formPrograma").addEventListener("submit", (ev) => {
    ev.preventDefault();
    api("programa/crear", { nombre: $("nuevoPrograma").value }).then(
      () => {
        $("nuevoPrograma").value = "";
        toast("Programa creado");
      },
      () => {}
    );
  });

  $("listaProgramas").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const li = b.closest("li");
    const id = Number(li.dataset.id);
    if (b.dataset.acc === "renombrar") accion("programa/renombrar", { id, nombre: li.querySelector("input").value }, "Nombre guardado");
    else if (b.dataset.acc === "borrar" && confirm(`¿Borrar "${nombrePrograma(id)}"? Se borran también sus encuestas (los mensajes quedan en el chat).`)) accion("programa/borrar", { id }, "Programa borrado");
  });

  const rolNuevo = () => document.querySelector("input[name=nuRol]:checked").value;

  $("formUsuario").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const usuario = $("nuUsuario").value.trim().toLowerCase();
    const clave = $("nuClave").value;
    api("usuario/crear", { usuario, clave, rol: rolNuevo() }).then(
      () => {
        $("formUsuario").reset();
        $("accesoTexto").textContent = `Panel de Brindis Bravo\n${urlPanel()}\nUsuario: ${usuario}\nClave: ${clave}`;
        $("acceso").hidden = false;
        toast(`Listo: ${usuario} ya puede entrar`);
      },
      () => {}
    );
  });

  async function copiar(texto, aviso) {
    try {
      await navigator.clipboard.writeText(texto);
      toast(aviso || "Copiado");
    } catch {
      toast("No pude copiar: seleccionalo y copialo a mano", true);
    }
  }

  $("btnCopiar").addEventListener("click", () => copiar($("accesoTexto").textContent, "Copiado: pegalo en WhatsApp"));
  $("btnCompartir").hidden = !navigator.share;
  $("btnCompartir").addEventListener("click", () => navigator.share({ text: $("accesoTexto").textContent }).catch(() => {}));
  $("btnCopiarPanel").addEventListener("click", () => copiar(urlPanel()));

  // El rol se guarda apenas se toca.
  $("listaUsuarios").addEventListener("change", (ev) => {
    const li = ev.target.closest("li[data-usuario]");
    if (!li || !ev.target.matches(".u-rol")) return;
    const usuario = li.dataset.usuario;
    accion("usuario/editar", { usuario, rol: ev.target.value }, ev.target.value === "admin" ? `${usuario} ahora es admin` : `${usuario} ahora es productor`);
  });

  $("listaUsuarios").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    const usuario = b.closest("li").dataset.usuario;
    if (b.dataset.acc === "clave") {
      const clave = prompt(`Clave nueva para "${usuario}" (mínimo 4 letras):`);
      if (clave) accion("usuario/editar", { usuario, clave }, `Listo: la clave nueva de ${usuario} es "${clave}"`);
    } else if (b.dataset.acc === "borrar" && confirm(`¿Borrar a "${usuario}"? Ya no va a poder entrar al panel.`)) {
      accion("usuario/borrar", { usuario }, "Borrado");
    }
  });

  // ---------- QR ----------

  function urlPublica() {
    return (S.ajustes && S.ajustes.urlQR) || servidor();
  }

  function pintarQR() {
    const url = urlPublica();
    if (!cambio("qr", url)) return;
    $("qrGrande").innerHTML = svgQR(url);
    $("qrUrl").textContent = url;
  }

  $("btnImprimir").addEventListener("click", () => window.print());
  $("btnQRpng").addEventListener("click", () => {
    const svg = svgQR(urlPublica()).replace("<svg ", '<svg width="1200" height="1200" ');
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 1200;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 1200, 1200);
      c.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "qr-brindis-bravo.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      });
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });

  arrancar();
})();
