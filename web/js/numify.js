// JetBrains Mono solo para números. Envuelve cada cifra (1.2, 3,550, 20:37, 26…) de cualquier texto en <span class="n">,
// salvo en campos de texto, SVG, mapa y las insignias de ruta (códigos como B10 o 19-6, que van completos en Inter).
const NUM = /\d+(?:[.,:]\d+)*/g;
const SKIP = "script,style,textarea,input,svg,canvas,.n,.maplibregl-map,.tile,.badge,.rcode,.av,.mark,[data-nonum]";
function wrap(node) {
  const p = node.parentElement; if (!p || p.closest(SKIP)) return;
  const text = node.nodeValue; if (!/\d/.test(text)) return;
  const frag = document.createDocumentFragment(); let last = 0, m; NUM.lastIndex = 0;
  while ((m = NUM.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const s = document.createElement("span"); s.className = "n"; s.textContent = m[0]; frag.append(s); last = m.index + m[0].length;
  }
  if (!last) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}
function scan(root) {
  if (root.nodeType === 3) return wrap(root);
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
  while (w.nextNode()) list.push(w.currentNode);
  list.forEach(wrap);
}
export function startNumify() {
  let queue = new Set(), raf = 0;
  const flush = () => { raf = 0; const q = [...queue]; queue.clear(); q.forEach((n) => n.isConnected && scan(n)); };
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") queue.add(m.target);
      else m.addedNodes.forEach((n) => queue.add(n));
    }
    if (!raf) raf = requestAnimationFrame(flush);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  scan(document.body);
}
