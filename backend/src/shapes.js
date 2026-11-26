// Recorridos por las calles de cada ruta (server-data/shapes.json, ver tools/build-shapes.py).
const fs = require("fs");
const path = require("path");
let DB = null;
const load = () => { if (DB) return DB; try { DB = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-data", "shapes.json"), "utf8")); } catch { DB = {}; } return DB; };
const cache = new Map();
function decode(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}
/** Puntos [lon, lat] del recorrido de la ruta rid entre el paradero p0 y el p1 (posiciones en su lista de paraderos); null si no hay. */
function slice(rid, p0, p1) {
  const r = load()[rid]; if (!r) return null;
  let pts = cache.get(rid); if (!pts) { pts = decode(r.p); if (cache.size > 200) cache.delete(cache.keys().next().value); cache.set(rid, pts); }
  const a = r.s[p0], b = r.s[p1]; if (a == null || b == null || b < a) return null;
  return pts.slice(a, b + 1);
}
module.exports = { slice, load };
