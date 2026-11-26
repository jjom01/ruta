// Genera web/sw.js: el service worker que deja Ruta instalable y utilizable sin conexión.
//   node backend/tools/build-sw.mjs
// Lista todos los archivos de la app (HTML, CSS, JS, datos, iconos) y calcula una versión a partir de su contenido:
// cuando algo cambia, la versión cambia y el teléfono descarga la nueva copia en segundo plano.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const SKIP = /^(sw\.js|dev\/|\.DS_Store)/;
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name), rel = relative(WEB, p).split("\\").join("/"); if (SKIP.test(rel) || SKIP.test(rel + "/")) continue; e.isDirectory() ? walk(p) : files.push(rel); } };
walk(WEB);
files.sort();

const hash = createHash("sha1");
for (const f of files) { hash.update(f); hash.update(readFileSync(join(WEB, f))); }
const version = hash.digest("hex").slice(0, 10);
const bytes = files.reduce((a, f) => a + statSync(join(WEB, f)).size, 0);

const shell = files.map((f) => (f === "index.html" ? "./" : f));
const src = `// GENERADO por backend/tools/build-sw.mjs — no editar a mano.
const VERSION = "${version}";
const SHELL = "ruta-app-" + VERSION;      // la app: HTML, CSS, JS, datos e iconos
const LIBS = "ruta-libs-v1";              // MapLibre y tipografías (versionadas en su URL: nunca cambian)
const TILES = "ruta-tiles-v1";            // teselas del mapa que ya se vieron
const API = "ruta-api-v1";                // últimas respuestas de alertas, trazados y búsqueda de lugares
const MAX_TILES = 700;
const FILES = ${JSON.stringify(shell)};

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // no_cache: así la copia nunca sale de la caché HTTP del navegador sino del servidor
    await Promise.all(FILES.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("ruta-app-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isTile = (u) => u.hostname === "tiles.openfreemap.org";
const isLib = (u) => u.hostname === "unpkg.com" || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
const isLive = (u) => u.pathname === "/api/rt" || u.pathname === "/api/est" || u.pathname === "/api/health" || u.pathname === "/api/fleet";

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

// Responde con la copia guardada al instante y la renueva por detrás
async function staleWhileRevalidate(req, name, max) {
  const cache = await caches.open(name), hit = await cache.match(req);
  const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") { cache.put(req, r.clone()); max && trim(cache, max); } return r; }).catch(() => null);
  return hit || (await net) || new Response("", { status: 504 });
}
// Una vez guardado, no vuelve a la red (las URL llevan versión)
async function cacheFirst(req, name) {
  const cache = await caches.open(name), hit = await cache.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") cache.put(req, r.clone());
  return r;
}
// Red primero con tiempo límite; sin conexión, la última respuesta guardada
async function networkFirst(req, name, ms = 6000) {
  const cache = await caches.open(name);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
    if (r.ok) cache.put(req, r.clone());
    return r;
  } catch {
    return (await cache.match(req)) || new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (isTile(url)) return e.respondWith(staleWhileRevalidate(req, TILES, MAX_TILES));
  if (isLib(url)) return e.respondWith(cacheFirst(req, LIBS).catch(() => new Response("", { status: 504 })));
  if (url.origin !== location.origin) return;
  if (isLive(url)) return;                                   // buses en vivo: siempre de la red, nunca de una copia vieja
  if (url.pathname.startsWith("/api/")) return e.respondWith(networkFirst(req, API));
  if (req.mode === "navigate") {                             // abrir la app: la copia guardada, y se renueva por detrás
    e.respondWith((async () => {
      const cache = await caches.open(SHELL), hit = await cache.match("./") || await cache.match("/index.html");
      const net = fetch(req).then((r) => { if (r.ok && url.pathname === "/") cache.put("./", r.clone()); return r; }).catch(() => null);
      return hit || (await net) || new Response("Sin conexión", { status: 503 });
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(SHELL), key = req.url.split("?")[0] === location.origin + "/" ? "./" : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok) cache.put(key, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response("", { status: 504 });
  })());
});
`;
writeFileSync(join(WEB, "sw.js"), src);
console.log(`sw.js v${version}: ${files.length} archivos, ${(bytes / 1048576).toFixed(1)} MB`);
