// Arma la app para Mac (Apple Silicon e Intel) y Windows, y la deja en dist/ como .zip.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const servidor = JSON.parse(readFileSync("config.json", "utf8")).servidor;
if (servidor.includes("localhost")) console.warn("⚠️  config.json apunta a localhost: cambialo por la dirección publicada antes de repartir la app.");

const destinos = (process.argv[2] || "darwin-arm64,darwin-x64,win32-x64").split(",");
for (const d of destinos) {
  const [platform, arch] = d.split("-");
  const [carpeta] = await packager({
    dir: ".",
    out: "dist",
    overwrite: true,
    platform,
    arch,
    asar: { unpack: "**/*.node" }, // koffi trae una parte nativa que no puede ir adentro del asar
    prune: true,
    name: "Brindis Bravo",
    executableName: platform === "win32" ? "Brindis Bravo" : undefined,
    appBundleId: "ar.brindisbravo.pantalla",
    appCopyright: "Brindis Bravo",
    // De koffi sólo hace falta la parte nativa de la plataforma que se arma.
    ignore: [/^\/dist($|\/)/, /^\/empaquetar\.mjs$/, new RegExp(`^/node_modules/koffi/build/koffi/(?!${platform}_${arch}(/|$))`), /^\/node_modules\/koffi\/(src|doc|vendor)($|\/)/],
    extendInfo: { LSUIElement: true },
  });
  const zip = path.join("dist", `Brindis Bravo - ${platform === "darwin" ? "Mac" : "Windows"} ${arch === "arm64" ? "(Apple Silicon)" : platform === "darwin" ? "(Intel)" : ""}`.trim() + ".zip");
  const origen = platform === "darwin" ? path.join(carpeta, "Brindis Bravo.app") : carpeta;
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", origen, zip]);
  console.log("Listo:", zip);
}
