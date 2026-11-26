/* Resultados de un viaje sobre el mapa: la pantalla de inicio se retira, la cámara vuela al recorrido,
   la hoja de opciones sube desde abajo y la ruta se dibuja de origen a destino. */
const REDUCED = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE_OUT = (t) => 1 - Math.pow(1 - t, 3);
let tripAnim = 0, tripCoords = [], etaTimer = 0;

function destIcon() {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d");
  g.scale(2, 2);
  g.fillStyle = "#FFE600"; g.strokeStyle = dark() ? "#111" : "#111"; g.lineWidth = 2;
  g.beginPath(); g.roundRect(4, 4, 16, 16, 4); g.fill(); g.stroke();
  return g.getImageData(0, 0, 48, 48);
}
function addTripLayers() {
  if (!map.getSource("trip")) map.addSource("trip", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  if (!map.hasImage("ruta-dest")) map.addImage("ruta-dest", destIcon(), { pixelRatio: 2 });
  if (!map.getLayer("trip-walk")) map.addLayer({
    id: "trip-walk", type: "line", source: "trip", filter: ["==", ["get", "kind"], "walk"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": dark() ? "#F2F2EE" : "#111111", "line-width": 3, "line-dasharray": [0.01, 2.2], "line-opacity": 0.85 },
  });
  if (!map.getLayer("trip-ride")) map.addLayer({
    id: "trip-ride", type: "line", source: "trip", filter: ["==", ["get", "kind"], "ride"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 6 },
  });
  if (!map.getLayer("trip-stops")) map.addLayer({
    id: "trip-stops", type: "symbol", source: "trip", filter: ["==", ["get", "kind"], "stop"],
    layout: { "icon-image": "ruta-station", "icon-size": 1.1, "icon-allow-overlap": true, "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-font": ["Noto Sans Regular"], "text-optional": true },
    paint: { "text-color": dark() ? "#F2F2EE" : "#111111", "text-halo-color": dark() ? "#111" : "#fff", "text-halo-width": 1.5 },
  });
  if (!map.getLayer("trip-origin")) map.addLayer({
    id: "trip-origin", type: "circle", source: "trip", filter: ["==", ["get", "kind"], "origin"],
    paint: { "circle-radius": 7, "circle-color": dark() ? "#F2F2EE" : "#111111", "circle-stroke-width": 5, "circle-stroke-color": "rgba(255,230,0,.45)" },
  });
  if (!map.getLayer("trip-dest")) map.addLayer({
    id: "trip-dest", type: "symbol", source: "trip", filter: ["==", ["get", "kind"], "dest"],
    layout: { "icon-image": "ruta-dest", "icon-size": 1.15, "icon-allow-overlap": true },
  });
  if (state.trip) setTripData(1);
}

/* ---------- geometría ---------- */
const lonlat = (k) => [rstops.stops[k][2], rstops.stops[k][1]];
function legColor(l) {
  const tmish = ["troncal", "dual", "transmicable"].includes(l.sys), letter = l.sys === "transmicable" ? "T" : l.code[0];
  return routeColor(tmish && colors.routes[letter] ? letter : sitpLetter(l));
}
/* Trazado real (GTFS shapes) entre dos paradas de una ruta; null si aún no se ha cargado. */
let shapes = null, shapesP = null;
function loadShapes() { return (shapesP ||= fetch("data/shapes.json?v=3").then((r) => r.json()).then((j) => (shapes = j)).catch(() => { shapesP = null; return null; })); }
function railSlice(rid, a, b) {
  const sh = shapes && shapes[rid];
  if (!sh) return null;
  const d0 = sh.d[a], d1 = sh.d[b], c = sh.c, p = sh.p, out = [];
  const at = (i) => [p[2 * i], p[2 * i + 1]];
  const lerp = (i, d) => { const f = c[i + 1] > c[i] ? (d - c[i]) / (c[i + 1] - c[i]) : 0, A = at(i), B = at(i + 1); return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f]; };
  let i = 0, n = c.length;
  while (i < n - 2 && c[i + 1] <= d0) i++;
  out.push(lerp(i, d0));
  for (let k = i + 1; k < n && c[k] < d1; k++) out.push(at(k));
  let j = Math.min(Math.max(i, 0), n - 2);
  while (j < n - 2 && c[j + 1] < d1) j++;
  out.push(lerp(j, d1));
  return out.length > 1 ? out : null;
}
function tripLines(it, origin, dest) {
  const out = [], P = (p) => [p.lon, p.lat];
  it.legs.forEach((l, i) => {
    if (l.t === "walk" && !l.dest) out.push({ kind: "walk", coords: [P(origin), lonlat(l.to)] });
    else if (l.t === "walk") out.push({ kind: "walk", coords: [lonlat(it.legs[i - 1].to), P(dest)] });
    else if (l.t === "xfer") out.push({ kind: "walk", coords: [lonlat(l.from), lonlat(l.to)] });
    else {
      const list = rstops.routes[l.rid], a = Math.min(l.p0, l.p1), b = Math.max(l.p0, l.p1);
      let c = railSlice(l.rid, a, b) || list.slice(a, b + 1).map(lonlat);
      if (l.p0 > l.p1) c = c.reverse();
      out.push({ kind: "ride", color: legColor(l), coords: c });
    }
  });
  const len = (c) => c.slice(1).reduce((s, p, i) => s + Math.hypot((p[0] - c[i][0]) * 0.99, p[1] - c[i][1]), 0);
  out.forEach((l) => (l.len = len(l.coords)));
  return out;
}
function slice(coords, frac, total) {
  if (frac >= 1) return coords;
  let left = frac * total;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const seg = Math.hypot((coords[i][0] - coords[i - 1][0]) * 0.99, coords[i][1] - coords[i - 1][1]);
    if (left >= seg) { out.push(coords[i]); left -= seg; continue; }
    const f = seg ? left / seg : 0;
    out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]);
    break;
  }
  return out;
}
function setTripData(progress) {
  const t = state.trip;
  if (!t || !map.getSource("trip")) return;
  const total = t.lines.reduce((s, l) => s + l.len, 0) || 1;
  let done = 0;
  const feats = [];
  t.lines.forEach((l) => {
    const frac = Math.max(0, Math.min(1, (progress * total - done) / (l.len || 1)));
    done += l.len;
    if (frac > 0 && l.coords.length > 1) feats.push({ type: "Feature", properties: { kind: l.kind, color: l.color || "#888" }, geometry: { type: "LineString", coordinates: slice(l.coords, frac, l.len) } });
  });
  if (progress >= 0.98) t.stopsPts.forEach((s) => feats.push({ type: "Feature", properties: { kind: "stop", name: s.name }, geometry: { type: "Point", coordinates: s.c } }));
  feats.push({ type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [t.origin.lon, t.origin.lat] } });
  if (progress >= 0.98) feats.push({ type: "Feature", properties: { kind: "dest" }, geometry: { type: "Point", coordinates: [t.dest.lon, t.dest.lat] } });
  map.getSource("trip").setData({ type: "FeatureCollection", features: feats });
}
function animateTrip() {
  cancelAnimationFrame(tripAnim);
  if (REDUCED()) { setTripData(1); return; }
  const t0 = performance.now(), D = 900;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / D);
    setTripData(EASE_OUT(p));
    if (p < 1) tripAnim = requestAnimationFrame(tick);
  };
  tripAnim = requestAnimationFrame(tick);
}
function fitTrip() {
  const t = state.trip;
  if (!t) return;
  const b = new window.maplibregl.LngLatBounds();
  t.lines.forEach((l) => l.coords.forEach((c) => b.extend(c)));
  b.extend([t.origin.lon, t.origin.lat]); b.extend([t.dest.lon, t.dest.lat]);
  const sheet = $("tripSheet").offsetHeight || 320;
  map.fitBounds(b, { padding: { top: 72, bottom: sheet + $("filters").offsetHeight + 56, left: 40, right: 72 }, maxZoom: 15.5, duration: REDUCED() ? 0 : 900, essential: true });
}

/* ---------- selección de opción ---------- */
/* buses en vivo que se muestran: del tramo donde el usuario eligió bus, solo ese; de los demás tramos, todas sus alternativas */
function liveRids(it) {
  const rides = it.legs.filter((l) => l.t === "ride"), set = new Set();
  rides.forEach((o, n) => {
    const sel = it.sel && it.sel[n], alts = o.alts && o.alts.length ? o.alts : [o];
    const codes = new Set(sel ? [sel] : [o.code, ...(o._order || []).slice(0, 4).map((a) => a.code)]);   // elegido, o los 4 de la pastilla
    alts.filter((a) => codes.has(a.code)).forEach((a) => set.add(String(a.rid)));
    if (!sel) set.add(String(o.rid));
  });
  return set;
}
/* buses del viaje en el mapa y el color (por dirección) de los SITP */
function syncLive(it) {
  const prev = state.trip.rids, next = liveRids(it);
  state.trip.rids = next;
  state.trip.ridDir = new Map();
  it.legs.filter((l) => l.t === "ride").forEach((o) => (o.alts && o.alts.length ? o.alts : [o]).forEach((a) => { if (!["troncal", "dual", "transmicable"].includes(a.sys)) state.trip.ridDir.set(String(a.rid), sitpLetter(a)); }));
  if (!prev || prev.size !== next.size || [...next].some((r) => !prev.has(r))) RT.touch();
}
function showItin(it) {
  const legs = effLegs(it);
  state.trip.origin = it.origin; state.trip.dest = it.dest;
  state.trip.lines = tripLines({ legs }, it.origin, it.dest);
  state.trip.stopsPts = [];
  legs.forEach((l) => { if (l.t === "ride") [l.from, l.to].forEach((k) => state.trip.stopsPts.push({ name: rstops.stops[k][0], c: lonlat(k) })); });
  state.trip.it = it;
  syncLive(it);
  fitTrip();
  animateTrip();
  RT.touch();
  if (RT.age() > 20000) RT.load({});
  updateEtas();
}
/* Al elegir un bus se vuelve a planear lo que falta desde su parada de bajada, para que los tramos siguientes se adapten a esa elección. */
async function replanTail(it, n) {
  const rides = effLegs(it).filter((l) => l.t === "ride"), r = rides[n];
  let mask = 0;
  rides.slice(0, n + 1).forEach((l) => (mask |= ["troncal", "dual", "transmicable", "alimentador"].includes(l.sys) ? 1 : 2));
  const mode = it.kind === "mixed" ? (mask === 3 ? "any" : "mixed") : it.kind;       // direct / tm / sitp / mixed
  const tail = await PL.replanAsync({ from: r.to, dest: it.dest, mode, kind: it.kind === "mixed" ? "mixed" : it.kind, startMask: mask, off: inactiveRids() });
  return tail;
}
async function selectAlt(it, n, code) {
  const prev = { sel: { ...(it.sel || {}) }, legs: it.legs };
  it.sel = { ...(it.sel || {}), [n]: code };
  Object.keys(it.sel).forEach((k) => { if (+k > n) delete it.sel[k]; });
  const card = () => [...document.querySelectorAll("#tripSheet .opt")].find((c) => c._it === it);
  if (card()) refreshCard(card());
  showItin(it);
  if (it.kind === "direct") return;
  let tail = null;
  try { tail = await replanTail(it, n); } catch (e) { tail = null; }
  if (state.trip?.it !== it) return;
  if (!tail) {                                                    // no hay cómo seguir desde esa parada: se conserva lo anterior
    it.sel = prev.sel; it.legs = prev.legs;
    if (card()) { refreshCard(card()); warn(card(), S.noContinue); }
    showItin(it);
    return;
  }
  const rides = it.legs.filter((l) => l.t === "ride").slice(0, n + 1);
  it.legs = [...rides, ...tail];
  if (card()) refreshCard(card());
  showItin(it);
}
function warn(card, text) {
  card.querySelector(".opt-warn")?.remove();
  const d = document.createElement("div");
  d.className = "opt-warn"; d.textContent = text;
  card.querySelector(".opt-steps").prepend(d);
  setTimeout(() => d.remove(), 4000);
}
function pickItin(card, it) {
  const sheet = $("tripSheet");
  sheet.querySelectorAll(".opt").forEach((c) => {
    const on = c === card, body = c.querySelector(".opt-steps"), head = c.querySelector(".opt-head");
    if (body) body.hidden = !on;
    head.setAttribute("aria-expanded", String(on));
    c.classList.toggle("sel", on);
  });
  if (!it) return;
  showItin(it);
}

/* ---------- apertura y cierre ---------- */
async function openTrip(res, origin, dest, names) {
  await Promise.race([loadShapes(), new Promise((r) => setTimeout(r, 4000))]);
  setLegend(false); setAlerts(false); clearSelection();
  state.menu = false; renderFilters();
  state.trip = { origin, dest, res, lines: [], stopsPts: [], rids: new Set() };
  clearInterval(etaTimer); etaTimer = setInterval(updateEtas, 15000);
  applyPaint();
  const sheet = $("tripSheet");
  sheet.querySelector(".trip-route").textContent = `${names.from} → ${names.to}`;
  const box = sheet.querySelector(".opts");
  box.replaceChildren();
  const cards = [];
  if (res.direct) cards.push(["direct", res.direct]);
  ["tm", "sitp", "mixed"].forEach((k) => cards.push([k, res[k]]));
  cards.forEach(([k, it]) => { const c = itinCard(k, it, false, pickItin); box.append(c); });
  const go = () => {
    hideHome();
    $("home").classList.remove("leaving");
    sheet.hidden = false;
    sheet.classList.remove("out");
    sheet.classList.add("in");
    const first = [...box.querySelectorAll(".opt")].find((c) => c.querySelector(".opt-total")?.textContent);
    pickItin(first || box.firstChild, cards.find(([, it]) => it)?.[1]);
  };
  if (REDUCED()) go();
  else { $("home").classList.add("leaving"); setTimeout(go, 240); }
}
function closeTrip() {
  if (!state.trip) return;
  cancelAnimationFrame(tripAnim);
  const sheet = $("tripSheet");
  sheet.classList.remove("in");
  sheet.classList.add("out");
  clearInterval(etaTimer);
  const done = () => { sheet.hidden = true; sheet.classList.remove("out"); state.trip = null; map.getSource("trip")?.setData({ type: "FeatureCollection", features: [] }); applyPaint(); RT.touch(); renderPill(); };
  if (REDUCED()) done(); else setTimeout(done, 180);
}

/* ---------- buses en vivo y hora estimada del próximo bus ---------- */
const eStopPt = (k) => ({ lat: rstops.stops[k][1], lon: rstops.stops[k][2] });
// minutos de horario que lleva un bus sobre su ruta: se proyecta su posición sobre el tramo más cercano entre paradas
function busProgress(list, times, v) {
  const kx = 111320 * Math.cos(v.lat * Math.PI / 180), ky = 110540;
  let best = { d: Infinity, el: 0 };
  for (let j = 0; j < list.length - 1; j++) {
    const a = eStopPt(list[j]), b = eStopPt(list[j + 1]);
    const ax = (a.lon - v.lon) * kx, ay = (a.lat - v.lat) * ky, bx = (b.lon - v.lon) * kx, by = (b.lat - v.lat) * ky;
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, el: times[j] + t * (times[j + 1] - times[j]) };
  }
  return best.d < 700 ? best.el : null;
}
function etaFor(rid, pos, arriveSec) {
  const list = rstops.routes[rid], times = rstops.times[rid];
  const cands = [];
  if (list) for (const v of RT.vehicles()) {
    if (String(v.rid) !== String(rid)) continue;
    const el = busProgress(list, times, v);
    if (el == null) continue;
    const eta = times[pos] - el;
    if (eta >= -20) cands.push({ eta: Math.max(0, eta), est: !!v.est });
  }
  cands.sort((a, b) => a.eta - b.eta);
  return { count: cands.length, next: cands.find((c) => c.eta >= arriveSec - 30) || null };
}
function updateEtas() {
  const tr = state.trip;
  if (!tr) return;
  document.querySelectorAll("#tripSheet .opt").forEach((card) => {
    const it = card._it;
    if (!it) return;
    const legs = effLegs(it), rides = legs.filter((l) => l.t === "ride"), selected = card.classList.contains("sel");
    const rows = selected ? [...card.querySelectorAll(".step[data-ride]")] : [];
    let t0 = 0, prev = null;                              // t0: segundos hasta bajar del tramo anterior
    rides.forEach((r, n) => {
      const o = r.orig || r;
      // cada ruta que sirve el tramo, con el momento en que llegaría a su parada de subida desde donde estarías
      const ranked = (o.alts && o.alts.length ? o.alts : [o]).map((a) => {
        const walk = n === 0 ? PL.walkSec(a.wb || 0) : (prev.to === a.from ? 0 : PL.walkSec(meters(stopPt(prev.to), stopPt(a.from))) + 60);
        const arr = t0 + walk, e = etaFor(a.rid, a.p0, arr);
        return { a, e, live: !!e.next, board: e.next ? e.next.eta : arr + a.wait };
      }).sort((x, y) => (y.live - x.live) || x.board - y.board);
      const seen = new Set(), order = ranked.filter((q) => !seen.has(q.a.code) && seen.add(q.a.code));
      o._order = order.map((q) => ({ rid: q.a.rid, code: q.a.code, sys: q.a.sys, live: q.live, est: !!q.e.next?.est, min: Math.round(q.board / 60), count: q.e.count, from: q.a.from, to: q.a.to, toward: q.a.toward }));
      card.querySelectorAll(`.alts[data-ride="${n}"]`).forEach((box) => fillAlts(box, o, box._max, it, n, box._ia));
      const f = order.find((q) => q.a.code === r.code) || order[0], row = rows.find((x) => Number(x.dataset.ride) === n);
      if (row) {
        const box = row.querySelector(".step-eta"), parts = [];
        if (f.e.next) {
          parts.push(f.board < 60 ? S.etaNow : fmt(S.etaNext, { n: Math.round(f.board / 60) }));
          if (f.e.next.est) parts.push(S.etaEst);
          parts.push(f.e.count === 1 ? S.etaOne : fmt(S.etaMany, { n: f.e.count }));
        } else parts.push(S.etaNone, fmt(S.etaSched, { n: Math.round(f.a.wait / 60) }));
        box.textContent = parts.join(" · ");
        box.classList.toggle("live", !!f.e.next);
      }
      t0 = f.board + f.a.sec;
      prev = r;
    });
    if (selected && state.trip.it === it) syncLive(it);
  });
}
