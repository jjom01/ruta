// Geocodificación: malla de Bogotá (OSM local) + lugares con Photon/Nominatim.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const nrm = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
let STREETS = null, streetsTried = 0;
const streets = () => {
  if ((!STREETS || !Object.keys(STREETS).length) && Date.now() - streetsTried > 10_000) {
    streetsTried = Date.now();
    try { STREETS = JSON.parse(fs.readFileSync(path.join(ROOT, "server-data", "streets.json"), "utf8")); } catch { STREETS = {}; }
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
    return { a, b, label: q.trim(), plate: +m[10] };
  }
  return null;
}
// ---- ubicación exacta sobre la vía: cruce real de las dos calles + los metros de la placa hacia la siguiente calle ----
const KXX = 111320 * Math.cos(4.65 * Math.PI / 180), KYY = 110540;
const toM = (p) => [p[1] * KXX, p[0] * KYY], fromM = (v) => [v[1] / KYY, v[0] / KXX];
function closestSegs(a0, a1, b0, b1) {   // puntos más cercanos entre dos segmentos (metros): {d, pa}
  const P = toM(a0), Q = toM(a1), R = toM(b0), S = toM(b1), u = [Q[0] - P[0], Q[1] - P[1]], v = [S[0] - R[0], S[1] - R[1]], w = [P[0] - R[0], P[1] - R[1]];
  const a = u[0] * u[0] + u[1] * u[1], b = u[0] * v[0] + u[1] * v[1], c = v[0] * v[0] + v[1] * v[1], d = u[0] * w[0] + u[1] * w[1], e = v[0] * w[0] + v[1] * w[1], D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; }
  else { sN = b * e - c * d; tN = a * e - b * d; if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; } }
  if (tN < 0) { tN = 0; sN = -d < 0 ? 0 : -d > a ? sD : -d; sD = -d < 0 || -d > a ? sD : a; if (sD === 0) sD = 1; }
  else if (tN > tD) { tN = tD; const t2 = -d + b; sN = t2 < 0 ? 0 : t2 > a ? sD : t2; sD = t2 < 0 || t2 > a ? sD : a; if (sD === 0) sD = 1; }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  const pa = [P[0] + sc * u[0], P[1] + sc * u[1]], pb = [R[0] + tc * v[0], R[1] + tc * v[1]];
  return { d: Math.hypot(pa[0] - pb[0], pa[1] - pb[1]), pa };
}
function crossPoints(A, B) {            // todos los cruces entre dos vías (metros), separados >150 m; si no cruzan, el punto más cercano (<120 m)
  const found = []; let closest = null;
  for (const la of A) for (let i = 0; i + 1 < la.length; i++) for (const lb of B) for (let j = 0; j + 1 < lb.length; j++) {
    const r = closestSegs(la[i], la[i + 1], lb[j], lb[j + 1]);
    if (!closest || r.d < closest.d) closest = r;
    if (r.d < 25 && !found.some((q) => Math.hypot(q[0] - r.pa[0], q[1] - r.pa[1]) < 150)) found.push(r.pa);
  }
  return found.length ? found : closest && closest.d < 120 ? [closest.pa] : [];
}
const nearestTo = (pts, h) => (h ? pts.reduce((b, q) => (Math.hypot(q[0] - h[0], q[1] - h[1]) < Math.hypot(b[0] - h[0], b[1] - h[1]) ? q : b), pts[0]) : pts[0]);
const crossPoint = (A, B, hintM) => { const c = crossPoints(A, B); return c.length ? nearestTo(c, hintM) : null; };
const keyOrder = (k) => { const m = /^(\w+)\|(\d+)([a-z]*)$/.exec(k); if (!m) return null; const sur = m[3].length > 0 && m[3].endsWith("s"); return { t: m[1], n: +m[2], r: sur ? m[3].slice(0, -1) : m[3], sur }; };
function nextKey(S, k) {                 // la siguiente calle (misma clase y lado Sur/Norte) con numeración mayor
  const o = keyOrder(k); if (!o) return null; let best = null, bo = null;
  for (const c in S) { const x = keyOrder(c); if (!x || x.t !== o.t || x.sur !== o.sur) continue; if (x.n > o.n || (x.n === o.n && x.r > o.r)) { if (!bo || x.n < bo.n || (x.n === bo.n && x.r < bo.r)) { best = c; bo = x; } } }
  return best;
}
const NEXT_CACHE = new Map();
const nextOf = (S, k) => { if (!NEXT_CACHE.has(k)) NEXT_CACHE.set(k, nextKey(S, k)); return NEXT_CACHE.get(k); };
function snapOnto(A, pm) {               // punto de la vía A más cercano a pm (metros)
  let best = null;
  for (const la of A) for (let i = 0; i + 1 < la.length; i++) {
    const a = toM(la[i]), b = toM(la[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((pm[0] - a[0]) * dx + (pm[1] - a[1]) * dy) / l2)) : 0, p = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - pm[0], p[1] - pm[1]);
    if (!best || d < best.d) best = { d, p };
  }
  return best ? best.p : pm;
}
/** Punto de una dirección con placa ("Cr. 69 #64H -07"): el cruce de Cr. 69 con Cl. 64H más 7 m por la Cr. 69 hacia la Cl. 64I. */
function locatePlate(S, ka, kb, plate, hint) {
  const A = S[ka], B = S[kb]; if (!A || !B) return null;
  const p0 = crossPoint(A, B, hint ? toM(hint) : null); if (!p0) return null;
  if (!(plate > 0)) return fromM(p0);
  // dirección: hacia el cruce con la siguiente calle (o, si no hay, desde la anterior)
  let dir = null; const nk = nextOf(S, kb);
  if (nk && S[nk]) { const p1 = crossPoint(A, S[nk], p0); if (p1) { const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (d > 15 && d < 400) dir = [(p1[0] - p0[0]) / d, (p1[1] - p0[1]) / d]; } }
  if (!dir) return fromM(p0);
  const off = Math.min(plate, 99);
  return fromM(snapOnto(A, [p0[0] + dir[0] * off, p0[1] + dir[1] * off]));
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
// Busca la vía más parecida cuando la exacta no está en OSM (otra letra, "bis" o ±2 de numeración): sirve para ubicar direcciones de listados con ~1 cuadra de error.
function looseKey(S, k) {
  if (S[k]) return k;
  const m = /^(calle|carrera|diagonal|transversal)\|(\d+)([a-z]*)$/.exec(k); if (!m) return null;
  const [, t, n, rest] = m, sur = rest.endsWith("s") && rest.length > 1 ? "s" : "";
  for (const d of [0, 1, -1, 2, -2]) for (const suf of ["", "a", "b", "bis"]) { const c = `${t}|${+n + d}${suf}${sur}`; if (S[c]) return c; }
  return null;
}
function resolveAddress(q, loose = false, hint = null) {
  const p = parseAddress(q), S = streets();
  if (!p) return null;
  const a = S[p.a] ? p.a : loose ? looseKey(S, p.a) : null, b = S[p.b] ? p.b : loose ? looseKey(S, p.b) : null;
  if (!a || !b) return null;
  const pt = (p.plate > 0 && locatePlate(S, a, b, p.plate, hint)) || intersect(S[a], S[b]);
  return pt ? { label: p.label, sub: p.plate > 0 ? "Dirección" : "Dirección · aproximada", lat: pt[0], lon: pt[1], kind: "address" } : null;
}
const poi = require("./poi");
// Lugares conocidos (server-data/places.json: centros comerciales, universidades, aeropuertos…; las filas «area» las usa poi.js)
let PLACES = null;
function places(q) {
  if (!PLACES) { try { PLACES = JSON.parse(fs.readFileSync(path.join(ROOT, "server-data", "places.json"), "utf8")).filter((r) => r[3] !== "area").map((r) => ({ r, n: nrm(r[0]) })); } catch { PLACES = []; } }
  const toks = nrm(q).split(" ").filter(Boolean); if (!toks.length) return [];
  return PLACES.filter((p) => toks.every((t) => p.n.includes(t))).slice(0, 5).map(({ r }) => ({ label: r[0], sub: r[4] || "Lugar", lat: r[1], lon: r[2], kind: "place" }));
}
const geoCache = new Map();
let lastPhoton = 0;
async function photon(q) {
  const wait = Math.max(0, lastPhoton + 300 - Date.now());
  lastPhoton = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const u = new URL("https://photon.komoot.io/api/");
  u.search = new URLSearchParams({ q, limit: "6", lat: "4.65", lon: "-74.07", bbox: "-74.35,4.40,-73.90,4.90" });
  const r = await fetch(u, { headers: { "User-Agent": "Ruta/1.0" }, signal: AbortSignal.timeout(8000) });
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
  out.push(...places(q), ...poi.search(q, 5).map((x) => ({ ...x, sub: x.sub || "Lugar" })));
  if (out.length < 2 && !/^\s*\d/.test(q) && !(addr && /[#-]/.test(q))) {
    const tryAll = async (fns) => { for (const f of fns) { try { const r = await f(); if (r.length) return r; } catch {} } return []; };
    if (mode === "submit") {
      // se prueban Nominatim y Photon, con y sin "Bogotá", hasta que alguno responda
      const qb = /bogot/i.test(q) ? q : `${q}, Bogotá`;
      out.push(...(await tryAll([() => nominatim(q), () => photon(qb), () => photon(q)])));
    } else if (out.length < 4) out.push(...(await tryAll([() => photon(q), () => photon(`${q} Bogotá`), () => nominatim(q)])));
  }
  const v = [];
  for (const x of out) {
    const nx = nrm(x.label);
    // mismo sitio: nombre parecido y a menos de 150 m de uno ya incluido
    if (v.some((y) => { const ny = nrm(y.label); return (ny === nx || ny.includes(nx) || nx.includes(ny)) && Math.hypot((x.lat - y.lat) * 110540, (x.lon - y.lon) * 111320 * Math.cos(x.lat * Math.PI / 180)) < 150; })) continue;
    v.push(x);
    if (v.length >= 6) break;
  }
  if (geoCache.size > 500) geoCache.delete(geoCache.keys().next().value);
  geoCache.set(key, { at: Date.now(), v });
  return v;
}

module.exports = { geocode, resolveAddress, parseAddress };
