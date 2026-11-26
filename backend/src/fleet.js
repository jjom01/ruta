// Flota en vivo de Croma (de pago por lectura): una página por zona, caché y tope diario guardado en disco.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const BASE = process.env.CROMA_API_URL || "https://api.croma.run";
const TTL = 120_000, PER_PAGE = 500;
// Cada lectura en vivo cuesta 10 créditos (plan gratuito: 1.500 al mes). Se lee una sola
// página por zona, se cachea y hay un tope diario que se guarda en disco.
const DAILY_CALLS = Number(process.env.DAILY_CALLS || 5);
const RESERVE = 20;
const STATE_FILE = process.env.CREDITS_FILE || path.join(ROOT, ".credits.json");
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
module.exports = { fleet, creditState: () => state };
