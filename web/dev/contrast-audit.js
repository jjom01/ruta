export function audit() {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true }); cv.canvas.width = cv.canvas.height = 1;
  const parse = (s) => { if (!s || s === "transparent") return null; cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; if (/^rgba\(0, 0, 0, 0\)$|^color\(.*\/ 0\)$/.test(s)) return { r: 0, g: 0, b: 0, a: 0 }; const m = s.match(/\/\s*([\d.]+)\)$|rgba\([^)]*,\s*([\d.]+)\)$/); return { r: d[0], g: d[1], b: d[2], a: m ? +(m[1] ?? m[2]) : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const L = (c) => { const [r, g, b] = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const root = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const base = root.a < 1 ? over(root, { r: 128, g: 128, b: 128, a: 1 }) : root;
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a >= 1) break; } } let b = base; for (const c of chain.reverse()) b = over(c, b); return b; };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || false) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    { let L = r.left, T = r.top, R = r.right, B = r.bottom; for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) { const c = getComputedStyle(p); if (c.overflowX === "visible" && c.overflowY === "visible") continue; const q = p.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); } if (R - L < 2 || B - T < 2) continue; }
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const bg = bgOf(el); let fg = parse(cs.color); if (!fg) continue; fg = over({ ...fg, a: fg.a * op }, bg);
    const ratio = cr(fg, bg), size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (size >= 18.66 && bold), min = large ? 3 : 4.5;
    if (ratio < min) out.push(`${ratio.toFixed(2)}<${min} "${el.textContent.trim().slice(0, 24)}" ${size}px .${(el.className?.toString?.() || el.tagName).slice(0, 28)} fg=${cs.color} bg=rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})`);
  }
  return out;
}