// Mapa esquemático de TransMilenio para Inicio: SVG en línea con zoom y desplazamiento (pellizco, rueda, doble toque).
// Tocar una estación abre su ficha en Rutas. Los nombres del esquema se enlazan con los paraderos reales por nombre.
import { D, dark, propsOfRid } from "./data.js";
import { goStop } from "./detail.js";
import { t } from "./i18n.js";

const LEVELS = [1, 2.2, 5], LEVEL = LEVELS[LEVELS.length - 1], TAP = 8;   // tres niveles de zoom: completo, intermedio y cercano
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const key = (s) => norm(s).replace(/[^a-z0-9]/g, "");
const STOP = new Set(["de", "la", "el", "del", "estacion", "portal", "av", "avenida", "calle", "cl", "cra", "carrera", "kr"]);
const toks = (s) => new Set((norm(s).match(/[a-z0-9]+/g) || []).filter((x) => !STOP.has(x)));

/* ---------- enlace nombre del esquema -> paradero real ---------- */
// Los nombres de GTFS llevan prefijos y patrocinios ("Estación Calle 63", "Calle 100 - Marketmedios"): se comparan por su nombre base.
const base = (n) => key(n.replace(/^estaci[oó]n\s+/i, "").replace(/^est\.?\s+/i, "").split(/\s[-–]\s/)[0]);
let all, trunkSet;
function index() {
  if (all) return;
  trunkSet = new Set();
  for (const [rid, idx] of Object.entries(D.rs.routes)) if (propsOfRid(rid)?.type !== "zonal") idx.forEach((i) => trunkSet.add(i));
  all = D.rs.stops.map((s, i) => ({ n: s[0], full: key(s[0]), base: base(s[0]), est: /^estaci[oó]n/i.test(s[0]), trunk: trunkSet.has(i) }));
}
const score = (c) => (c.trunk ? 2 : 0) + (c.est ? 1 : 0);
const best = (list) => list.sort((a, b) => score(b) - score(a) || a.n.length - b.n.length)[0]?.n;
const OVERRIDE = { "NQS Calle 38A Sur": "CL 38A Sur - Centro Mayor", "NQS Calle 30 Sur": "Estación NQS - Calle 30 Sur", "Calle 75": "Estación NQS - Calle 75", "Las Aguas": "Las Aguas - Centro Colombo Americano", "Terreros": "Terreros - H. Cardiovascular", "Américas Boyacá": "Av Américas - Av. Boyacá", "Carrera 43": "Carrera 43 - Comapan", "El Tiempo Maloka": "Estación El Tiempo - Maloka", "Calle 26 Estación Central": "Avenida Calle 26", "Movistar Arena": "TIGO" };
const cache = new Map();
export function resolve(label) {
  if (cache.has(label)) return cache.get(label);
  index();
  const keys = [...new Set([key(label), key(label.replace(/^av\.?\s/i, "Avenida ")), key(label.replace(/^u\.\s/i, "Universidad "))])];
  let out = OVERRIDE[label]
    || best(all.filter((c) => c.trunk && keys.includes(c.full)))
    || best(all.filter((c) => c.trunk && keys.includes(c.base)))
    || best(all.filter((c) => keys.includes(c.full) || keys.includes(c.base)))
    || null;
  if (!out) {                                    // parecido por palabras entre paraderos de troncal
    const t = toks(label); let bs = 0;
    if (t.size) for (const c of all) { if (!c.trunk) continue; const u = toks(c.n); if (!u.size) continue; let n = 0; t.forEach((x) => u.has(x) && n++); const sc = n / (t.size + u.size - n); if (sc > bs) { bs = sc; out = c.n; } }
    if (bs < 0.5) out = null;
  }
  cache.set(label, out); return out;           // null: estación sin datos (p. ej. TransMiCable en construcción)
}

/* ---------- SVG ---------- */
const NS = "http://www.w3.org/2000/svg";
const svgCache = {};
async function loadSvg(theme) {
  if (!svgCache[theme]) svgCache[theme] = fetch(`data/map-${theme}.svg`).then((r) => r.text());
  const doc = new DOMParser().parseFromString(await svgCache[theme], "image/svg+xml");
  doc.querySelectorAll("script,foreignObject").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => [...n.attributes].forEach((a) => /^on/i.test(a.name) && n.removeAttribute(a.name)));
  return doc.documentElement;
}
function stations(svg) {
  const labels = [];
  svg.querySelectorAll("text").forEach((t) => {
    const fs = parseFloat(t.getAttribute("font-size")); if (fs !== 20.5 && fs !== 25) return;
    const name = [...t.querySelectorAll("tspan")].map((x) => x.textContent.trim()).join(" ").trim(); if (!name) return;
    const m = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(t.getAttribute("transform") || "");
    labels.push({ name, el: t, x: m ? +m[1] : +t.getAttribute("x"), y: m ? +m[2] : +t.getAttribute("y") });
  });
  const pts = [], used = new Set();
  svg.querySelectorAll("circle").forEach((c) => {
    const r = +c.getAttribute("r"); if (r !== 8.5 && r !== 17) return;
    const x = +c.getAttribute("cx"), y = +c.getAttribute("cy"); let b = null, bd = 90;
    labels.forEach((l) => { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; b = l; } });
    if (b) { pts.push({ x, y, name: b.name }); used.add(b); }
  });
  labels.forEach((l) => !used.has(l) && pts.push(l));
  return { pts, labels };
}

export function mountHomeMap(box) {
  box.innerHTML = `<div class="hm-skel skel"></div><div class="hm-view"></div><div class="hm-zoom"><button type="button" data-z="1" aria-label="+">+</button><button type="button" data-z="-1" aria-label="−">−</button></div>`;
  const view = box.querySelector(".hm-view");
  let svg = null, pts = [], labels = [], theme = null;
  let B = { x: 0, y: 0, w: 3900, h: 2900 };   // encuadre del esquema (viewBox del SVG)
  let s = 1, cx = 0, cy = 0, sMax = 12;
  const size = () => ({ w: box.clientWidth || 1, h: box.clientHeight || 1 });
  const fit = () => { const { w, h } = size(); return Math.max(B.w / w, B.h / h); };
  // Con todo el mapa a la vista queda centrado y fijo; al acercar, solo se puede mover dentro de los límites del esquema.
  const bound = (s, cx, cy) => {                 // centro permitido para una escala dada
    const { w, h } = size(), hw = (w * s) / 2, hh = (h * s) / 2;
    return [hw * 2 >= B.w - 1 ? B.x + B.w / 2 : Math.min(Math.max(cx, B.x + hw), B.x + B.w - hw), hh * 2 >= B.h - 1 ? B.y + B.h / 2 : Math.min(Math.max(cy, B.y + hh), B.y + B.h - hh)];
  };
  const clamp = () => {
    sMax = fit(); s = Math.min(Math.max(s, sMax / LEVEL), sMax); [cx, cy] = bound(s, cx, cy);
    view.classList.toggle("fixed", s >= sMax * 0.995);
    const l2 = s <= sMax / LEVEL * 1.02; box.querySelector('[data-z="1"]')?.toggleAttribute("disabled", l2); box.querySelector('[data-z="-1"]')?.toggleAttribute("disabled", s >= sMax * 0.995);
  };
  let mvT = 0;
  const apply = () => { if (!svg) return; view.classList.add("moving"); clearTimeout(mvT); mvT = setTimeout(() => view.classList.remove("moving"), 160); clamp(); const { w, h } = size(); svg.setAttribute("viewBox", `${cx - (w * s) / 2} ${cy - (h * s) / 2} ${w * s} ${h * s}`); };
  const toSvg = (px, py) => { const r = view.getBoundingClientRect(), { w, h } = size(); return [cx + (px - r.left - w / 2) * s, cy + (py - r.top - h / 2) * s]; };
  const zoomAt = (px, py, f) => { const [ax, ay] = toSvg(px, py), n = Math.min(Math.max(s / f, fit() / LEVEL), fit()); const r = view.getBoundingClientRect(), { w, h } = size(); s = n; cx = ax - (px - r.left - w / 2) * s; cy = ay - (py - r.top - h / 2) * s; apply(); };
  // Niveles discretos: animación suave (arranque y llegada lentos) que mantiene bajo el dedo el punto que se acerca o aleja
  let anim = 0, goal = null;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const stop = () => { cancelAnimationFrame(anim); anim = 0; goal = null; };
  const levelNow = () => { if (goal !== null) return goal; let best = 0, bd = 1e9; LEVELS.forEach((f, i) => { const d = Math.abs(Math.log(fit() / s) - Math.log(f)); if (d < bd) { bd = d; best = i; } }); return best; };
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  function toLevel(i, px, py, ms) {
    cancelAnimationFrame(anim); i = Math.min(Math.max(i, 0), LEVELS.length - 1); goal = i;
    const to = fit() / LEVELS[i], from = s, r = view.getBoundingClientRect(), { w, h } = size();
    const [ax, ay] = toSvg(px, py), at = (k) => [ax - (px - r.left - w / 2) * k, ay - (py - r.top - h / 2) * k];
    const [ex, ey] = at(to), [tx, ty] = bound(to, ex, ey), dx = tx - ex, dy = ty - ey;   // el tramo final se desliza hacia el centro permitido, sin saltos
    ms ??= 280 + 220 * Math.min(1, Math.abs(Math.log(to / from)) / Math.log(5));
    const t0 = performance.now();
    const done = () => { s = to; cx = tx; cy = ty; apply(); anim = 0; goal = null; };
    if (still.matches || Math.abs(Math.log(to / from)) < 0.005 && !dx && !dy) { done(); return; }
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = ease(k);
      if (k >= 1) return done();
      s = from * (to / from) ** e; const [bx, by] = at(s); cx = bx + dx * e; cy = by + dy * e; apply();
      anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  const center = () => { const r = box.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  async function paint() {
    const want = dark() ? "dark" : "light"; if (want === theme && svg) return; theme = want;
    const el = await loadSvg(want); if (theme !== want) return;
    el.removeAttribute("width"); el.removeAttribute("height"); el.setAttribute("preserveAspectRatio", "xMidYMid meet"); el.setAttribute("role", "img");
    el.setAttribute("aria-label", el.querySelector("title")?.textContent || "");
    const first = !svg; box.querySelector(".hm-skel")?.remove(); view.replaceChildren(document.importNode(el, true)); svg = view.firstElementChild; ({ pts, labels } = stations(svg));
    const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number); if (vb.length === 4 && vb.every(isFinite)) B = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    box.style.background = svg.querySelector("rect")?.getAttribute("fill") || "";   // mismo fondo que el esquema, sin franjas
    if (first) { s = fit(); cx = B.x + B.w / 2; cy = B.y + B.h / 2; } apply();
  }

  /* gestos */
  const ptr = new Map(); let down = null, pinch = null;
  view.addEventListener("pointerdown", (e) => {
    stop();
    ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.size === 1) down = { x: e.clientX, y: e.clientY, t: e.timeStamp, moved: 0 };
    else { down = null; const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s }; }
  });
  view.addEventListener("pointermove", (e) => {
    const p = ptr.get(e.pointerId); if (!p) return;
    if (ptr.size >= 2 && pinch) {
      ptr.set(e.pointerId, [e.clientX, e.clientY]); const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.s / s) * (d / pinch.d)); return;
    }
    const dx = e.clientX - p[0], dy = e.clientY - p[1]; ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (!down) return; down.moved += Math.abs(dx) + Math.abs(dy);
    if (down.moved > TAP) { try { view.setPointerCapture(e.pointerId); } catch {} view.classList.add("drag"); cx -= dx * s; cy -= dy * s; apply(); }
  });
  const up = (e) => {
    const was = ptr.has(e.pointerId); ptr.delete(e.pointerId); if (!was) return; view.classList.remove("drag");
    if (ptr.size < 2 && pinch) { pinch = null; const [px, py] = ptr.size ? [...ptr.values()][0] : [e.clientX, e.clientY]; toLevel(levelNow(), px, py, 200); }
    if (down && down.moved <= TAP && e.type === "pointerup") tap(e.clientX, e.clientY);
    if (!ptr.size) down = null;
  };
  view.addEventListener("pointerup", up); view.addEventListener("pointercancel", up);
  let wheelT = 0;
  view.addEventListener("wheel", (e) => { e.preventDefault(); if (performance.now() - wheelT < 350) return; wheelT = performance.now(); toLevel(levelNow() + (e.deltaY < 0 ? 1 : -1), e.clientX, e.clientY); }, { passive: false });
  let lastTap = 0;
  function tap(px, py) {
    const [x, y] = toSvg(px, py), R = 26 * s; let b = null, bd = R;
    for (const l of labels) { const r = l.el.getBoundingClientRect(), g = 6; if (px >= r.left - g && px <= r.right + g && py >= r.top - g && py <= r.bottom + g) { b = l; break; } }   // toque sobre el nombre
    if (!b) for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; b = p; } }
    if (b) { pulse(b); const stop = resolve(b.name); if (stop) setTimeout(() => goStop(stop), 120); else note(b.name); return; }
    const now = performance.now(); if (now - lastTap < 320) toLevel(levelNow() === LEVELS.length - 1 ? 0 : levelNow() + 1, px, py); lastTap = now;
  }
  let noteT = 0;
  function note(name) {                          // estación del esquema sin datos en la app (cable en construcción, nombres sin paradero)
    let n = box.querySelector(".hm-note"); if (!n) { n = document.createElement("div"); n.className = "hm-note"; box.append(n); }
    n.textContent = name + " · " + t("noStopData"); n.classList.add("on"); clearTimeout(noteT); noteT = setTimeout(() => n.classList.remove("on"), 2200);
  }
  function pulse(p) {
    const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); c.setAttribute("r", 20); c.setAttribute("class", "hm-pulse"); svg.append(c); setTimeout(() => c.remove(), 600);
  }
  box.querySelector(".hm-zoom").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.disabled) return; const [px, py] = center(); toLevel(levelNow() + (b.dataset.z === "1" ? 1 : -1), px, py); });
  new ResizeObserver(() => { if (svg) { const atFit = s >= sMax - 0.01; if (atFit) s = fit(); apply(); } }).observe(box);
  addEventListener("themechange", paint); matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  paint();
  return { paint };
}
