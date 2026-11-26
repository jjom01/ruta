import { t, getLang } from "../i18n.js";
import { api } from "../net.js";
import { D, dark, propsOfRid, colorOf, token, onColor } from "../data.js";
import { fetchBuses } from "../rt.js";
import { glassSeg, CARD_PATHS, BUS_PATHS, swipeDismiss } from "../ui.js";
// Símbolos del selector: tarjeta (puntos de recarga) y bus (red y rutas), los mismos dibujos de la barra de pestañas.
const CARD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">${CARD_PATHS}</svg>`;
const TM_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">${BUS_PATHS}</svg>`;
import { simulated, locate, lastPos } from "../loc.js";
import { goRoutes, goStop, openStop } from "../detail.js";

const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const BOGOTA = [-74.0721, 4.711];
const LIMITS = { w: -74.45, e: -73.85, s: 4.40, n: 4.95 };           // más allá de esto el mapa rebota a la ciudad
const GROUPS = ["tm", "mixto", "sitp", "cable"];
const RADIUS = 1500;                                                   // m, buses mostrados alrededor de un lugar buscado

const st = { mode: "map", map: null, ready: false, query: null, buses: [], groups: new Set(GROUPS), timer: null, el: null };
const $ = (s) => st.el.querySelector(s);
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dist = (a, b) => { const dx = (a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), dy = (a[1] - b[1]) * 110540; return Math.hypot(dx, dy); };

/* ---------- búsqueda local (rutas y paraderos) ---------- */
let codes = null, stopNames = null;
function index() {
  if (codes) return;
  codes = new Map();
  for (const [rid, i] of Object.entries(D.ridx)) { const c = codes.get(i.c) || { code: i.c, system: i.s, rids: [], names: new Set() }; c.rids.push(rid); c.names.add(i.n); codes.set(i.c, c); }
  const seen = new Map();
  D.rs.stops.forEach((s, k) => { const key = s[0].toLowerCase(); if (!seen.has(key)) seen.set(key, { name: s[0], lat: s[1], lon: s[2] }); });
  stopNames = [...seen.values()];
}
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function localSuggest(q) {
  index();
  const n = norm(q.trim());
  if (!n) return [];
  const out = [];
  for (const c of codes.values()) {
    if (norm(c.code).startsWith(n) || [...c.names].some((x) => norm(x).includes(n)))
      out.push({ kind: "route", code: c.code, rids: c.rids, label: c.code, sub: [...c.names][0] || "", system: c.system });
    if (out.length > 40) break;
  }
  out.sort((a, b) => (norm(a.code) === n ? -1 : 0) - (norm(b.code) === n ? -1 : 0) || a.code.length - b.code.length);
  const stops = stopNames.filter((s) => norm(s.name).includes(n)).slice(0, 5).map((s) => ({ kind: "stop", label: s.name, sub: "", lat: s.lat, lon: s.lon }));
  return [...out.slice(0, 5), ...stops];
}
let gTimer = 0, gSeq = 0;
async function geocode(q, mode = "suggest") {
  const seq = ++gSeq;
  try {
    const r = await fetch(api(`/api/geocode?q=${encodeURIComponent(q)}&mode=${mode}`));
    const j = await r.json();
    return seq === gSeq ? (j.results || []).map((x) => ({ kind: "place", label: x.label, sub: x.sub, lat: x.lat, lon: x.lon })) : null;
  } catch { return []; }
}

/* ---------- UI ---------- */
function init(el) {
  if (st.el) return; // ya iniciada (p. ej. por Planear vía ensure()): no crear un segundo mapa
  st.el = el;
  el.innerHTML = `
    <div class="seg glassy map-filters" id="mf" role="group"><button type="button" data-m="recharge" aria-pressed="false" aria-label="${t("rechargePts")}" title="${t("rechargePts")}">${CARD_ICON}</button><button type="button" data-m="map" aria-pressed="true" aria-label="${t("mapMode")}" title="${t("mapMode")}">${TM_ICON}</button></div>
    <div class="rcard" id="rcard" hidden></div>
    <button class="help" id="help" type="button" aria-label="${t("legend")}" aria-expanded="false">?</button>
    <section class="legend" id="legend" hidden aria-label="${t("legend")}"></section>
    <div class="toast" id="toast" hidden role="status"></div>
    <div class="search">
      <div class="sugg" id="sugg"></div>
      <button type="button" class="pillbtn rdet" id="rdet" hidden></button>
      <form id="sf" autocomplete="off">
        <div class="in"><input id="q" type="search" enterkeyhint="search" placeholder="${t("search")}" aria-label="${t("search")}"></div>
        <button class="go" id="go" type="submit" aria-label="${t("search")}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg></button>
      </form>
    </div>`;
  $("#mf").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); });
  glassSeg($("#mf"));
  $("#help").addEventListener("click", toggleLegend);
  swipeDismiss($("#legend"), { dir: "up", scroller: $("#legend"), onDismiss: () => { if (!$("#legend").hidden) toggleLegend(); } });
  swipeDismiss($("#rcard"), { dir: "down", onDismiss: () => { $("#rcard").hidden = true; } });
  const q = $("#q");
  q.addEventListener("input", () => {
    $("#go").classList.toggle("on", !!q.value.trim());
    if (!q.value.trim()) return clearSearch();
    suggest(q.value);
  });
  $("#sf").addEventListener("submit", async (e) => { e.preventDefault(); await submit(q.value); });
  initMap();
}
function toggleLegend() {
  const box = $("#legend"), open = box.hidden;
  if (open) {
    const m = dark() ? "dark" : "light";
    const line = (c, dash) => `<svg width="34" height="10" aria-hidden="true"><line x1="2" y1="5" x2="32" y2="5" stroke="${c}" stroke-width="5" stroke-linecap="${dash ? "butt" : "round"}" ${dash ? 'stroke-dasharray="6 4"' : ""}/></svg>`;
    const dot = (fill, stroke, op = 1) => `<svg width="34" height="16" aria-hidden="true"><circle cx="17" cy="8" r="6" fill="${fill}" stroke="${stroke}" stroke-width="2.5" opacity="${op}"/></svg>`;
    const busDot = (fill, op) => { const id = "lg" + Math.random().toString(36).slice(2, 7); return `<svg width="34" height="30" viewBox="-17 -15 34 30" aria-hidden="true" opacity="${op}"><defs><radialGradient id="${id}" cx="0" cy="0" r="16" gradientUnits="userSpaceOnUse"><stop offset=".3" stop-color="${fill}" stop-opacity=".85"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient></defs><g transform="rotate(40)"><path d="M0 0 L-8.5 -13.5 A16 16 0 0 1 8.5 -13.5Z" fill="url(#${id})"/></g><circle r="6" fill="${fill}" stroke="#fff" stroke-width="2.4"/></svg>`; };
    const estDot = (fill) => `<svg width="34" height="30" viewBox="-17 -15 34 30" aria-hidden="true"><circle r="9" fill="${fill}" fill-opacity=".5"/><circle r="9" fill="none" stroke="${dark() ? "#fff" : "#1a1a1a"}" stroke-width="3" stroke-dasharray="4.5 3.5"/></svg>`;
    const row = (ic, tx) => `<div class="lg">${ic}<span>${tx}</span></div>`;
    const letters = Object.entries(D.colors.routes).map(([k, v]) => `<div class="lg"><i class="dotc" style="background:${v[m]}"></i><span><b class="mono">${k}</b> ${v.name}</span></div>`).join("");
    box.innerHTML = `<button class="x" id="lx" aria-label="${t("close")}">×</button>
      ${row(line("var(--fg)"), t("lgTrunk"))}${row(line("var(--fg)", true), t("lgMixed"))}${row(line(GREY), t("lgOther"))}${row(dot("#fff", "#111"), t("lgStation"))}
      ${row(busDot(colorOf("D", "troncal"), 1), t("lgBus"))}${row(estDot(colorOf("D", "troncal")), t("lgEst"))}
      ${row(line(colorOf("Z", "zonal")), t("lgSitp"))}${row(line(colorOf("T", "cable")), t("lgCable"))}${row(dot("#2F80FF", "#fff"), t("lgYou"))}
      <div class="lg-h">${t("lgLines")}</div><div class="lg-grid">${letters}</div>`;
    box.querySelector("#lx").onclick = toggleLegend;
  }
  box.hidden = !open; $("#help").setAttribute("aria-expanded", String(open));
}
function suggest(v) {
  const box = $("#sugg");
  const local = localSuggest(v);
  render(box, local);
  clearTimeout(gTimer);
  if (v.trim().length < 3) return;
  gTimer = setTimeout(async () => { const g = await geocode(v); if (g && $("#q").value === v) render(box, [...local, ...g.slice(0, 4)]); }, 350);
}
function render(box, items) {
  box.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    if (it.kind === "route") {
      const p = propsOfRid(it.rids[0]);
      b.innerHTML = `<span class="badge" style="background:${p?.color};color:${onColor(p?.color)}">${it.code.slice(0, 3)}</span><span class="grow"><span class="title"></span><br><span class="sub"></span></span>`;
    } else b.innerHTML = `<span class="grow"><span class="title"></span><br><span class="sub"></span></span>`;
    b.querySelector(".title").textContent = it.label;
    b.querySelector(".sub").textContent = it.sub || "";
    if (!it.sub) b.querySelector("br").remove();
    b.addEventListener("click", () => choose(it));
    box.append(b);
  }
}
// Borrar la búsqueda devuelve el mapa a su estado original
function clearSearch() {
  clearTimeout(gTimer); gSeq++; clearInterval(st.timer); st.pin?.remove();
  $("#sugg").innerHTML = ""; $("#rdet").hidden = true; toast(null);
  if (!st.query) return;
  st.query = null; st.buses = [];
  draw();
  const me = lastPos();
  st.map.flyTo(me ? { center: me, zoom: 14, duration: 700 } : { center: BOGOTA, zoom: 11.5, duration: 700 });
}
async function submit(v) {
  v = v.trim(); if (!v) return;
  const local = localSuggest(v);
  const exact = local.find((x) => x.kind === "route" && norm(x.code) === norm(v));
  if (exact) return choose(exact);
  const g = await geocode(v, "submit");
  if (g === null) return; // la búsqueda quedó obsoleta (el usuario eligió otra cosa mientras tanto)
  const hit = (g && g[0]) || local[0];
  if (hit) return choose(hit);
  empty(t("noResults"));
}

/* ---------- resultado de la búsqueda ---------- */
async function choose(it) {
  clearTimeout(gTimer); gSeq++; st.pin?.remove();
  $("#sugg").innerHTML = "";
  $("#q").value = it.label; $("#go").classList.add("on"); $("#q").blur();
  toast(null);
  if (it.kind === "stop") { st.map.flyTo({ center: [it.lon, it.lat], zoom: 15.5 }); return openStop(it.label); }
  if (it.kind === "route") st.query = { kind: "route", rids: new Set(it.rids), code: it.code };
  else st.query = { kind: "place", center: [it.lon, it.lat] };
  const rd = $("#rdet");
  if (it.kind === "route") { const p = propsOfRid(it.rids[0]); rd.innerHTML = `<span class="tile" style="min-width:0;height:26px;font-size:var(--fs-s);background:${p?.color};color:${onColor(p?.color)}">${it.code.slice(0, 4)}</span><span>${t("detail")}</span>`; rd.hidden = false; rd.onclick = () => goRoutes(it.code); } else rd.hidden = true;
  if (st.query.kind === "place") st.map.flyTo({ center: st.query.center, zoom: 15 });
  else fitRoute(it);
  await refresh();
  clearInterval(st.timer);
  st.timer = setInterval(() => document.hidden || refresh(), 15000);
}
// Recorrido de cada ruta por las calles (servidor: /api/shape); mientras llega, se usa el trazado aproximado
st.shapes = new Map();
function loadShapes(q) {
  const need = [...q.rids].filter((r) => !st.shapes.has(r)).slice(0, 8); if (!need.length) return;
  need.forEach((r) => st.shapes.set(r, null));
  fetch(api("/api/shape?legs=" + need.map((r) => `${r}:0:${Math.max(0, (D.rs.routes[r] || []).length - 1)}`).join(","))).then((r) => r.json())
    .then((j) => { need.forEach((r, i) => st.shapes.set(r, j.shapes?.[i] || false)); if (st.query === q) draw(); })
    .catch(() => need.forEach((r) => st.shapes.delete(r)));
}
function lineFeatures(q) {
  if (q.kind !== "route") return [];
  const out = [];
  for (const rid of q.rids) {
    const p = propsOfRid(rid); if (!p) continue;
    const f = D.byId.get(`${p.code}#${rid}`), sh = st.shapes.get(rid);
    if (sh?.length) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: sh }, properties: { color: p.color } });
    else if (f) out.push({ type: "Feature", geometry: f.geometry, properties: { color: p.color } });
    else { // sin trazado propio: une las paradas en orden
      const co = (D.rs.routes[rid] || []).map((k) => [D.rs.stops[k][2], D.rs.stops[k][1]]);
      if (co.length > 1) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: co }, properties: { color: p.color } });
    }
  }
  return out;
}
// Paradas de la ruta buscada (sin repetir entre sentidos)
function stopFeatures(q) {
  if (q.kind !== "route") return [];
  const seen = new Set(), out = [];
  for (const rid of q.rids) {
    const p = propsOfRid(rid); if (!p) continue;
    for (const k of D.rs.routes[rid] || []) {
      if (seen.has(k)) continue; seen.add(k);
      const [name, lat, lon] = D.rs.stops[k];
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { color: p.color, name } });
    }
  }
  return out;
}
function fitRoute(it) {
  if (!st.map) return;
  const b = new maplibregl.LngLatBounds();
  for (const f of lineFeatures(st.query)) for (const c of f.geometry.coordinates) b.extend(c);
  if (!b.isEmpty()) st.map.fitBounds(b, { padding: 60, duration: 600 });
}
async function refresh() {
  try { st.buses = await fetchBuses(); } catch { st.buses = []; }
  draw();
}
// Haz de luz de dirección: una imagen por color de ruta (degradado del color hacia afuera, apunta al norte y se gira con el rumbo)
const beamColors = new Set();
const beamId = (c) => { beamColors.add(c); return "beam-" + c.slice(1); };
function ensureBeam(map, color) {
  const id = "beam-" + color.slice(1);
  if (map.hasImage(id)) return;
  const S = 128, R = 62, C = S / 2, half = 32 * Math.PI / 180, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
  const [r, gg, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const grad = g.createRadialGradient(C, C, 0, C, C, R);
  grad.addColorStop(0.18, `rgba(${r},${gg},${b},1)`); grad.addColorStop(0.55, `rgba(${r},${gg},${b},.55)`); grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad; g.beginPath(); g.moveTo(C, C); g.arc(C, C, R, -Math.PI / 2 - half, -Math.PI / 2 + half); g.closePath(); g.fill();
  map.addImage(id, g.getImageData(0, 0, S, S), { pixelRatio: 2 });
}
// Bus estimado: anillo discontinuo (blanco en tema oscuro, tinta en claro) con relleno suave del color de la ruta; una imagen por color y tema
const estIcons = new Map();
const estId = (c) => { const id = "est-" + (dark() ? "d" : "l") + c.slice(1); estIcons.set(id, c); return id; };
function ensureEst(map, id, color) {
  if (map.hasImage(id)) return;
  const S = 72, C = S / 2, [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)), c = document.createElement("canvas"); c.width = c.height = S; const x = c.getContext("2d");
  x.beginPath(); x.arc(C, C, 22, 0, Math.PI * 2); x.fillStyle = `rgba(${r},${g},${b},.5)`; x.fill();
  x.beginPath(); x.arc(C, C, 22, 0, Math.PI * 2); x.lineWidth = 6; x.setLineDash([9, 7]); x.lineCap = "butt"; x.strokeStyle = id.startsWith("est-d") ? "#ffffff" : "#1a1a1a"; x.stroke();
  map.addImage(id, x.getImageData(0, 0, S, S), { pixelRatio: 2 });
}
// El feed en vivo no trae rumbo. Cada variante (rid) ya es un sentido, así que el rumbo sale del tramo
// más cercano del recorrido de esa variante, en el orden de sus paraderos.
const pathCache = new Map();
function pathOf(rid) {
  if (pathCache.has(rid)) return pathCache.get(rid);
  const co = (D.rs.routes[rid] || []).map((k) => [D.rs.stops[k][2], D.rs.stops[k][1]]);
  pathCache.set(rid, co); return co;
}
function headingOf(rid, lon, lat) {
  const co = pathOf(String(rid)); if (co.length < 2) return null;
  const kx = Math.cos(lat * Math.PI / 180);
  let best = 1e18, hd = null;
  for (let i = 1; i < co.length; i++) {
    const [ax, ay] = co[i - 1], [bx, by] = co[i];
    const dx = (bx - ax) * kx, dy = by - ay, L = dx * dx + dy * dy; if (!L) continue;
    let u = (((lon - ax) * kx) * dx + (lat - ay) * dy) / L; u = Math.max(0, Math.min(1, u));
    const ex = (lon - ax) * kx - u * dx, ey = (lat - ay) - u * dy, d = ex * ex + ey * ey;
    if (d < best) { best = d; hd = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; }
  }
  return hd;
}
function visibleBuses() {
  const q = st.query; if (!q) return [];
  const out = [];
  for (const v of st.buses) {
    const p = propsOfRid(v.rid, v);
    if (!p) continue;
    if (q.kind === "route" ? !q.rids.has(p.rid) : dist(q.center, [v.lon, v.lat]) > RADIUS) continue;
    const hd = Number.isFinite(v.bearing) && v.bearing !== 0 ? v.bearing : headingOf(v.rid, v.lon, v.lat);
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: [v.lon, v.lat] }, properties: { color: p.color, beam: beamId(p.color), code: p.code, bearing: hd ?? 0, dir: hd == null ? 0 : 1, est: v.est ? 1 : 0, estImg: v.est ? estId(p.color) : "" } });
  }
  return out;
}
// Mapa base: colores del sistema y jerarquía por zoom. Alejado se ve limpio (solo vías grandes, nombres de barrio y de avenidas);
// al acercar entran poco a poco las calles menores, los nombres de calles, los edificios y los senderos. Las capas propias (líneas y
// estaciones de transporte, buses) no se tocan.
const LINE = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
const MAJOR = ["primary", "secondary", "tertiary", "trunk"];
function themeBase(map) {
  const tk = token, rail = tk("mapRail"), bg = tk("mapBackground"), land = tk("mapLand"), road = tk("mapRoad"), minor = tk("mapRoadMinor"), casing = tk("mapRoadCasing"), label = tk("mapLabel"), halo = tk("mapLabelHalo"), bldg = tk("mapBuilding");
  const z = (...s) => ["interpolate", ["linear"], ["zoom"], ...s];
  const zx = (base, ...s) => ["interpolate", ["exponential", base], ["zoom"], ...s];
  const has = (id) => !!map.getLayer(id);
  const paint = (id, k, v) => { try { has(id) && map.setPaintProperty(id, k, v); } catch {} };
  const range = (id, lo, hi) => { try { has(id) && map.setLayerZoomRange(id, lo, hi ?? 24); } catch {} };
  const layers = map.getStyle().layers || [];
  // fondo y superficies
  for (const l of layers) {
    try {
      if (l.type === "background") map.setPaintProperty(l.id, "background-color", bg);
      else if (l.type === "fill" && /landcover|landuse|park|wood|grass|forest|residential|garden|pitch/.test(l.id) && !/water/.test(l.id)) { map.setPaintProperty(l.id, "fill-color", land); map.setPaintProperty(l.id, "fill-opacity", 0.9); }
    } catch {}
  }
  // calles de servicio y pasajes: capa propia para que entren más tarde que las calles menores
  const spec = layers.find((l) => l.id === "highway_minor");
  if (spec && !has("highway_service")) {
    try {
      map.setFilter("highway_minor", ["all", LINE, ["==", ["get", "class"], "minor"]]);
      map.addLayer({ ...spec, id: "highway_service", filter: ["all", LINE, ["match", ["get", "class"], ["service", "track"], true, false]] }, "highway_minor");
    } catch {}
  }
  // vías principales por jerarquía: troncales y primarias siempre; secundarias desde z10.8; terciarias desde z11.8.
  // De lejos son finas y tenues (el tono sube con el zoom); al acercar ganan grosor y borde.
  const groups = [["", ["trunk", "primary"], 9, 1], ["_b", ["secondary"], 10.8, 0.85], ["_c", ["tertiary"], 11.8, 0.7]];
  const iIn = layers.findIndex((l) => l.id === "highway_major_inner"), afterInner = layers[iIn + 1]?.id;
  paint("highway_major_subtle", "line-color", minor); paint("highway_major_subtle", "line-width", z(6, 0, 8, 0.8, 9, 1.1)); range("highway_major_subtle", 6, 9);
  for (const [sfx, cls, lo, k] of groups) {
    const filt = ["all", LINE, ["match", ["get", "class"], cls, true, false], ["!=", ["get", "ramp"], 1]];   // los ramales y enlaces van aparte (de lejos ensucian)
    for (const base of ["highway_major_casing", "highway_major_inner"]) {
      const id = base + sfx, sp = layers.find((l) => l.id === base);
      try {
        if (!sfx && has(base)) map.setFilter(base, filt);
        else if (sfx && sp && !has(id)) map.addLayer({ ...sp, id, filter: filt }, base === "highway_major_casing" ? "highway_major_inner" : afterInner);
      } catch {}
    }
    const ci = "highway_major_casing" + sfx, ii = "highway_major_inner" + sfx, cl = lo + 1.4;
    range(ii, lo); paint(ii, "line-color", z(lo, minor, lo + 4, road)); paint(ii, "line-opacity", z(lo, 0, lo + 1.5, 1));
    paint(ii, "line-width", zx(1.4, lo, 0.8 * k, 13, 2.8 * k, 15, 5.5 * k, 17, 12 * k, 20, 30 * k));
    const c0 = Math.max(lo, 11.3);
    range(ci, c0); paint(ci, "line-color", casing); paint(ci, "line-opacity", z(c0, 0, c0 + 1.6, 1));
    paint(ci, "line-width", zx(1.4, c0, 1.8 * k, 13, 3.8 * k, 15, 7.2 * k, 17, 14.5 * k, 20, 33 * k));
  }
  // ramales y enlaces: solo muy cerca
  const sp0 = layers.find((l) => l.id === "highway_major_inner");
  if (sp0 && !has("highway_ramp")) { try { map.addLayer({ ...sp0, id: "highway_ramp", filter: ["all", LINE, ["match", ["get", "class"], MAJOR, true, false], ["==", ["get", "ramp"], 1]] }, afterInner); } catch {} }
  range("highway_ramp", 13.5); paint("highway_ramp", "line-color", minor); paint("highway_ramp", "line-opacity", z(13.5, 0, 14.8, 0.9)); paint("highway_ramp", "line-width", zx(1.5, 13.5, 0.8, 17, 3.2, 20, 9));
  for (const id of ["highway_motorway_inner", "highway_motorway_bridge_inner", "tunnel_motorway_inner"]) { paint(id, "line-color", road); }
  for (const id of ["highway_motorway_casing", "highway_motorway_bridge_casing", "tunnel_motorway_casing"]) paint(id, "line-color", casing);
  paint("highway_motorway_subtle", "line-color", road);
  // calles menores, de servicio y senderos: aparecen gradualmente
  range("highway_minor", 12.2); paint("highway_minor", "line-color", minor); paint("highway_minor", "line-opacity", z(12.2, 0, 13.6, 0.65, 15, 1)); paint("highway_minor", "line-width", zx(1.6, 12.2, 0.5, 14, 1, 16, 2.6, 18, 8, 20, 22));
  range("highway_service", 14.2); paint("highway_service", "line-color", minor); paint("highway_service", "line-opacity", z(14.2, 0, 15.4, 0.8)); paint("highway_service", "line-width", zx(1.6, 14.2, 0.6, 17, 1.8, 20, 12));
  range("highway_path", 15.2); paint("highway_path", "line-color", minor); paint("highway_path", "line-opacity", z(15.2, 0, 16.4, 0.9)); paint("highway_path", "line-width", zx(1.4, 15.2, 0.8, 20, 5));
  // edificios: solo al acercar
  range("building", 13.6); paint("building", "fill-color", bldg); paint("building", "fill-opacity", z(13.6, 0, 15, 1)); paint("building", "fill-outline-color", bg);
  // nombres de calles: las avenidas primero, el resto solo cerca
  const nameStyle = (id, lo, size) => { range(id, lo); paint(id, "text-color", label); paint(id, "text-halo-color", halo); paint(id, "text-halo-width", 1.6); paint(id, "text-halo-blur", 0.4); paint(id, "text-opacity", z(lo, 0, lo + 0.8, 1)); try { has(id) && map.setLayoutProperty(id, "text-size", zx(1.2, lo, size[0], 18, size[1])); } catch {} };
  const other = layers.find((l) => l.id === "highway_name_other");
  if (other && !has("highway_name_major")) {
    try {
      map.setFilter("highway_name_other", ["all", ["!=", ["get", "class"], "motorway"], ["!", ["match", ["get", "class"], MAJOR, true, false]], LINE]);
      map.addLayer({ ...other, id: "highway_name_major", filter: ["all", ["match", ["get", "class"], MAJOR, true, false], LINE] });
    } catch {}
  }
  nameStyle("highway_name_major", 11.6, [10, 13]); nameStyle("highway-name-major", 11.6, [10, 13]);
  nameStyle("highway_name_other", 14, [10, 13]); nameStyle("highway-name-minor", 14, [10, 13]); nameStyle("highway-name-path", 15.4, [10, 12]);
  paint("highway_name_motorway", "text-color", label); paint("highway_name_motorway", "text-halo-color", halo); paint("highway_name_motorway", "text-halo-width", 1.4);
  // vías del tren: línea fina gris con travesaños cortos perpendiculares (la capa «dashline» se dibuja ancha con trazos muy cortos, que quedan como travesaños)
  for (const id of ["railway", "railway_minor", "railway_transit", "railway_service"]) { paint(id, "line-color", rail); paint(id, "line-opacity", z(13.6, 0, 14.6, 1)); paint(id, "line-width", zx(1.3, 13.6, 0.9, 14, 1.3, 17, 2, 20, 3.2)); }
  for (const id of ["railway_dashline", "railway_minor_dashline", "railway_transit_dashline", "railway_service_dashline"]) {
    paint(id, "line-color", rail); paint(id, "line-opacity", z(13.6, 0, 14.6, 1)); paint(id, "line-width", zx(1.3, 13.6, 3.8, 14, 5, 17, 8, 20, 13)); paint(id, "line-dasharray", [0.3, 4.2]);
    try { has(id) && map.setLayoutProperty(id, "line-cap", "butt"); } catch {}
  }
  range("railway", 13.6); range("railway_dashline", 13.6); for (const id of ["railway_minor", "railway_minor_dashline", "railway_transit", "railway_transit_dashline", "railway_service", "railway_service_dashline"]) range(id, 15);
  // barrios y lugares: de lejos solo las ciudades; los barrios entran al acercar y se quedan
  for (const [id, lo] of [["place_suburb", 11.8], ["place_other", 12.6]]) { range(id, lo, 19); paint(id, "text-opacity", z(lo, 0, lo + 0.8, 1)); }
  for (const l of layers) {
    if (l.type !== "symbol" || !/^(place|label_|water_name|waterway_line_label)/.test(l.id)) continue;
    paint(l.id, "text-color", label); paint(l.id, "text-halo-color", halo); paint(l.id, "text-halo-width", 1.5);
  }
}
let trunk = null;
const trunkStops = () => trunk ||= new Set(Object.entries(D.rs.routes).filter(([rid]) => propsOfRid(rid)?.type !== "zonal").flatMap(([, idx]) => idx));
let network = null, networkDark = null;
// Contraste de la línea contra el fondo del mapa (WCAG): sin cambiar el tono, se aclara u oscurece hasta llegar a 3:1
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
function legible(hex, bg, min = 3) {
  const to = lum(bg) < 0.5 ? 255 : 0; let c = hex;
  for (let k = 1; k <= 20 && ratio(c, bg) < min; k++) c = "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k / 20) + to * (k / 20)).toString(16).padStart(2, "0")).join("");
  return c;
}
// La red ya viene calculada por corredor (backend/tools/build-network.py → data/network.geojson): un color por corredor, gris donde ninguna troncal lo reclama.
const GREY = "#8F8A8C";
function buildNetwork() {
  if (network && networkDark === dark()) return network;
  networkDark = dark();
  const owned = D.network.features.filter((f) => !f.properties.st).map((f) => { const l = f.properties.l; return { type: "Feature", geometry: f.geometry, properties: { letter: l, mixed: f.properties.mixed, color: legible(D.colors.routes[l === "S" ? "G" : l]?.[dark() ? "dark" : "light"] || GREY, token("mapLand")) } }; });
  const stations = D.network.features.filter((f) => f.properties.st);
  return (network = { lines: owned, stations });
}
/* ---------- modo: Mapa (red y rutas) / Puntos de recarga ---------- */
const MODE_LAYERS = ["net", "netMixed", "stations", "stationsHit", "lines", "qstops", "bus-beam", "buses", "buses-est"];
function applyMode() {
  const m = st.map; if (!st.ready || !m) return;
  const rc = st.mode === "recharge";
  for (const id of MODE_LAYERS) m.getLayer(id) && m.setLayoutProperty(id, "visibility", rc ? "none" : "visible");
  for (const id of ["shopCl", "shopPt", "shopHit"]) m.getLayer(id) && m.setLayoutProperty(id, "visibility", rc ? "visible" : "none");
  document.querySelectorAll("#mf button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === st.mode)));
  const card = $("#rcard"); if (card) card.hidden = true;   // la ficha solo aparece al tocar un punto
  $("#help")?.toggleAttribute("hidden", rc);
  if (rc) { $("#sugg").innerHTML = ""; loadShops(); }
}
function setMode(mode) {
  if (st.mode === mode) return;
  st.mode = mode; st.pin?.remove();
  if (mode === "recharge") { $("#legend").hidden = true; $("#help").setAttribute("aria-expanded", "false"); }
  applyMode();
  if (mode === "recharge") fitRecharge();
}
const LOCATOR = "https://www.tullaveplus.gov.co/puntos-de-recarga";
/* Tiendas, papelerías, droguerías y otros establecimientos que recargan TuLlave (listas de la Alcaldía, mar. 2022; ubicación aproximada por dirección) */
const SHOP_TYPES = { es: {}, en: { "Papelería": "Stationery shop", "Café Internet": "Internet café", "Multiservicios": "Multi-service shop", "Tienda": "Corner shop", "Droguería": "Pharmacy", "Cabinas Telefónicas": "Phone booths", "Ventas": "Sales point", "Variedades": "General store", "Cigarrería": "Tobacco shop", "Supermercado": "Supermarket", "Asesores y Servicios": "Advisory and services", "Panadería": "Bakery", "Miscelánea": "Notions shop" } };
// verde billete: más claro en el tema oscuro y más profundo en el claro para que siempre contraste con el mapa (≥ 3:1)
const money = () => (dark() ? "#3FBF73" : "#1E7F47");
function loadShops() {
  if (st.shopsP) return st.shopsP;
  st.shopsP = fetch("data/recharge-shops.json").then((r) => r.json()).then((a) => {
    st.shopsData = { type: "FeatureCollection", features: a.map(([lat, lon, type, barrio, addr]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { type, barrio, addr } })) };
    st.map?.getSource("shops")?.setData(st.shopsData);
  }).catch(() => { st.shopsP = null; });
  return st.shopsP;
}
function showShop(f) {
  const box = $("#rcard"); if (!box) return; box.hidden = false;
  const p = f.properties, [lon, lat] = f.geometry.coordinates, me = lastPos(), d = me ? Math.round(dist([lon, lat], me)) : null;
  const type = (SHOP_TYPES[getLang()] || {})[p.type] || p.type;
  const dtxt = d != null ? `<span class="rc-d mono">${d >= 1000 ? (d / 1000).toFixed(1) + " km" : d + " m"}</span>` : "";
  box.innerHTML = `<div class="rc-h"><b>${esc(type)}</b>${dtxt}<button type="button" class="rc-x" aria-label="${esc(t("close"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div><div class="rc-s">${esc([p.addr, p.barrio].filter(Boolean).join(" · "))}</div><div class="rc-n">${esc(t("shopNote"))}</div>`;
  box.querySelector(".rc-x").addEventListener("click", () => { box.hidden = true; });
}
// Ajusta el mapa a los puntos más cercanos (o a toda la red si no hay ubicación)
async function fitRecharge() {
  await loadShops(); const pts = (st.shopsData?.features || []).map((f) => f.geometry.coordinates), me = lastPos(), m = st.map;
  if (!m || !pts.length || st.mode !== "recharge") return;
  const b = new maplibregl.LngLatBounds();
  if (me) { b.extend(me); [...pts].sort((x, y) => dist(x, me) - dist(y, me)).slice(0, 25).forEach((c) => b.extend(c)); m.fitBounds(b, { padding: { top: 140, left: 50, right: 50, bottom: 300 }, maxZoom: 16, duration: 800 }); }
  else { pts.forEach((c) => b.extend(c)); m.fitBounds(b, { padding: { top: 140, left: 30, right: 30, bottom: 200 }, duration: 800 }); }
}
function draw() {
  if (!st.ready) return;
  applyMode();
  const q = st.query;
  const net = buildNetwork();
  st.map.getSource("net").setData({ type: "FeatureCollection", features: net.lines });
  st.map.getSource("stations").setData({ type: "FeatureCollection", features: net.stations });
  const dim = !!q || !!st.dim;
  for (const id of ["net", "netMixed"]) st.map.setPaintProperty(id, "line-opacity", dim ? 0.18 : 0.95);
  st.map.setPaintProperty("stations", "circle-opacity", dim ? 0.2 : 1);
  st.map.setPaintProperty("stations", "circle-stroke-opacity", dim ? 0.2 : 1);
  const buses = visibleBuses();
  beamColors.forEach((c) => ensureBeam(st.map, c)); estIcons.forEach((c, id) => ensureEst(st.map, id, c));
  st.map.getSource("buses").setData({ type: "FeatureCollection", features: buses });
  if (q?.kind === "route") loadShapes(q);
  st.map.getSource("lines").setData({ type: "FeatureCollection", features: q ? lineFeatures(q) : [] });
  st.map.getSource("qstops").setData({ type: "FeatureCollection", features: q ? stopFeatures(q) : [] });
  if (!q) return toast(null);
  if (buses.length) return toast(null);
  const routeOff = q.kind === "route" && st.buses.length && ![...st.buses].some((v) => q.rids.has(String(v.rid)));
  empty(routeOff ? t("offHours") : t("noResults"));
}
function empty(msg) { toast(msg); }
function toast(msg) { const e = $("#toast"); e.hidden = !msg; if (msg) e.textContent = msg; }

/* ---------- mapa ---------- */
// MapLibre (≈0,8 MB) ya no bloquea el arranque: se baja al abrir Mapa o Planear (y se precarga en segundo plano desde index.html)
const MLIB = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
let libP = null;
const loadLib = () => (libP ||= new Promise((res, rej) => {
  if (window.maplibregl) return res();
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = MLIB + ".css"; document.head.append(css);
  const s = document.createElement("script"); s.src = MLIB + ".js"; s.onload = () => res(); s.onerror = () => { libP = null; rej(new Error("maplibre")); }; document.head.append(s);
}));
const mapWaiters = [];
const whenMap = () => (st.map ? Promise.resolve(st.map) : new Promise((r) => mapWaiters.push(r)));   // el mapa se crea cuando MapLibre termina de bajar
function initMap() { loadLib().then(initMapNow).catch(() => {}); }
function initMapNow() {
  const map = (st.map = new maplibregl.Map({ container: "basemap", style: STYLES[dark() ? "dark" : "light"], center: BOGOTA, zoom: 11.5, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0 }));
  mapWaiters.splice(0).forEach((r) => r(map));
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
  map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
  const addLayers = () => {
    for (const id of ["net", "stations", "lines", "qstops", "buses"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.getLayer("net")) map.addLayer({ id: "net", type: "line", source: "net", filter: ["!=", ["get", "mixed"], 1], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 15, 4.5], "line-opacity": 0.9 } });
    if (!map.getLayer("netMixed")) map.addLayer({ id: "netMixed", type: "line", source: "net", filter: ["==", ["get", "mixed"], 1], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 15, 5], "line-dasharray": [2.2, 1.6], "line-opacity": 0.95 } }, "net");
    if (!map.getLayer("stations")) map.addLayer({ id: "stations", type: "circle", source: "stations", minzoom: 11.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 11.5, 2.4, 15, 6], "circle-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11.5, 1.6, 15, 2.8], "circle-stroke-color": "#111", "circle-pitch-alignment": "map" } });
    if (!map.getLayer("stationsHit")) map.addLayer({ id: "stationsHit", type: "circle", source: "stations", minzoom: 11.5, paint: { "circle-radius": 16, "circle-color": "#000", "circle-opacity": 0 } });
    if (!map.getSource("shops")) map.addSource("shops", { type: "geojson", cluster: true, clusterRadius: 38, clusterMaxZoom: 15, data: st.shopsData || { type: "FeatureCollection", features: [] } });
    if (!map.getLayer("shopCl")) map.addLayer({ id: "shopCl", type: "circle", source: "shops", filter: ["has", "point_count"], layout: { visibility: "none" }, paint: { "circle-color": money(), "circle-opacity": 0.3, "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 9, 20, 15, 100, 23, 400, 34], "circle-stroke-width": 1.5, "circle-stroke-color": money(), "circle-stroke-opacity": 0.85 } });
    if (!map.getLayer("shopPt")) map.addLayer({ id: "shopPt", type: "circle", source: "shops", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" }, paint: { "circle-color": money(), "circle-opacity": 0.6, "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 17, 8], "circle-stroke-width": 1.5, "circle-stroke-color": money(), "circle-stroke-opacity": 0.95 } });
    if (!map.getLayer("shopHit")) map.addLayer({ id: "shopHit", type: "circle", source: "shops", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" }, paint: { "circle-radius": 18, "circle-color": "#000", "circle-opacity": 0 } });
    if (!map.getLayer("lines")) map.addLayer({ id: "lines", type: "line", source: "lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5.5, "line-opacity": 1 } });
    if (!map.getLayer("qstops")) map.addLayer({ id: "qstops", type: "circle", source: "qstops", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.6, 15, 6.5], "circle-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 15, 3], "circle-stroke-color": ["get", "color"] } });
    if (!map.getLayer("bus-beam")) map.addLayer({ id: "bus-beam", type: "symbol", source: "buses", filter: ["==", ["get", "dir"], 1], layout: { "icon-image": ["get", "beam"], "icon-rotate": ["get", "bearing"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1.3 }, paint: { "icon-opacity": ["case", ["==", ["get", "est"], 1], 0.55, 1] } });
    if (!map.getLayer("buses")) map.addLayer({ id: "buses", type: "circle", source: "buses", filter: ["!=", ["get", "est"], 1], paint: { "circle-radius": 9, "circle-color": ["get", "color"], "circle-stroke-width": 3, "circle-stroke-color": "#fff" } });
    if (!map.getLayer("buses-est")) map.addLayer({ id: "buses-est", type: "symbol", source: "buses", filter: ["==", ["get", "est"], 1], layout: { "icon-image": ["get", "estImg"], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1 } });
    beamColors.forEach((c) => ensureBeam(map, c)); estIcons.forEach((c, id) => ensureEst(map, id, c));
    st.ready = true; draw();
  };
  map.on("style.load", () => { themeBase(map); addLayers(); });
  { // Punto azul con la ubicación real (o simulada con ?loc=); pide permiso una sola vez
    const e = document.createElement("div"); e.className = "me";
    const mk = new maplibregl.Marker({ element: e });
    const show = (p, fly) => { mk.setLngLat(p).addTo(map); if (fly) { map.jumpTo({ center: p, zoom: 14 }); } };
    let watching = false;
    const start = (p) => { if (!p) return; show(p, true); if (!simulated && !watching && navigator.geolocation) { watching = true; navigator.geolocation.watchPosition((q) => show([q.coords.longitude, q.coords.latitude], false), () => {}, { enableHighAccuracy: true, maximumAge: 10000 }); } };
    locate().then(start); addEventListener("ruta:location", () => locate().then(start)); // permiso concedido desde Inicio · Ajustes
  }
  map.on("moveend", () => {            // rebote: si se aleja de Bogotá vuelve a la ciudad
    const c = map.getCenter();
    if (c.lng < LIMITS.w || c.lng > LIMITS.e || c.lat < LIMITS.s || c.lat > LIMITS.n) map.easeTo({ center: BOGOTA, zoom: 11.5, duration: 700 });
  });
  // Toque en una estación: abre su detalle dentro de la pantalla Rutas
  map.on("click", "shopHit", (e) => { const f = e.features[0]; showShop(f); map.easeTo({ center: f.geometry.coordinates, duration: 400 }); });
  map.on("click", "shopCl", (e) => { const f = e.features[0]; map.getSource("shops").getClusterExpansionZoom(f.properties.cluster_id).then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(17, z + 0.5), duration: 450 })).catch(() => {}); });
  for (const id of ["shopHit", "shopCl"]) { map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer")); map.on("mouseleave", id, () => (map.getCanvas().style.cursor = "")); }
  map.on("click", "stationsHit", (e) => {
    const [lon, lat] = e.features[0].geometry.coordinates, kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
    const tm = trunkStops(), norm = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""), want = norm(e.features[0].properties.n || "");
    let best = null, bd = 300;
    for (const i of tm) { const s = D.rs.stops[i], d = Math.hypot((s[2] - lon) * kx, (s[1] - lat) * ky), nm = norm(s[0]); const sc = d - (nm === want ? 250 : 0); if (sc < bd) { bd = sc; best = s[0]; } }
    goStop(best || e.features[0].properties.n);
  });
  map.on("mouseenter", "stationsHit", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "stationsHit", () => (map.getCanvas().style.cursor = ""));
  const restyle = () => { st.ready = false; map.setStyle(STYLES[dark() ? "dark" : "light"], { diff: false }); };   // sin «diff»: el estilo se recarga entero y vuelve a disparar style.load (capas propias y colores)
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", restyle); addEventListener("themechange", restyle);
}

function ensure() { if (!st.el) init(document.getElementById("s-map")); return st.map; }
/* ---------- destello del recorrido (opción A) ---------- */
const GLOW_MS = 2600, GLOW_W = 0.16;
function glowStops(pos, a) {
  // franja de ancho GLOW_W centrada en pos (puede salirse de 0..1 al entrar y salir); los tramos deben ser estrictamente crecientes
  const c = (x) => Math.min(1, Math.max(0, x)), lo = pos - GLOW_W / 2, hi = pos + GLOW_W / 2, g0 = "rgba(255,255,255,0)", g1 = `rgba(255,255,255,${a})`;
  const stops = [[0, g0]];
  const add = (x, col) => { const v = c(x); if (v > stops[stops.length - 1][0] + 1e-4) stops.push([v, col]); };
  add(lo, g0); add(pos, g1); add(hi, g0);
  if (stops[stops.length - 1][0] < 1) stops.push([1, g0]);
  // si la franja está totalmente fuera, el degradado queda transparente
  return stops.length < 2 ? [[0, g0], [1, g0]] : stops;
}
function startGlow() {
  const m = st.map; if (!m || st.glowRAF || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const t0 = performance.now();
  const frame = (now) => {
    st.glowRAF = 0;
    if (!st.map || !m.getLayer("plan-glow") || m.getLayoutProperty("plan-glow", "visibility") === "none" || document.hidden) return;   // se detiene fuera de Planear
    const p = (((now - t0) % GLOW_MS) / GLOW_MS) * (1 + GLOW_W) - GLOW_W / 2;
    const expr = (a) => ["interpolate", ["linear"], ["line-progress"], ...glowStops(p, a).flat()];
    m.setPaintProperty("plan-glow-w", "line-gradient", expr(0.28));
    m.setPaintProperty("plan-glow", "line-gradient", expr(0.9));
    st.glowRAF = requestAnimationFrame(frame);
  };
  st.glowRAF = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) startGlow(); });
const api = { showStop(lon, lat, name) {
    st.pin?.remove(); clearTimeout(gTimer); gSeq++;
    const e = document.createElement("div"); e.className = "stoppin"; e.innerHTML = "<i></i>";
    $("#sugg").innerHTML = ""; $("#q").value = name; $("#go").classList.add("on");
    whenMap().then((m) => { st.pin = new maplibregl.Marker({ element: e }).setLngLat([lon, lat]).addTo(m); m.flyTo({ center: [lon, lat], zoom: 16.5, duration: 900 }); });
  }, showRoute(code) { index(); const c = codes.get(code); if (c) choose({ kind: "route", code, rids: c.rids, label: code, sub: "" }); },
  // vuelve a encuadrar el último recorrido con otro margen inferior (lista de resultados abierta o plegada)
  // al pasar a Planear se borra la búsqueda del mapa (ruta, paradero o lugar) para que no quede dibujada
  reset() { if (!st.el) return; const q = $("#q"); if (q) q.value = ""; $("#go")?.classList.remove("on"); $("#rdet").hidden = true; clearSearch(); },
  glow: () => startGlow(),
  planFit(fit) { st.fit = fit; },
  refit(bottom) { const m = st.map; if (!m || !st.fit?.length) return; const b = new maplibregl.LngLatBounds(); st.fit.forEach((c) => b.extend(c)); m.fitBounds(b, { padding: { top: 90, left: 50, right: 50, bottom }, duration: 500 }); },
  setMode: (m) => { setMode(m); }, ensure, map: () => st.map, ready: () => whenMap().then((m) => (st.ready ? m : new Promise((r) => m.once("idle", () => r(m))))),
  // Capa de itinerario (planear viaje): líneas y puntos sobre la red.
  overlay(features, fit) {
    const run = () => { const m = st.map; if (!m.getSource("plan")) { m.addSource("plan", { type: "geojson", lineMetrics: true, data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "plan-walk", type: "line", source: "plan", filter: ["==", ["get", "k"], "walk"], paint: { "line-color": dark() ? "#fff" : "#111", "line-width": 3, "line-dasharray": [0.5, 2], "line-opacity": 0.8 }, layout: { "line-cap": "round" } });
      m.addLayer({ id: "plan-ride", type: "line", source: "plan", filter: ["==", ["get", "k"], "ride"], paint: { "line-color": ["get", "color"], "line-width": 6 }, layout: { "line-cap": "round", "line-join": "round" } });
      // destello que viaja por el recorrido: degradado a lo largo de la línea (line-progress) que se desplaza en cada cuadro
      const g0 = "rgba(255,255,255,0)";
      m.addLayer({ id: "plan-glow-w", type: "line", source: "plan", filter: ["==", ["get", "k"], "ride"], paint: { "line-width": 15, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, g0, 1, g0] }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "plan-glow", type: "line", source: "plan", filter: ["==", ["get", "k"], "ride"], paint: { "line-width": 5, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, g0, 1, g0] }, layout: { "line-cap": "round", "line-join": "round" } });
      // paradas del recorrido: círculos sobre la línea (las de subida y bajada, más grandes)
      m.addLayer({ id: "plan-stop", type: "circle", source: "plan", filter: ["==", ["get", "k"], "stop"], paint: { "circle-radius": ["case", ["==", ["get", "big"], 1], 7, 4], "circle-color": "#fff", "circle-stroke-width": ["case", ["==", ["get", "big"], 1], 3.5, 2.5], "circle-stroke-color": ["get", "color"], "circle-pitch-alignment": "map" } });
      m.addLayer({ id: "plan-pt", type: "circle", source: "plan", filter: ["==", ["get", "k"], "pt"], paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-width": 3, "circle-stroke-color": token("bg") } }); }
      m.getSource("plan").setData({ type: "FeatureCollection", features }); startGlow();
      if (fit?.length) { st.fit = fit; const b = new maplibregl.LngLatBounds(); fit.forEach((c) => b.extend(c)); m.fitBounds(b, { padding: { top: 90, left: 50, right: 50, bottom: 360 }, duration: 700 }); } };
    st.ready ? run() : whenMap().then((m) => (st.ready ? run() : m.once("idle", run)));
  },
  dim(v) { st.dim = v; draw(); },
};
export default { init, show: () => { st.dim = false; st.map?.resize(); draw(); st.map?.getLayer("plan-ride") && ["plan-walk", "plan-ride", "plan-glow-w", "plan-glow", "plan-stop", "plan-pt"].forEach((l) => st.map.setLayoutProperty(l, "visibility", "none")); }, api };
