// Edición sobre la pantalla misma (sólo dentro de la app de escritorio): mover y
// agrandar las cajas con el mouse, prenderlas y apagarlas, y unos pocos ajustes.
// La app avisa cuándo se entra y se sale del modo edición.
(function () {
  "use strict";
  if (!window.overlay || !window.overlay.alModo || !window.Pantalla) return;
  const P = window.Pantalla;
  const CAJAS = ["destacado", "ventana", "encuesta", "qr"];
  const NOMBRES = { ventana: "Chat", encuesta: "Encuesta", destacado: "Destacado", qr: "QR" };
  const DESLIZADORES = [
    { k: "opacidad", nombre: "Opacidad", min: 0.1, max: 1, paso: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
    { k: "letra", nombre: "Letra del chat", min: 12, max: 90, paso: 1, fmt: (v) => v + " px" },
    { k: "fondoVentana", nombre: "Fondo del chat", min: 0, max: 1, paso: 0.05, fmt: (v) => Math.round(v * 100) + "%" },
  ];
  const r1 = (v) => Math.round(v * 10) / 10;
  let activa = false;
  let arrastre = null;

  // ---------- armado ----------

  const raiz = document.createElement("div");
  raiz.id = "edicion";
  raiz.hidden = true;
  raiz.innerHTML =
    CAJAS.map((c) => {
      const dirs = c === "qr" ? ["nw", "ne", "sw", "se"] : ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
      return `<div class="marco-ed" data-caja="${c}"><span>${NOMBRES[c]}</span>${dirs.map((d) => `<i class="tirador-ed ${d}" data-dir="${d}"></i>`).join("")}</div>`;
    }).join("") +
    `<div class="barra-ed" id="barraEd">
      <div class="agarre-ed" title="Arrastrá para mover esta barra">⠿ Editando la pantalla <span class="nota-ed">· arrastrá las cajas y tirá de sus bordes</span></div>
      <form class="login-ed" id="loginEd" hidden>
        <div>Para guardar los cambios, entrá con tu usuario del panel:</div>
        <input name="usuario" placeholder="Usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <input name="clave" type="password" placeholder="Clave" autocomplete="current-password" required>
        <button>Entrar</button>
        <span class="error-ed" id="errorEd"></span>
      </form>
      <div id="controlesEd">
        <div class="fila-ed">
          ${["ventana", "encuesta", "destacado", "qr"].map((c) => `<label><input type="checkbox" data-caja="${c}"> ${NOMBRES[c]}</label>`).join("")}
          <label><input type="checkbox" data-titulo> Título</label>
          <label><input type="checkbox" data-contador> Contador de gente</label>
          <label title="Los mensajes no se van por tiempo: sólo cuando los empujan otros nuevos"><input type="checkbox" data-fijos> Mensajes fijos</label>
        </div>
        <div class="fila-ed">
          ${DESLIZADORES.map((d) => `<label>${d.nombre} <input type="range" data-k="${d.k}" min="${d.min}" max="${d.max}" step="${d.paso}"> <b data-valor="${d.k}"></b></label>`).join("")}
        </div>
        <div class="fila-ed">
          <button type="button" data-acc="simular">Simular mensajes</button>
          <button type="button" data-acc="listo" class="listo-ed">✓ Listo: volver a usar la PC</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(raiz);
  const $ = (sel) => raiz.querySelector(sel);
  const marco = (c) => $(`.marco-ed[data-caja="${c}"]`);

  // ---------- guardar en el servidor ----------

  let pendiente = {};
  let tEnvio = null;
  function enviar(parcial) {
    for (const [k, v] of Object.entries(parcial)) pendiente[k] = v && typeof v === "object" ? { ...(pendiente[k] || {}), ...v } : v;
    P.ocupadoHasta = Date.now() + 1500;
    if (tEnvio) return;
    tEnvio = setTimeout(async () => {
      const datos = pendiente;
      pendiente = {};
      tEnvio = null;
      const r = await post("ajustes", { ajustes: datos });
      if (r && r.status === 401) pedirLogin();
    }, 120);
  }

  async function post(ruta, datos) {
    try {
      return await fetch("/api/" + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos || {}) });
    } catch {
      return null;
    }
  }

  // Cambia un ajuste acá mismo (se ve al instante) y lo manda a guardar.
  function cambiar(parcial) {
    const a = P.ajustes();
    if (!a) return;
    const nuevo = { ...a };
    for (const [k, v] of Object.entries(parcial)) nuevo[k] = v && typeof v === "object" ? { ...a[k], ...v } : v;
    P.aplicar(nuevo);
    enviar(parcial);
    pintar();
  }

  // ---------- usuario ----------

  function pedirLogin() {
    $("#loginEd").hidden = false;
    $("#controlesEd").hidden = true;
    raiz.classList.add("sin-permiso");
    $("#loginEd input[name=usuario]").focus();
  }

  async function revisarSesion() {
    let ok = false;
    try {
      ok = (await fetch("/api/yo")).ok;
    } catch {}
    if (!ok) return pedirLogin();
    $("#loginEd").hidden = true;
    $("#controlesEd").hidden = false;
    raiz.classList.remove("sin-permiso");
  }

  $("#loginEd").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    $("#errorEd").textContent = "";
    const r = await post("login", { usuario: f.usuario.value, clave: f.clave.value });
    if (r && r.ok) {
      f.clave.value = "";
      revisarSesion();
    } else {
      const j = r ? await r.json().catch(() => ({})) : {};
      $("#errorEd").textContent = j.error || "Sin conexión";
    }
  });

  // ---------- recuadros ----------

  // Rectángulo de cada caja en % de la pantalla.
  function rectDe(c) {
    const a = P.ajustes()[c];
    if (c !== "qr") return { x: a.x, y: a.y, w: a.w, h: a.h };
    const qr = document.getElementById("qr");
    const alto = qr.offsetWidth ? qr.offsetHeight / qr.offsetWidth : 1.12; // con el texto de abajo
    const prop = innerHeight / innerWidth;
    return { x: a.x, y: a.y, w: a.tam * prop, h: a.tam * alto };
  }

  function ubicar(c, r) {
    const el = marco(c);
    el.style.left = r.x + "%";
    el.style.top = r.y + "%";
    el.style.width = r.w + "%";
    el.style.height = r.h + "%";
  }

  function pintar() {
    const a = P.ajustes();
    if (!activa || !a) return;
    if (!arrastre) for (const c of CAJAS) ubicar(c, rectDe(c));
    for (const c of CAJAS) marco(c).classList.toggle("oculto", !a[c].visible);
    raiz.querySelectorAll("input[data-caja]").forEach((i) => (i.checked = !!a[i.dataset.caja].visible));
    $("input[data-titulo]").checked = a.titulo !== false;
    $("input[data-contador]").checked = a.contador !== false;
    $("input[data-fijos]").checked = a.duracion === 0;
    for (const d of DESLIZADORES) {
      const i = $(`input[data-k="${d.k}"]`);
      if (document.activeElement !== i) i.value = a[d.k];
      $(`[data-valor="${d.k}"]`).textContent = d.fmt(Number(i.value));
    }
  }

  function redimensionar(b, dir, dx, dy, c) {
    const min = c === "ventana" ? 5 : 8;
    let x1 = b.x;
    let y1 = b.y;
    let x2 = b.x + b.w;
    let y2 = b.y + b.h;
    if (dir.includes("w")) x1 = Math.max(0, Math.min(x2 - min, x1 + dx));
    if (dir.includes("e")) x2 = Math.min(100, Math.max(x1 + min, x2 + dx));
    if (dir.includes("n")) y1 = Math.max(0, Math.min(y2 - min, y1 + dy));
    if (dir.includes("s")) y2 = Math.min(100, Math.max(y1 + min, y2 + dy));
    if (c === "qr") {
      // Sigue siendo cuadrado: manda el lado que más se movió.
      const prop = b.w / (b.tam || 1);
      const alto = b.h / (b.tam || 1);
      const porAncho = (x2 - x1) / prop;
      const porAlto = (y2 - y1) / alto;
      const tam = Math.max(5, Math.min(70, Math.abs(porAncho - b.tam) >= Math.abs(porAlto - b.tam) ? porAncho : porAlto));
      if (dir.includes("w")) x1 = Math.max(0, x2 - tam * prop);
      if (dir.includes("n")) y1 = Math.max(0, y2 - tam * alto);
      return { x: x1, y: y1, w: tam * prop, h: tam * alto, tam };
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  raiz.addEventListener("pointerdown", (ev) => {
    const el = ev.target.closest(".marco-ed");
    if (!el || raiz.classList.contains("sin-permiso")) return;
    ev.preventDefault();
    const c = el.dataset.caja;
    arrastre = { c, el, dir: ev.target.dataset.dir || "mover", x0: ev.clientX, y0: ev.clientY, base: { ...rectDe(c), tam: P.ajustes().qr.tam } };
    el.setPointerCapture(ev.pointerId);
    el.classList.add("activo");
  });

  raiz.addEventListener("pointermove", (ev) => {
    if (!arrastre) return;
    const A = arrastre;
    const dx = ((ev.clientX - A.x0) / innerWidth) * 100;
    const dy = ((ev.clientY - A.y0) / innerHeight) * 100;
    const r =
      A.dir === "mover"
        ? { ...A.base, x: Math.max(0, Math.min(100 - A.base.w, A.base.x + dx)), y: Math.max(0, Math.min(100 - A.base.h, A.base.y + dy)) }
        : redimensionar(A.base, A.dir, dx, dy, A.c);
    const valores = A.c === "qr" ? { x: r1(r.x), y: r1(r.y), tam: r1(r.tam ?? A.base.tam) } : { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
    ubicar(A.c, r);
    cambiar({ [A.c]: valores });
  });

  function soltar() {
    if (!arrastre) return;
    arrastre.el.classList.remove("activo");
    arrastre = null;
    pintar();
  }
  raiz.addEventListener("pointerup", soltar);
  raiz.addEventListener("pointercancel", soltar);

  // ---------- barra ----------

  raiz.addEventListener("change", (ev) => {
    const i = ev.target;
    if (i.dataset.caja) cambiar({ [i.dataset.caja]: { visible: i.checked } });
    else if ("titulo" in i.dataset) cambiar({ titulo: i.checked });
    else if ("contador" in i.dataset) cambiar({ contador: i.checked });
    else if ("fijos" in i.dataset) cambiar({ duracion: i.checked ? 0 : 45 });
  });
  raiz.addEventListener("input", (ev) => {
    const k = ev.target.dataset.k;
    if (k) cambiar({ [k]: Number(ev.target.value) });
  });
  raiz.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acc]");
    if (!b) return;
    if (b.dataset.acc === "simular") post("simular");
    if (b.dataset.acc === "listo") window.overlay.pedirModo("ver");
  });
  document.addEventListener("keydown", (ev) => {
    if (activa && ev.key === "Escape") window.overlay.pedirModo("ver");
  });

  // La barra se puede correr si tapa algo.
  const barra = $("#barraEd");
  let mover = null;
  $(".agarre-ed").addEventListener("pointerdown", (ev) => {
    const r = barra.getBoundingClientRect();
    mover = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    ev.target.setPointerCapture(ev.pointerId);
  });
  $(".agarre-ed").addEventListener("pointermove", (ev) => {
    if (!mover) return;
    barra.style.left = Math.max(0, Math.min(innerWidth - barra.offsetWidth, ev.clientX - mover.dx)) + "px";
    barra.style.top = Math.max(0, Math.min(innerHeight - barra.offsetHeight, ev.clientY - mover.dy)) + "px";
    barra.style.transform = "none";
  });
  $(".agarre-ed").addEventListener("pointerup", () => (mover = null));

  // ---------- entrar y salir del modo ----------

  window.overlay.alModo((modo) => {
    activa = modo === "editar";
    raiz.hidden = !activa;
    document.body.classList.toggle("editando", activa);
    if (activa) {
      revisarSesion();
      pintar();
    }
  });
  window.addEventListener("resize", pintar);
  setInterval(pintar, 1000); // por si cambian los ajustes desde el panel
})();
