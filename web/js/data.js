// Datos estáticos de v2 (GTFS procesado) y utilidades de color.
const j = (u) => fetch(u).then((r) => r.json());
export const dark = () => { const f = document.documentElement.dataset.theme; return f ? f === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
export const D = {};
export async function loadData() {
  // Arranque ligero: el índice de propiedades (routes-meta.json); los trazados (routes.geojson, 1 MB) llegan después con loadGeom()
  const [colors, ridx, rs, meta, network, hours] = await Promise.all([j("data/colors.json"), j("data/routes-index.json"), j("data/route-stops.json"), j("data/routes-meta.json"), j("data/network.geojson"), j("data/hours.json").catch(() => ({}))]);
  Object.assign(D, { colors, ridx, rs, network, hours });
  D.byRid = new Map(meta.map((p) => [p.id.split("#")[1] ?? p.id, p]));
  D.byId = new Map();
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => loadGeom(), { timeout: 4000 });
}
let geomP = null;
// Trazados de las rutas (los usa el mapa como respaldo cuando el servidor no da el recorrido por calles)
export function loadGeom() {
  return (geomP ||= j("data/routes.geojson").then((routes) => { D.routes = routes; for (const f of routes.features) D.byId.set(f.properties.id, f); }).catch(() => { geomP = null; }));
}
export const SITP_COLOR = { light: "#2F6FDE", dark: "#5B9BFF" };
// Grupo de filtro de una ruta del feed: tm | mixto | sitp | cable
export function groupOfType(type, mixed) {
  if (type === "cable") return "cable";
  if (type === "zonal") return "sitp";
  return mixed ? "mixto" : "tm";
}
export function colorOf(letter, type) {
  const m = dark() ? "dark" : "light";
  if (type === "cable") return "#E11D48";
  if (type === "zonal") return SITP_COLOR[m];
  if (!D.colors.routes[letter]) return D.colors.fallback[m];
  return D.colors.routes[letter][m];
}
export function propsOfRid(rid, v = {}) {
  const info = D.ridx[String(rid)];
  const system = info?.s || v.system;
  if (!system) return null;
  const type = system === "transmicable" ? "cable" : system === "troncal" ? "troncal" : system === "dual" ? "dual" : "zonal";
  const code = info?.c || v.code || "";
  const feat = D.byRid.get(String(rid));
  const letter = type === "zonal" ? "Z" : type === "cable" ? "T" : code[0];
  return { rid: String(rid), code, type, letter, group: groupOfType(type, feat?.mixed), name: info?.n || "", color: colorOf(letter, type) };
}

// Token de color del tema (lee las variables CSS: una sola fuente de verdad)
export const token = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
// Texto legible sobre el color de una ruta (negro o blanco según luminancia, WCAG)
export function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // se elige el texto (blanco o casi negro) con mayor contraste WCAG sobre ese color
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0603) ? "#FFFFFF" : "#1A1A1A";
}

// Primer y último servicio de una ruta hoy: hábil, sábado, domingo o festivo (los festivos salen del calendario del GTFS). Devuelve ["04:30", "22:00", "h"|"s"|"d"|"f"], [null, null, k] si no opera hoy, o null sin datos.
const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
export function dayKind(now = new Date()) {
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return D.hours?._hol?.includes(String(ymd)) ? "f" : ["d", "h", "h", "h", "h", "h", "s"][now.getDay()];
}
export function hoursOf(code) {
  const h = D.hours?.[code]; if (!h) return null;
  const k = dayKind(), a = h[k]; if (!a) return [null, null, k];   // sin viajes ese tipo de día: la ruta no opera hoy
  return [hhmm(a[0]), hhmm(a[1]), k];
}
