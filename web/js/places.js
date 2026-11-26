// Lugares conocidos de Bogotá (centros comerciales, universidades, hospitales, parques, barrios…): búsqueda local, tolerante a
// tildes, abreviaturas ("cc", "u", "hosp") y errores de escritura. Datos de data/places.json (OpenStreetMap, ver backend/tools/build-places.py).
import { t } from "./i18n.js";

export const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const ALIAS = { cc: "centro comercial", c: "", univ: "universidad", u: "universidad", uni: "universidad", hosp: "hospital", clin: "clinica", pq: "parque", est: "estacion", av: "avenida", cra: "carrera", cl: "calle", cll: "calle", sta: "santa", sto: "santo", cent: "centro", biblio: "biblioteca", terminal: "terminal", ctro: "centro" };
const WEIGHT = { mall: 12, university: 12, landmark: 12, terminal: 12, airport: 12, hospital: 10, area: 8, culture: 8, sport: 8, gov: 6, church: 4, park: 3, hotel: 2, place: 0 };
let P = null, loading = null, AREA = null;
/** ¿Este texto es el nombre de un barrio o localidad? */
export const isArea = (x) => { if (!P) return false; AREA ||= new Set(P.filter((p) => p.kind === "area").map((p) => p.n.replace(/^localidad /, ""))); return AREA.has(norm(x)); };
export const loadPlaces = () => (loading ||= fetch("data/places.json").then((r) => r.json()).then((a) => {
  P = a.filter((r) => !/^upz/i.test(r[0])).map((r) => { const n = norm(r[0]); return { name: r[0], lat: r[1], lon: r[2], kind: r[3], zone: r[4], n, tk: n.split(" ") }; });
}).catch(() => { P = []; }));

const expand = (tokens) => tokens.map((x) => (x in ALIAS ? ALIAS[x] : x)).join(" ").split(" ").filter(Boolean);
function lev(a, b, max) {   // distancia de edición acotada
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); rowMin = Math.min(rowMin, cur[j]); }
    if (rowMin > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
function score(p, qn, qt, fuzzy) {
  if (p.n === qn) return 200;
  let s = 0, hit = 0;
  for (const q of qt) {
    let best = 0;
    for (const w of p.tk) {
      if (w === q) best = Math.max(best, 10);
      else if (w.startsWith(q)) best = Math.max(best, 8);
      else if (q.length >= 4 && w.includes(q)) best = Math.max(best, 4);
      else if (fuzzy && q.length >= 4 && lev(q, w, q.length >= 8 ? 2 : 1) <= (q.length >= 8 ? 2 : 1)) best = Math.max(best, 5);
    }
    if (!best) return 0;
    s += best; hit++;
  }
  if (p.n.startsWith(qn)) s += 30;
  return s + WEIGHT[p.kind] * 2.5 - p.n.length * 0.08;
}
/** Lugares que coinciden con el texto, mejores primero. */
export function searchPlaces(q, limit = 5) {
  if (!P) return [];
  const qn = norm(q); if (qn.length < 2) return [];
  const qt = expand(qn.split(" ")); if (!qt.length) return [];
  const run = (fuzzy) => { const out = []; for (const p of P) { const s = score(p, qn, qt, fuzzy); if (s > 0) out.push([s, p]); } return out.sort((a, b) => b[0] - a[0]); };
  let r = run(false); if (!r.length && qn.length >= 4) r = run(true);
  const seen = new Set(), res = [];
  for (const [s, p] of r) {
    const k = p.n; if (seen.has(k)) continue; seen.add(k);
    res.push({ label: p.name, sub: [t("pk_" + p.kind), p.zone].filter(Boolean).join(" · "), pts: [{ lat: p.lat, lon: p.lon }], score: s, kind: "place" });
    if (res.length >= limit) break;
  }
  return res;
}
