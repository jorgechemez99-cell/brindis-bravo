// Puente mínimo entre las páginas y la app: estado de la conexión, dirección del
// servidor, modo (ver / editar) y los botones de la botonera.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  estado: (s) => ipcRenderer.send("estado", String(s)),
  leerServidor: () => ipcRenderer.invoke("leer-servidor"),
  guardarServidor: (url) => ipcRenderer.invoke("guardar-servidor", String(url)),
  alModo: (cb) => ipcRenderer.on("modo", (_ev, m) => cb(String(m))),
  pedirModo: (m) => ipcRenderer.send("pedir-modo", String(m)),
  alEstadoBotonera: (cb) => ipcRenderer.on("estado-botonera", (_ev, s) => cb(s)),
  botonera: (accion) => ipcRenderer.send("botonera", String(accion)),
});
