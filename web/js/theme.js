// Tema: "auto" sigue al dispositivo; "light" y "dark" lo fijan. Se guarda solo en este dispositivo.
const KEY = "ruta.theme";
export const getTheme = () => { try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch { return "auto"; } };
function apply(v) {
  const r = document.documentElement;
  if (v === "auto") { delete r.dataset.theme; r.style.colorScheme = ""; } else { r.dataset.theme = v; r.style.colorScheme = v; }
}
export function setTheme(v) {
  try { v === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch {}
  apply(v); dispatchEvent(new Event("themechange"));
}
apply(getTheme());
