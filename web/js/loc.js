// Ubicación del usuario. Para simular en desarrollo: ?loc=4.711,-74.072 (solo en este navegador; no se guarda).
const sim = (() => { const m = new URLSearchParams(location.search).get("loc"); if (!m) return null; const [a, b] = m.split(",").map(Number); return isFinite(a) && isFinite(b) ? [b, a] : null; })();
export const simulated = !!sim;
let last = sim;
export const lastPos = () => last;
export function locate() {
  if (sim) return Promise.resolve(sim);
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => { last = [p.coords.longitude, p.coords.latitude]; res(last); }, () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}
export async function locateIfAllowed() {
  if (sim) return sim;
  try { const p = await navigator.permissions.query({ name: "geolocation" }); if (p.state === "granted") return await locate(); } catch {}
  return null;
}
