// Claves con PBKDF2 (WebCrypto) y tokens de sesión.
const ITERACIONES = 100000; // el máximo que permite workerd
const enc = new TextEncoder();

export async function hashClave(clave, salB64) {
  const sal = salB64 ? b64aBytes(salB64) : crypto.getRandomValues(new Uint8Array(16));
  const llave = await crypto.subtle.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: ITERACIONES },
    llave,
    256
  );
  return { sal: bytesAb64(sal), hash: bytesAb64(new Uint8Array(bits)) };
}

export async function verificarClave(clave, sal, hash) {
  const r = await hashClave(clave, sal);
  return iguales(r.hash, hash);
}

// Compara dos textos sin filtrar por tiempo cuánto coinciden.
export async function compararTexto(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return iguales(ha, hb);
}

export function tokenAleatorio() {
  return bytesAb64(crypto.getRandomValues(new Uint8Array(24))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(texto) {
  return bytesAb64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(texto))));
}

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function bytesAb64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64aBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
