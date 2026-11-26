// Hojas de detalle: letrero de paradero/estación y ficha de ruta (inspiradas en la señalética oficial)
import { t } from "./i18n.js";
import { D, propsOfRid, onColor, hoursOf } from "./data.js";
import { HEART, isFav, toggleFav, glassSeg, swipeDismiss, flip, canMorph } from "./ui.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const BUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="13" rx="3"/><path d="M4 11h16M7 17v3M17 17v3"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';

let box, body, inner, head, stack = [], idx = null, opener = null;
function build() {
  if (idx) return;
  const byCode = new Map(), byStop = new Map(), coords = new Map();
  for (const [rid, ids] of Object.entries(D.rs.routes)) {
    const p = propsOfRid(rid); if (!p) continue;
    const c = byCode.get(p.code) || { p, code: p.code, rids: [] };
    // variantes idénticas del GTFS (mismo nombre, mismos extremos y mismo número de paradas) cuentan como una sola: no se ofrecen dos botones iguales
    const sig = (r) => { const l = D.rs.routes[r] || []; return `${isCiclo(r) ? 1 : 0}|${baseName(r)}|${l[0]}|${l[l.length - 1]}|${l.length}`; };
    if (!c.rids.some((x) => sig(x) === sig(rid))) c.rids.push(rid);
    byCode.set(p.code, c);
    for (const i of ids) { const k = norm(D.rs.stops[i][0]); const s = byStop.get(k) || new Set(); s.add(p.code); byStop.set(k, s); if (!coords.has(k)) coords.set(k, [D.rs.stops[i][2], D.rs.stops[i][1]]); }
  }
  idx = { byCode, byStop, coords };
}
function ensureBox() {
  if (box) return;
  box = document.createElement("section");
  box.id = "detail"; box.className = "dsheet"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Ruta");
  box.innerHTML = '<div class="dscrim"></div><div class="dwin"><div class="dbar"><button type="button" class="dback" aria-label=""></button></div><div class="dhead" id="dhead"></div><div class="dbody" id="dbody"></div><i class="dfade t"></i><i class="dfade b"></i></div>';
  document.body.append(box);
  head = box.querySelector("#dhead"); body = box.querySelector("#dbody"); body.innerHTML = '<div class="dinner"></div>'; inner = body.firstChild; bounce(body, inner);
  box.querySelector(".dback").addEventListener("click", back);
  body.dataset.swipe = "1";   // el empuje hacia abajo en el borde superior cierra la ventana (en vez de rebotar)
  swipeDismiss(box.querySelector(".dwin"), { dir: "down", scroller: body, dim: box.querySelector(".dscrim"), onDismiss: close });
  box.querySelector(".dscrim").addEventListener("click", close);
  body.addEventListener("scroll", fade, { passive: true });
  addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") return back();
    if (e.key !== "Tab") return; // el foco no se escapa de la ventana
    const f = [...box.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent && !x.disabled && getComputedStyle(x).visibility !== "hidden");
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });
}
// Desvanecido en los bordes del contenido: proporcional al scroll, sin cortes secos
function fade() {
  const max = body.scrollHeight - body.clientHeight;
  const t0 = Math.min(56, body.scrollTop), b0 = Math.min(56, Math.max(0, max - body.scrollTop));
  body.style.setProperty("--mt", t0 + "px"); body.style.setProperty("--mb", b0 + "px");
  const w = box.querySelector(".dwin");
  w.style.setProperty("--ot", String(Math.min(1, t0 / 36))); w.style.setProperty("--ob", String(Math.min(1, b0 / 36)));
}
// Apertura con elemento compartido: la insignia (.vt-tile) o el título (.vt-title) pulsado crece hasta su par en la ventana
function pushFrom(el, view, cls) {
  ensureBox(); build();
  const src = el?.closest?.(cls) || el?.querySelector?.(cls);
  if (!src || !canMorph()) return push(view);
  const a = src.getBoundingClientRect();
  if (!stack.length) opener = document.activeElement;
  stack.push(view); box.dataset.vt = cls; box.classList.add("vt");   // «vt»: la ventana aparece ya en su sitio final (así se mide el destino) y se anima aparte
  render(false); box.classList.add("open");
  const ease = "cubic-bezier(.22, 1, .36, 1)";
  box.querySelector(".dwin").animate([{ opacity: 0, transform: "translateY(12px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: ease });
  box.querySelector(".dscrim").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
  const dst = box.querySelector(".dhead " + cls) || box.querySelector(cls);
  const done = () => box.classList.remove("vt");
  if (dst) flip(src, dst, a, { duration: 360, title: cls === ".vt-title" }).then(done); else setTimeout(done, 340);
}
function push(view) { ensureBox(); build(); if (!stack.length) opener = document.activeElement; stack.push(view); render(true); }
function back() { stack.pop(); if (!stack.length) return close(); render(false); }
const behind = () => [document.getElementById("screens"), document.getElementById("tabbar")].filter(Boolean);
function close() {
  if (!box || box.hidden) return;
  const cls = box.dataset.vt, tile = cls && opener && document.contains(opener) ? (opener.closest(cls) || opener.querySelector?.(cls)) : null;
  const head = cls && (box.querySelector(".dhead " + cls) || box.querySelector(cls));
  // cierre con elemento compartido (no si se cerró arrastrando ni si el origen ya no se ve): la cabecera vuelve a su sitio en la lista
  if (tile?.offsetParent && head && canMorph() && !box.querySelector(".dwin").style.transform) flip(head, tile, head.getBoundingClientRect(), { duration: 320, title: cls === ".vt-title" });
  hide(true);
}
function hide(animate) {
  stack = []; if (!box) return;
  behind().forEach((x) => x.removeAttribute("inert"));
  box.classList.remove("open"); box.dataset.vt = "";
  if (animate) setTimeout(() => { if (!stack.length) box.hidden = true; }, 260); else box.hidden = true;
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); opener = null;
}
function render(slide) {
  const v = stack[stack.length - 1];
  const bk = box.querySelector(".dback");
  bk.innerHTML = BACK; bk.setAttribute("aria-label", t("back"));
  box.querySelector(".dwin").classList.toggle("hasback", stack.length > 1);
  body.scrollTop = 0;
  const r = v.type === "custom" ? { head: v.head, body: v.body } : v.type === "stop" ? stopHTML(v) : routeHTML(v);
  head.innerHTML = r.head; inner.innerHTML = r.body;
  head.querySelector(".dclose")?.addEventListener("click", close);
  wire(v);
  box.hidden = false;
  behind().forEach((x) => x.setAttribute("inert", "")); // lo de atrás no recibe foco ni toques mientras la ventana está abierta
  requestAnimationFrame(() => { (head.querySelector(".dclose") || box.querySelector(".dback"))?.focus({ preventScroll: true }); const w = box.querySelector(".dwin"), bar = box.querySelector(".dbar"); w.style.setProperty("--ht", (bar.offsetHeight + head.offsetHeight) + "px"); fade(); });
  if (slide && !box.classList.contains("open")) requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("open")));
}

/* ---------- letrero de paradero / estación ---------- */
function stopHTML(v) {
  const codes = [...(idx.byStop.get(norm(v.name)) || [])].map((c) => idx.byCode.get(c)).filter(Boolean);
  const tm = codes.some((c) => c.p.group === "tm" || c.p.group === "mixto" || c.p.type === "cable");
  const order = { tm: 0, mixto: 1, sitp: 2, cable: 3 };
  codes.sort((a, b) => order[a.p.group] - order[b.p.group] || a.code.localeCompare(b.code, "es", { numeric: true }));
  const rows = codes.map((c) => {
    const rid = best(c);
    const name = D.ridx[rid]?.n || c.code, kind = t({ tm: "kTm", mixto: "kMixed", sitp: "kSitp", cable: "cableName" }[c.p.group]);
    return `<button type="button" class="srow" data-code="${esc(c.code)}"><span class="tile" style="background:${c.p.color};color:${onColor(c.p.color)}">${esc(c.code.slice(0, 4))}</span><span class="grow"><span class="title">${esc(name)}</span><span class="sub mono">${esc(kind)}</span></span><i class="cv">${CHEV}</i></button>`;
  }).join("");
  return { head: `<div class="dtop"><header class="sign"><i class="busico">${BUS}</i><div class="grow"><div class="kicker mono">${t(tm ? "kStation" : "kStop")}</div><h2 class="vt-title">${esc(v.name)}</h2></div></header><button type="button" class="dloc" aria-label="${t("locateStop")}" title="${t("locateStop")}">${PIN}</button><button type="button" class="dclose" aria-label="${t("close")}">${CLOSE}</button></div>`, body: `<div class="sub mono count">${t("routesN", { n: codes.length })}</div>
    <div class="srows">${rows || `<div class="empty">${t("noResults")}</div>`}</div>` };
}
const best = (c) => c.rids.slice().sort((a, b) => (D.rs.routes[b]?.length || 0) - (D.rs.routes[a]?.length || 0))[0];

/* ---------- ficha de ruta ---------- */
function routeHTML(v) {
  const c = idx.byCode.get(v.code); if (!c) return { head: "", body: `<div class="empty">${t("noResults")}</div>` };
  const rids = c.rids.slice().sort((a, b) => isCiclo(a) - isCiclo(b) || baseName(a).localeCompare(baseName(b)));
  const rid = v.rid && rids.includes(v.rid) ? v.rid : best(c);
  v.rid = rid;
  const p = c.p;
  const dirs = rids.length > 1 ? `<div class="seg slide dirs" id="dirs">${rids.map((r, i) => `<button type="button" data-rid="${r}" aria-pressed="${r === rid}">${esc(dirName(rids, r))}</button>`).join("")}</div>` : "";
  return { head: `<div class="dtop"><header class="rhead vt-tile" style="--c:${p.color};--on:${onColor(p.color)}"><span class="rcode mono">${esc(c.code)}</span><span class="rsys mono">${esc(t({ tm: "kTm", mixto: "kMixed", sitp: "kSitp", cable: "cableName" }[p.group]))}</span></header><button type="button" class="dclose" aria-label="${t("close")}">${CLOSE}</button></div>`, body: `<h2 class="rname">${esc(baseName(rid) || c.code)}</h2>
    <div class="sub mono rmeta">${metaOf(rid)}</div>${hoursRow(c.code)}
    <div class="ractions"><button type="button" class="pillbtn fav" aria-pressed="${isFav(c.code)}" aria-label="${t("fav")} ${esc(c.code)}">${HEART}</button><button type="button" class="pillbtn onmap" data-code="${esc(c.code)}" aria-label="${t("onMap")}" title="${t("onMap")}">${PIN}</button></div>
    ${dirs}
    <ul class="rtl" style="--c:${p.color}">${rowsOf(rid)}</ul>` };
}
function hoursRow(code) {
  const h = hoursOf(code); if (!h) return "";
  const kind = t({ h: "dayH", s: "dayS", d: "dayD", f: "holiday" }[h[2]]);
  return h[0] ? `<div class="rhours"><div><span class="sub">${t("firstSvc")}</span><b class="mono">${h[0]}</b></div><div><span class="sub">${t("lastSvc")}</span><b class="mono">${h[1]}</b></div><div><span class="sub">${t("today")}</span><b>${kind}</b></div></div>`
    : `<div class="rhours"><div><span class="sub">${t("today")} · ${kind}</span><b class="off">${t("notToday")}</b></div></div>`;
}
function metaOf(rid) {
  const ids = D.rs.routes[rid] || [], tm = D.rs.times[rid], total = tm ? Math.round((tm[tm.length - 1] - tm[0]) / 60) : null;
  return `${t("rideN", { n: Math.max(0, ids.length - 1) })}${total ? " · " + total + " " + t("minShort") : ""}`;
}
function rowsOf(rid) {
  const ids = D.rs.routes[rid] || [], tm = D.rs.times[rid];
  return ids.map((i, k) => {
    const s = D.rs.stops[i], end = k === 0 || k === ids.length - 1, st = s[3] & 1;
    const m = tm ? Math.round((tm[k] - tm[0]) / 60) : null;
    return `<li class="${end ? "end" : ""}${st ? " stn" : ""}"><span class="nm">${esc(s[0])}</span>${m != null ? `<span class="sub mono">${m} ${t("minShort")}</span>` : ""}</li>`;
  }).join("");
}
// Variantes de una misma ruta: "Ruta regular" / "Ciclovía" cuando solo cambia eso; si no, el nombre del destino
const isCiclo = (r) => /ciclov/i.test(D.ridx[r].n || "");
const baseName = (r) => (D.ridx[r].n || "").replace(/ciclov[ií]a/i, "").replace(/\s+/g, " ").trim();
function dirName(rids, r) {
  const base = (x) => { const bases = new Set(rids.map(baseName)); return bases.size === 1 ? t(isCiclo(x) ? "ciclovia" : "regular") : baseName(x) + (isCiclo(x) ? " · " + t("ciclovia") : ""); };
  const same = rids.filter((x) => base(x) === base(r));
  if (same.length === 1) return base(r);
  // variantes con el mismo nombre (otro sentido o recorrido más corto): se distinguen por sus extremos y, si hace falta, por el número de paradas
  const ends = (x) => { const l = D.rs.routes[x] || []; const nm = (k) => (D.rs.stops[k]?.[0] || "").split(" - ")[0]; return `${nm(l[0])} → ${nm(l[l.length - 1])}`; };
  const lab = (x) => (isCiclo(x) ? t("ciclovia") + " · " : "") + ends(x);
  const sameEnds = same.filter((x) => lab(x) === lab(r));
  return sameEnds.length === 1 ? lab(r) : `${lab(r)} (${t("rideN", { n: Math.max(0, (D.rs.routes[r] || []).length - 1) })})`;
}

function wire(v) {
  if (v.type === "custom") return;
  if (v.type === "stop") head.querySelector(".dloc")?.addEventListener("click", async () => {
    const co = idx.coords.get(norm(v.name)); if (!co) return;
    close();
    document.querySelector('#tabbar button[data-id="map"]')?.click();
    const m = (await import("./screens/map.js")).default;
    for (let i = 0; i < 40 && !document.querySelector("#s-map #q"); i++) await new Promise((r) => setTimeout(r, 50));
    m.api.showStop?.(co[0], co[1], v.name);
  });
  if (v.type === "stop") body.querySelectorAll(".srow").forEach((b) => b.addEventListener("click", () => (currentTab() === "routes" ? push({ type: "route", code: b.dataset.code }) : goRoutes(b.dataset.code))));
  else {
    const d = body.querySelector("#dirs");
    if (d) { glassSeg(d); d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.dataset.rid === v.rid) return; swapRid(v, b.dataset.rid, d); }); }
    body.querySelector(".fav")?.addEventListener("click", (e) => e.currentTarget.setAttribute("aria-pressed", String(toggleFav(v.code))));
    body.querySelector(".onmap")?.addEventListener("click", async () => {
      close();
      document.querySelector('#tabbar button[data-id="map"]')?.click();
      const m = (await import("./screens/map.js")).default;
      // sin esperas fijas: apenas el mapa está listo se dibuja la ruta, mientras la ventana se desvanece
      for (let i = 0; i < 40 && !document.querySelector("#s-map #q"); i++) await new Promise((r) => setTimeout(r, 50));
      m.api.showRoute?.(v.code);
    });
  }
}

export const openPanel = (head, body) => push({ type: "custom", head, body });
export const openStop = (name, from) => (from ? pushFrom(from, { type: "stop", name }, ".vt-title") : push({ type: "stop", name }));
export const openRoute = (code, rid, from) => (from ? pushFrom(from, { type: "route", code, rid }, ".vt-tile") : push({ type: "route", code, rid }));
export const closeDetail = close;
// Precalienta el índice y la ventana en un momento ocioso: así la primera apertura no tiene que construirlos
export const warm = () => { ensureBox(); build(); };

const currentTab = () => document.querySelector('#tabbar button[aria-selected="true"]')?.dataset.id;
// Desde el mapa, el detalle de un bus se muestra dentro de la pantalla Rutas
export async function goRoutes(code) {
  close();
  document.querySelector('#tabbar button[data-id="routes"]')?.click();
  const m = (await import("./screens/routes.js")).default;
  m.focusRoute?.(code);
}

export async function goStop(name) {
  close();
  document.querySelector('#tabbar button[data-id="routes"]')?.click();
  const m = (await import("./screens/routes.js")).default;
  m.focusStop?.(name);
}

// Límite elástico: al tirar más allá del contenido, cede con resistencia y vuelve con un rebote suave
function bounce(sc, el) {
  let y0 = null, off = 0, timer = 0, blocked = false, peak = 0, lastT = 0, lastA = 0;
  const REST = "transform .38s cubic-bezier(.22,1,.36,1)"; // salida suave, sin rebasar el punto de reposo
  const set = (v, anim) => { off = v; el.style.transition = anim ? REST : "none"; el.style.transform = v ? `translate3d(0,${v}px,0)` : ""; };
  const release = () => { clearTimeout(timer); peak = 0; if (off) { set(0, true); blocked = true; } };
  const atTop = () => sc.scrollTop <= 0, atBot = () => sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1;
  const damp = (d) => Math.sign(d) * Math.min(56, Math.abs(d) ** 0.8);
  sc.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; if (off) set(0, false); }, { passive: true });
  sc.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    const d = e.touches[0].clientY - y0;
    if (d > 0 && atTop() && sc.dataset.swipe) return;          // lo gestiona swipeDismiss
    if ((d > 0 && atTop()) || (d < 0 && atBot())) { e.preventDefault(); set(damp(d), false); } else if (off) set(0, false);
  }, { passive: false });
  const end = () => { y0 = null; release(); };
  sc.addEventListener("touchend", end); sc.addEventListener("touchcancel", end);
  sc.addEventListener("wheel", (e) => {
    const up = e.deltaY < 0 && atTop(), down = e.deltaY > 0 && atBot();
    if (!up && !down) { if (off) release(); return; }          // el empuje cambió de sentido: volver ya
    e.preventDefault();
    const now = performance.now(), a = Math.abs(e.deltaY);
    // tras un rebote, lo que sigue es la cola de inercia del mismo gesto: se ignora hasta que haya una pausa o un empujón nuevo y claro
    if (blocked) { if (now - lastT > 140 || (a > 25 && a > lastA * 2)) blocked = false; else { lastT = now; lastA = a; return; } }
    lastT = now; lastA = a;
    if (a < 3 && !off) return;
    peak = Math.max(peak, a);
    if (off && a < peak * 0.5) return release();               // la inercia ya va a la baja: soltar sin esperar a que termine
    set(Math.max(-56, Math.min(56, off - e.deltaY * 0.3 * (1 - Math.abs(off) / 70))), false);
    clearTimeout(timer); timer = setTimeout(release, 55);   // soltar casi al instante cuando cesa el empuje
  }, { passive: false });
}

// Cambio de variante en el sitio: el selector no se recrea (la píldora se desliza de verdad) y solo la lista hace fundido
function swapRid(v, rid, seg) {
  v.rid = rid;
  seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.rid === rid)));
  const ul = body.querySelector(".rtl"), nm = body.querySelector(".rname"), meta = body.querySelector(".rmeta");
  ul.style.transition = "opacity .14s ease-in, transform .14s ease-in"; ul.style.opacity = "0"; ul.style.transform = "translateY(6px)";
  setTimeout(() => {
    ul.innerHTML = rowsOf(rid); nm.textContent = baseName(rid) || v.code; meta.textContent = metaOf(rid);
    body.scrollTop = Math.min(body.scrollTop, Math.max(0, ul.offsetTop - 120));
    ul.style.transition = "opacity .28s ease-out, transform .32s cubic-bezier(.22,1,.36,1)"; ul.style.opacity = "1"; ul.style.transform = "";
    requestAnimationFrame(fade);
  }, 150);
}
