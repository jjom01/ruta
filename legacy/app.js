const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const SYSTEMS = { tm: ["troncal", "cable"], mixto: ["dual"], sitp: ["zonal"] };
const DEFAULT_SYSTEM = "tm";
const BOGOTA = [-74.0721, 4.711];
const $ = (id) => document.getElementById(id);
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const theme = () => (dark() ? "dark" : "light");

const state = { alerts: [], alertsOk: false, alertsOpen: false, legend: false, menu: false, system: DEFAULT_SYSTEM, letter: null, query: "", selected: null };
let service = null, cicRoutes = null, colors, S, routes, stops, map, userMarker, config, ridx = {}, rstops = { stops: [], routes: {} };

const load = (p) => fetch(p).then((r) => r.json());
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

/* SITP: 8 tonos que se asignan por código de ruta (Y0..Y7); una ruta conserva siempre el mismo color. */
const SITP_TONES = [
  { dark: "#22D3EE", light: "#0891B2" }, { dark: "#E879F9", light: "#A21CAF" }, { dark: "#7DB8FF", light: "#2563EB" }, { dark: "#FDBA74", light: "#C2410C" },
  { dark: "#6EE7B7", light: "#047857" }, { dark: "#A5B4FC", light: "#4338CA" }, { dark: "#FDA4AF", light: "#BE123C" }, { dark: "#FDE68A", light: "#A16207" },
];
const isTone = (l) => /^Y[0-7]$/.test(l);
function zl(code) { let h = 0; for (const ch of String(code || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return "Y" + (h % SITP_TONES.length); }
function routeColor(letter) {
  if (isTone(letter)) return SITP_TONES[+letter[1]][theme()];
  const c = colors.routes[letter] || colors.fallback;
  return c[theme()];
}
function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}
function badge(id, letter, type, sel) {
  const c = routeColor(letter);
  const el = document.createElement("span");
  el.className = `badge ${type === "zonal" ? "zonal" : ""} ${sel ? "sel" : ""}`;
  el.style.setProperty("--c", c);
  el.style.setProperty("--t", textOn(c));
  el.textContent = id;
  return el;
}


/* ---------- calendario de servicio: qué rutas circulan hoy (hábil / sábado / domingo-festivo y ciclovía) ---------- */
// Simulación: ?sim=2026-11-15T10:00 (hora local). Sin parámetro se usa el reloj real.
const SIM_SHIFT = (() => { const q = new URLSearchParams(location.search).get("sim"); const t = q && new Date(q).getTime(); return t && !isNaN(t) ? t - Date.now() : 0; })();
const serviceNow = () => new Date(Date.now() + SIM_SHIFT);
function dayType(d) {
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  if (service?.holidays.includes(ymd) || d.getDay() === 0) return 4;
  return d.getDay() === 6 ? 2 : 1;
}
function routeActive(rid, type, sec) {
  if (!service) return true;
  const c = service.cic[rid];
  if (c) return type === 4 && sec >= c.from - 600 && sec <= c.to;
  const v = service.baseCic?.[rid];
  if (v && type === 4 && sec >= v.from - 600 && sec <= v.to) return false; // en horario de ciclovía la ruta normal cambia a su variante
  const m = service.days[rid];
  return m == null ? true : !!(m & type);
}
function updateService() {
  if (!service) return false;
  if (!service.baseCic) { service.baseCic = {}; Object.entries(service.cic).forEach(([k, c]) => { if (c.base) service.baseCic[c.base] = c; }); }
  const d = serviceNow(), type = dayType(d), sec = d.getHours() * 3600 + d.getMinutes() * 60;
  const offRids = Object.keys(ridx).filter((r) => !routeActive(r, type, sec));
  const key = type + "|" + offRids.length + "|" + offRids.slice(0, 40).join(",") + offRids.slice(-40).join(",");
  const changed = key !== state.svcKey;
  state.svcKey = key; state.dayType = type; state.offRids = new Set(offRids);
  state.offIds = routes.features.map((f) => f.properties.id).filter((id) => id.includes("#") && state.offRids.has(id.split("#")[1]));
  state.offSet = new Set(state.offIds);
  state.cicNow = type === 4 && Object.values(service.cic).some((c) => sec >= c.from - 600 && sec <= c.to);
  renderSvcPill(d);
  return changed;
}
function renderSvcPill(d) {
  let p = $("svcPill");
  if (!p) { p = document.createElement("div"); p.id = "svcPill"; document.body.append(p); }
  const sim = SIM_SHIFT !== 0, special = state.dayType === 4;
  p.hidden = !(sim || special);
  const day = state.dayType === 4 ? (state.cicNow ? S.svcCic : S.svcSun) : state.dayType === 2 ? S.svcSat : S.svcWeek;
  p.textContent = sim ? `${S.svcSim} · ${day} · ${d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })}` : day;
}
const inactiveRids = () => [...(state.offRids || [])];

/* ---------- map ---------- */
function colorExpr() {
  const e = ["match", ["get", "letter"]];
  Object.keys(colors.routes).forEach((k) => e.push(k, routeColor(k)));
  SITP_TONES.forEach((_, i) => e.push("Y" + i, routeColor("Y" + i)));
  e.push(routeColor("?"));
  return e;
}
function filterExpr() {
  if (state.system !== "tm" && !state.letter && !state.query) return ["==", ["get", "type"], "none"];
  const f = ["all", ["in", ["get", "type"], ["literal", SYSTEMS[state.system]]]];
  if (state.offIds?.length) f.push(["!", ["in", ["get", "id"], ["literal", state.offIds]]]);
  if (!state.letter && !state.query) f.push(["!", ["has", "svc"]]);
  if (state.letter) f.push(["==", ["get", "letter"], state.letter]);
  if (state.query) f.push(["in", state.query.toLowerCase(), ["downcase", ["get", "code"]]]);
  return f;
}
function selExpr(on, off) {
  return state.selected ? ["case", ["==", ["get", "id"], state.selected], on, off] : on;
}
/* Con una búsqueda activa solo se dibujan las paradas de las rutas encontradas; sin búsqueda, todas las estaciones. */
const STOP_TYPE = { troncal: "troncal", dual: "dual", transmicable: "cable" };
function updateStops() {
  if (!map.getSource("route-stops")) return;
  const q = state.query.toLowerCase(), searching = !!q && !state.trip;
  const vis = (on) => (on ? "visible" : "none");
  ["stops", "stop-labels"].forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", vis(!searching && !state.trip && state.system === "tm")));
  ["route-stops", "route-stop-labels"].forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", vis(searching)));
  if (!searching) return;
  const byRid = new Map(routes.features.map((f) => [f.properties.id.split("#")[1], f.properties.id]));
  const serving = new Map();
  Object.entries(ridx).forEach(([rid, info]) => {
    const type = STOP_TYPE[info.s] || "zonal";
    if (state.offRids?.has(rid) || !SYSTEMS[state.system].includes(type) || !info.c.toLowerCase().includes(q)) return;
    if (state.letter && info.c[0] !== state.letter) return;
    (rstops.routes[rid] || []).forEach((k) => {
      if (!serving.has(k)) serving.set(k, []);
      if (byRid.has(rid)) serving.get(k).push(byRid.get(rid));
    });
  });
  const features = [...serving].map(([k, ids]) => ({
    type: "Feature", properties: { id: "s" + k, name: rstops.stops[k][0], routes: ids },
    geometry: { type: "Point", coordinates: [rstops.stops[k][2], rstops.stops[k][1]] },
  }));
  map.getSource("route-stops").setData({ type: "FeatureCollection", features });
}

function applyPaint() {
  if (!map.getLayer("routes")) return;
  const f = filterExpr();
  ["routes", "routes-mixed"].forEach((l) => map.setLayoutProperty(l, "visibility", state.trip ? "none" : "visible"));
  map.setFilter("routes", ["all", f, ["!", ["has", "mixed"]]]);
  map.setFilter("routes-mixed", ["all", f, ["has", "mixed"]]);
  ["routes", "routes-mixed"].forEach((l) => {
    map.setPaintProperty(l, "line-color", colorExpr());
    map.setPaintProperty(l, "line-width", 3);
    map.setPaintProperty(l, "line-opacity", selExpr(1, state.selected ? 0.12 : 1));
  });
  RT.touch();
  updateStops();
  renderPill();
}
function stationIcon(fg, bg) {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d");
  g.scale(2, 2);
  g.fillStyle = bg; g.strokeStyle = fg; g.lineWidth = 2;
  g.beginPath(); g.roundRect(3.5, 3.5, 9, 9, 3); g.fill(); g.stroke();
  return g.getImageData(0, 0, 32, 32);
}
function addLayers() {
  map.addSource("routes", { type: "geojson", data: routes });
  map.addSource("stops", { type: "geojson", data: stops });
  map.addLayer({
    id: "routes", type: "line", source: "routes",
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#888", "line-width": 3, "line-opacity-transition": { duration: 180 } },
  });
  // Tramos mixtos (sin carril exclusivo): línea punteada con el mismo color y grosor.
  map.addLayer({
    id: "routes-mixed", type: "line", source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#888", "line-width": 3, "line-dasharray": [0.01, 2.2], "line-opacity-transition": { duration: 180 } },
  });
  const fg = dark() ? "#F2F2EE" : "#111111", bg = dark() ? "#1A1A1A" : "#FFFFFF";
  if (!map.hasImage("ruta-station")) map.addImage("ruta-station", stationIcon(fg, bg), { pixelRatio: 2 });
  map.addLayer({
    id: "stops", type: "symbol", source: "stops", minzoom: 11,
    layout: { "icon-image": "ruta-station", "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.65, 14, 1.05], "icon-allow-overlap": true, "icon-ignore-placement": true },
  });
  map.addLayer({
    id: "stop-labels", type: "symbol", source: "stops", minzoom: 14,
    layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": dark() ? "#ddd" : "#333", "text-opacity": 0.7 },
  });
  map.addSource("route-stops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "route-stops", type: "symbol", source: "route-stops", layout: { visibility: "none", "icon-image": "ruta-station", "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.25, 12, 0.45, 14, 1.05], "icon-allow-overlap": true, "icon-ignore-placement": true },
  });
  map.addLayer({
    id: "route-stop-labels", type: "symbol", source: "route-stops", minzoom: 13,
    layout: { visibility: "none", "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": dark() ? "#ddd" : "#333", "text-opacity": 0.7 },
  });
  addTripLayers();
  RT.attach(map, [...Object.keys(colors.routes), "Z0", ...SITP_TONES.map((_, i) => "Y" + i)], routeColor);
  applyPaint();
  ["routes", "routes-mixed", "stops"].forEach((l) => {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  });
}
function pad(pt, r = 8) { return [[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]]; }

function initMap() {
  map = new maplibre.Map({
    container: "map", style: STYLES[theme()], center: BOGOTA, zoom: 11.5,
    attributionControl: false,
  });
  map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-left");
  map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  map.on("style.load", addLayers);
  map.on("click", (e) => {
    const s = map.queryRenderedFeatures(pad(e.point, 10), { layers: ["stops", "route-stops"] })[0];
    if (s) return openStop(s.properties);
    const r = map.queryRenderedFeatures(pad(e.point, 8), { layers: ["routes", "routes-mixed"] })[0];
    if (r) return selectRoute(r.properties.id);
    if (state.legend) setLegend(false);
    if (state.alertsOpen) setAlerts(false);
    clearSelection();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    map.setStyle(STYLES[theme()], { diff: false });
    renderFilters();
  });
}
const maplibre = window.maplibregl;

/* ---------- selection & panel ---------- */
function routeById(id) { return routes.features.find((f) => f.properties.id === id)?.properties; }
function clearSelection() { state.selected = null; $("panel").hidden = true; applyPaint(); }
function selectRoute(id) {
  const p = routeById(id);
  if (!p) return;
  state.selected = id;
  applyPaint();
  const o = colors.routes[p.letter];
  const al = p.type === "troncal" && !p.svc ? [] : alertsForCode(p.code);
  const extra = al.length ? Object.assign(document.createElement("div"), { className: "meta", textContent: al.map((x) => x.title).join(" · ") }) : null;
  if (extra) extra.style.marginTop = "12px";
  openPanel(badge(p.code || p.id, p.letter, p.type, true), [...new Set(p.name.split(" · "))].join(" · "), [...new Set([S[p.type], o?.name].filter(Boolean))].join(" · "), extra);
}
function openStop(p) {
  const ids = typeof p.routes === "string" ? JSON.parse(p.routes) : p.routes;
  const row = document.createElement("div");
  row.className = "row";
  ids.forEach((id) => {
    const r = routeById(id);
    if (!r) return;
    const b = badge(r.code || id, r.letter, r.type);
    b.style.cursor = "pointer";
    b.onclick = () => selectRoute(id);
    row.append(b);
  });
  state.selected = null; applyPaint();
  openPanel(null, p.name, S.routesServing, row);
}
function openPanel(head, title, meta, extra) {
  const panel = $("panel");
  panel.replaceChildren();
  const x = Object.assign(document.createElement("button"), { className: "x", textContent: "×", onclick: clearSelection });
  x.setAttribute("aria-label", S.close);
  const h = document.createElement("h2"); h.textContent = title;
  const m = document.createElement("div"); m.className = "meta"; m.textContent = meta;
  panel.append(x);
  if (head) panel.append(head);
  panel.append(h, m);
  if (extra) panel.append(extra);
  panel.hidden = false;
}

/* ---------- filters ---------- */
function chip(label, { pressed, onclick, mono, color, tonal } = {}) {
  const b = document.createElement("button");
  b.className = `chip ${mono ? "mono" : ""} ${tonal ? "tonal" : ""}`;
  if (color) { b.style.setProperty("--c", color); b.innerHTML = '<span class="dot"></span>'; }
  b.append(label);
  b.setAttribute("aria-pressed", String(!!pressed));
  b.onclick = onclick;
  return b;
}
const ICON_FILTER = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let filterBtn, fitTimer, segEl;

function buildBar() {
  const label = document.createElement("label");
  label.className = "search";
  label.innerHTML = ICON_SEARCH;
  const q = document.createElement("input");
  q.type = "search"; q.placeholder = S.search; q.setAttribute("aria-label", S.search);
  q.oninput = () => {
    state.query = q.value.trim();
    applyPaint(); renderFilters();
    clearTimeout(fitTimer); fitTimer = setTimeout(() => { fitResults(); if (state.query && RT.age() > 20000) refreshBuses(); }, 350);
  };
  label.append(q);
  filterBtn = document.createElement("button");
  filterBtn.className = "filter-btn";
  filterBtn.innerHTML = ICON_FILTER;
  filterBtn.setAttribute("aria-label", S.filters);
  filterBtn.onclick = () => setMenu(!state.menu);
  const rb = document.createElement("button");
  rb.id = "refresh"; rb.className = "filter-btn";
  rb.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4h-4"/></svg>';
  $("filters").replaceChildren(label, filterBtn, rb);
  new ResizeObserver(() => document.documentElement.style.setProperty("--dock-h", $("filters").offsetHeight + "px")).observe($("filters"));
}
function setMenu(open) { state.menu = open; renderFilters(); }
const isFiltered = () => state.system !== DEFAULT_SYSTEM || !!state.letter;
function renderFilters() {
  filterBtn.setAttribute("aria-pressed", String(isFiltered()));
  filterBtn.setAttribute("aria-expanded", String(state.menu));
  renderMenu();
  const mh = state.menu ? $("menu").offsetHeight + 8 : 0;
  document.documentElement.style.setProperty("--menu-h", mh + "px");
}
function systemLetters(k) {
  const types = SYSTEMS[k], set = new Set();
  routes.features.forEach((f) => { const p = f.properties; if (types.includes(p.type) && p.letter !== "Z0" && !isTone(p.letter)) set.add(p.letter); });
  const order = Object.keys(colors.routes);
  return [...set].sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99) || x.localeCompare(y));
}
function renderMenu() {
  const m = $("menu");
  m.hidden = !state.menu;
  if (!state.menu) return;
  if (!segEl) {
    segEl = Object.assign(document.createElement("div"), { className: "seg" });
    Object.keys(SYSTEMS).forEach((k) => {
      const c = chip(S[k], { onclick: () => {
        state.system = k; state.letter = null;
        clearSelection(); applyPaint(); renderFilters();
        if (k === "sitp") $("filters").querySelector("input").focus();
      } });
      c.dataset.k = k;
      segEl.append(c);
    });
  }
  const keys = Object.keys(SYSTEMS);
  segEl.style.setProperty("--i", keys.indexOf(state.system));
  segEl.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.k === state.system)));
  if (segEl.parentNode !== m) m.prepend(segEl);
  m.querySelector(".letters")?.remove();
  const letters = systemLetters(state.system);
  if (letters.length) {
    const grid = Object.assign(document.createElement("div"), { className: "letters" });
    letters.forEach((l) =>
      grid.append(chip(l, { mono: true, color: routeColor(l), pressed: state.letter === l, onclick: () => {
        state.letter = state.letter === l ? null : l;
        clearSelection(); applyPaint(); renderFilters(); fitResults();
        RT.touch(); if (state.letter && RT.age() > 20000) refreshBuses();
      } })));
    m.append(grid);
  }
}
function matches(p) {
  return !state.offSet?.has(p.id) && SYSTEMS[state.system].includes(p.type) &&
    (state.letter || state.query || !p.svc) &&
    (!state.letter || p.letter === state.letter) &&
    (!state.query || p.code.toLowerCase().includes(state.query.toLowerCase()));
}
function fitResults() {
  if (!state.letter && !state.query) return;
  const b = new maplibre.LngLatBounds();
  let n = 0;
  routes.features.forEach((f) => {
    if (!matches(f.properties)) return;
    n++;
    const g = f.geometry;
    (g.type === "LineString" ? [g.coordinates] : g.coordinates).forEach((l) => l.forEach((c) => b.extend(c)));
  });
  if (!n) return;
  map.resize();
  const bottom = $("filters").offsetHeight + (state.menu ? $("menu").offsetHeight + 12 : 0) + 40;
  map.fitBounds(b, { padding: { top: 120, bottom, left: 28, right: 28 }, maxZoom: 15, duration: REDUCED() ? 0 : 600, essential: true });
}

/* ---------- buses en vivo (bajo demanda: cada lectura cuesta créditos) ---------- */
function refreshBuses() {
  const c = map.getCenter(), r = Math.min(5000, Math.max(500, Math.round(c.distanceTo(map.getBounds().getNorthEast()))));
  return RT.load({ lat: c.lat.toFixed(4), lon: c.lng.toFixed(4), r });
}
// El icono gira mientras se lee cualquier actualización (manual o automática), al menos 700 ms.
let spinSince = 0, spinTimer;
function setSpin(on) {
  const b = $("refresh");
  clearTimeout(spinTimer);
  if (on) { spinSince = Date.now(); b.classList.add("busy"); return; }
  spinTimer = setTimeout(() => b.classList.remove("busy"), Math.max(0, 700 - (Date.now() - spinSince)));
}

/* ---------- alertas (alerts.pb) ---------- */
const nowSec = () => Date.now() / 1000 + (window.__nowShift || 0);
const activeAlerts = () => state.alerts.filter((x) => x.start <= nowSec() && (!x.end || x.end >= nowSec()));
async function loadAlerts() {
  try {
    const r = await fetch("/api/alerts", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    state.alerts = RT.decodeAlerts(new Uint8Array(await r.arrayBuffer()));
    state.alertsOk = true;
  } catch { state.alertsOk = state.alertsOk || false; }
  renderAlertsBtn();
  if (state.alertsOpen) renderAlerts();
}
function renderAlertsBtn() {
  const n = activeAlerts().length;
  $("alertsBtn").hidden = !state.alertsOk;
  $("alertCount").hidden = !n;
  $("alertCount").textContent = n > 99 ? "99+" : n;
  $("alertsBtn").setAttribute("aria-label", n ? `${S.alerts} (${n})` : S.alerts);
}
const stopNames = (d) => d.split("\\").slice(1).map((p) => p.replace(/^[^_]*_[A-Z]+_/, "").trim()).filter(Boolean);
function alertsForCode(code) {
  return activeAlerts().filter((a) => a.routes.some((rid) => ridx[rid]?.c === code));
}
function renderAlerts() {
  const L = $("alerts");
  const x = Object.assign(document.createElement("button"), { className: "x", textContent: "×", onclick: () => setAlerts(false) });
  x.setAttribute("aria-label", S.close);
  const body = Object.assign(document.createElement("div"), { className: "scroll" });
  body.append(Object.assign(document.createElement("h2"), { textContent: S.alerts }));
  const list = activeAlerts().sort((p, q) => q.start - p.start);
  if (!list.length) body.append(Object.assign(document.createElement("div"), { className: "empty", textContent: S.noAlerts }));
  const fmt = (t) => new Date(t * 1000).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  list.forEach((a) => {
    const d = document.createElement("div");
    d.className = "item";
    const names = stopNames(a.desc);
    const sub = [S["fx" + a.effect] || S.fx7, a.end ? `${S.until} ${fmt(a.end)}` : "", names.join(" · ")].filter(Boolean).join(" · ");
    const text = document.createElement("span");
    text.innerHTML = `${a.title.replace(/</g, "&lt;")}<small>${sub.replace(/</g, "&lt;")}</small>`;
    const tags = document.createElement("div");
    tags.className = "tags";
    [...new Set(a.routes.map((rid) => ridx[rid]?.c).filter(Boolean))].slice(0, 8).forEach((code) => {
      const sample = routes.features.find((f) => f.properties.code === code)?.properties;
      const rid = a.routes.find((r) => ridx[r]?.c === code);
      const sys = ridx[rid]?.s;
      const letter = sample?.letter || (colors.routes[code[0]] && (sys === "troncal" || sys === "dual") ? code[0] : zl(code));
      const b = badge(code, letter, sys === "troncal" || sys === "dual" ? "troncal" : "zonal");
      if (sample) { b.style.cursor = "pointer"; b.onclick = () => { setAlerts(false); selectRoute(sample.id); }; }
      tags.append(b);
    });
    text.append(tags);
    d.append(text);
    body.append(d);
  });
  L.replaceChildren(x, body);
}
function setAlerts(open) {
  state.alertsOpen = open;
  if (open) { if (state.legend) setLegend(false); state.menu = false; renderFilters(); renderAlerts(); }
  $("alerts").hidden = !open;
}

/* ---------- píldora "en vivo" ---------- */
const POLL_MS = () => config?.realtime?.pollMs || 26000;
function renderPill() {
  const p = $("livePill");
  p.hidden = !(state.query || state.letter || state.trip);
  if (!(state.query || state.letter || state.trip)) return;
  const lv = state.live, ago = state.liveAt ? Math.max(0, Math.round((Date.now() - state.liveAt) / 1000)) : null;
  const t = ago == null ? "" : ago < 60 ? `${ago} s` : `${Math.floor(ago / 60)} min`;
  const stale = ago != null && ago > POLL_MS() / 1000 * 2 + 10;
  p.className = ago == null ? "off" : stale || (lv && !lv.ok) ? "stale" : "";
  p.querySelector("span").textContent = ago == null ? (lv && !lv.ok ? S.liveOff : S.liveLoading) : `${stale || (lv && !lv.ok) ? S.liveStale : S.live} · ${S.ago} ${t}`;
}
setInterval(() => renderPill(), 1000);

/* ---------- convenciones ---------- */
const SVG_BUS = (c, arrow = true, dashed = false) => `<svg width="24" height="24" viewBox="-16 -16 32 32"><circle r="7" fill="#fff" fill-opacity=".85"/><circle r="7" fill="${c}" fill-opacity=".3"/><circle r="7" fill="none" stroke="${c}" stroke-width="2.5"${dashed ? ' stroke-dasharray="3.2 2.6"' : ""}/>${arrow ? `<path d="M0-15L3.8-10L-3.8-10Z" fill="${c}" stroke="#fff" stroke-width="2" paint-order="stroke" stroke-linejoin="round"/>` : ""}</svg>`;
function renderLegend() {
  const L = $("legend");
  const item = (sw, text, sub) => {
    const d = document.createElement("div");
    d.className = "item";
    d.innerHTML = `<span class="sw">${sw}</span><span>${text}${sub ? `<small>${sub}</small>` : ""}</span>`;
    return d;
  };
  const h3 = (t) => Object.assign(document.createElement("h3"), { textContent: t });
  const x = Object.assign(document.createElement("button"), { className: "x", textContent: "×", onclick: () => setLegend(false) });
  x.setAttribute("aria-label", S.close);
  const title = Object.assign(document.createElement("h2"), { textContent: S.legend });
  const body = Object.assign(document.createElement("div"), { className: "scroll" });
  body.append(title, h3(S.legendSystems),
    item(`<b class="mono">TM</b>`, S.tm, S.tmDesc), item(`<b class="mono">MX</b>`, S.mixto, S.mixtoDesc), item(`<b class="mono">SP</b>`, S.sitp, S.sitpDesc),
    h3(S.legendTroncales));
  Object.entries(colors.routes).forEach(([l, o]) => {
    const b = badge(l, l, "troncal");
    const row = item(b.outerHTML, o.name, o.verified ? "" : S.mkProvisional);
    body.append(row);
  });
  const ink = dark() ? "#F2F2EE" : "#111";
  body.append(h3(S.legendMarkers),
    item(`<svg width="28" height="8" viewBox="0 0 28 8"><path d="M1 4H27" stroke="${ink}" stroke-width="3"/></svg>`, S.mkSolid),
    item(`<svg width="28" height="8" viewBox="0 0 28 8" fill="${ink}"><circle cx="4" cy="4" r="1.5"/><circle cx="10.67" cy="4" r="1.5"/><circle cx="17.33" cy="4" r="1.5"/><circle cx="24" cy="4" r="1.5"/></svg>`, S.mkMixed),
    item(`<svg width="16" height="16" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="3" fill="${dark() ? "#1A1A1A" : "#fff"}" stroke="${ink}" stroke-width="2"/></svg>`, S.mkStation),
    item(SVG_BUS(routeColor("B")), S.mkBus),
    item(SVG_BUS(routeColor("B"), false), S.mkDot),
    item(SVG_BUS(routeColor("B"), true, true), S.mkEst),
    item(`<svg width="24" height="24" viewBox="-16 -16 32 32"><circle r="7.5" fill="#fff" fill-opacity=".9"/><circle r="7.5" fill="none" stroke="${routeColor("?")}" stroke-width="2"/><rect x="-3.2" y="-3.4" width="2.2" height="6.8" rx="1" fill="${routeColor("?")}"/><rect x="1" y="-3.4" width="2.2" height="6.8" rx="1" fill="${routeColor("?")}"/></svg>`, S.mkIdle),
    item(SVG_BUS(routeColor("?")), S.mkZonal));
  const lv = state.live;
  if (lv) {
    const fmt = (d) => new Date(d).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    body.append(h3(S.legendLive));
    if (lv.ok && lv.asOf) body.append(item(`<b class="mono">${fmt(lv.asOf)}</b>`, S.lastRead));
    if (!lv.ok) body.append(item(`<b class="mono">!</b>`, S["err_" + lv.error] || S.err_generic));
    if (lv.credits != null) body.append(item(`<b class="mono">${lv.credits}</b>`, S.credits, lv.resetsAt ? S.resetsOn + " " + new Date(lv.resetsAt).toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : ""));
    if (lv.callsLeft != null) body.append(item(`<b class="mono">${lv.callsLeft}</b>`, S.readsLeft));
  }
  L.replaceChildren(x, body);
}
function setLegend(open) {
  state.legend = open;
  if (open) { if (state.alertsOpen) setAlerts(false); renderLegend(); state.menu = false; renderFilters(); }
  $("legend").hidden = !open;
  $("help").setAttribute("aria-expanded", String(open));
}

/* ---------- location ---------- */
function locate(cb) {
  if (!navigator.geolocation) return cb?.(false);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const c = [pos.coords.longitude, pos.coords.latitude];
      if (!userMarker) {
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 45%,transparent)";
        userMarker = new maplibre.Marker({ element: el }).setLngLat(c).addTo(map);
      } else userMarker.setLngLat(c);
      map.flyTo({ center: c, zoom: 15 });
      cb?.(true);
    },
    () => { $("locate").disabled = true; cb?.(false); },
    { timeout: 8000 }
  );
}

/* ---------- onboarding ---------- */
const ART = [
  `<svg viewBox="0 0 320 200" fill="none" stroke-width="4"><path class="draw" d="M10 160 L110 150 L170 90 L310 70" stroke="#81BA27"/><path class="draw" style="animation-delay:150ms" d="M10 60 L120 80 L200 130 L310 150" stroke="#DC0814"/><path class="draw" style="animation-delay:300ms" d="M60 190 L140 110 L230 30" stroke="#D5B079"/></svg>`,
  `<svg viewBox="0 0 320 120" fill="none"><g stroke="currentColor" stroke-opacity=".25"><rect x="10" y="40" width="80" height="40" rx="6"/><rect x="230" y="40" width="80" height="40" rx="6"/></g><rect x="100" y="40" width="120" height="40" rx="6" fill="#FFE600" fill-opacity=".25" stroke="#FFE600"/></svg>`,
  `<svg viewBox="0 0 200 200" fill="none"><circle cx="100" cy="100" r="60" stroke="#FFE600" stroke-opacity=".6" stroke-width="3"/><circle cx="100" cy="100" r="14" fill="currentColor"/></svg>`,
];
function onboarding() {
  const root = $("onboarding");
  let i = 0;
  const done = () => { store.set("ruta.onboarded", "1"); root.hidden = true; };
  const render = () => {
    const last = i === 2;
    root.innerHTML = `
      <div class="top">${last ? "" : `<button class="link" id="skip">${S.skip}</button>`}</div>
      <div class="art">${ART[i]}</div>
      <p>${S["ob" + (i + 1)]}</p>
      <div class="dots">${[0, 1, 2].map((n) => `<i class="${n === i ? "on" : ""}"></i>`).join("")}</div>
      <button class="cta" id="cta">${last ? S.allowLocation : S.next}</button>
      ${last ? `<button class="link below" id="later">${S.notNow}</button>` : ""}`;
    $("cta").onclick = () => (last ? locate(done) : (i++, render()));
    $("skip")?.addEventListener("click", done);
    $("later")?.addEventListener("click", done);
  };
  root.hidden = false;
  render();
}

/* ---------- boot ---------- */
(async function () {
  [colors, S, routes, stops, config] = await Promise.all([
    load("data/colors.json"), load("data/strings.json").then((s) => s.es),
    load("data/routes.geojson"), load("data/stops.geojson"), load("data/config.json"),
  ]);
  ridx = await load("data/routes-index.json");
  [service, cicRoutes] = await Promise.all([load("data/service.json?v=2").catch(() => null), load("data/cic-routes.geojson?v=3").catch(() => null)]);
  if (cicRoutes) { const have = new Set(routes.features.map((f) => f.properties.id)); cicRoutes.features.forEach((f) => { if (!have.has(f.properties.id)) routes.features.push(f); }); }
  routes.features.forEach((f) => { const p = f.properties; if (p.type === "zonal") p.letter = zl(p.code); });
  updateService();
  setInterval(() => { if (updateService()) { applyPaint(); if (state.trip) closeTrip(); } }, 60000);
  rstops = await load("data/route-stops.json");
  const ui = colors.ui[theme()];
  const root = document.documentElement.style;
  root.setProperty("--accent", ui.accent);
  $("locate").setAttribute("aria-label", S.locate);
  $("locate").onclick = () => locate();
  $("help").onclick = () => setLegend(!state.legend);
  $("alertsBtn").onclick = () => setAlerts(!state.alertsOpen);
  loadAlerts();
  setInterval(() => { if (!document.hidden) loadAlerts(); }, 120000);
  addEventListener("keydown", (e) => e.key === "Escape" && state.legend && setLegend(false));
  buildBar();
  renderFilters();
  initMap();
  const byRid = new Map(routes.features.map((f) => [f.properties.id.split("#")[1], f.properties]));
  const TYPE_OF = { troncal: "troncal", dual: "dual", transmicable: "cable" };
  const resolveBus = (v) => {
    const info = ridx[String(v.rid)];
    const system = info?.s || v.system;
    if (!system) return { props: null, letter: "Z0" };
    const type = TYPE_OF[system] || "zonal";
    const code = info?.c || v.code || "";
    const l = code[0];
    let letter = type === "cable" ? "T" : type === "dual" ? l : type !== "zonal" && colors.routes[l] ? l : zl(code);
    if (state.trip?.ridDir?.has(String(v.rid))) letter = state.trip.ridDir.get(String(v.rid));
    return { props: { id: byRid.get(String(v.rid))?.id ?? null, rid: String(v.rid), type, letter, code }, letter };
  };
  RT.setAllow((i) => {
    if (state.trip) return !!i.props && !!state.trip.rids?.has(i.props.rid); // viaje abierto: solo los buses de sus rutas
    if (!i.props || !(state.query || state.letter)) return false; // los buses en vivo aparecen al buscar o elegir una letra
    if (!state.selected) return matches(i.props);
    const s = routeById(state.selected);
    if (s.svc || s.type !== "troncal") return i.props.code === s.code;
    return i.props.type === "troncal" && i.props.letter === s.letter;
  });
  RT.init(config.realtime, resolveBus, (st) => { state.live = st; if (st.ok) state.liveAt = Date.now(); renderPill(); if (state.legend) renderLegend(); if (state.trip) updateEtas(); }, setSpin, () => !!state.query || !!state.letter || !!state.trip);
  $("refresh").setAttribute("aria-label", S.refresh);
  $("refresh").onclick = refreshBuses;
  const ob2 = new URLSearchParams(location.search).has("ob");
  if (ob2) onboardingV2(); else if (!store.get("ruta.onboarded")) onboarding();
  initHome();
})();
