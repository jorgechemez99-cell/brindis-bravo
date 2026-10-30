// App de escritorio: una ventana transparente, siempre arriba, que muestra el chat
// encima de lo que esté en la pantalla. Dos modos:
//   - "ver": los clics pasan de largo y la compu se usa normal, viendo todo.
//   - "editar": se mueven y agrandan las cajas con el mouse, ahí mismo.
// Se maneja con la botonera flotante, el ícono de la barra de menú (Mac) o de la
// bandeja (Windows), y atajos de teclado.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, ipcMain, shell, powerSaveBlocker } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const ATAJO = "CommandOrControl+Alt+Shift+C"; // ocultar / mostrar todo
const ATAJO_EDITAR = "CommandOrControl+Alt+Shift+E"; // editar / usar la PC
const COLORES = { conectado: [46, 229, 157], conectando: [255, 177, 61], desconectado: [255, 75, 75] };
const ETIQUETAS = { conectado: "Conectado", conectando: "Conectando…", desconectado: "Sin conexión, reintentando…" };
const NOMBRE = "Brindis Bravo";

let ventana = null;
let botonera = null;
let ventanaConfig = null;
let tray = null;
let conf = {};
let estado = "conectando";
let visible = true;
let modo = "ver";

// ---------- configuración (config.json de la app + la del usuario) ----------

const archivoUsuario = () => path.join(app.getPath("userData"), "config.json");

function leerJson(archivo) {
  try {
    return JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch {
    return {};
  }
}

function leerConf() {
  const c = { ...leerJson(path.join(__dirname, "config.json")), ...leerJson(archivoUsuario()) };
  if (process.env.BRINDIS_SERVIDOR) c.servidor = process.env.BRINDIS_SERVIDOR; // para probar contra otro servidor
  return c;
}

function guardarConf(cambios) {
  const propia = { ...leerJson(archivoUsuario()), ...cambios };
  fs.mkdirSync(path.dirname(archivoUsuario()), { recursive: true });
  fs.writeFileSync(archivoUsuario(), JSON.stringify(propia, null, 2));
  conf = leerConf();
}

// ---------- macOS: que el chat no se corra al mostrar el escritorio ----------

// Con "clic en el fondo de pantalla para mostrar el escritorio" (o Mission Control),
// macOS corre todas las ventanas a un costado. Marcada como "estacionaria", la ventana
// se queda quieta en su lugar, como el fondo de pantalla. Electron no trae esa opción:
// se le pide a macOS directo, con koffi.
const ESTACIONARIA = 16n; // NSWindowCollectionBehaviorStationary
let objc = null;

function fijarEnMac(win) {
  if (process.platform !== "darwin" || !win || win.isDestroyed()) return;
  try {
    if (!objc) {
      const lib = require("koffi").load("/usr/lib/libobjc.A.dylib");
      objc = {
        sel: lib.func("uint64 sel_registerName(const char *nombre)"),
        pedir: lib.func("uint64 objc_msgSend(uint64 objeto, uint64 sel)"),
        poner: lib.func("void objc_msgSend(uint64 objeto, uint64 sel, uint64 valor)"),
      };
    }
    const vista = win.getNativeWindowHandle().readBigUInt64LE(0); // la NSView de la ventana
    const nsWindow = objc.pedir(vista, objc.sel("window"));
    const actual = BigInt(objc.pedir(nsWindow, objc.sel("collectionBehavior")));
    if (!(actual & ESTACIONARIA)) objc.poner(nsWindow, objc.sel("setCollectionBehavior:"), actual | ESTACIONARIA);
  } catch (e) {
    console.error("No pude fijar la ventana en macOS:", e.message);
  }
}

// ---------- ventana del chat ----------

function pantallaElegida() {
  return screen.getAllDisplays().find((d) => d.id === conf.pantallaId) || screen.getPrimaryDisplay();
}

// La pantalla se carga del sitio: así se guardan los cambios con la sesión del panel
// y cualquier mejora de la pantalla llega sola, sin reinstalar la app.
let tReintento;
function cargar() {
  clearTimeout(tReintento);
  if (ventana && !ventana.isDestroyed()) ventana.loadURL(conf.servidor + "/pantalla").catch(() => {});
}

function crearVentana() {
  const d = pantallaElegida();
  ventana = new BrowserWindow({
    ...d.bounds,
    // panel (Mac) flota sobre apps en pantalla completa; toolbar (Windows) no aparece en Alt+Tab.
    type: process.platform === "darwin" ? "panel" : process.platform === "win32" ? "toolbar" : undefined,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false },
  });
  ventana.setIgnoreMouseEvents(modo !== "editar");
  ventana.setFocusable(modo === "editar");
  ventana.setAlwaysOnTop(true, "screen-saver");
  if (process.platform === "darwin") ventana.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  fijarEnMac(ventana);
  ventana.setBounds(d.bounds);
  cargar();
  ventana.once("ready-to-show", () => {
    if (visible) ventana.showInactive();
  });
  // Si la página se cuelga o se cae, se levanta de nuevo sola.
  ventana.webContents.on("render-process-gone", () => {
    const v = ventana;
    ventana = null;
    if (v && !v.isDestroyed()) v.destroy();
    setTimeout(crearVentana, 1000);
  });
  ventana.on("unresponsive", () => ventana && ventana.webContents.reload());
  ventana.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ventana.webContents.on("will-navigate", (ev) => ev.preventDefault());
  // Sin internet al arrancar (o si se corta en medio de una recarga): reintenta sola.
  ventana.webContents.on("did-fail-load", (_ev, codigo, _desc, _url, principal) => {
    if (!principal || codigo === -3) return; // -3: se canceló porque empezó otra carga
    estado = "desconectado";
    armarTray();
    tReintento = setTimeout(cargar, 3000);
  });
  ventana.webContents.on("did-finish-load", () => ventana.webContents.send("modo", modo));
}

// ---------- modos: ver (usar la PC) y editar ----------

function ponerModo(m) {
  modo = m === "editar" ? "editar" : "ver";
  const editar = modo === "editar";
  if (editar && !visible) alternar();
  if (ventana && !ventana.isDestroyed()) {
    ventana.setIgnoreMouseEvents(!editar);
    ventana.setFocusable(editar);
    if (editar) {
      if (process.platform === "darwin") app.focus({ steal: true });
      ventana.focus();
    } else ventana.blur();
    ventana.webContents.send("modo", modo);
  }
  armarTray();
}

// ---------- botonera flotante ----------

function crearBotonera() {
  const area = pantallaElegida().workArea;
  const ancho = 300;
  const alto = 46;
  const guardada = conf.botonera;
  const enPantalla = guardada && screen.getAllDisplays().some((d) => guardada.x >= d.bounds.x && guardada.x < d.bounds.x + d.bounds.width && guardada.y >= d.bounds.y && guardada.y < d.bounds.y + d.bounds.height);
  botonera = new BrowserWindow({
    x: enPantalla ? guardada.x : area.x + area.width - ancho - 16,
    y: enPantalla ? guardada.y : area.y + area.height - alto - 16,
    width: ancho,
    height: alto,
    type: process.platform === "darwin" ? "panel" : process.platform === "win32" ? "toolbar" : undefined,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  botonera.setAlwaysOnTop(true, "screen-saver", 1); // un escalón arriba del chat
  if (process.platform === "darwin") botonera.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  fijarEnMac(botonera);
  botonera.loadFile(path.join(__dirname, "botonera.html"));
  botonera.once("ready-to-show", () => {
    if (conf.botoneraVisible !== false) botonera.showInactive();
    avisarBotonera();
  });
  botonera.on("moved", () => {
    const [x, y] = botonera.getPosition();
    guardarConf({ botonera: { x, y } });
  });
}

function avisarBotonera() {
  if (botonera && !botonera.isDestroyed()) botonera.webContents.send("estado-botonera", { modo, visible, conexion: estado });
}

function alternarBotonera() {
  if (!botonera || botonera.isDestroyed()) return;
  const mostrar = !botonera.isVisible();
  mostrar ? botonera.showInactive() : botonera.hide();
  guardarConf({ botoneraVisible: mostrar });
  armarTray();
}

function reubicar() {
  if (ventana && !ventana.isDestroyed()) ventana.setBounds(pantallaElegida().bounds);
  armarTray();
}

function alternar() {
  visible = !visible;
  if (!visible && modo === "editar") ponerModo("ver");
  if (ventana) visible ? ventana.showInactive() : ventana.hide();
  armarTray();
}

// Algunos programas (presentaciones, reproductores) se ponen arriba de todo:
// cada tanto el chat vuelve a ponerse adelante.
function reafirmar() {
  if (ventana && !ventana.isDestroyed() && visible) {
    fijarEnMac(ventana);
    ventana.setAlwaysOnTop(true, "screen-saver");
    if (process.platform === "win32") ventana.moveTop();
  }
  if (botonera && !botonera.isDestroyed() && botonera.isVisible()) {
    fijarEnMac(botonera);
    botonera.setAlwaysOnTop(true, "screen-saver", 1);
    if (process.platform === "win32") botonera.moveTop();
  }
}

// ---------- ícono de la bandeja (globito de color según la conexión) ----------

function dentroDelGlobo(x, y) {
  const enCirculo = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const lado = (ax, ay, bx, by) => (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const enCola = (() => {
    const d1 = lado(7, 19, 4, 30);
    const d2 = lado(4, 30, 16, 24);
    const d3 = lado(16, 24, 7, 19);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  })();
  if (!enCirculo(16, 14, 12.5) && !enCola) return false;
  // tres puntitos huecos adentro
  return !(enCirculo(10, 14, 2) || enCirculo(16, 14, 2) || enCirculo(22, 14, 2));
}

function icono() {
  const t = 32;
  const buf = Buffer.alloc(t * t * 4);
  const [r, g, b] = COLORES[estado] || COLORES.conectando;
  for (let y = 0; y < t; y++) {
    for (let x = 0; x < t; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (dentroDelGlobo(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      const a = n / 16;
      const i = (y * t + x) * 4;
      buf[i] = Math.round(b * a); // BGRA premultiplicado
      buf[i + 1] = Math.round(g * a);
      buf[i + 2] = Math.round(r * a);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: t, height: t, scaleFactor: 2 });
}

function armarTray() {
  avisarBotonera();
  if (!tray) tray = new Tray(icono());
  else tray.setImage(icono());
  const principal = screen.getPrimaryDisplay().id;
  const elegida = pantallaElegida().id;
  tray.setToolTip(NOMBRE + " — " + ETIQUETAS[estado]);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: NOMBRE + " — " + ETIQUETAS[estado], enabled: false },
      { label: conf.servidor, enabled: false },
      { type: "separator" },
      { label: modo === "editar" ? "Listo: volver a usar la PC" : "Editar la pantalla", accelerator: ATAJO_EDITAR, click: () => ponerModo(modo === "editar" ? "ver" : "editar") },
      { label: visible ? "Ocultar todo" : "Mostrar todo", accelerator: ATAJO, click: alternar },
      { label: botonera && !botonera.isDestroyed() && botonera.isVisible() ? "Ocultar la botonera" : "Mostrar la botonera", click: alternarBotonera },
      {
        label: "Pantalla",
        submenu: screen.getAllDisplays().map((d, i) => ({
          label: `Pantalla ${i + 1} (${d.size.width}×${d.size.height})${d.id === principal ? " · principal" : ""}`,
          type: "radio",
          checked: d.id === elegida,
          click: () => {
            guardarConf({ pantallaId: d.id });
            reubicar();
          },
        })),
      },
      { label: "Recargar", click: () => ventana && ventana.webContents.reload() },
      { type: "separator" },
      { label: "Abrir el panel de producción", click: () => shell.openExternal(conf.servidor + "/panel") },
      { label: "Cambiar el servidor…", click: abrirConfig },
      { type: "separator" },
      { label: "Salir", click: () => app.quit() },
    ])
  );
}

// ---------- ventanita para cambiar el servidor ----------

function abrirConfig() {
  if (ventanaConfig && !ventanaConfig.isDestroyed()) return ventanaConfig.focus();
  ventanaConfig = new BrowserWindow({
    width: 520,
    height: 230,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Servidor del chat",
    backgroundColor: "#101016",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  ventanaConfig.setMenuBarVisibility(false);
  ventanaConfig.loadFile(path.join(__dirname, "config.html"));
}

ipcMain.on("estado", (_ev, s) => {
  if (s === estado || !COLORES[s]) return;
  estado = s;
  armarTray();
});

ipcMain.handle("leer-servidor", () => conf.servidor);

ipcMain.on("pedir-modo", (_ev, m) => ponerModo(m));

ipcMain.on("botonera", (_ev, accion) => {
  if (accion === "modo") ponerModo(modo === "editar" ? "ver" : "editar");
  else if (accion === "visible") alternar();
  else if (accion === "esconder") alternarBotonera();
});

ipcMain.handle("guardar-servidor", (_ev, valor) => {
  let url;
  try {
    url = new URL(String(valor).trim());
  } catch {
    return "Esa dirección no es válida";
  }
  if (!/^https?:$/.test(url.protocol)) return "Tiene que empezar con https://";
  guardarConf({ servidor: url.origin });
  if (ventana) cargar();
  armarTray();
  if (ventanaConfig && !ventanaConfig.isDestroyed()) ventanaConfig.close();
  return "";
});

// ---------- arranque ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (leerConf().sinAceleracion) app.disableHardwareAcceleration(); // por si en alguna PC la ventana sale negra
  app.whenReady().then(() => {
    if (process.platform === "darwin") app.dock.hide();
    conf = leerConf();
    crearVentana();
    crearBotonera();
    armarTray();
    globalShortcut.register(ATAJO, alternar);
    globalShortcut.register(ATAJO_EDITAR, () => ponerModo(modo === "editar" ? "ver" : "editar"));
    powerSaveBlocker.start("prevent-display-sleep"); // que la pantalla no se apague en medio del show
    for (const ev of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(ev, reubicar);
    setInterval(reafirmar, 3000);
  });
  app.on("window-all-closed", () => {}); // la app sigue viva aunque se cierre la ventanita de configuración
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
