/* Pantalla de inicio: paraderos cercanos, recorte del mapa en tu posición, Viajar y Recargar tarjeta.
   Usa los datos globales de app.js (rstops, ridx, colors, S, state, map, badge, STYLES…). */
let homeMap, homeUser = null, homeMarker, homeFeatures = [], servingMap, namesMap;
const BOGOTA_C = { lat: 4.6097, lon: -74.0817 };
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const meters = (a, b) => {
  const p = Math.PI / 180, x = Math.sin(((b.lat - a.lat) * p) / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
};
const fmtM = (m) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
const stopPt = (k) => ({ lat: rstops.stops[k][1], lon: rstops.stops[k][2] });
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text ?? "" });

function serving(k) {
  if (!servingMap) {
    servingMap = new Map();
    Object.entries(rstops.routes).forEach(([rid, list]) => list.forEach((s) => { if (!servingMap.has(s)) servingMap.set(s, []); servingMap.get(s).push(rid); }));
  }
  return servingMap.get(k) || [];
}
function nearest(test, n, max = Infinity) {
  const out = [];
  rstops.stops.forEach((s, k) => {
    if (!test(s[3])) return;
    const d = meters(homeUser, { lat: s[1], lon: s[2] });
    if (d <= max) out.push([d, k]);
  });
  return out.sort((a, b) => a[0] - b[0]).slice(0, n);
}

/* ---------- filas ---------- */
function stopRow(k, d, kind) {
  const b = el("button", "stop");
  b.type = "button";
  const main = el("div", "stop-main");
  main.append(el("div", "stop-name", rstops.stops[k][0]));
  const tags = el("div", "tags");
  const rids = serving(k);
  if (kind === "tm") {
    const letters = [...new Set(rids.map((r) => ridx[r]).filter((i) => i && ["troncal", "dual", "transmicable"].includes(i.s)).map((i) => (i.s === "transmicable" ? "T" : i.c[0])).filter((l) => colors.routes[l]))].sort();
    letters.slice(0, 8).forEach((l) => tags.append(badge(l, l, "troncal")));
  } else {
    const codes = [...new Set(rids.map((r) => ridx[r]?.c).filter(Boolean))].sort();
    codes.slice(0, 3).forEach((c) => tags.append(badge(c, zl(c), "zonal")));
    if (codes.length > 3) tags.append(el("span", "more", `+${codes.length - 3}`));
    if (rstops.stops[k][3] & 4) tags.append(el("span", "more", S.feeder));
  }
  if (tags.children.length) main.append(tags);
  b.append(main, el("div", "stop-d", d == null ? "" : fmtM(d)));
  b.onclick = () => { hideHome(); const p = stopPt(k); map.jumpTo({ center: [p.lon, p.lat], zoom: 16 }); };
  return b;
}

function stationRow(f, d) {
  const b = el("button", "stop");
  b.type = "button";
  const main = el("div", "stop-main");
  main.append(el("div", "stop-name", f.properties.name));
  const ids = typeof f.properties.routes === "string" ? JSON.parse(f.properties.routes) : f.properties.routes;
  const letters = [...new Set(ids.map((id) => routeById(id)?.letter).filter(Boolean))].sort();
  const tags = el("div", "tags");
  letters.forEach((l) => tags.append(badge(l, l, "troncal")));
  if (tags.children.length) main.append(tags);
  b.append(main, el("div", "stop-d", fmtM(d)));
  b.onclick = () => { hideHome(); map.jumpTo({ center: f.geometry.coordinates, zoom: 16 }); };
  return b;
}

/* ---------- inicio ---------- */
function renderHome() {
  $("hParaderos").textContent = S.hParaderos;
  $("hViajar").textContent = S.hViajar;
  const MAAS = '<img src="assets/maas-logo.svg" alt="Máas" height="20">';
  $("topup").innerHTML = MAAS;
  $("topup").setAttribute("aria-label", `${S.topupAria} (${S.tripOpens})`);
  $("nfcMaas").innerHTML = MAAS + '<span>' + S.nfcOpenMaas + '</span>';
  $("balanceBtn").innerHTML = '<svg viewBox="0 0 28 24" width="24" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="6" width="16" height="12" rx="2.5"/><path d="M1.5 10h16M5 14.5h3"/><path d="M21 9.5a4 4 0 0 1 0 5M24 7.5a7 7 0 0 1 0 9"/></svg>';
  $("balanceBtn").setAttribute("aria-label", S.nfcTitle);
  if (!$("balanceBtn").dataset.on) { $("balanceBtn").dataset.on = "1"; initNfc(); }
  $("tripFrom").placeholder = S.myLoc;
  $("tripTo").placeholder = S.tripTo;
  $("tripFrom").setAttribute("aria-label", S.tripFrom);
  $("tripTo").setAttribute("aria-label", S.tripTo);
  $("tripGo").setAttribute("aria-label", S.hViajar);
  $("homeMap").setAttribute("aria-label", S.mapAria);

  const tm = $("homeTm"), sitp = $("homeSitp");
  tm.replaceChildren(); sitp.replaceChildren();
  homeFeatures = [];
  if (!homeUser) {
    sitp.append(Object.assign(el("div", "home-note"), {}));
    const b = el("button", "", S.allowLocation);
    b.type = "button"; b.onclick = homeLocate;
    sitp.firstChild.append(b);
  } else {
    const st = stops.features
      .map((f) => ({ f, d: meters(homeUser, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }) }))
      .sort((a, b) => a.d - b.d)[0];
    if (st) { const card = el("div", "card"); card.append(stationRow(st.f, st.d)); tm.append(card); homeFeatures.push({ lat: st.f.geometry.coordinates[1], lon: st.f.geometry.coordinates[0] }); }
    let five = nearest((f) => f & 2 && !(f & 1), 5);
    const fd = nearest((f) => f & 4 && !(f & 1), 1, 800)[0];
    if (fd && !five.some(([, k]) => rstops.stops[k][3] & 4) && !five.some(([, k]) => k === fd[1])) five = [...five.slice(0, 4), fd].sort((a, b) => a[0] - b[0]);
    five.forEach(([d, k]) => { sitp.append(stopRow(k, d, "sitp")); homeFeatures.push(stopPt(k)); });
    if (!five.length) sitp.hidden = true; else sitp.hidden = false;
  }
  homeMapUpdate();
}

function addHomeLayers() {
  if (!homeMap.getSource("hs")) homeMap.addSource("hs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const fg = dark() ? "#F2F2EE" : "#111111", bg = dark() ? "#1A1A1A" : "#FFFFFF";
  if (!homeMap.hasImage("ruta-station")) homeMap.addImage("ruta-station", stationIcon(fg, bg), { pixelRatio: 2 });
  if (!homeMap.getLayer("hs")) homeMap.addLayer({ id: "hs", type: "symbol", source: "hs", layout: { "icon-image": "ruta-station", "icon-size": 1.1, "icon-allow-overlap": true } });
  setHomeData();
}
function setHomeData() {
  if (!homeMap?.getSource("hs")) return;
  homeMap.getSource("hs").setData({ type: "FeatureCollection", features: homeFeatures.map((p) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });
}
function homeMapUpdate() {
  const c = homeUser || BOGOTA_C, zoom = homeUser ? 15.4 : 11.2;
  if (!homeMap) {
    homeMap = new window.maplibregl.Map({ container: "homeMapEl", style: STYLES[theme()], center: [c.lon, c.lat], zoom, interactive: false, attributionControl: { compact: true } });
    homeMap.on("style.load", addHomeLayers);
    homeMap.once("load", () => document.querySelector("#homeMapEl .maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => homeMap.setStyle(STYLES[theme()], { diff: false }));
  } else {
    homeMap.jumpTo({ center: [c.lon, c.lat], zoom });
    setHomeData();
  }
  homeMarker?.remove();
  if (homeUser) {
    const d = document.createElement("div");
    d.style.cssText = "width:14px;height:14px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 45%,transparent)";
    homeMarker = new window.maplibregl.Marker({ element: d }).setLngLat([c.lon, c.lat]).addTo(homeMap);
  }
}

function showHome() {
  closeTrip();
  state.home = true;
  $("home").hidden = false;
  renderHome();
  setTimeout(() => homeMap?.resize(), 60);
}
function hideHome() {
  state.home = false;
  $("home").hidden = true;
  map.resize();
}
function homeLocate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => { homeUser = { lat: p.coords.latitude, lon: p.coords.longitude }; renderHome(); },
    () => {},
    { timeout: 8000, maximumAge: 60000 }
  );
}

/* ---------- viajar: rutas directas entre dos paradas ---------- */
const tripPick = { from: null, to: null };
let suggTimer, suggSeq = 0;
function buildNames() {
  if (namesMap) return;
  namesMap = new Map();
  rstops.stops.forEach((s, k) => {
    const n = norm(s[0]);
    if (!namesMap.has(n)) namesMap.set(n, { name: s[0], idxs: [] });
    namesMap.get(n).idxs.push(k);
  });
}
function localMatches(q) {
  const m = [];
  for (const [n, v] of namesMap) {
    const i = n.indexOf(q);
    if (i < 0) continue;
    m.push([i === 0 ? 0 : 1, homeUser ? Math.min(...v.idxs.map((k) => meters(homeUser, stopPt(k)))) : n.length, v]);
  }
  return m.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 3).map(([, , v]) => ({ label: v.name, sub: S.stopKind, pts: v.idxs.map(stopPt), kind: "stop" }));
}
async function remoteMatches(text, mode = "suggest") {
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(text)}&mode=${mode}`);
    if (!r.ok) return [];
    return (await r.json()).results.map((x) => ({ label: x.label, sub: x.sub, pts: [{ lat: x.lat, lon: x.lon }], kind: x.kind }));
  } catch { return []; }
}
function drawSugg(input, side, items) {
  const out = $("tripOut");
  out.replaceChildren();
  if (!items.length) return;
  const box = el("div", "sugg");
  items.slice(0, 6).forEach((it) => {
    const b = el("button", "stop");
    b.type = "button";
    const main = el("div", "stop-main");
    main.append(el("div", "stop-name", it.label));
    if (it.sub) main.append(el("div", "step-sub", it.sub));
    b.append(main);
    b.onclick = () => { input.value = it.label; tripPick[side] = it.pts; out.replaceChildren(); (side === "from" ? $("tripTo") : input).focus(); };
    box.append(b);
  });
  out.append(box);
}
function suggest(input, side) {
  buildNames();
  tripPick[side] = null;
  const text = input.value.trim(), q = norm(text), seq = ++suggSeq;
  clearTimeout(suggTimer);
  if (q.length < 2) { $("tripOut").replaceChildren(); return; }
  const local = localMatches(q);
  drawSugg(input, side, local);
  if (text.length < 3) return;
  suggTimer = setTimeout(async () => {
    const remote = await remoteMatches(text);
    if (seq !== suggSeq) return;
    drawSugg(input, side, [...remote, ...local]);
  }, 400);
}
function openRouteOnMap(code, rid) {
  const s = ridx[rid]?.s;
  state.system = s === "troncal" || s === "transmicable" ? "tm" : s === "dual" ? "mixto" : "sitp";
  state.letter = null;
  hideHome();
  const inp = document.querySelector(".search input");
  inp.value = code;
  inp.dispatchEvent(new Event("input"));
  renderFilters();
}
const fmt = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const mins = (sec) => Math.max(1, Math.round(sec / 60));
const WALK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0"/><path d="M7 21l3-4"/><path d="M16 21l-2-4l-3-3l1-6"/><path d="M6 12l2-3l4-1l3 3l3 1"/></svg>';
const sname = (k) => rstops.stops[k][0];
/* Color de un bus SITP en un viaje: el del corredor de TransMilenio hacia donde va el bus (su terminal).
   Se mide desde el centro de Bogotá hasta la terminal; si ésta queda cerca del centro, se usa el rumbo desde la parada de subida. */
const CENTER = { lat: 4.598, lon: -74.078 };
const bearing = (a, b) => {
  const p = Math.PI / 180, y = Math.sin((b.lon - a.lon) * p) * Math.cos(b.lat * p), x = Math.cos(a.lat * p) * Math.sin(b.lat * p) - Math.sin(a.lat * p) * Math.cos(b.lat * p) * Math.cos((b.lon - a.lon) * p);
  return (Math.atan2(y, x) / p + 360) % 360;
};
// rumbo (°) → corredor: Norte (verde), NE/E (turquesa), Sur (naranja), Suroccidente (azul), Occidente (rojo), Calle 26 (beige), Calle 80 (morado)
const DIR_SECTORS = [[0, 35, "B"], [35, 150, "M"], [150, 225, "H"], [225, 275, "G"], [275, 305, "F"], [305, 335, "K"], [335, 350, "D"], [350, 360.1, "B"]];
function dirLetter(from, to) {
  const a = stopPt(from), b = stopPt(to);
  const br = meters(CENTER, b) > 3000 ? bearing(CENTER, b) : bearing(a, b);
  return DIR_SECTORS.find(([lo, hi]) => br >= lo && br < hi)[2];
}
// la dirección es hacia donde va el bus (su terminal final), no dónde se baja el usuario
const sitpLetter = (l) => (l.toward != null && l.from != null ? dirLetter(l.from, l.toward) : zl(l.code));
const routeBadge = (l) => {
  const tmish = ["troncal", "dual", "transmicable"].includes(l.sys), letter = l.sys === "transmicable" ? "T" : l.code[0];
  return badge(l.code, tmish && colors.routes[letter] ? letter : sitpLetter(l), ["troncal", "dual", "transmicable"].includes(l.sys) ? "troncal" : "zonal");
};
/* Pastilla con todas las rutas que sirven un mismo tramo, ordenadas por el bus que llega antes a la parada de subida. */
function altItems(l) {
  if (l._order) return l._order;
  const seen = new Set();
  return (l.alts && l.alts.length ? l.alts : [l]).filter((a) => !seen.has(a.code) && seen.add(a.code));
}
/* it.sel[n] = código del bus que el usuario eligió para el n-ésimo tramo en bus (si no eligió, se sigue la ruta del planificador). */
const selCode = (it, n, o) => (it && it.sel && it.sel[n]) || o.code;
function fillAlts(box, o, max, it, n, interactive) {
  const full = altItems(o), cur = selCode(it, n, o);
  const all = full.slice(0, 4);                                   // solo los 4 primeros buses en pasar
  if (!all.some((a) => a.code === cur)) { const s = full.find((a) => a.code === cur); if (s) all.push(s); }   // el elegido siempre se ve
  let items = all;
  if (max && all.length > max) {
    items = all.slice(0, max);
    if (!items.some((a) => a.code === cur)) items[max - 1] = all.find((a) => a.code === cur);
  }
  box.replaceChildren(...items.map((a, k) => {
    const s = el(interactive ? "button" : "span", "alt" + (k === 0 ? " first" : "") + (a.live ? " live" : "") + (a.code === cur ? " sel" : ""));
    if (interactive) { s.type = "button"; s.setAttribute("aria-pressed", String(a.code === cur)); s.onclick = () => selectAlt(it, n, a.code); }
    s.append(routeBadge(a));
    if (a.min != null) s.append(el("small", "", a.live ? (a.min < 1 ? S.altNow : `${a.min} min`) : `~${a.min} min`));
    return s;
  }));
  if (max && all.length > max) box.append(el("span", "alt more", `+${all.length - max}`));
  box.classList.toggle("multi", all.length > 1);
}
const altsBox = (o, n, max, it, interactive) => { const b = el("span", "alts"); b.dataset.ride = n; b._o = o; b._it = it; b._max = max; b._ia = !!interactive; fillAlts(b, o, max, it, n, interactive); return b; };

/* Tramos efectivos del viaje: los del planificador, cambiando cada tramo por el bus que el usuario escogió (con su parada de subida y de bajada). */
function effLegs(it) {
  const rides = it.legs.filter((l) => l.t === "ride");
  if (!it.sel || !Object.keys(it.sel).length) return it.legs;
  const R = rides.map((l, n) => {
    const c = it.sel[n];
    if (!c || c === l.code) return l;
    const a = (l.alts || []).filter((x) => x.code === c).sort((x, y) => x.cost - y.cost)[0];
    return a ? { ...l, rid: a.rid, code: a.code, sys: a.sys, from: a.from, to: a.to, p0: a.p0, p1: a.p1, stops: a.stops, sec: a.sec, wait: a.wait, toward: a.toward, orig: l } : l;
  });
  const out = [{ t: "walk", m: meters(it.origin, stopPt(R[0].from)), to: R[0].from }];
  R.forEach((r, n) => {
    if (n && R[n - 1].to !== r.from) out.push({ t: "xfer", m: meters(stopPt(R[n - 1].to), stopPt(r.from)), from: R[n - 1].to, to: r.from });
    out.push(r);
  });
  out.push({ t: "walk", m: meters(stopPt(R[R.length - 1].to), it.dest), dest: true });
  return out;
}
function effTotals(legs) {
  let walk = 0, ride = 0, wait = 0;
  legs.forEach((l) => { if (l.t === "ride") { ride += l.sec; wait += l.wait; } else walk += PL.walkSec(l.m) + (l.t === "xfer" ? 60 : 0); });
  return { walk, total: walk + ride + wait };
}
const routeBar = (l) => {
  const b = document.createElement("span");
  b.className = "bar";
  const tmish = ["troncal", "dual", "transmicable"].includes(l.sys), letter = l.sys === "transmicable" ? "T" : l.code[0];
  b.style.background = routeColor(tmish && colors.routes[letter] ? letter : sitpLetter(l));
  return b;
};
function step(icon, text, sub) {
  const r = el("div", "step"), i = el("div", "step-i"), t = el("div", "step-t");
  if (typeof icon === "string") i.innerHTML = icon; else i.append(icon);
  if (typeof text === "string") t.append(el("div", "", text)); else t.append(text);
  if (sub) t.append(el("div", "step-sub", sub));
  r.append(i, t);
  return r;
}
function steps(it) {
  const box = el("div", "opt-steps");
  const legs = effLegs(it);
  let rn = -1;
  legs.forEach((l, i) => {
    if (l.t === "walk" && !l.dest) box.append(step(WALK_SVG, fmt(S.walkTo, { n: mins(PL.walkSec(l.m)), x: sname(l.to) }), fmtM(l.m)));
    else if (l.t === "walk") box.append(step(WALK_SVG, fmt(S.walkDest, { n: mins(PL.walkSec(l.m)) }), fmtM(l.m)));
    else if (l.t === "xfer") box.append(step(WALK_SVG, fmt(S.xferWalk, { n: mins(PL.walkSec(l.m) + 60), x: sname(l.to) }), fmtM(l.m)));
    else {
      const prev = legs[i - 1];
      if (prev && prev.t === "ride") box.append(step('<span class="dot"></span>', fmt(S.xferAt, { x: sname(prev.to) })));
      rn++;
      const line = el("div", "");
      line.append(`${S.board} `, altsBox(l.orig || l, rn, 0, it, true), ` ${S.toward} ${sname(l.toward)}`);
      const row = step(routeBar(l), line, `${l.stops} ${S.stopsN} · ${mins(l.sec)} min`);
      row.dataset.ride = rn;
      row.querySelector(".step-t").append(el("div", "step-eta"));
      box.append(row);
      box.append(step('<span class="dot"></span>', fmt(S.alight, { x: sname(l.to) })));
    }
  });
  return box;
}
function fillChain(chain, it) {
  chain.replaceChildren();
  let ri = 0;
  it.legs.forEach((l) => { if (l.t !== "ride") return; if (ri) chain.append(el("span", "more", "›")); chain.append(altsBox(l, ri++, 2, it, false)); });
}
function itinCard(kind, it, open, onPick) {
  const card = el("div", "opt");
  card._it = it;
  if (it) it.kind = kind;
  const head = el("button", "opt-head");
  head.type = "button";
  const top = el("div", "opt-top");
  top.append(el("div", "eyebrow", S["opt_" + kind]), el("div", "opt-total", it ? `${mins(it.total)} min` : ""));
  head.append(top);
  if (!it) { head.append(el("div", "opt-none", S.noOption)); card.append(head); head.disabled = false; head.onclick = onPick ? () => onPick(card, null) : null; return card; }
  const row = el("div", "opt-row"), chain = el("div", "tags");
  fillChain(chain, it);
  row.append(chain, el("div", "opt-walk", fmt(S.totalWalk, { n: mins(it.walk) })));
  head.append(row);
  const body = steps(it);
  body.hidden = !open;
  head.setAttribute("aria-expanded", String(open));
  head.onclick = onPick ? () => onPick(card, it) : () => { body.hidden = !body.hidden; head.setAttribute("aria-expanded", String(!body.hidden)); };
  card.append(head, body);
  return card;
}
/* Vuelve a dibujar una tarjeta después de que el usuario escoge otro bus: tiempo total, caminata y lista de pasos. */
function refreshCard(card) {
  const it = card._it;
  if (!it) return;
  const t = effTotals(effLegs(it));
  card.querySelector(".opt-total").textContent = `${mins(t.total)} min`;
  card.querySelector(".opt-walk").textContent = fmt(S.totalWalk, { n: mins(t.walk) });
  fillChain(card.querySelector(".opt-head .tags"), it);
  const old = card.querySelector(".opt-steps"), body = steps(it);
  body.hidden = old.hidden;
  old.replaceWith(body);
}
async function resolvePoint(id, side) {
  if (tripPick[side]) return tripPick[side];
  const text = $(id).value.trim();
  if (!text) return side === "from" && homeUser ? [homeUser] : null;
  buildNames();
  const stop = namesMap.get(norm(text));
  if (stop) return stop.idxs.map(stopPt);
  const r = await remoteMatches(text, "submit");
  return r.length ? r[0].pts : null;
}
async function tripSearch(e) {
  e.preventDefault();
  const out = $("tripOut");
  out.replaceChildren();
  const go = $("tripGo");
  go.disabled = true;
  try {
    const dests = await resolvePoint("tripTo", "to");
    if (!dests) { out.append(el("div", "none", $("tripTo").value.trim() ? S.notFound : "")); $("tripTo").focus(); return; }
    const origins = await resolvePoint("tripFrom", "from");
    if (!origins) { out.append(el("div", "none", $("tripFrom").value.trim() ? S.notFound : S.needFrom)); $("tripFrom").focus(); return; }
    if (Math.min(...origins.flatMap((o) => dests.map((d) => meters(o, d)))) < 150) { out.append(el("div", "none", S.sameSpot)); return; }
    const res = await PL.planAsync(origins, dests, typeof inactiveRids === "function" ? inactiveRids() : []);
    if (!res.direct && !res.tm && !res.sitp && !res.mixed && !res.extras?.length) { out.append(el("div", "none", S.noReach)); return; }
    openTrip(res, origins[0], dests[0], { from: $("tripFrom").value.trim() || S.myLoc, to: $("tripTo").value.trim() });
  } finally { go.disabled = false; }
}

function initHome() {
  PL.warm(); if (typeof loadShapes === "function") setTimeout(loadShapes, 1500);
  $("homeBtn").onclick = showHome;
  $("tripSheet").querySelector(".x").onclick = closeTrip;
  $("homeMap").onclick = () => { hideHome(); if (homeUser) map.jumpTo({ center: [homeUser.lon, homeUser.lat], zoom: 15.5 }); };
  $("homeMap").onkeydown = (e) => { if (e.key === "Enter") $("homeMap").click(); };
  $("trip").onsubmit = tripSearch;
  $("tripFrom").oninput = (e) => suggest(e.target, "from");
  $("tripTo").oninput = (e) => suggest(e.target, "to");
  $("homeBtn").setAttribute("aria-label", S.home);
  navigator.permissions?.query({ name: "geolocation" }).then((st) => {
    if (st.state === "granted") homeLocate();
    st.onchange = () => { if (st.state === "granted") homeLocate(); };
  }).catch(() => {});
  showHome();
}


/* ---------- saldo de la tarjeta (NFC) ---------- */
function initNfc() {
  const sheet = $("nfcSheet"), title = $("nfcTitle"), msg = $("nfcMsg"), maas = $("nfcMaas");
  let ctrl = null;
  const show = (t, m, link) => { title.textContent = t; msg.textContent = m; maas.hidden = !link; sheet.dataset.state = link ? "done" : "wait"; };
  const close = () => { if (ctrl) { ctrl.abort(); ctrl = null; } sheet.hidden = true; $("balanceBtn").focus(); };
  async function start() {
    sheet.hidden = false;
    $("nfcX").focus();
    if (!("NDEFReader" in window)) { sheet.dataset.state = "off"; return show(S.nfcNo, S.nfcNoMsg, true); }
    show(S.nfcTitle, S.nfcAsk, false);
    ctrl = new AbortController();
    try {
      const r = new NDEFReader();
      await r.scan({ signal: ctrl.signal });
      title.textContent = S.nfcWait;
      r.onreading = () => { show(S.nfcFound, S.nfcFoundMsg, true); ctrl && ctrl.abort(); ctrl = null; };
      r.onreadingerror = () => { show(S.nfcFail, S.nfcFailMsg, true); };
    } catch (err) {
      ctrl = null;
      if (err && err.name === "NotAllowedError") show(S.nfcOff, S.nfcOffMsg, false);
      else show(S.nfcNo, S.nfcNoMsg, true);
      if (err && err.name === "NotAllowedError") sheet.dataset.state = "off";
    }
  }
  $("balanceBtn").addEventListener("click", start);
  $("nfcX").addEventListener("click", close);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) close(); });
}
