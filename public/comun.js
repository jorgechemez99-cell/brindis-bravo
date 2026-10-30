// Utilidades compartidas por el público, el panel y la pantalla.
(function () {
  "use strict";

  function idAleatorio() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const r = () => Math.random().toString(36).slice(2, 10);
    return (r() + r() + Date.now().toString(36)).slice(0, 32);
  }

  // Servidor: el de la página, o el que se pasa con ?server= (app de escritorio).
  function servidor() {
    const p = new URLSearchParams(location.search).get("server");
    return (p || location.origin).replace(/\/+$/, "");
  }

  function urlWs(consulta) {
    return servidor().replace(/^http/, "ws") + "/ws?" + consulta;
  }

  function colorDe(nick) {
    let h = 7;
    for (const c of String(nick)) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return `hsl(${h % 360} 90% 72%)`;
  }

  // Ícono de cada rol del equipo, al lado del apodo (en la pantalla, el chat y el panel).
  const ROLES = { conductor: ["🎙️", "Conducción"], productor: ["🎬", "Producción"], admin: ["👑", "Admin"] };
  function iconoRol(rol) {
    const [icono, nombre] = ROLES[rol] || ROLES.productor;
    return `<span class="icono-rol" title="${nombre}" aria-label="${nombre}">${icono}</span>`;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function largo(s) {
    return Array.from(String(s || "")).length;
  }

  function guardado(clave, valor) {
    try {
      if (valor === undefined) return localStorage.getItem(clave);
      if (valor === null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, valor);
    } catch {
      return null;
    }
  }

  // QR dibujado como SVG (usa vendor/qrcode.js).
  function svgQR(texto) {
    const qr = qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (qr.isDark(f, c)) d += `M${c},${f}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  // WebSocket que se reconecta solo, con latido para detectar conexiones muertas
  // (celulares que se bloquean, wifi que se cae, etc.).
  class Conexion {
    constructor(url, { alRecibir, alCambiarEstado, alAbrir } = {}) {
      this.url = url;
      this.alRecibir = alRecibir || (() => {});
      this.alCambiarEstado = alCambiarEstado || (() => {});
      this.alAbrir = alAbrir || (() => {});
      this.ws = null;
      this.intento = 0;
      this.fallosSeguidos = 0;
      this.ultimaSenal = 0;
      this.conectar();
      window.addEventListener("online", () => this.reconectarYa());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (!this.abierta() || Date.now() - this.ultimaSenal > 30000) this.reconectarYa();
      });
    }

    abierta() {
      return !!this.ws && this.ws.readyState === 1;
    }

    avisar(estado) {
      this.estado = estado;
      try {
        this.alCambiarEstado(estado, this.fallosSeguidos);
      } catch (e) {
        console.error(e);
      }
    }

    // Corta para siempre (p. ej. al cerrar sesión en el panel).
    cerrar() {
      this.detenida = true;
      clearTimeout(this.tReconectar);
      clearInterval(this.tLatido);
      const ws = this.ws;
      this.ws = null;
      if (ws) {
        ws.onclose = null;
        try {
          ws.close();
        } catch {}
      }
    }

    conectar() {
      clearTimeout(this.tReconectar);
      if (this.detenida || (this.ws && this.ws.readyState <= 1)) return;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch {
        this.reprogramar();
        return;
      }
      this.ws = ws;
      this.avisar("conectando");
      ws.onopen = () => {
        this.intento = 0;
        this.fallosSeguidos = 0;
        this.ultimaSenal = Date.now();
        this.latir();
        this.avisar("conectado");
        this.alAbrir();
      };
      ws.onmessage = (ev) => {
        this.ultimaSenal = Date.now();
        if (ev.data === "pong") return;
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        try {
          this.alRecibir(m);
        } catch (e) {
          console.error(e);
        }
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        clearInterval(this.tLatido);
        this.fallosSeguidos++;
        this.avisar("desconectado");
        this.reprogramar();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    }

    latir() {
      clearInterval(this.tLatido);
      this.tLatido = setInterval(() => {
        if (!this.abierta()) return;
        if (Date.now() - this.ultimaSenal > 60000) return this.reconectarYa();
        try {
          this.ws.send("ping");
        } catch {}
      }, 25000);
    }

    reconectarYa() {
      const ws = this.ws;
      this.ws = null;
      clearInterval(this.tLatido);
      if (ws) {
        ws.onclose = null;
        try {
          ws.close();
        } catch {}
      }
      this.intento = 0;
      this.conectar();
    }

    reprogramar() {
      clearTimeout(this.tReconectar);
      const espera = Math.min(5000, 300 * 2 ** this.intento) + Math.random() * 500;
      this.intento++;
      this.tReconectar = setTimeout(() => this.conectar(), espera);
    }

    enviar(obj) {
      if (!this.abierta()) return false;
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch {
        return false;
      }
    }
  }

  window.Comun = { Conexion, idAleatorio, servidor, urlWs, colorDe, esc, largo, guardado, svgQR, iconoRol, ROLES };
})();
