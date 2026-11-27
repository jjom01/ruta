import { t } from "../i18n.js";
import { apiUrl } from "../net.js";
import { D, propsOfRid, dark, token, onColor } from "../data.js";
import { fetchBuses } from "../rt.js";
import { locate, locateIfAllowed, lastPos } from "../loc.js";
import mapScreen from "./map.js";
import { skel } from "../ui.js";
import { searchPlaces, loadPlaces, isArea } from "../places.js";

const st = { from: null, to: null, el: null, worker: null, id: 1, pending: new Map(), buses: [], names: null };
const $ = (s) => st.el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const pt = (k) => ({ lat: D.rs.stops[k][1], lon: D.rs.stops[k][2] });
const hav = (a, b) => Math.hypot((a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 110540);
const mins = (s) => Math.max(1, Math.round(s / 60));

/* ---------- planificador (worker) ---------- */
function worker() {
  if (!st.worker) {
    st.worker = new Worker("/js/plan-worker.js");
    st.worker.onmessage = (e) => { const p = st.pending.get(e.data.id); if (p) { st.pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.res); } };
  }
  return st.worker;
}
const planAsync = (origins, dests) => new Promise((res, rej) => { const id = st.id++; st.pending.set(id, { res, rej }); worker().postMessage({ id, origins, dests, off: [] }); });

/* ---------- puntos: paraderos por nombre, lugares con el geocodificador ---------- */
function names() {
  if (st.names) return st.names;
  const m = new Map();
  D.rs.stops.forEach((s, k) => { const key = norm(s[0]); const e = m.get(key) || { name: s[0], idxs: [] }; e.idxs.push(k); m.set(key, e); });
  return (st.names = m);
}
let gSeq = 0;
async function geocode(q, mode) {
  const seq = ++gSeq;
  try { const j = await (await fetch(apiUrl(`/api/geocode?q=${encodeURIComponent(q)}&mode=${mode}`))).json(); return seq === gSeq ? (j.results || []).map((x) => ({ label: x.label, sub: x.sub === "Lugar" ? t("pk_place") : x.sub, pts: [{ lat: x.lat, lon: x.lon }] })) : null; } catch { return []; }
}
function localMatches(q, limit = 5) {
  const n = norm(q.trim()); if (n.length < 2) return [];
  const stops = [];
  for (const [k, e] of names()) { if (k.startsWith(n) || (n.length >= 3 && k.includes(n))) stops.push({ label: e.name, sub: t("pk_station"), pts: e.idxs.map(pt), score: k === n ? 300 : k.startsWith(n) ? 55 : 25 }); if (stops.length >= 20) break; }
  // lugares conocidos y paraderos, mezclados por relevancia
  return [...searchPlaces(q, limit), ...stops].sort((x, y) => y.score - x.score).slice(0, limit);
}
const toks = (x) => norm(x).replace(/[^a-z0-9ñ ]+/g, " ").split(" ").filter((w) => w.length > 1);
// ¿el candidato contiene todas las palabras que escribió la persona?
const covers = (q, it) => {
  const hay = norm(`${it.label} ${it.sub || ""}`); let w = toks(q);
  // "mcdonalds fontibon": el barrio o localidad del final es una pista de zona, no parte del nombre
  for (const n of [2, 1]) if (w.length > n && isArea(w.slice(-n).join(" "))) { w = w.slice(0, -n); break; }
  return w.every((x) => hay.includes(x));
};
async function resolve(which) {
  await loadPlaces();
  const inp = $("#" + which), pick = st[which];
  if (pick && pick.label === inp.value) return { pts: pick.pts };
  const q = inp.value.trim();
  if (q && norm(q) === norm(t("myLoc")) && lastPos()) return { pts: [{ lon: lastPos()[0], lat: lastPos()[1] }] };
  if (!q) return which === "from" && lastPos() ? { pts: [{ lon: lastPos()[0], lat: lastPos()[1] }] } : { pts: null };
  const loc = localMatches(q, 3), exact = loc.find((x) => norm(x.label) === norm(q));
  if (exact) return { pts: exact.pts };
  if (loc[0] && loc[0].score >= 60 && covers(q, loc[0])) return { pts: loc[0].pts };
  const g = await geocode(q, "submit");
  const cands = [...(g || []), ...loc];
  const good = cands.find((c) => covers(q, c));
  if (good) return { pts: good.pts };
  // sin coincidencia completa: se ofrece la más cercana para confirmar en vez de elegirla en silencio
  return cands[0] ? { pts: null, guess: cands[0] } : { pts: null };
}

/* ---------- UI ---------- */
function init(el) {
  st.el = el;
  mapScreen.api.ensure();
  el.innerHTML = `
    <div class="toast" id="ptoast" hidden role="status"></div>
    <section class="sheet" id="res" hidden></section>
    <div class="pickpin" aria-hidden="true">${PIN}</div>
    <div class="pickbar"><button type="button" class="pillbtn ghost" id="pcancel" aria-label="${t("close")}">×</button><button type="button" class="pillbtn on" id="pok">${t("usePoint")}</button></div>
    <div class="plan-bottom">
      <div class="sugg" id="psugg"></div>
      <form id="pf" autocomplete="off">
        <div class="prow"><div class="in"><i class="dot o"></i><input id="from" placeholder="${t("from")}" aria-label="${t("from")}" enterkeyhint="next"></div>
          <button type="button" class="go" id="here" data-perm="prompt" aria-label="${t("myLoc")}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path class="slash" d="M4 4l16 16"/></svg><i class="pd"></i></button></div>
        <div class="prow"><div class="in"><i class="dot d"></i><input id="to" placeholder="${t("to")}" aria-label="${t("to")}" enterkeyhint="search"></div>
          <button type="submit" class="go on" id="pgo" aria-label="${t("plan")}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg></button></div>
      </form>
    </div>`;
  for (const w of ["from", "to"]) {
    $("#" + w).addEventListener("input", (e) => { st[w] = null; suggest(w, e.target.value); });
    $("#" + w).addEventListener("focus", (e) => suggest(w, e.target.value));
  }
  const here = $("#here"); let permTimer = 0;
  const say = (m) => { const e = $("#ptoast"); e.textContent = m; e.hidden = false; clearTimeout(permTimer); permTimer = setTimeout(() => (e.hidden = true), 3600); };
  const setPerm = (v) => { here.dataset.perm = v; here.setAttribute("aria-label", v === "denied" ? t("locOff") : v === "prompt" ? t("locAsk") : t("myLoc")); here.title = here.getAttribute("aria-label"); };
  try { navigator.permissions.query({ name: "geolocation" }).then((q) => { setPerm(q.state); q.onchange = () => setPerm(q.state); }); } catch {}
  here.addEventListener("click", async () => {
    if (here.dataset.perm === "denied") return say(t("locOffHelp"));
    const p = await locate();
    if (p) { st.from = { label: t("myLoc"), pts: [{ lon: p[0], lat: p[1] }] }; $("#from").value = t("myLoc"); }
    else if (here.dataset.perm !== "granted") { try { const q = await navigator.permissions.query({ name: "geolocation" }); setPerm(q.state); if (q.state === "denied") say(t("locOffHelp")); } catch { say(t("locOffHelp")); } }
  });
  $("#pf").addEventListener("submit", (e) => { e.preventDefault(); search(); });
  locateIfAllowed().then((p) => { if (p && !$("#from").value) { st.from = { label: t("myLoc"), pts: [{ lon: p[0], lat: p[1] }] }; $("#from").value = t("myLoc"); } });
}
let timer = 0;
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
function suggest(which, v) {
  const box = $("#psugg");
  clearTimeout(timer);
  // lista de sugerencias; al final siempre queda la opción de elegir el punto en el mapa (así nadie se queda sin salida)
  const paint = (items) => {
    box.innerHTML = "";
    for (const it of items) { const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<span class="grow"><span class="title"></span>${it.sub ? '<br><span class="sub"></span>' : ""}</span>`; b.querySelector(".title").textContent = it.label; if (it.sub) b.querySelector(".sub").textContent = it.sub; b.addEventListener("click", () => { st[which] = it; $("#" + which).value = it.label; box.innerHTML = ""; if (which === "from" && !st.to) $("#to").focus(); }); box.append(b); }
    const m = document.createElement("button"); m.type = "button"; m.className = "pickrow"; m.innerHTML = `${PIN}<span class="grow"><span class="title">${esc(t("pickMap"))}</span></span>`;
    m.addEventListener("click", () => pickOnMap(which, items[0])); box.append(m);
  };
  const first = which === "from" && !v.trim() && lastPos() ? [{ label: t("myLoc"), sub: "", pts: [{ lon: lastPos()[0], lat: lastPos()[1] }] }] : [];
  const local = localMatches(v); paint([...first, ...local]);
  loadPlaces().then(() => { if ($("#" + which).value !== v) return; const l2 = localMatches(v); if (l2.length !== local.length || l2[0]?.label !== local[0]?.label) paint([...first, ...l2]); });
  if (v.trim().length >= 3) timer = setTimeout(async () => {
    const g = await geocode(v, "suggest"); if (!g || $("#" + which).value !== v) return;
    const cur = localMatches(v), same = (x) => cur.some((c) => norm(c.label) === norm(x.label));
    paint([...first, ...cur, ...g.filter((x) => !same(x)).slice(0, Math.max(2, 6 - cur.length))]);
  }, 350);
}
function skelRes() {   // mientras se calcula: tarjetas de esqueleto en lugar de un texto
  const r = $("#res"); r.hidden = false; r.classList.remove("rich", "peek", "dragging"); r.style.removeProperty("--drop");
  r.innerHTML = skel.cards(3) + `<span class="sr-only" role="status">${esc(t("planning"))}</span>`;
}
function msg(text, actions) {
  const r = $("#res"); r.hidden = !text; r.classList.remove("rich", "peek", "dragging"); r.style.removeProperty("--drop");
  r.innerHTML = text ? `<div class="empty" style="padding:22px 0;text-align:center">${esc(text)}</div>${actions ? '<div class="acts"></div>' : ""}` : "";
  if (actions) { const box = r.querySelector(".acts"); for (const [label, fn] of actions) { const b = document.createElement("button"); b.type = "button"; b.className = "pillbtn"; b.textContent = label; b.onclick = fn; box.append(b); } }
}

/* ---------- elegir un punto en el mapa (salida segura cuando el lugar no aparece en ninguna fuente) ---------- */
function pickOnMap(which, near) {
  const map = mapScreen.api.map(), el = st.el;
  if (!map) return;   // MapLibre aún se está descargando
  $("#psugg").innerHTML = ""; document.activeElement?.blur();
  el.classList.add("picking");
  const guess = near?.pts?.[0] || (which === "to" && st.from?.pts?.[0]) || null;
  if (near?.pts?.[0]) map.flyTo({ center: [near.pts[0].lon, near.pts[0].lat], zoom: 15.5, duration: 700 });
  const done = (ok) => {
    el.classList.remove("picking");
    $("#pok").onclick = $("#pcancel").onclick = null;
    if (!ok) return;
    const c = map.getCenter(), p = { lat: c.lat, lon: c.lng };
    let nearest = null, bd = 1e9; D.rs.stops.forEach((x) => { const d = hav(p, { lat: x[1], lon: x[2] }); if (d < bd) { bd = d; nearest = x[0]; } });
    const label = t("pinned");
    st[which] = { label, sub: nearest ? t("nearTo", { n: nearest }) : "", pts: [p] };
    $("#" + which).value = label;
    if (which === "from" && !$("#to").value.trim()) $("#to").focus(); else if ($("#to").value.trim() && $("#from").value.trim()) search();
  };
  $("#pok").onclick = () => done(true); $("#pcancel").onclick = () => done(false);
}

let sSeq = 0;
async function search() {
  const mine = ++sSeq;
  clearTimeout(timer); gSeq++;
  if (!$("#to").value.trim()) { $("#to").focus(); return; } // sin destino no hay nada que buscar
  $("#psugg").innerHTML = ""; document.activeElement?.blur();
  mapScreen.api.overlay([], null); // quita el recorrido anterior: no debe quedar dibujado si ahora no hay ruta
  skelRes();
  const rt = await resolve("to"), rf = await resolve("from");
  if (mine !== sSeq) return;
  const ask = (which, r) => {
    const inp = $("#" + which), acts = [];
    if (r.guess) acts.push([t("useThis", { n: r.guess.label }), () => { st[which] = r.guess; inp.value = r.guess.label; search(); }]);
    acts.push([t("pickMap"), () => pickOnMap(which, r.guess)]);
    msg(r.guess ? t("didYouMean", { n: r.guess.label }) : (which === "from" && !inp.value.trim() ? t("pickFrom") : t("placeNotFound")), acts);
  };
  if (!rt.pts) return ask("to", rt);
  if (!rf.pts) return ask("from", rf);
  const dests = rt.pts, origins = rf.pts;
  const gap = Math.min(...origins.flatMap((o) => dests.map((d) => hav(o, d))));
  if (gap < 150) return msg(t("samePlace"));
  let res;
  try { [res, st.buses] = await Promise.all([planAsync(origins, dests), fetchBuses().catch(() => [])]); } catch { res = null; }
  if (mine !== sSeq) return;
  let tooFar = false;
  tooFar = ["direct", "tm", "sitp", "mixed"].some((k) => res?.[k]?.walk > 75 * 60); // más de 75 min a pie no es una ruta útil
  // todas las opciones, de la más rápida a la más lenta, con su tipo y sus transbordos
  const list = (res?.options || []).map((it) => ({
    it, label: t(it.allTm ? "kTm" : it.allSitp ? "kSitp" : "kMixed") + " · " + (it.rides === 1 ? t("kDirect") : it.rides === 2 ? t("xfer1") : t("xferN", { n: it.rides - 1 })),
  }));
  if (!list.length) {
    if (gap < 2200) return msg(t("walkN2", { n: Math.max(1, Math.round(gap * 1.3 / 80)) }));
    const far = (ps) => Math.min(...ps.flatMap((p) => D.rs.stops.map((s) => hav(p, { lat: s[1], lon: s[2] })))) > 6000;
    return msg(tooFar || far(origins) || far(dests) ? t("outOfCover") : t("noRoute"));
  }
  list.sort((a, b) => a.it.total - b.it.total);
  renderResults(...featuredFirst(list));
}

/* ---------- resultados ---------- */
/* Las dos primeras: la mejor solo en TransMilenio y el mejor viaje en un solo bus SITP. Si falta una de las dos clases,
   el puesto lo toma la siguiente de la otra. Devuelve la lista reordenada y cuántas van arriba. */
function featuredFirst(list) {
  const tmOnly = list.filter((x) => x.it.allTm), oneSitp = list.filter((x) => x.it.rides === 1 && x.it.allSitp);
  const top = [tmOnly[0], oneSitp[0]].filter(Boolean);
  for (const x of [...tmOnly, ...oneSitp].sort((a, b) => a.it.total - b.it.total)) if (top.length < 2 && !top.includes(x)) top.push(x);
  top.sort((a, b) => a.it.total - b.it.total);
  return [[...top, ...list.filter((x) => !top.includes(x))], top.length];
}
function etaFirst(leg) {
  const idx = D.rs.routes[leg.rid], tm = D.rs.times[leg.rid]; if (!idx || !tm) return null;
  let best = null;
  for (const v of st.buses) {
    if (String(v.rid) !== String(leg.rid)) continue;
    let bi = -1, bd = 450;
    for (let i = 0; i <= leg.p0; i++) { const d = hav({ lat: v.lat, lon: v.lon }, pt(idx[i])); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) continue;
    const s = tm[leg.p0] - tm[bi]; if (s >= 0 && (best == null || s < best)) best = s;
  }
  return best;
}
const tile = (p, code) => `<span class="tile" style="background:${p.color};color:${onColor(p.color)}">${esc(code)}</span>`;
/* Barra para agarrar la lista: se arrastra hacia abajo para ver el recorrido completo en el mapa y hacia arriba para volver */
function grabber(box) {
  const g = document.createElement("div"); g.className = "grab"; g.setAttribute("role", "button"); g.tabIndex = 0; g.setAttribute("aria-label", t("dragList")); g.innerHTML = "<i></i>";
  box.prepend(g);
  // al plegar, la barra baja hasta quedar a ~6 px de los campos de búsqueda (sin taparlos ni quitarles toques)
  const peekD = () => { const pb = box.parentElement?.querySelector(".plan-bottom"), gap = pb ? pb.offsetTop - (box.offsetTop + box.offsetHeight) : 0; return Math.max(0, box.offsetHeight - 30 + Math.max(0, gap - 6)); };
  const settle = (peek) => {
    box.classList.remove("dragging"); box.classList.toggle("peek", peek); box.style.setProperty("--drop", peek ? peekD() + "px" : "0px");
    g.setAttribute("aria-expanded", String(!peek));
    mapScreen.api.refit?.(peek ? 150 : 360);
  };
  let y0 = 0, base = 0, moved = 0, t0 = 0, drag = false, wasPeek = false;
  g.addEventListener("pointerdown", (e) => { drag = true; moved = 0; y0 = e.clientY; t0 = e.timeStamp; base = box.classList.contains("peek") ? peekD() : 0; g.setPointerCapture(e.pointerId);
    // si estaba plegada, el contenido reaparece de inmediato y sube junto con el dedo
    wasPeek = box.classList.contains("peek"); box.classList.remove("peek"); box.classList.add("dragging"); box.style.setProperty("--drop", base + "px"); });
  g.addEventListener("pointermove", (e) => { if (!drag) return; const dy = e.clientY - y0; moved = Math.max(moved, Math.abs(dy)); box.style.setProperty("--drop", Math.max(0, Math.min(peekD(), base + dy)) + "px"); });
  const end = (e) => { if (!drag) return; drag = false; const dy = e.clientY - y0, v = dy / Math.max(1, e.timeStamp - t0), cur = Math.max(0, Math.min(peekD(), base + dy));
    if (moved < 6) return settle(!wasPeek);            // un toque alterna
    settle(Math.abs(v) > 0.5 ? v > 0 : cur > peekD() * 0.4); };
  g.addEventListener("pointerup", end);
  g.addEventListener("pointercancel", () => { if (!drag) return; drag = false; settle(wasPeek); });   // gesto interrumpido: vuelve a donde estaba
  const onResize = () => { if (!box.isConnected) return removeEventListener("resize", onResize); if (box.classList.contains("peek")) box.style.setProperty("--drop", peekD() + "px"); };
  addEventListener("resize", onResize);
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); settle(!box.classList.contains("peek")); } });
}
function renderResults(list, featured = 0) {
  const box = $("#res"); box.hidden = false; box.innerHTML = ""; box.scrollTop = 0;
  box.classList.remove("peek", "dragging"); box.classList.add("rich"); box.style.removeProperty("--drop");
  grabber(box);
  const body = document.createElement("div"); body.className = "sbody"; box.append(body);
  const cards = [];
  // El desvanecido solo aparece cuando el encabezado del bus está pegado arriba (el contenido empieza a pasar por debajo)
  let raf = 0;
  const mark = () => { raf = 0; const top = body.getBoundingClientRect().top; body.querySelectorAll(".card.open .bushead").forEach((h) => h.classList.toggle("stuck", h.getBoundingClientRect().top <= top + 3)); };
  // el contenedor conserva su borde donde recorta el contenido (arriba si ya se desplazó, abajo si queda más por ver)
  // la tarjeta abierta conserva su borde donde el contenedor la recorta (arriba o abajo)
  const cap = () => { const b = body.getBoundingClientRect(); cards.forEach((c) => { const r = c.getBoundingClientRect(), open = c.classList.contains("open"); c.classList.toggle("cap-t", open && r.top < b.top - 1); c.classList.toggle("cap-b", open && r.bottom > b.bottom + 1); }); };
  const ro = new ResizeObserver(cap);
  body.onscroll = () => { cap(); if (!raf) raf = requestAnimationFrame(mark); };
  const select = (c, it, scroll, open = true) => {
    const was = c.classList.contains("open");
    const tl = c.querySelector(".tl"); if (open && !tl.firstChild) tl.innerHTML = timeline(it);   // el detalle se arma al abrirlo: la lista puede ser larga
    cards.forEach((o) => { const on = o === c && open && !(was && scroll); o.classList.toggle("open", on); o.classList.toggle("sel", o === c); o.querySelector(".top").setAttribute("aria-expanded", on); });
    draw(it);
    if (scroll) setTimeout(() => body.scrollTo({ top: Math.max(0, c.offsetTop - 4), behavior: "smooth" }), 40);
  };
  const heading = (txt) => { const h = document.createElement("h3"); h.className = "rhead"; h.textContent = txt; body.append(h); };
  list.forEach(({ it, label }, n) => {
    if (featured && n === 0) heading(t("optTop"));
    if (n === featured && n < list.length) heading(t(featured ? "optRest" : "optAll", { n: list.length - featured }));
    const c = document.createElement("article"); c.className = "card"; c.style.setProperty("--i", Math.min(n, 6));
    const rides = it.legs.filter((l) => l.t === "ride");
    const badges = rides.map((l) => tile(propsOfRid(l.rid) || { color: "#888" }, l.code)).join('<i class="chev">›</i>');
    const stopsN = rides.reduce((a, l) => a + l.stops, 0);
    c.innerHTML = `<button class="top" aria-expanded="false"><span class="grow"><span class="chips">${badges}</span><span class="sub mono">${esc(label)} · ${t("rideN", { n: stopsN })} · ${t("walkN", { n: mins(it.walk) })}</span></span><span class="total">${mins(it.total)} <small>${t("minShort")}</small></span></button><div class="body"><div class="tl"></div></div>`;
    c.querySelector(".top").addEventListener("click", () => select(c, it, true));
    c.addEventListener("click", (e) => { const r = e.target.closest(".run"); if (r) r.closest(".leg").classList.toggle("open"); });
    body.append(c); cards.push(c); ro.observe(c);
    if (n === 0) requestAnimationFrame(() => select(c, it, false, false));
  });
}
function timeline(it) {
  const L = it.legs, out = [];
  const walk = (m) => `<div class="leg walk"><span class="ico">${PERSON}</span><span>${t("walkN", { n: Math.max(1, Math.round(m * 1.3 / 80)) })}</span></div>`;
  L.forEach((l, i) => {
    if (l.t === "walk") { if (l.m > 15) out.push(walk(l.m)); }
    else if (l.t === "xfer") out.push(walk(l.m));
    else {
      const p = propsOfRid(l.rid) || { color: "#888" }, eta = etaFirst(l), first = !L.slice(0, i).some((x) => x.t === "ride");
      const wait = first ? (eta != null ? t("busIn", { n: mins(eta) }) : t("waitN", { n: Math.round(l.wait / 60) })) : "";
      const nm = (k) => D.rs.stops[k][0], pl = L[i - 1], nx = L[i + 1];
      const prevJoin = pl?.t === "ride" && nm(pl.to) === nm(l.from), nextJoin = nx?.t === "ride" && nm(l.to) === nm(nx.from);
      const pc = prevJoin ? (propsOfRid(pl.rid) || { color: "#888" }).color : "", nc = nextJoin ? (propsOfRid(nx.rid) || { color: "#888" }).color : "";
      const mids = (D.rs.routes[l.rid] || []).slice(l.p0 + 1, l.p1).map((k) => `<div class="mid"><span>${esc(nm(k))}</span></div>`).join("");
      out.push(`<div class="leg ride${prevJoin ? " from-prev" : ""}${nextJoin ? " to-next" : ""}${l.stops <= 4 ? " open" : ""}" style="--c:${p.color};--cp:${pc};--cn:${nc}">
        <div class="bar"><i></i><i class="m"></i><i></i></div>
        <div class="info">
          <div class="bushead">
            <div class="stop"><span class="nm">${tile(p, l.code)}<b>${esc(nm(l.from))}</b></span><button type="button" class="run mono" aria-label="${t("rideN", { n: l.stops })}"><span>${mins(l.sec)} ${t("minShort")}</span><svg class="chv" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button></div>
          </div>
          <div class="subline sub mono">${[wait, t("rideN", { n: l.stops }) + (l.toward != null ? " · " + t("toward") + " " + esc(nm(l.toward)) : "")].filter(Boolean).map((x, i) => i ? x : esc(x)).join(" · ")}</div>
          <div class="mids"><div class="midsin">${mids}</div></div>
          ${nextJoin ? "" : `<div class="stop last"><span class="nm"><b>${esc(nm(l.to))}</b></span></div>`}
        </div></div>`);
    }
  });
  return out.join("");
}
const PERSON = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="1"/><path d="M7 21l3-4"/><path d="M16 21l-2-4-3-3 1-6"/><path d="M6 12l2-3 4-1 3 3 3 1"/></svg>`;

// punto de una línea más cercano a otro (para que los círculos de las paradas queden sobre el recorrido dibujado)
function nearestOn(line, p) {
  const kx = Math.cos(p[1] * Math.PI / 180); let best = p, bd = 1e18;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], dx = (b[0] - a[0]) * kx, dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0, ex = ax + dx * t, ey = ay + dy * t, d = ex * ex + ey * ey;
    if (d < bd) { bd = d; best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  }
  return best;
}
let drawSeq = 0;
function features(it, shapes, walks) {
  const feats = [], fit = [], pairs = [], ll = (p) => [p.lon, p.lat];
  const prevEnd = { c: ll(it.origin) };
  fit.push(ll(it.origin), ll(it.dest));
  // tramo a pie: por las calles si el servidor lo trazó; si no, línea recta
  const walk = (a, b) => { const i = pairs.length; pairs.push([a, b]); const c = walks?.[i]; if (c?.length) c.forEach((x) => fit.push(x)); feats.push({ type: "Feature", properties: { k: "walk" }, geometry: { type: "LineString", coordinates: c?.length ? c : [a, b] } }); };
  let n = 0;
  it.legs.forEach((l) => {
    if (l.t !== "ride") return;
    const idx = D.rs.routes[l.rid], p = propsOfRid(l.rid) || { color: "#888" };
    // recorrido por las calles si el servidor lo tiene; si no, línea entre paraderos
    const coords = shapes?.[n++] || idx.slice(l.p0, l.p1 + 1).map((k) => ll(pt(k)));
    feats.push({ type: "Feature", properties: { k: "ride", color: p.color }, geometry: { type: "LineString", coordinates: coords } });
    // círculos en cada parada del tramo (subida y bajada más grandes)
    idx.slice(l.p0, l.p1 + 1).forEach((k, q, arr) => feats.push({ type: "Feature", properties: { k: "stop", color: p.color, big: q === 0 || q === arr.length - 1 ? 1 : 0 }, geometry: { type: "Point", coordinates: nearestOn(coords, ll(pt(k))) } }));
    walk(prevEnd.c, coords[0]);
    prevEnd.c = coords[coords.length - 1]; coords.forEach((c) => fit.push(c));
  });
  walk(prevEnd.c, ll(it.dest));
  feats.push({ type: "Feature", properties: { k: "pt", color: token("fg") }, geometry: { type: "Point", coordinates: ll(it.origin) } });
  feats.push({ type: "Feature", properties: { k: "pt", color: token("accent") }, geometry: { type: "Point", coordinates: ll(it.dest) } });
  return { feats, fit, pairs };
}
function draw(it) {
  const mine = ++drawSeq, api = mapScreen.api; api.dim(true);
  const base = features(it); api.overlay(base.feats, base.fit);
  const m = api.map(); ["plan-walk", "plan-ride", "plan-glow-w", "plan-glow", "plan-stop", "plan-pt"].forEach((x) => m.getLayer(x) && m.setLayoutProperty(x, "visibility", "visible"));
  const rides = it.legs.filter((l) => l.t === "ride");
  const get = (q) => fetch(apiUrl("/api/shape?" + q)).then((r) => r.json());
  // 1) recorrido de cada bus por las calles; 2) caminatas por las calles entre los puntos resultantes
  get("legs=" + rides.map((l) => `${l.rid}:${l.p0}:${l.p1}`).join(",")).then(async (j) => {
    if (mine !== drawSeq) return;
    const shapes = j.shapes || [], f1 = features(it, shapes.some(Boolean) ? shapes : null);
    if (shapes.some(Boolean)) { api.overlay(f1.feats, null); api.planFit?.(f1.fit); }
    const pairs = f1.pairs.map(([a, b]) => `${a[1].toFixed(5)},${a[0].toFixed(5)},${b[1].toFixed(5)},${b[0].toFixed(5)}`).join(";");
    const w = await get("walks=" + pairs); if (mine !== drawSeq || !w.walks?.some(Boolean)) return;
    const f2 = features(it, shapes.some(Boolean) ? shapes : null, w.walks); api.overlay(f2.feats, null); api.planFit?.(f2.fit);
  }).catch(() => {});
}
let backToSitp = false;
export default {
  init,
  show() { mapScreen.api.reset?.(); mapScreen.api.glow?.(); backToSitp = mapScreen.api.mode?.() === "sitp"; mapScreen.api.setMode?.("map"); document.body.classList.add("on-plan"); mapScreen.api.map()?.resize(); mapScreen.api.dim(true); const m = mapScreen.api.map(); if (m) ["plan-walk", "plan-ride", "plan-glow-w", "plan-glow", "plan-stop", "plan-pt"].forEach((x) => m.getLayer(x) && m.setLayoutProperty(x, "visibility", "visible")); },
  hide() { document.body.classList.remove("on-plan"); mapScreen.api.dim(false); if (backToSitp) mapScreen.api.setMode("sitp"); },
};
