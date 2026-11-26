// Camino a pie por las calles (server-data/roads.json, ver tools/build-shapes.py): vale cualquier sentido de la vía.
const fs = require("fs");
const path = require("path");
const KX = 111320 * Math.cos(4.65 * Math.PI / 180), KY = 110540;
let G = null;
function decode(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (let k = 0; k < 2; k++) { let sh = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) lat += d; else lon += d; }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}
function load() {
  if (G) return G;
  G = { ok: false };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-data", "roads.json"), "utf8"));
    const N = j.n.length / 2, E = j.e.length;
    const adj = Array.from({ length: N }, () => []), edges = new Array(E), grid = new Map(), CELL = 0.002;
    for (let i = 0; i < E; i++) {
      const [u, v, len, wt, poly] = j.e[i], geom = decode(poly);
      let L = 0; const cum = [0];
      for (let k = 1; k < geom.length; k++) { L += Math.hypot((geom[k][0] - geom[k - 1][0]) * KY, (geom[k][1] - geom[k - 1][1]) * KX); cum.push(L); }
      // a pie: se evitan autopistas y se prefieren calles normales
      const w = wt <= 0.8 ? 3 : 1;
      edges[i] = { u, v, geom, cum, L, w };
      adj[u].push([v, i, 1]); adj[v].push([u, i, -1]);
      for (let s = 0; s < geom.length - 1; s++) {
        const a = geom[s], b = geom[s + 1];
        for (let ci = Math.floor(Math.min(a[0], b[0]) / CELL); ci <= Math.floor(Math.max(a[0], b[0]) / CELL); ci++)
          for (let cj = Math.floor(Math.min(a[1], b[1]) / CELL); cj <= Math.floor(Math.max(a[1], b[1]) / CELL); cj++) { const key = ci * 100000 + cj; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(i * 4096 + s); }
      }
    }
    G = { ok: true, edges, adj, grid, CELL };
  } catch {}
  return G;
}
function snap(lat, lon) {
  const g = load(); let best = null;
  const ci = Math.floor(lat / g.CELL), cj = Math.floor(lon / g.CELL);
  for (const r of [1, 3, 6]) {
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      for (const code of g.grid.get(i * 100000 + j) || []) {
        const ei = Math.floor(code / 4096), s = code % 4096, e = g.edges[ei], a = e.geom[s], b = e.geom[s + 1];
        const ax = (a[1] - lon) * KX, ay = (a[0] - lat) * KY, bx = (b[1] - lon) * KX, by = (b[0] - lat) * KY, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0, d = Math.hypot(ax + dx * t, ay + dy * t);
        if (!best || d < best.d) best = { d, ei, along: e.cum[s] + t * Math.sqrt(l2) };
      }
    }
    if (best && best.d < 80) break;
  }
  return best && best.d < 500 ? best : null;
}
function part(e, s0, s1) {
  const rev = s0 > s1, lo = rev ? s1 : s0, hi = rev ? s0 : s1, out = [];
  for (let k = 0; k < e.geom.length - 1; k++) {
    const a = e.cum[k], b = e.cum[k + 1], seg = b - a; if (seg <= 0 || b < lo || a > hi) continue;
    const t0 = Math.max(0, (lo - a) / seg), t1 = Math.min(1, (hi - a) / seg), p = e.geom[k], q = e.geom[k + 1];
    if (!out.length) out.push([p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0]);
    out.push([p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1]);
  }
  return rev ? out.reverse() : out;
}
/** Camino a pie entre dos puntos: [[lon,lat],…] por las calles; null si no se pudo (el cliente dibuja una recta). */
function route(a, b) {
  const g = load(); if (!g.ok) return null;
  const A = snap(a[0], a[1]), B = snap(b[0], b[1]); if (!A || !B) return null;
  const ea = g.edges[A.ei], eb = g.edges[B.ei];
  const straight = Math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX);
  if (A.ei === B.ei) return part(ea, A.along, B.along).map(([la, lo]) => [lo, la]);
  const dist = new Map(), prev = new Map(), heap = [];   // montículo simple (listas cortas)
  const push = (n, c, via) => { if (c < (dist.get(n) ?? 1e18)) { dist.set(n, c); prev.set(n, via); heap.push([c, n]); heap.sort((x, y) => y[0] - x[0]); } };
  push(ea.v, (ea.L - A.along) * ea.w, ["s", 1]); push(ea.u, A.along * ea.w, ["s", -1]);
  const tgt = new Map([[eb.u, B.along * eb.w], [eb.v, (eb.L - B.along) * eb.w]]);
  let best = 1e18, bn = null; const seen = new Set();
  while (heap.length) {
    const [c, n] = heap.pop(); if (c > dist.get(n) || seen.has(n)) continue; seen.add(n);
    if (c >= best || c > Math.max(1500, straight * 4) * 3) break;
    if (tgt.has(n) && c + tgt.get(n) < best) { best = c + tgt.get(n); bn = n; }
    for (const [m, ei] of g.adj[n]) { const e = g.edges[ei]; push(m, c + e.L * e.w, [n, ei]); }
  }
  if (bn == null) return null;
  const chain = []; let n = bn;
  for (;;) { const p = prev.get(n); if (p[0] === "s") { chain.push(["s", p[1]]); break; } chain.push([p[1], p[0]]); n = p[0]; }
  chain.reverse(); let pts = [];
  for (const it of chain) {
    if (it[0] === "s") pts = pts.concat(it[1] === 1 ? part(ea, A.along, ea.L) : part(ea, A.along, 0));
    else { const e = g.edges[it[0]], fwd = e.u === it[1]; pts = pts.concat(fwd ? e.geom : [...e.geom].reverse()); }
  }
  pts = pts.concat(bn === eb.u ? part(eb, 0, B.along) : part(eb, eb.L, B.along));
  return pts.map(([la, lo]) => [lo, la]);
}
module.exports = { route, load };
