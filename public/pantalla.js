// Pantalla: muestra los mensajes, el destacado, la encuesta y el QR.
// Se usa dentro de la app de escritorio, como fuente de navegador en OBS
// o como vista previa en el panel (?vista=1).
(function () {
  "use strict";
  const { Conexion, urlWs, servidor, colorDe, esc, svgQR, iconoRol } = window.Comun;
  const vista = new URLSearchParams(location.search).get("vista") === "1";
  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;

  let ajustes = null;
  let desfase = 0; // reloj del servidor menos reloj local
  let visibles = []; // { id, ts, el }
  let destacado = null;
  let encuesta = null;
  let qrHecho = "";
  let turnoDestacado = 0;

  const ahora = () => Date.now() + desfase;

  function ubicar(el, r) {
    el.style.left = r.x + "%";
    el.style.top = r.y + "%";
    el.style.width = r.w + "%";
    if (r.h != null) el.style.height = r.h + "%";
  }

  // Busca la letra más grande con la que el contenido entra en su caja.
  function ajustarLetra(caja, el, max) {
    if (el.hidden || caja.classList.contains("apagada") || !caja.clientHeight) return;
    let lo = 6;
    let hi = Math.max(lo + 1, max);
    for (let i = 0; i < 14; i++) {
      const medio = (lo + hi) / 2;
      el.style.fontSize = medio + "px";
      if (el.offsetHeight <= caja.clientHeight && el.offsetWidth <= caja.clientWidth + 1 && el.scrollWidth <= caja.clientWidth + 1) lo = medio;
      else hi = medio;
    }
    el.style.fontSize = lo + "px";
  }

  function ajustarCajas() {
    ajustarLetra($("encuesta"), $("encuesta").querySelector(".dentro"), $("encuesta").clientHeight / 3);
    ajustarLetra($("zonaDestacado"), $("destacado"), $("zonaDestacado").clientHeight / 2.2);
  }

  function aplicarAjustes(a) {
    ajustes = a;
    raiz.style.setProperty("--opacidad", a.opacidad);
    raiz.style.setProperty("--fondo-ventana", a.fondoVentana);
    raiz.style.setProperty("--fondo-globo", a.fondoGlobo);
    raiz.style.setProperty("--letra", a.letra);
    ubicar($("ventana"), a.ventana);
    ubicar($("encuesta"), a.encuesta);
    ubicar($("zonaDestacado"), a.destacado);
    $("ventana").classList.toggle("apagada", !a.ventana.visible);
    $("tituloTexto").hidden = a.titulo === false;
    $("gente").hidden = a.contador === false;
    $("tituloChat").hidden = a.titulo === false && a.contador === false;
    $("encuesta").classList.toggle("apagada", !a.encuesta.visible);
    $("zonaDestacado").classList.toggle("apagada", !a.destacado.visible);
    const qr = $("qr");
    qr.hidden = !a.qr.visible;
    qr.style.left = a.qr.x + "%";
    qr.style.top = a.qr.y + "%";
    qr.style.width = a.qr.tam + "vh";
    qr.style.fontSize = a.qr.tam * 0.085 + "vh";
    const url = a.urlQR || servidor();
    if (url !== qrHecho) {
      $("qrImg").innerHTML = svgQR(url);
      qrHecho = url;
    }
    ajustarCajas();
    revisar();
  }

  function ponerTitulo(p) {
    $("tituloTexto").innerHTML = '<span class="marca">Brindis Bravo</span>' + (p ? `<span class="prog"> · ${esc(p.nombre)}</span>` : "");
  }

  // ---------- mensajes ----------

  function vencido(ts) {
    return ajustes && ajustes.duracion > 0 && ahora() - ts > ajustes.duracion * 1000;
  }

  function agregar(m, animar = true) {
    if (visibles.some((v) => v.id === m.id) || vencido(m.ts)) return;
    const el = document.createElement("div");
    el.className = "msj" + (m.prod ? " prod" : m.equipo ? " equipo" : "") + (animar ? "" : " quieto");
    const color = m.prod || m.equipo ? "" : ` style="color:${colorDe(m.nick)}"`;
    el.innerHTML = `${m.equipo ? iconoRol(m.rol) : ""}<span class="nick"${color}>${esc(m.nick)}</span><span class="texto">${esc(m.texto)}</span>`;
    $("lista").appendChild(el);
    visibles.push({ id: m.id, ts: m.ts, el });
    revisar();
  }

  function sacar(v) {
    visibles = visibles.filter((x) => x !== v);
    v.el.classList.remove("quieto");
    v.el.classList.add("sale");
    setTimeout(() => v.el.remove(), 500);
  }

  function vaciar() {
    for (const v of visibles) v.el.remove();
    visibles = [];
  }

  // Saca lo que sobra o ya cumplió su tiempo, y apaga el destacado vencido.
  function revisar() {
    if (!ajustes) return;
    for (const v of [...visibles]) if (vencido(v.ts)) sacar(v);
    while (visibles.length > ajustes.maxMensajes) sacar(visibles[0]);
    if (destacado && ajustes.destacadoSeg > 0 && ahora() - destacado.desde > ajustes.destacadoSeg * 1000) ponerDestacado(null);
  }

  // ---------- destacado ----------

  function ponerDestacado(d) {
    destacado = d;
    const el = $("destacado");
    const turno = ++turnoDestacado;
    if (!d || (ajustes && ajustes.destacadoSeg > 0 && ahora() - d.desde > ajustes.destacadoSeg * 1000)) {
      destacado = null;
      if (el.hidden) return;
      el.classList.add("sale");
      setTimeout(() => {
        if (turno !== turnoDestacado) return;
        el.hidden = true;
        el.classList.remove("sale");
      }, 400);
      return;
    }
    el.className = d.prod ? "prod" : "";
    const color = d.prod ? "" : ` style="color:${colorDe(d.nick)}"`;
    el.innerHTML = `<span class="nick"${color}>${esc(d.nick)}</span><span class="texto">${esc(d.texto)}</span>`;
    el.hidden = false;
    ajustarCajas();
    el.style.animation = "none";
    void el.offsetHeight; // reinicia la animación
    el.style.animation = "";
  }

  // ---------- encuesta ----------

  function ponerEncuesta(e) {
    encuesta = e;
    const el = $("encuesta");
    if (!e) {
      el.hidden = true;
      el.querySelector(".dentro").innerHTML = "";
      return;
    }
    if (e.tipo === "anonima") {
      // Caja anónima: sólo la pregunta y cuántos respondieron (las respuestas las lee el equipo).
      el.querySelector(".dentro").innerHTML =
        `<div class="preg">📮 ${esc(e.pregunta)}</div>` +
        `<div class="pie pie-anonima"><span class="estado">${e.estado === "abierta" ? "Respondé desde tu celu · es anónimo" : "Ya no se reciben respuestas"}</span><span class="total">000 respuestas</span></div>`;
      el.hidden = false;
      ajustarCajas(); // se mide con el texto más largo posible
      pintarRespuestas(e.respuestas || 0);
      return;
    }
    el.querySelector(".dentro").innerHTML =
      `<div class="preg">${esc(e.pregunta)}</div>` +
      e.opciones.map((o) => `<div class="opc"><div class="barra"></div><span class="txt">${esc(o)}</span><span class="pct">100%</span></div>`).join("") +
      `<div class="pie"><span class="estado">¡Votá desde tu celu!</span><span class="total">000 votos</span></div>`;
    el.hidden = false;
    ajustarCajas(); // se mide con los textos más largos posibles
    const conteos = e.conteos || e.opciones.map(() => 0);
    pintarVotos(conteos.map(() => 0)); // las barras arrancan de cero y crecen
    requestAnimationFrame(() => requestAnimationFrame(() => pintarVotos(conteos)));
  }

  function pintarRespuestas(n) {
    const t = $("encuesta").querySelector(".total");
    if (t) t.textContent = n + (n === 1 ? " respuesta" : " respuestas");
  }

  function pintarVotos(c) {
    if (!encuesta || !c) return;
    encuesta.conteos = c;
    const total = c.reduce((a, b) => a + b, 0);
    const max = Math.max(...c);
    const el = $("encuesta");
    el.querySelectorAll(".opc").forEach((fila, i) => {
      const pct = total ? Math.round((c[i] * 100) / total) : 0;
      fila.querySelector(".barra").style.width = pct + "%";
      fila.querySelector(".pct").textContent = pct + "%";
      fila.classList.toggle("gana", encuesta.estado === "cerrada" && total > 0 && c[i] === max);
    });
    el.querySelector(".estado").textContent = encuesta.estado === "abierta" ? "¡Votá desde tu celu!" : "Resultados";
    el.querySelector(".total").textContent = total + (total === 1 ? " voto" : " votos");
  }

  // ---------- conexión ----------

  function alRecibir(m) {
    switch (m.t) {
      case "estado":
        desfase = m.ahora - Date.now();
        aplicarAjustes(m.ajustes);
        ponerTitulo(m.programa);
        $("gente").textContent = "👥 " + (m.gente || 0);
        vaciar();
        m.mensajes.forEach((x) => agregar(x, false));
        ponerDestacado(m.destacado);
        ponerEncuesta(m.encuesta);
        break;
      case "msg":
        agregar(m.m);
        break;
      case "borrar": {
        const v = visibles.find((x) => x.id === m.id);
        if (v) sacar(v);
        break;
      }
      case "limpiar":
        for (const v of [...visibles]) sacar(v);
        ponerDestacado(null);
        break;
      case "programa":
        ponerTitulo(m.programa);
        break;
      case "gente":
        $("gente").textContent = "👥 " + m.n;
        break;
      case "ajustes":
        if (Date.now() < window.Pantalla.ocupadoHasta) break; // se está editando acá mismo
        aplicarAjustes(m.ajustes);
        break;
      case "destacado":
        ponerDestacado(m.d);
        break;
      case "encuesta":
        if (encuesta && m.e && m.e.tipo !== "anonima" && encuesta.id === m.e.id && encuesta.opciones.length === m.e.opciones.length) {
          encuesta = m.e; // misma encuesta (p. ej. se cerró): sólo se actualiza
          pintarVotos(m.e.conteos);
        } else ponerEncuesta(m.e);
        break;
      case "votos":
        if (encuesta && encuesta.id === m.encuesta) pintarVotos(m.conteos);
        break;
      case "respuestas":
        if (encuesta && encuesta.id === m.encuesta) pintarRespuestas(m.n);
        break;
    }
  }

  let tSinConexion;
  function alCambiarEstado(estado) {
    if (window.overlay) window.overlay.estado(estado);
    clearTimeout(tSinConexion);
    if (estado === "conectado") $("sinConexion").hidden = true;
    else if (!vista) tSinConexion = setTimeout(() => ($("sinConexion").hidden = false), 10000);
  }

  // Para la edición sobre la pantalla (pantalla-editar.js, sólo en la app de escritorio).
  window.Pantalla = { ajustes: () => ajustes, aplicar: aplicarAjustes, ocupadoHasta: 0 };

  new Conexion(urlWs("rol=pantalla" + (vista ? "&vista=1" : "")), { alRecibir, alCambiarEstado });
  setInterval(revisar, 1000);
  window.addEventListener("resize", ajustarCajas);
})();
