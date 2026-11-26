import { t } from "../i18n.js";
import { D, propsOfRid, onColor, hoursOf } from "../data.js";
import { HEART, isFav, toggleFav, glassSeg } from "../ui.js";
import { locate, locateIfAllowed } from "../loc.js";
import { openRoute, openStop } from "../detail.js";

const st = { tab: "routes", group: "tm", q: "", pos: null };
let el, rev = null;
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const meters = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
const inGroup = (p) => st.group === "fav" ? isFav(p.code) : st.group === "tm" ? p.group === "tm" || p.group === "mixto" : p.group === st.group;

function build() {
  const byCode = new Map(), stopRids = new Map();
  for (const [rid, idxs] of Object.entries(D.rs.routes)) {
    const p = propsOfRid(rid); if (!p) continue;
    const c = byCode.get(p.code) || { p, code: p.code, rids: [] }; c.rids.push(rid); byCode.set(p.code, c);
    for (const i of idxs) { const s = stopRids.get(i) || new Set(); s.add(p.code); stopRids.set(i, s); }
  }
  rev = { byCode, stopRids };
}
function routeCards() {
  const q = norm(st.q);
  return [...rev.byCode.values()].filter((c) => inGroup(c.p) && (!q || norm(c.code).includes(q) || c.rids.some((r) => norm(D.ridx[r].n).includes(q))))
    .sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
}
function stopCards() {
  const q = norm(st.q), seen = new Map();
  rev.stopRids.forEach((codes, i) => {
    const s = D.rs.stops[i];
    const ps = [...codes].map((c) => rev.byCode.get(c).p);
    if (!ps.some(inGroup)) return;
    if (q && !norm(s[0]).includes(q)) return;
    const k = norm(s[0]); const e = seen.get(k) || { name: s[0], lat: s[1], lon: s[2], codes: new Set() };
    codes.forEach((c) => e.codes.add(c)); seen.set(k, e);
  });
  const arr = [...seen.values()];
  if (st.pos) arr.forEach((e) => (e.d = meters(st.pos, [e.lon, e.lat])));
  return arr.sort((a, b) => st.pos ? a.d - b.d : a.name.localeCompare(b.name, "es"));
}
function heartBtn(code) {
  const b = document.createElement("button");
  b.className = "heart"; b.type = "button"; b.setAttribute("aria-label", t("fav") + " " + code); b.setAttribute("aria-pressed", String(isFav(code))); b.innerHTML = HEART;
  b.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    b.setAttribute("aria-pressed", String(toggleFav(code)));
    if (st.group === "fav") { nextStop(); setTimeout(paint, 250); }
  });
  return b;
}
function routeRow(c) {
  const rid = c.rids.slice().sort((a, b) => (D.rs.routes[b]?.length || 0) - (D.rs.routes[a]?.length || 0))[0];
  const idx = D.rs.routes[rid] || [], tm = D.rs.times[rid];
  const mins = tm ? Math.round((tm[tm.length - 1] - tm[0]) / 60) : null;
  const hr = hoursOf(c.code), d = document.createElement("details");
  d.className = "item"; d.style.setProperty("--c", c.p.color);
  d.innerHTML = `<summary><span class="tile vt-tile" style="background:${c.p.color};color:${onColor(c.p.color)}">${esc(c.code.slice(0, 4))}</span><span class="grow"><div class="title">${esc(D.ridx[rid].n || c.code)}</div><div class="sub mono">${t("stopsN", { n: idx.length })}${mins ? " · " + mins + " min" : ""}</div>${hr ? `<div class="sub mono hrs${hr[0] ? "" : " off"}">${hr[0] ? `${hr[0]} – ${hr[1]}${hr[2] === "f" ? ` · ${t("holiday")}` : ""}` : t("notToday")}</div>` : ""}</span></summary><ul class="stops"></ul>`;
  d.querySelector("summary").append(heartBtn(c.code));
  d.querySelector("summary").addEventListener("click", (e) => { if (e.target.closest(".heart")) return; e.preventDefault(); openRoute(c.code, rid, d.querySelector("summary")); });
  d.addEventListener("toggle", () => { if (d.open && !d.querySelector("li")) d.querySelector("ul").innerHTML = idx.map((i, k) => `<li><span>${esc(D.rs.stops[i][0])}</span>${tm ? `<span class="sub mono">${Math.round((tm[k] - tm[0]) / 60)}′</span>` : ""}</li>`).join(""); });
  return d;
}
function stopRow(e) {
  const d = document.createElement("div");
  d.className = "item";
  d.addEventListener("click", () => openStop(e.name, d)); d.style.cursor = "pointer";
  const all = [...e.codes].sort((a, b) => a.localeCompare(b, "es", { numeric: true })), codes = all.slice(0, 4), more = all.length - codes.length;
  d.innerHTML = `<div class="head"><div class="grow"><div class="title vt-title">${esc(e.name)}</div><div class="sub mono">${e.d != null ? (e.d < 1000 ? Math.round(e.d) + " m" : (e.d / 1000).toFixed(1) + " km") : t("routesN", { n: e.codes.size })}</div></div><span style="display:flex;gap:4px">${codes.map((c) => `<span class="tile" style="min-width:0;height:24px;font-size:var(--fs-xs);padding:0 9px;border-radius:999px;background:${rev.byCode.get(c).p.color};color:${onColor(rev.byCode.get(c).p.color)}">${esc(c)}</span>`).join("")}${more > 0 ? `<span class="tile more" style="min-width:0;height:24px;font-size:var(--fs-xs);padding:0 9px;border-radius:999px;background:color-mix(in srgb, var(--fg) 12%, transparent);color:var(--fg)">+${more}</span>` : ""}</span></div>`;
  return d;
}
function paint() {
  const list = st.tab === "routes" ? routeCards() : stopCards();
  const box = el.querySelector("#rl");
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = `<div class="empty">${st.group === "fav" ? t("noFavs") : t("noResults")}</div>`; return; }
  let n = 0, io;
  const more = () => {
    box.querySelector(".sentinel")?.remove();
    list.slice(n, n + 40).forEach((x) => box.append(st.tab === "routes" ? routeRow(x) : stopRow(x))); n += 40;
    if (n < list.length) { const s = document.createElement("div"); s.className = "sentinel"; box.append(s); io.observe(s); }
  };
  io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); more(); } }, { root: el.querySelector(".scroll"), rootMargin: "500px" });
  more();
}
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const NEAR = { tm: (p) => p.group === "tm" || p.group === "mixto", sitp: (p) => p.group === "sitp", cable: (p) => p.group === "cable", fav: (p) => isFav(p.code) };
// Paradero o estación más cercana que sirve a las rutas del filtro activo (TM, SITP, Cable o Favoritos)
function nearest() {
  const ok = NEAR[st.group]; let best = null;
  rev.stopRids.forEach((codes, i) => {
    let hit = false; for (const c of codes) if (ok(rev.byCode.get(c).p)) { hit = true; break; }
    if (!hit) return;
    const s = D.rs.stops[i], d = meters(st.pos, [s[2], s[1]]);
    if (!best || d < best.d) best = { d, name: s[0] };
  });
  return best;
}
function nextStop() {
  const box = el.querySelector("#next");
  const kick = t(st.group === "tm" || st.group === "cable" ? "nearStn" : "nearStop");
  const body = (title, right) => `<span class="nico">${PIN}</span><span class="grow"><span class="kicker mono">${kick}</span><span class="title">${title}</span></span>${right}`;
  box.onclick = null; box.removeAttribute("role"); box.removeAttribute("tabindex"); box.classList.remove("hit");
  if (!st.pos) { box.innerHTML = body(esc(t("nextStopAsk")), `<button class="btn" id="loc" type="button">${t("enable")}</button>`); box.querySelector("#loc").onclick = () => locateMe(); return; }
  const best = nearest();
  if (!best) { box.innerHTML = body(esc(t(st.group === "fav" ? "noFavs" : "noResults")), ""); return; }
  const d = best.d < 1000 ? Math.round(best.d) + " m" : (best.d / 1000).toFixed(1) + " km";
  box.innerHTML = body(esc(best.name), `<span class="dist mono">${d}</span>`);
  box.classList.add("hit"); box.setAttribute("role", "button"); box.tabIndex = 0;
  box.onclick = () => openStop(best.name);
  box.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStop(best.name); } };
}
async function locateMe(p) { p ||= await locate(); if (!p) return; st.pos = p; nextStop(); if (st.tab === "stops") paint(); }
function init(root) {
  el = root;
  build();
  el.innerHTML = `<div class="scroll"><div class="stick">
    <input class="field" id="rq" type="search" placeholder="${t("search")}" aria-label="${t("search")}">
    <div class="tabs" role="tablist"><button role="tab" data-t="routes" aria-selected="true">${t("routes")}</button><button role="tab" data-t="stops" aria-selected="false">${t("paraderos")}</button></div>
    <div class="seg" id="g">${["tm", "sitp", "cable"].map((g) => `<button data-g="${g}" aria-pressed="${g === st.group}">${t(g)}</button>`).join("")}<button class="fav" data-g="fav" aria-pressed="false" aria-label="${t("favs")}">${HEART}</button></div>
    <div class="next" id="next"></div></div>
    <div class="list" id="rl"></div></div>`;
  el.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.tab = b.dataset.t; el.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b))); paint(); };
  el.querySelector("#g").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.group = b.dataset.g; el.querySelectorAll("#g button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); nextStop(); paint(); };
  el.querySelector("#rq").oninput = (e) => { st.q = e.target.value; paint(); };
  nextStop(); paint();
  locateIfAllowed().then((p) => p && locateMe(p));
  glassSeg(el.querySelector("#g"));
}
function focusRoute(code, tries = 0) {
  if (!el) return tries < 20 && setTimeout(() => focusRoute(code, tries + 1), 100);
  const rid = [...(rev.byCode.get(code)?.rids || [])][0], p = rid && propsOfRid(rid);
  st.tab = "routes"; st.group = !p ? "tm" : p.group === "mixto" ? "tm" : p.group; st.q = code;
  el.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.t === "routes")));
  el.querySelectorAll("#g button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.g === st.group)));
  const q = el.querySelector("#rq"); if (q) q.value = code;
  nextStop(); paint(); el.querySelector(".scroll")?.scrollTo(0, 0);
  openRoute(code);
}
function focusStop(name, tries = 0) {
  if (!el) return tries < 20 && setTimeout(() => focusStop(name, tries + 1), 100);
  st.tab = "stops"; st.group = "tm"; st.q = name;
  el.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.t === "stops")));
  el.querySelectorAll("#g button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.g === "tm")));
  const q = el.querySelector("#rq"); if (q) q.value = name;
  nextStop(); paint(); el.querySelector(".scroll")?.scrollTo(0, 0);
  openStop(name);
}
function reset() { st.tab = "routes"; st.group = "tm"; st.q = ""; st.pos = null; }
export default { focusRoute, focusStop, init, reset, show: () => { if (st.group === "fav" && el) paint(); } };
