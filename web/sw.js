// GENERADO por backend/tools/build-sw.mjs — no editar a mano.
const VERSION = "fb0af647b8";
const SHELL = "ruta-app-" + VERSION;      // la app: HTML, CSS, JS, datos e iconos
const LIBS = "ruta-libs-v1";              // MapLibre y tipografías (versionadas en su URL: nunca cambian)
const TILES = "ruta-tiles-v1";            // teselas del mapa que ya se vieron
const API = "ruta-api-v1";                // últimas respuestas de alertas, trazados y búsqueda de lugares
const MAX_TILES = 700;
const FILES = ["apple-touch-icon.png","assets/ruta-wordmark.svg","css/app.css","data/colors.json","data/fare.json","data/hours.json","data/map-dark.svg","data/map-light.svg","data/network.geojson","data/places.json","data/recharge-shops.json","data/route-stops.json","data/routes-index.json","data/routes-meta.json","data/routes.geojson","data/src/map-dark.orig.svg","data/src/map-light.orig.svg","icon-192.png","icon-512.png","icon-maskable-512.png","icon.svg","./","js/card-sim.js","js/data.js","js/detail.js","js/home-map.js","js/i18n.js","js/keyboard.js","js/loc.js","js/main.js","js/net.js","js/numify.js","js/onboarding.js","js/places.js","js/plan-worker.js","js/planner.js","js/rt.js","js/screens/balance.js","js/screens/home.js","js/screens/map.js","js/screens/plan.js","js/screens/routes.js","js/theme.js","js/ui.js","manifest.webmanifest"];

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
