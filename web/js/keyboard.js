// Teclado en pantalla: en iOS el teclado tapa los campos fijos de abajo. Se mide con visualViewport y se sube la búsqueda.
export function startKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const upd = () => {
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty("--kb", kb + "px");
    document.body.classList.toggle("kb", kb > 120);
    if (kb > 120) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); upd();
}
