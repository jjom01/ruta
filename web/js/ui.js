// Piezas compartidas: marca (la R), corazón, favoritos.
export const MARK = `<svg class="mark" viewBox="146 166 212 206" overflow="visible" role="img" aria-label="Ruta"><path fill="currentColor" stroke="currentColor" stroke-width="9" stroke-linejoin="round" d="M164.17,363.24c-3.7,0-6.69-2.99-6.69-6.69v-125.48c0-23.36,19.01-42.37,42.37-42.37h125.48c3.7,0,6.69,2.99,6.69,6.69s-2.99,6.69-6.69,6.69h-125.48c-15.99,0-28.99,13.01-28.99,28.99v125.48c0,3.7-2.99,6.69-6.69,6.69Z"/><rect x="306.7" y="176.76" width="37.26" height="37.26" rx="5" fill="#FBE74D"/></svg>`;
export const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>`;
const KEY = "ruta.favs";
let favs;
try { favs = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { favs = new Set(); }
export const isFav = (code) => favs.has(code);
export const allFavs = () => favs;
export function toggleFav(code) {
  favs.has(code) ? favs.delete(code) : favs.add(code);
  try { localStorage.setItem(KEY, JSON.stringify([...favs])); } catch {}
  return favs.has(code);
}

// Selector de cristal deslizante para un grupo de botones con aria-pressed (uno activo a la vez).
export function glassSeg(seg) {
  seg.classList.add("slide");
  const g = document.createElement("i"); g.className = "sg"; seg.prepend(g);
  const move = () => { const b = seg.querySelector('button[aria-pressed="true"]'); if (!b || !b.offsetWidth) return; g.style.width = b.offsetWidth + "px"; g.style.transform = `translateX(${b.offsetLeft}px)`; };
  // Recolocar sin deslizar (carga inicial, fuentes que cambian el ancho, pantalla que pasa de oculta a visible); solo el cambio de selección se anima
  let snapT = 0;
  const snap = () => { seg.classList.add("snap"); move(); cancelAnimationFrame(snapT); snapT = requestAnimationFrame(() => { move(); snapT = requestAnimationFrame(() => seg.classList.remove("snap")); }); };
  new MutationObserver(move).observe(seg, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
  new ResizeObserver(snap).observe(seg); seg.querySelectorAll("button").forEach((x) => new ResizeObserver(snap).observe(x));
  document.fonts?.ready.then(snap);
  snap(); addEventListener("resize", snap);
  return move;
}

// Icono de tarjeta compartido (pestaña Saldo y selector de puntos de recarga del mapa): un solo dibujo
export const CARD_PATHS = '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path class="k" d="M3 10h18M7 15h3"/>';
// Icono de bus compartido (pestaña Rutas y selector de red del mapa)
export const BUS_PATHS = '<rect x="5" y="3.5" width="14" height="14" rx="3.2"/><path class="k" d="M5 11h14"/><path d="M8.5 21v-3.5M15.5 21v-3.5"/><circle class="k" cx="8.6" cy="14.2" r="1"/><circle class="k" cx="15.4" cy="14.2" r="1"/>';

/* ---------- Esqueletos de carga (CSS: .skel) ---------- */
const W = [62, 48, 70, 55, 66, 44];
export const skel = {
  // filas de lista: insignia + dos líneas
  rows: (n = 5) => `<div class="skel-rows" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<div class="skel-row"><i class="skel pill" style="width:52px;height:34px"></i><div><i class="skel line" style="width:${W[i % 6]}%"></i><i class="skel line" style="width:${W[(i + 3) % 6] - 14}%"></i></div></div>`).join("")}</div>`,
  // tarjetas de resultados del planificador
  cards: (n = 3) => `<div class="skel-rows" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<div class="skel-card"><i class="skel pill" style="width:${[96, 120, 84][i % 3]}px;height:24px"></i><i class="skel line" style="width:${[72, 58, 66][i % 3]}%"></i></div>`).join("")}</div>`,
  // un bloque cualquiera
  block: (h = 120, r = 24) => `<div class="skel" style="height:${h}px;border-radius:${r}px" aria-hidden="true"></div>`,
};

/* ---------- Arrastrar para cerrar ----------
   swipeDismiss(el, { dir: "down"|"up", scroller, dim, onDismiss })
   - el: lo que se desplaza con el dedo; scroller: contenido con scroll dentro de él (solo se arrastra cuando está en su borde).
   - dim: elemento cuyo opacity baja mientras se arrastra (p. ej. el velo). Funciona con táctil y con ratón. */
export function swipeDismiss(el, { dir = "down", scroller = null, dim = null, onDismiss } = {}) {
  const sg = dir === "down" ? 1 : -1;
  let y0 = null, ly = 0, lt = 0, v = 0, drag = false, dy = 0;
  const atEdge = () => !scroller || (dir === "down" ? scroller.scrollTop <= 0 : scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1);
  const put = (d) => { dy = d; el.style.transform = d ? `translate3d(0,${sg * d}px,0)` : ""; if (dim) dim.style.opacity = d ? String(Math.max(0, 1 - d / 260)) : ""; };
  const begin = (y) => { y0 = y; ly = y; lt = performance.now(); v = 0; drag = false; dy = 0; };
  const move = (y, ev) => {
    if (y0 == null) return;
    const d = (y - y0) * sg, now = performance.now();
    if (!drag) {
      if (d < -6) { y0 = y; return; }                                // empezó en sentido contrario (hace scroll): se vuelve a medir desde aquí
      if (d > 8 && atEdge()) { drag = true; y0 = y; el.classList.add("swiping"); getSelection()?.removeAllRanges(); } else return;
    }
    ev.cancelable && ev.preventDefault();
    const o = Math.max(0, (y - y0) * sg);
    v = (y - ly) * sg / Math.max(1, now - lt); ly = y; lt = now;
    put(o);
  };
  const finish = () => {
    if (y0 == null) return; const was = drag; y0 = null; drag = false;
    if (!was) return;
    el.classList.remove("swiping"); el.classList.add("swipe-back");
    const gone = dy > Math.min(150, el.offsetHeight * 0.3) || v > 0.7;
    const clean = () => { el.classList.remove("swipe-back"); el.style.transform = ""; dim && (dim.style.opacity = ""); };
    if (gone) { put(el.offsetHeight + 80); if (dim) dim.style.opacity = "0"; setTimeout(() => { onDismiss?.(); setTimeout(clean, 320); }, 200); }
    else { put(0); setTimeout(clean, 320); }
  };
  el.addEventListener("touchstart", (e) => { if (e.touches.length === 1 && !e.target.closest("input, textarea, select")) begin(e.touches[0].clientY); }, { passive: true });
  el.addEventListener("touchmove", (e) => move(e.touches[0].clientY, e), { passive: false });
  el.addEventListener("touchend", finish); el.addEventListener("touchcancel", finish);
  // ratón: solo desde zonas sin controles (así no se pelea con clics ni con la selección de texto)
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest("button, a, input, textarea, select, [role=tab], .seg")) return;
    begin(e.clientY);
    const mm = (m) => move(m.clientY, m), mu = () => { removeEventListener("mousemove", mm); removeEventListener("mouseup", mu); finish(); };
    addEventListener("mousemove", mm); addEventListener("mouseup", mu);
  });
}

/* ---------- Elemento compartido entre pantallas ----------
   Las clases globales .vt-tile (insignia de ruta) y .vt-title (nombre de paradero) marcan el elemento que viaja.
   flip(origen, destino): un clon del origen crece hasta el rectángulo del destino mientras éste aparece con un fundido.
   Solo se anima un elemento pequeño (posición y tamaño); no se captura la página, así que no hay pausas al empezar. */
export const canMorph = () => !matchMedia("(prefers-reduced-motion: reduce)").matches && !!Element.prototype.animate;
let liveFlip = null;
export function flip(src, dst, a = src.getBoundingClientRect(), { duration = 360, title = false } = {}) {
  liveFlip?.remove(); liveFlip = null;
  const b = dst.getBoundingClientRect();
  if (!b.width || !a.width) return Promise.resolve();
  const cs = getComputedStyle(src), c = src.cloneNode(true), px = (r) => ({ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  c.removeAttribute("id"); c.setAttribute("aria-hidden", "true"); c.classList.remove("vt-tile", "vt-title");
  Object.assign(c.style, px(a), { position: "fixed", margin: "0", zIndex: "60", pointerEvents: "none", boxSizing: "border-box", transition: "none", animation: "none", transform: "none", borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color, font: cs.font, display: "flex", alignItems: "center", justifyContent: title ? "flex-start" : "center", overflow: "hidden", whiteSpace: "nowrap" });
  document.body.append(c); liveFlip = c;
  const ease = "cubic-bezier(.22, 1, .36, 1)";
  const grow = c.animate([px(a), px(b)], { duration, easing: ease, fill: "forwards" });
  c.animate([{ opacity: 1 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration, fill: "forwards" });
  const show = dst.animate([{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1 }], { duration, fill: "both" });
  return Promise.allSettled([grow.finished, show.finished]).then(() => { c.remove(); if (liveFlip === c) liveFlip = null; try { show.cancel(); } catch {} });
}
