// Buses en vivo: GTFS‑RT (protobuf) de /api/rt + estimados de /api/est. Backend: ../backend/README.md
import { apiUrl } from "./net.js";
const varint = (b, i) => { let r = 0, s = 0, x; do { x = b[i++]; r += (x & 127) * 2 ** s; s += 7; } while (x & 128); return [r, i]; };
function fields(b, i, end, cb) {
  while (i < end) {
    let k; [k, i] = varint(b, i);
    const f = k >>> 3, w = k & 7;
    if (w === 0) { let v; [v, i] = varint(b, i); cb(f, v); }
    else if (w === 1) { cb(f, new DataView(b.buffer, b.byteOffset + i, 8)); i += 8; }
    else if (w === 2) { let l; [l, i] = varint(b, i); cb(f, [i, i + l]); i += l; }
    else if (w === 5) { cb(f, new DataView(b.buffer, b.byteOffset + i, 4)); i += 4; }
    else break;
  }
}
const str = (b, [a, e]) => new TextDecoder().decode(b.subarray(a, e));
export function decodePositions(b) {
  const out = [];
  fields(b, 0, b.length, (f, v) => {
    if (f !== 2) return;
    fields(b, v[0], v[1], (f2, v2) => {
      if (f2 !== 4) return;
      const x = { id: "", rid: "", lat: NaN, lon: NaN, bearing: null, ts: 0 };
      fields(b, v2[0], v2[1], (f3, v3) => {
        if (f3 === 1) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 5) x.rid = str(b, v4); });
        else if (f3 === 2) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 1) x.lat = v4.getFloat32(0, true); else if (f4 === 2) x.lon = v4.getFloat32(0, true); else if (f4 === 3) x.bearing = v4.getFloat32(0, true); });
        else if (f3 === 5) x.ts = v3;
        else if (f3 === 8) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 1 && !x.id) x.id = str(b, v4); });
      });
      if (isFinite(x.lat) && isFinite(x.lon)) out.push(x);
    });
  });
  return out;
}
export function decodeAlerts(b) {
  const out = [];
  const text = (v) => { let t = ""; fields(b, v[0], v[1], (f, x) => { if (f === 1 && !t) fields(b, x[0], x[1], (f2, y) => { if (f2 === 1) t = str(b, y); }); }); return t; };
  fields(b, 0, b.length, (f, v) => {
    if (f !== 2) return;
    const a = { id: "", start: 0, end: 0, routes: [], title: "", desc: "", url: "" };
    fields(b, v[0], v[1], (f2, v2) => {
      if (f2 === 1) a.id = str(b, v2);
      if (f2 !== 5) return;
      fields(b, v2[0], v2[1], (f3, v3) => {
        if (f3 === 1) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 1) a.start = v4; else if (f4 === 2) a.end = v4; });
        else if (f3 === 5) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 2) a.routes.push(str(b, v4)); });
        else if (f3 === 8) a.url = text(v3);
        else if (f3 === 10) a.title = text(v3);
        else if (f3 === 11) a.desc = text(v3);
      });
    });
    out.push(a);
  });
  return out;
}
export async function fetchBuses() {
  const r = await fetch(apiUrl("/api/rt"), { cache: "no-store" });
  if (!r.ok) throw new Error("rt_" + r.status);
  const list = decodePositions(new Uint8Array(await r.arrayBuffer()));
  const now = Date.now() / 1000;
  const fresh = list.filter((v) => !v.ts || now - v.ts < 300);
  try { const e = await fetch(apiUrl("/api/est"), { cache: "no-store" }); if (e.ok) fresh.push(...(await e.json()).vehicles.map((v) => ({ ...v, est: true }))); } catch {}
  return fresh;
}
export async function fetchAlerts() {
  const r = await fetch(apiUrl("/api/alerts"), { cache: "no-store" });
  if (!r.ok) throw new Error("alerts_" + r.status);
  return decodeAlerts(new Uint8Array(await r.arrayBuffer()));
}
