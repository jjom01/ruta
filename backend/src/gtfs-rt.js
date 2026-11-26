// Feed oficial GTFS Realtime (positions, alerts, tripupdates) + estimación de buses sin GPS fresco.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
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
try { SCHEDULE = JSON.parse(fs.readFileSync(path.join(ROOT, "server-data", "schedule.json"), "utf8")); } catch {}
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

module.exports = { rtFeed, alertsFeed, estimates, hasSchedule: () => Object.keys(SCHEDULE).length > 0 };
