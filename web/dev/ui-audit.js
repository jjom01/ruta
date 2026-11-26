// Auditoría de interfaz (consola del navegador): errores, peticiones fallidas, solapes, objetivos táctiles, desbordes y contraste.
// Uso:  const {sweep} = await import("/dev/ui-audit.js"); await sweep();
import { audit as contrast } from "./contrast-audit.js";
const log = { errors: [], failed: [] };
if (!window.__uiAudit) {
  window.__uiAudit = true;
  addEventListener("error", (e) => log.errors.push(e.message));
  addEventListener("unhandledrejection", (e) => log.errors.push(String(e.reason)));
  const f = window.fetch; window.fetch = async (...a) => { const r = await f(...a); if (!r.ok && !String(a[0]).includes("/api/rt") && !String(a[0]).includes("/api/alerts") && !String(a[0]).includes("/api/fleet") && !String(a[0]).includes("/api/est")) log.failed.push(r.status + " " + String(a[0]).slice(0, 80)); return r; };
}
// rectángulo realmente visible: recortado por los contenedores con scroll/overflow y comprobado con un toque de prueba (¿lo tapa otro elemento?)
const clipped = (e) => {
  let r = e.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom;
  for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p); if (cs.overflowX === "visible" && cs.overflowY === "visible" && !/clip/.test(cs.overflow)) continue;
    const q = p.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
  }
  return { L, T, R, B, w: R - L, h: B - T };
};
const vis = (e) => {
  const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.05) return false;
  const c = clipped(e); if (c.w < 2 || c.h < 2 || c.B < 0 || c.T > innerHeight || c.R < 0 || c.L > innerWidth) return false;
  for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]]) { const x = c.L + c.w * fx, y = c.T + c.h * fy; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue; const t = document.elementFromPoint(x, y); if (t && (t === e || e.contains(t) || t.contains(e))) return true; }
  return false;
};
const name = (e) => (e.getAttribute("aria-label") || e.textContent || e.className || e.tagName).toString().trim().replace(/\s+/g, " ").slice(0, 26);
export function overlaps(root = document) {
  const out = [], els = [...root.querySelectorAll("button, a, input, .tile, .card, .srow, .row, .chips *, h1, h2, h3, b, .title, .sub, .nm, .dist, .btn, .pillbtn, .seg > *, #tabbar button, .glass")].filter(vis).filter((e) => !e.closest("[inert]") && !e.matches(".glass, .sg"));
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
    const x = clipped(a), y = clipped(b), ix = Math.min(x.R, y.R) - Math.max(x.L, y.L), iy = Math.min(x.B, y.B) - Math.max(x.T, y.T);
    if (ix > 3 && iy > 3 && ix * iy > 60) {
      // se ignoran capas intencionales (sticky/modal) y elementos de zonas distintas con z-index propio
      const za = +getComputedStyle(a.closest("[style*='z-index'], .dwin, #tabbar, .sheet, .plan-bottom, .search, .rcard, .legend") || a).zIndex || 0, zb = +getComputedStyle(b.closest("[style*='z-index'], .dwin, #tabbar, .sheet, .plan-bottom, .search, .rcard, .legend") || b).zIndex || 0;
      if (a.closest(".dwin") !== b.closest(".dwin")) continue;
      out.push(`${name(a)} ⟷ ${name(b)} (${Math.round(ix)}×${Math.round(iy)})`);
    }
  }
  return out.slice(0, 12);
}
export function targets(min = 40) {
  return [...document.querySelectorAll("button, a, input, [role=button], [role=tab]")].filter(vis).filter((e) => !e.closest("[inert]") && !e.closest(".maplibregl-ctrl")).filter((e) => { const r = clipped(e); return (r.w < min || r.h < min) && !(e.matches("a") && getComputedStyle(e).display === "inline"); })
    .map((e) => `${name(e)} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`).slice(0, 10);
}
export function overflow() {
  const o = []; if (document.documentElement.scrollWidth > innerWidth + 1) o.push("página " + document.documentElement.scrollWidth + ">" + innerWidth);
  for (const e of document.querySelectorAll("body *")) { if (!vis(e)) continue; const r = e.getBoundingClientRect(); if (r.right > innerWidth + 2 && !e.closest(".maplibregl-map, #basemap, [inert], .dwin, .mid, .chips") && getComputedStyle(e).position !== "fixed") { o.push(name(e) + " →" + Math.round(r.right)); if (o.length > 6) break; } }
  return o;
}
// texto con números envueltos (.n) dentro de un contenedor flex/grid: el número pasa a ser otra celda y rompe la línea
export function brokenInline() {
  const out = [];
  for (const e of document.querySelectorAll("body *")) {
    if (e.closest("[inert]") || !e.querySelector(":scope > .n")) continue; const d = getComputedStyle(e).display;
    if ((d === "flex" || d === "grid" || d === "inline-flex" || d === "inline-grid") && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) out.push(name(e) + " (" + d + ")");
  }
  return out.slice(0, 8);
}
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = async (id) => { document.querySelector(`#tabbar button[data-id="${id}"]`).click(); await w(1100); };
export async function check(label) { await w(300); return { label, overlaps: overlaps(), targets: targets(), overflow: overflow(), contrast: contrast(), inline: brokenInline() }; }
export async function sweep() {
  const res = [], push = async (l) => res.push(await check(l));
  await tab("routes"); await push("Rutas");
  document.querySelector('.tabs button[data-t="stops"]').click(); await w(500); await push("Rutas·paraderos");
  for (const g of ["sitp", "cable", "fav", "tm"]) { document.querySelector(`#g button[data-g="${g}"]`).click(); await w(450); await push("Rutas·" + g); }
  document.querySelector('.tabs button[data-t="routes"]').click(); await w(300);
  const d = await import("/js/detail.js");
  d.openRoute("B10"); await w(1200); await push("Popup ruta B10"); d.closeDetail(); await w(500);
  d.openRoute("K707"); await w(1200); await push("Popup ruta con selector"); d.closeDetail(); await w(500);
  d.openStop("Portal Norte"); await w(1200); await push("Popup paradero"); d.closeDetail(); await w(500);
  await tab("plan"); await push("Planear vacío");
  const $ = (s) => document.querySelector("#s-plan " + s), set = (id, v) => { const i = $("#" + id); i.focus(); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); };
  set("from", "Unicen"); await w(1800); await push("Planear sugerencias"); 
  set("from", "Centro Comercial Andino"); set("to", "Universidad Nacional"); await w(1200); $("#pf").requestSubmit();
  for (let i = 0; i < 40; i++) { await w(400); const r = $("#res"); if (!r.hidden && r.querySelector(".card")) break; } await w(2500); await push("Planear resultados");
  $("#res .card .top").click(); await w(1500); await push("Planear tarjeta abierta");
  set("to", "xqzvbn"); $("#pf").requestSubmit(); await w(2500); await push("Planear no encontrado");
  await tab("map"); await push("Mapa");
  document.querySelector("#s-map #help").click(); await w(500); await push("Mapa leyenda"); document.querySelector("#s-map #help").click(); await w(300);
  document.querySelector('#mf button[data-m="recharge"]').click(); await w(3500); await push("Mapa recarga"); document.querySelector('#mf button[data-m="map"]').click(); await w(600);
  const api = (await import("/js/screens/map.js")).default.api; api.showRoute("B10"); await w(2500); await push("Mapa ruta B10"); api.reset(); await w(300);
  await tab("balance"); await push("Saldo");
  await tab("home"); await w(1500); await push("Inicio");
  return { log, res: res.filter((r) => r.overlaps.length || r.targets.length || r.overflow.length || r.contrast.length || r.inline.length), n: res.length };
}
