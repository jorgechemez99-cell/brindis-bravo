// Utilidades para los scripts de terminal.
import { createInterface } from "node:readline";

// Pide una clave sin mostrarla (aparecen puntitos).
export function pedirClave(pregunta) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    return new Promise((resolver) => rl.question(pregunta, (r) => (rl.close(), resolver(r))));
  }
  return new Promise((resolver) => {
    let valor = "";
    stdout.write(pregunta);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const alTeclear = (texto) => {
      for (const c of texto) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", alTeclear);
          stdout.write("\n");
          return resolver(valor);
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") {
          if (valor) {
            valor = Array.from(valor).slice(0, -1).join("");
            stdout.write("\b \b");
          }
        } else if (c >= " ") {
          valor += c;
          stdout.write("•");
        }
      }
    };
    stdin.on("data", alTeclear);
  });
}

// Cliente mínimo de la API del panel (guarda la cookie de sesión).
export function clienteApi(base) {
  let cookie = "";
  async function pedir(metodo, ruta, datos) {
    const r = await fetch(base + "/api/" + ruta, {
      method: metodo,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: metodo === "POST" ? JSON.stringify(datos || {}) : undefined,
    });
    if (ruta === "login" && r.ok) cookie = (r.headers.get("set-cookie") || "").split(";")[0];
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status} en ${ruta}`);
    return j;
  }
  return {
    post: (ruta, datos) => pedir("POST", ruta, datos),
    get: (ruta) => pedir("GET", ruta),
  };
}
