// Comercios y lugares de Bogotá (server-data/poi.json, de Overture Maps; ver tools/build-poi.py). Índice de prefijos en memoria.
const fs = require("fs");
const path = require("path");
const nrm = (x) => String(x).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const ALIAS = { cc: "centro comercial", univ: "universidad", u: "universidad", hosp: "hospital", pq: "parque", est: "estacion", sta: "santa", sto: "santo", ctro: "centro" };
let DB = null, AREAS = null;
// Barrios y localidades (places.json): "mcdonalds fontibon" → comercios con ese nombre, los más cercanos a Fontibón primero
function areas() {
  if (AREAS) return AREAS; AREAS = new Map();
  try { for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-data", "places.json"), "utf8"))) if (r[3] === "area") { const n = nrm(r[0]).replace(/^localidad /, ""); if (!AREAS.has(n)) AREAS.set(n, [r[1], r[2]]); } } catch {}
  return AREAS;
}
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
function load() {
  if (DB) return DB;
  DB = { rows: [], tok: new Map() };
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-data", "poi.json"), "utf8"));
    rows.forEach((r, i) => {
      const n = nrm(r[0]); const toks = n.split(" ").filter(Boolean);
      DB.rows.push({ r, n, toks });
      for (const t of new Set(toks)) { const k = t.slice(0, 3); let a = DB.tok.get(k); if (!a) DB.tok.set(k, (a = [])); a.push(i); }
    });
  } catch {}
  return DB;
}
function search(q, limit = 5) {
  const toks = nrm(q).split(" ").filter(Boolean);
  // ¿termina en un barrio/localidad? (1 o 2 palabras)
  for (const n of [2, 1]) {
    if (toks.length <= n) continue;
    const a = areas().get(toks.slice(-n).join(" "));
    if (a) {
      const hits = base(toks.slice(0, -n).join(" "), 60).map((x) => ({ ...x, d: dist([x.lat, x.lon], a) })).filter((x) => x.d < 6000).sort((x, y) => x.d - y.d);
      if (hits.length) return hits.slice(0, limit);
    }
  }
  const r = base(q, limit);
  if (r.length || toks.length < 2) return r;
  // sin coincidencia completa: se prueba quitando la última palabra (queda como coincidencia parcial)
  return base(toks.slice(0, -1).join(" "), limit);
}
function base(q, limit) {
  const db = load(); if (!db.rows.length) return [];
  const qn = nrm(q);
  const qt = qn.split(" ").map((x) => ALIAS[x] ?? x).join(" ").split(" ").filter(Boolean); if (!qt.length) return [];
  // candidatos: los que comparten el comienzo (3 letras) de la palabra más larga de la búsqueda
  const lead = [...qt].sort((a, b) => b.length - a.length)[0];
  const cand = lead.length >= 3 ? db.tok.get(lead.slice(0, 3)) || [] : [...db.tok.entries()].filter(([k]) => k.startsWith(lead)).flatMap(([, v]) => v);
  const out = [];
  for (const i of cand) {
    const { r, n, toks } = db.rows[i]; let s = 0;
    for (const w of qt) {
      let b = 0;
      for (const t of toks) { if (t === w) { b = 10; break; } if (t.startsWith(w)) b = Math.max(b, 7); else if (w.length >= 4 && t.length >= 4 && Math.abs(t.length - w.length) <= 1 && sim(t, w)) b = Math.max(b, 4); }
      if (!b) { s = 0; break; } s += b;
    }
    if (!s) continue;
    if (n === qn) s += 40; else if (n.startsWith(qn)) s += 20;
    out.push([s + r[5] * 8 - n.length * 0.1, r]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, r]) => ({ label: r[0], sub: r[4] || "", lat: r[1], lon: r[2], kind: "place" }));
}
// tolera una letra de diferencia (errores de escritura)
function sim(a, b) { let i = 0, d = 0; const x = a.length >= b.length ? a : b, y = a.length >= b.length ? b : a; let j = 0; while (i < x.length && j < y.length) { if (x[i] === y[j]) { i++; j++; } else { if (++d > 1) return false; if (x.length === y.length) { i++; j++; } else i++; } } return d + (x.length - i) + (y.length - j) <= 1; }
module.exports = { search, load };
