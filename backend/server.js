// Backend de Ruta: API en vivo (GTFS-RT, flota Croma, estimaciones, geocodificación) + archivos estáticos opcionales.
//   node backend/server.js                 → sirve la API y, si existe, STATIC_DIR (por defecto ../web)
//   STATIC_DIR=../legacy node server.js    → sirve la versión 1 junto con la API
// Endpoints: /api/rt  /api/alerts  /api/est  /api/fleet  /api/geocode  /api/health
require("./src/env");
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { fleet, creditState } = require("./src/fleet");
const { rtFeed, alertsFeed, estimates, hasSchedule } = require("./src/gtfs-rt");
const { geocode } = require("./src/geocode");
const shapes = require("./src/shapes");
const walk = require("./src/walk");

const PORT = process.env.PORT || 5173;
const STATIC = path.resolve(__dirname, process.env.STATIC_DIR || "../web");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".woff2": "font/woff2" };
const BLOCK = /^(\.env|\.credits|server\.js|server-data|tools|mobile|node_modules|skills-lock|backend)/;

const json = (res, code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(typeof obj === "string" ? obj : JSON.stringify(obj)); };
const fail = (res, e) => json(res, 502, { error: String(e.message) });

/* Estáticos: lectura en memoria con ETag, compresión brotli/gzip (precomprimida una vez por archivo y versión) y caché.
   - html/js/css: «no-cache» (siempre se revalida, pero con 304 cuesta casi nada).
   - datos, SVG, imágenes y fuentes: una hora fresca y un día «stale-while-revalidate». */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".geojson", ".svg", ".webmanifest"]);
const CODE = new Set([".html", ".js", ".css"]);
const cache = new Map();   // ruta → { mtime, size, etag, raw, br, gz }
function entry(file, stat, data) {
  let e = cache.get(file);
  if (e && e.mtime === stat.mtimeMs && e.size === stat.size) return e;
  const ext = path.extname(file);
  e = { mtime: stat.mtimeMs, size: stat.size, etag: '"' + crypto.createHash("sha1").update(data).digest("base64url").slice(0, 16) + '"', raw: data, br: null, gz: null };
  if (COMPRESSIBLE.has(ext) && data.length > 1024) {
    e.br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
    e.gz = zlib.gzipSync(data, { level: 9 });
  }
  cache.set(file, e); return e;
}
function serveStatic(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.statusCode = 404; return res.end("no encontrado"); }
    const cached = cache.get(file);
    const send = (data) => {
      const e = entry(file, stat, data), ext = path.extname(file);
      res.setHeader("Content-Type", (TYPES[ext] || "application/octet-stream") + (/^(text|application\/(json|manifest))/.test(TYPES[ext] || "") || ext === ".svg" ? "; charset=utf-8" : ""));
      res.setHeader("ETag", e.etag); res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Cache-Control", CODE.has(ext) ? "no-cache" : "public, max-age=3600, stale-while-revalidate=86400");
      if (req.headers["if-none-match"] === e.etag) { res.statusCode = 304; return res.end(); }
      const ae = String(req.headers["accept-encoding"] || "");
      let body = e.raw;
      if (e.br && /\bbr\b/.test(ae)) { body = e.br; res.setHeader("Content-Encoding", "br"); }
      else if (e.gz && /\bgzip\b/.test(ae)) { body = e.gz; res.setHeader("Content-Encoding", "gzip"); }
      res.setHeader("Content-Length", body.length);
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return send(cached.raw);
    fs.readFile(file, (e2, data) => { if (e2) { res.statusCode = 404; return res.end("no encontrado"); } send(data); });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // La app instalada en el teléfono (o una web en otro sitio) llama a esta API desde otro origen: datos de solo lectura, sin cookies.
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  }
  if (url.pathname === "/api/health") {
    return json(res, 200, { ok: true, rt: !!process.env.GTFS_RT_URL, fleetKey: !!process.env.CROMA_API_KEY, schedule: hasSchedule(), credits: creditState() });
  }
  if (url.pathname === "/api/alerts") {
    if (!process.env.GTFS_RT_URL && !process.env.ALERTS_URL) return json(res, 503, '{"error":"no_feed"}');
    try { const b = await alertsFeed(); res.setHeader("Content-Type", "application/x-protobuf"); return res.end(b); } catch (e) { return fail(res, e); }
  }
  if (url.pathname === "/api/geocode") {
    try { return json(res, 200, { results: await geocode(url.searchParams.get("q") || "", url.searchParams.get("mode") === "submit" ? "submit" : "suggest") }); } catch (e) { return fail(res, e); }
  }
  if (url.pathname === "/api/shape") {
    // /api/shape?legs=rid:p0:p1,rid:p0:p1 → recorrido por las calles de cada tramo ([lon,lat] o null si no hay)
    const legs = (url.searchParams.get("legs") || "").split(",").slice(0, 8).map((x) => x.split(":"));
    // walks=lat,lon,lat,lon;… → camino a pie por las calles de cada tramo caminado
    const walks = (url.searchParams.get("walks") || "").split(";").filter(Boolean).slice(0, 8).map((x) => x.split(",").map(Number));
    return json(res, 200, { shapes: legs.map(([rid, a, b]) => shapes.slice(String(rid), Number(a), Number(b))), walks: walks.map((w) => (w.length === 4 && w.every(isFinite) ? walk.route([w[0], w[1]], [w[2], w[3]]) : null)) });
  }
  if (url.pathname === "/api/est") {
    if (!process.env.GTFS_RT_URL || !hasSchedule()) return json(res, 503, '{"error":"no_feed"}');
    try { return json(res, 200, await estimates()); } catch (e) { return fail(res, e); }
  }
  if (url.pathname === "/api/rt") {
    if (!process.env.GTFS_RT_URL) return json(res, 503, '{"error":"no_feed"}');
    try { const b = await rtFeed(); res.setHeader("Content-Type", "application/x-protobuf"); return res.end(b); } catch (e) { return fail(res, e); }
  }
  if (url.pathname === "/api/fleet") {
    if (!process.env.CROMA_API_KEY) return json(res, 503, '{"error":"missing_api_key"}');
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon")), r = Math.min(5000, Math.max(50, Number(url.searchParams.get("r")) || 2000));
    if (!isFinite(lat) || !isFinite(lon)) return json(res, 400, '{"error":"bad_params"}');
    try { return json(res, 200, await fleet(lat, lon, r)); } catch (e) { return fail(res, e); }
  }
  const file = path.join(STATIC, path.normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  const rel = path.relative(STATIC, file);
  if (rel.startsWith("..") || BLOCK.test(rel)) { res.statusCode = 404; return res.end(); }
  serveStatic(req, res, file);
}).listen(PORT, () => console.log(`Ruta backend en http://localhost:${PORT} (estáticos: ${STATIC})`));
