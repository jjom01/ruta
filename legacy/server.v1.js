// Servidor mínimo sin dependencias: sirve la carpeta y proxea la flota de Croma.
// La clave CROMA_API_KEY vive solo aquí (env o .env.local), nunca llega al navegador.
const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  for (const l of fs.readFileSync(path.join(__dirname, ".env.local"), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = process.env.PORT || 5173;
const BASE = process.env.CROMA_API_URL || "https://api.croma.run";
const TTL = 120_000, PER_PAGE = 500;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// Cada lectura en vivo cuesta 10 créditos (plan gratuito: 1.500 al mes). Se lee una sola
// página por zona, se cachea y hay un tope diario que se guarda en disco.
const DAILY_CALLS = Number(process.env.DAILY_CALLS || 5);
const RESERVE = 20;
const STATE_FILE = process.env.CREDITS_FILE || path.join(__dirname, ".credits.json");
let state = { day: "", calls: 0, remaining: null, reset: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} };
const today = () => new Date().toISOString().slice(0, 10);

const croma = async (body) => {
  const r = await fetch(`${BASE}/co/transmilenio/vehicles/v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CROMA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rem = r.headers.get("x-ratelimit-remaining");
  if (rem !== null) state.remaining = Number(rem);
  state.reset = r.headers.get("x-ratelimit-reset") || state.reset;
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.data) throw new Error(j?.error?.code || "http_" + r.status);
  return j.data;
};

const cache = new Map();
const inflight = new Map();
async function fleet(lat, lon, r) {
  const key = `${lat.toFixed(2)}:${lon.toFixed(2)}:${Math.ceil(r / 500) * 500}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.body;
  if (state.day !== today()) { state.day = today(); state.calls = 0; }
  if (state.calls >= DAILY_CALLS) { if (hit) return hit.body; throw new Error("daily_budget"); }
  const expired = state.reset && Date.now() > Date.parse(state.reset);
  if (expired) state.remaining = null;
  if (state.remaining !== null && state.remaining < RESERVE + 10) { if (hit) return hit.body; throw new Error("plan_limit_reached"); }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    state.calls++; save();
    const d = await croma({ latitude: lat, longitude: lon, radius_m: Math.ceil(r / 500) * 500, per_page: PER_PAGE, page: 1 });
    save();
    const out = d.vehicles.map((v) => ({
      id: v.vehicle_id ?? v.label ?? `${v.latitude},${v.longitude}`, rid: v.route_id, code: v.route_code, system: v.system,
      lat: v.latitude, lon: v.longitude, bearing: v.bearing ?? null, ts: v.reported_at ? Date.parse(v.reported_at) / 1000 : 0,
    }));
    const body = JSON.stringify({ asOf: d.as_of, live: d.live, total: d.total, vehicles: out, credits: state.remaining, resetsAt: state.reset, callsToday: state.calls, callsLeft: Math.max(0, DAILY_CALLS - state.calls) });
    cache.set(key, { at: Date.now(), body });
    return body;
  })().catch((e) => { state.calls = Math.max(0, state.calls - 1); save(); if (hit) return hit.body; throw e; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Feed oficial GTFS Realtime (sin créditos): se define GTFS_RT_URL en .env.local.
let rt = null;
async function rtFeed() {
  if (rt && Date.now() - rt.at < 10_000) return rt.buf;
  try {
    const r = await fetch(process.env.GTFS_RT_URL, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error("http_" + r.status);
    rt = { at: Date.now(), buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    if (!rt) throw e;
  }
  return rt.buf;
}

let al = null;
async function alertsFeed() {
  const url = process.env.ALERTS_URL || (process.env.GTFS_RT_URL || "").replace(/[^/]*$/, "alerts.pb");
  if (al && Date.now() - al.at < 60_000) return al.buf;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error("http_" + r.status);
    al = { at: Date.now(), buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { if (!al) throw e; }
  return al.buf;
}

// Buses asignados a un viaje en curso (tripupdates.pb) que no tienen posición fresca en positions.pb:
// se estima dónde van con el horario y el retraso del viaje (server-data/schedule.json).
let SCHEDULE = {};
try { SCHEDULE = JSON.parse(fs.readFileSync(path.join(__dirname, "server-data", "schedule.json"), "utf8")); } catch {}
function pb(buf) {
  let i = 0;
  const big = () => { let r = 0n, s = 0n, x; do { x = buf[i++]; r |= BigInt(x & 127) << s; s += 7n; } while (x & 128); return r; };
  const rd = (a, b, cb) => {
    i = a;
    while (i < b) {
      const k = Number(big()), f = k >>> 3, w = k & 7;
      if (w === 0) cb(f, big());
      else if (w === 2) { const l = Number(big()), st = i; i += l; const keep = i; cb(f, [st, st + l]); i = keep; }
      else if (w === 5) { cb(f, buf.subarray(i, i + 4)); i += 4; }
      else if (w === 1) { cb(f, buf.subarray(i, i + 8)); i += 8; }
      else break;
    }
  };
  return { rd, str: (r) => buf.toString("utf8", r[0], r[1]) };
}
let tu = null;
async function tripFeed() {
  if (tu && Date.now() - tu.at < 20_000) return tu.buf;
  try {
    const r = await fetch(process.env.GTFS_RT_URL.replace(/[^/]*$/, "tripupdates.pb"), { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error("http_" + r.status);
    tu = { at: Date.now(), buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { if (!tu) throw e; }
  return tu.buf;
}
function along(sc, dist) {
  const c = sc.c, p = sc.p;
  if (dist <= 0) return { lat: p[0][0], lon: p[0][1], b: null };
  for (let k = 1; k < c.length; k++) {
    if (dist <= c[k]) {
      const f = (dist - c[k - 1]) / Math.max(1, c[k] - c[k - 1]);
      const [a1, o1] = p[k - 1], [a2, o2] = p[k];
      const dx = (o2 - o1) * Math.cos(a1 * Math.PI / 180), dy = a2 - a1;
      return { lat: a1 + (a2 - a1) * f, lon: o1 + (o2 - o1) * f, b: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
    }
  }
  const n = p.length - 1;
  return { lat: p[n][0], lon: p[n][1], b: null };
}
function distAt(t, el) {
  for (let k = 1; k < t.length; k++) if (el <= t[k][0]) return t[k - 1][1] + (t[k][1] - t[k - 1][1]) * ((el - t[k - 1][0]) / Math.max(1, t[k][0] - t[k - 1][0]));
  return t[t.length - 1][1];
}
let est = null;
let estAsked = 0;
setInterval(() => { if (Date.now() - estAsked < 300_000) estimates().catch(() => {}); }, 20_000);   // mantiene la estimación lista mientras alguien la use
let estBusy = null;
async function estimates() {
  estAsked = Date.now();
  if (est && Date.now() - est.at < 20_000) return est.body;
  if (!estBusy) estBusy = computeEstimates().finally(() => (estBusy = null));
  return est ? est.body : estBusy;      // con una copia previa se responde al instante y se refresca atrás
}
async function computeEstimates() {
  const nowS = Date.now() / 1000;
  // vehículos con GPS fresco
  const fresh = new Set();
  { const b = await rtFeed(), P = pb(b);
    P.rd(0, b.length, (f, v) => { if (f !== 2) return;
      let id = "", ts = 0;
      P.rd(v[0], v[1], (f2, v2) => { if (f2 !== 4) return;
        P.rd(v2[0], v2[1], (f3, v3) => { if (f3 === 5) ts = Number(v3); else if (f3 === 8) P.rd(v3[0], v3[1], (f4, v4) => { if (f4 === 1 && !id) id = P.str(v4); }); }); });
      if (id && nowS - ts < 300) fresh.add(id); }); }
  const b = await tripFeed(), P = pb(b);
  const sec = (nowS - 5 * 3600) % 86400;               // hora local de Bogotá (sin horario de verano)
  const out = [];
  P.rd(0, b.length, (f, v) => { if (f !== 2) return;
    P.rd(v[0], v[1], (f2, v2) => { if (f2 !== 3) return;
      let rid = "", start = "", rel = 0, veh = "", delay = 0;
      P.rd(v2[0], v2[1], (f3, v3) => {
        if (f3 === 1) P.rd(v3[0], v3[1], (f4, v4) => { if (f4 === 2) start = P.str(v4); else if (f4 === 4) rel = Number(v4); else if (f4 === 5) rid = P.str(v4); });
        else if (f3 === 3) P.rd(v3[0], v3[1], (f4, v4) => { if (f4 === 1) veh = P.str(v4); });
        else if (f3 === 5) delay = Number(BigInt.asIntN(64, v3));
      });
      const sc = SCHEDULE[rid];
      if (!veh || !sc || rel === 3 || fresh.has(veh) || !start) return;
      const [h, m, s] = start.split(":").map(Number), st = h * 3600 + m * 60 + s;
      for (const day of [0, 86400]) {
        const el = sec + day - (st + delay), dur = sc.t[sc.t.length - 1][0];
        if (el >= 0 && el <= dur) {
          const q = along(sc, distAt(sc.t, el));
          out.push({ id: veh, rid, code: null, system: null, lat: +q.lat.toFixed(5), lon: +q.lon.toFixed(5), bearing: q.b, ts: nowS, est: 1 });
          break;
        }
      }
    }); });
  const seen = new Set(), vehicles = out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  est = { at: Date.now(), body: JSON.stringify({ asOf: new Date().toISOString(), vehicles }) };
  return est.body;
}

/* ---------- geocodificación ----------
   Direcciones de la malla (Calle 80 # 69-20, Calle 80 con Carrera 69): se resuelven aquí, en la esquina de las dos
   vías, con server-data/streets.json (OpenStreetMap). Nada de eso sale a internet.
   Lugares por nombre (Parque de la 93, Universidad Nacional…): se consultan a Photon (OpenStreetMap), con caché. */
let STREETS = null, streetsTried = 0;
const streets = () => {
  if ((!STREETS || !Object.keys(STREETS).length) && Date.now() - streetsTried > 10_000) {
    streetsTried = Date.now();
    try { STREETS = JSON.parse(fs.readFileSync(path.join(__dirname, "server-data", "streets.json"), "utf8")); } catch { STREETS = {}; }
  }
  return STREETS;
};
const T = { calle: "calle", cl: "calle", cll: "calle", carrera: "carrera", cra: "carrera", cr: "carrera", kr: "carrera", k: "carrera", diagonal: "diagonal", dg: "diagonal", diag: "diagonal", transversal: "transversal", tv: "transversal", trans: "transversal" };
const OPP = { calle: "carrera", diagonal: "carrera", carrera: "calle", transversal: "calle" };
const NUM = "(\\d+)\\s*([a-z]{0,2})?\\s*(bis)?\\s*(sur|este)?";
const RE_PLATE = new RegExp(`^\\s*(?:av(?:enida|\\.)?\\s+)?(calle|cll|cl|carrera|cra|cr|kr|k|diagonal|diag|dg|transversal|trans|tv)\\.?\\s*${NUM}\\s*(?:#|no\\.?|nº|n°|num\\.?)?\\s*${NUM}\\s*[-–]\\s*(\\d+)`, "i");
const RE_CROSS = new RegExp(`^\\s*(?:av(?:enida|\\.)?\\s+)?(calle|cll|cl|carrera|cra|cr|kr|k|diagonal|diag|dg|transversal|trans|tv)\\.?\\s*${NUM}\\s*(?:con|y|x|esquina con|esq\\.? con)\\s*(?:av(?:enida|\\.)?\\s+)?(calle|cll|cl|carrera|cra|cr|kr|k|diagonal|diag|dg|transversal|trans|tv)?\\.?\\s*${NUM}`, "i");
const skey = (type, n, letter, bis, sur) => `${type}|${parseInt(n, 10)}${(letter || "").toLowerCase()}${bis ? "b" : ""}${/^sur$/i.test(sur || "") ? "s" : ""}`;
function parseAddress(q) {
  let m = RE_CROSS.exec(q);
  if (m) {
    const t1 = T[m[1].toLowerCase()], t2 = m[6] ? T[m[6].toLowerCase()] : OPP[t1];
    if (t1 && t2 && t1 !== t2) return { a: skey(t1, m[2], m[3], m[4], m[5]), b: skey(t2, m[7], m[8], m[9], m[10]), label: q.trim() };
  }
  m = RE_PLATE.exec(q);
  if (m) {
    const t1 = T[m[1].toLowerCase()], t2 = OPP[t1];
    // "Sur" al final del primer o segundo grupo aplica a la calle (vía este-oeste)
    const sur1 = m[5], sur2 = m[9];
    const a = skey(t1, m[2], m[3], m[4], t1 === "calle" || t1 === "diagonal" ? sur1 : ""), b = skey(t2, m[6], m[7], m[8], t2 === "calle" ? sur2 || sur1 : "");
    return { a, b, label: q.trim() };
  }
  return null;
}
function intersect(A, B) {
  const kx = 111320 * Math.cos(4.65 * Math.PI / 180), ky = 110540;
  let best = { d: 1e9 };
  const segDist = (p, s0, s1) => {
    const ax = (s0[1] - p[1]) * kx, ay = (s0[0] - p[0]) * ky, bx = (s1[1] - p[1]) * kx, by = (s1[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    return { d: Math.hypot(px, py), pt: [p[0] + py / ky, p[1] + px / kx] };
  };
  for (const la of A) for (let i = 0; i < la.length; i++) for (const lb of B) for (let j = 0; j + 1 < lb.length; j++) {
    const r = segDist(la[i], lb[j], lb[j + 1]);
    if (r.d < best.d) best = { d: r.d, pt: la[i] };
  }
  return best.d < 350 ? best.pt : null;
}
function resolveAddress(q) {
  const p = parseAddress(q), S = streets();
  if (!p || !S[p.a] || !S[p.b]) return null;
  const pt = intersect(S[p.a], S[p.b]);
  return pt ? { label: p.label, sub: "Dirección · aproximada", lat: pt[0], lon: pt[1], kind: "address" } : null;
}
const geoCache = new Map();
let lastPhoton = 0;
async function photon(q) {
  const wait = Math.max(0, lastPhoton + 300 - Date.now());
  lastPhoton = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const u = new URL("https://photon.komoot.io/api/");
  u.search = new URLSearchParams({ q, limit: "6", lat: "4.65", lon: "-74.07", bbox: "-74.35,4.40,-73.90,4.90" });
  const r = await fetch(u, { headers: { "User-Agent": "Ruta/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("http_" + r.status);
  const j = await r.json();
  return (j.features || []).map((f) => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const label = p.name || street || "";
    return label ? { label, sub: [p.name ? street : "", p.district || p.locality || p.city].filter(Boolean).join(" · "), lat, lon, kind: "place" } : null;
  }).filter(Boolean);
}
let lastNom = 0;
async function nominatim(q) {
  const wait = Math.max(0, lastNom + 1100 - Date.now());
  lastNom = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.search = new URLSearchParams({ q: /bogot/i.test(q) ? q : `${q}, Bogotá`, format: "jsonv2", limit: "5", countrycodes: "co", addressdetails: "1", viewbox: "-74.35,4.90,-73.90,4.40", bounded: "1" });
  const r = await fetch(u, { headers: { "User-Agent": "Ruta/1.0" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("http_" + r.status);
  return (await r.json()).map((x) => {
    const a = x.address || {};
    const label = x.name || (a.road ? [a.road, a.house_number].filter(Boolean).join(" ") : x.display_name.split(",")[0]);
    return { label, sub: [a.road && x.name ? a.road : "", a.suburb || a.neighbourhood || a.city_district].filter(Boolean).join(" · "), lat: +x.lat, lon: +x.lon, kind: "place" };
  });
}
async function geocode(q, mode) {
  q = q.trim().slice(0, 120);
  if (q.length < 3) return [];
  const key = mode + "|" + q.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.v;
  const out = [];
  const addr = resolveAddress(q);
  if (addr) out.push(addr);
  if (!/^\s*\d/.test(q) && !(addr && /[#-]/.test(q))) {
    if (mode === "submit") { try { out.push(...(await nominatim(q))); } catch {} }
    if (mode !== "submit" || !out.length) { try { out.push(...(await photon(q))); } catch {} }
  }
  const seen = new Set(), v = out.filter((x) => (seen.has(x.label + x.lat.toFixed(4)) ? false : seen.add(x.label + x.lat.toFixed(4)))).slice(0, 6);
  if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value);
  geoCache.set(key, { at: Date.now(), v });
  return v;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/alerts") {
    res.setHeader("Content-Type", "application/x-protobuf");
    if (!process.env.GTFS_RT_URL && !process.env.ALERTS_URL) { res.statusCode = 503; res.setHeader("Content-Type", "application/json"); return res.end('{"error":"no_feed"}'); }
    try { return res.end(await alertsFeed()); }
    catch (e) { res.statusCode = 502; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ error: String(e.message) })); }
  }
  if (url.pathname === "/api/geocode") {
    res.setHeader("Content-Type", "application/json");
    try { return res.end(JSON.stringify({ results: await geocode(url.searchParams.get("q") || "", url.searchParams.get("mode") === "submit" ? "submit" : "suggest") })); }
    catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ error: String(e.message) })); }
  }
  if (url.pathname === "/api/est") {
    res.setHeader("Content-Type", "application/json");
    if (!process.env.GTFS_RT_URL || !Object.keys(SCHEDULE).length) { res.statusCode = 503; return res.end('{"error":"no_feed"}'); }
    try { return res.end(await estimates()); }
    catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ error: String(e.message) })); }
  }
  if (url.pathname === "/api/rt") {
    if (!process.env.GTFS_RT_URL) { res.statusCode = 503; res.setHeader("Content-Type", "application/json"); return res.end('{"error":"no_feed"}'); }
    try { res.setHeader("Content-Type", "application/x-protobuf"); return res.end(await rtFeed()); }
    catch (e) { res.statusCode = 502; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ error: String(e.message) })); }
  }
  if (url.pathname === "/api/fleet") {
    res.setHeader("Content-Type", "application/json");
    if (!process.env.CROMA_API_KEY) { res.statusCode = 503; return res.end('{"error":"missing_api_key"}'); }
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon")), r = Math.min(5000, Math.max(50, Number(url.searchParams.get("r")) || 2000));
    if (!isFinite(lat) || !isFinite(lon)) { res.statusCode = 400; return res.end('{"error":"bad_params"}'); }
    try { return res.end(await fleet(lat, lon, r)); }
    catch (e) { res.statusCode = 502; return res.end(JSON.stringify({ error: String(e.message) })); }
  }
  const file = path.join(__dirname, path.normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  const rel = path.relative(__dirname, file);
  if (rel.startsWith("..") || /^(\.env|\.credits|server\.js|server-data|tools|mobile|node_modules|skills-lock)/.test(rel)) { res.statusCode = 404; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end("no encontrado"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
}).listen(PORT, () => console.log(`Ruta en http://localhost:${PORT}`));
