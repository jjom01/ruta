import { t } from "./i18n.js";
import { loadData } from "./data.js";
import { startNumify } from "./numify.js";
import { startKeyboard } from "./keyboard.js";
import { CARD_PATHS, BUS_PATHS } from "./ui.js";
startNumify(); startKeyboard();

const TABS = [
  { id: "home", icon: '<path d="M4 11.2 12 4l8 7.2v8.3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path class="k" d="M10 20.5v-4.8a2 2 0 0 1 4 0v4.8"/>' },
  { id: "routes", icon: BUS_PATHS },
  { id: "plan", icon: '<circle cx="6" cy="18.5" r="2.2"/><path d="M6 16.3V9.5a3.5 3.5 0 0 1 3.5-3.5H15"/><path d="M12.8 3.6 15.2 6l-2.4 2.4"/><rect x="15.8" y="15" width="5" height="5" rx="1.4"/>' },
  { id: "map", icon: '<path d="M12 21.2s-6.8-5.6-6.8-11.1a6.8 6.8 0 0 1 13.6 0c0 5.5-6.8 11.1-6.8 11.1z"/><circle class="k" cx="12" cy="10.1" r="2.4"/>' },
  { id: "balance", icon: CARD_PATHS },
];
const screens = {};
// Al cambiar el tema, las pantallas ya construidas que pintan colores de ruta se reconstruyen al volver a ellas
addEventListener("themechange", () => { for (const id of ["routes", "balance"]) if (screens[id]) { delete screens[id]; document.getElementById("s-" + id).innerHTML = ""; } });
// Al cerrar la introducción, Rutas (que se usó de práctica) se reconstruye limpia
addEventListener("onbdone", async () => { (await import("./screens/routes.js")).default.reset(); if (!screens.routes) return; delete screens.routes; document.getElementById("s-routes").innerHTML = ""; if (current === "routes") { current = null; show("routes"); } });
const bar = document.getElementById("tabbar");
let current = null;

bar.innerHTML = '<i class="glass"></i>' + TABS.map((x) => `<button role="tab" data-id="${x.id}" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true">${x.icon}</svg><span>${t(x.id)}</span></button>`).join("");
bar.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.id); });

async function show(id) {
  if (id === current) return;
  screens[current]?.hide?.();
  current = id;
  for (const x of TABS) document.getElementById("s-" + x.id).hidden = x.id !== id;
  bar.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
  const sel = bar.querySelector(`button[data-id="${id}"]`), g = bar.querySelector(".glass");
  g.style.width = sel.offsetWidth - 8 + "px"; g.style.transform = `translateX(${sel.offsetLeft + 4}px)`;
  const el = document.getElementById("s-" + id);
  if (!screens[id]) { screens[id] = (await import(`./screens/${id}.js`)).default; screens[id].init(el); }
  screens[id].show?.(el);
  // Un vistazo (marco dentro de la introducción) comparte sessionStorage con la página: no debe cambiar la pestaña de inicio
  if (self === top) try { sessionStorage.setItem("ruta.tab", id); } catch {}
}

(async () => {
  await loadData();
  let first = "home";
  if (self === top) try { first = sessionStorage.getItem("ruta.tab") || first; } catch {}
  const want = new URLSearchParams(location.search).get("tab") || first;
  await show(TABS.some((x) => x.id === want) ? want : "home");
  (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(() => import("./detail.js").then((m) => m.warm()), { timeout: 2500 });
  const boot = document.getElementById("boot"); if (boot) { boot.classList.add("done"); setTimeout(() => boot.remove(), 260); }
  // La introducción nunca debe impedir que la app cargue: si algo falla, se omite y se entra directo
  let seen = true; try { seen = !!localStorage.getItem("ruta.onb") && !location.search.includes("onboarding"); } catch {}
  if (self !== top) seen = true;                    // dentro de un vistazo no se repite la introducción
  if (!seen) try { (await import("./onboarding.js")).startOnboarding(); } catch { document.body.classList.remove("onb-on"); }
})();

addEventListener("resize", () => { const s = bar.querySelector('button[aria-selected="true"]'), g = bar.querySelector(".glass"); if (s) { g.style.width = s.offsetWidth - 8 + "px"; g.style.transform = `translateX(${s.offsetLeft + 4}px)`; } });

// Instalable y con copia en el teléfono: el service worker guarda la app, los datos y lo que ya se vio del mapa.
// Solo en https (regla del navegador). En desarrollo (localhost) no se activa, para no ver archivos viejos; se prueba con /?sw=1.
if ("serviceWorker" in navigator && self === top && (location.protocol === "https:" || /[?&]sw\b/.test(location.search))) {
  addEventListener("load", () => (window.requestIdleCallback || setTimeout)(() => navigator.serviceWorker.register("sw.js").catch(() => {})), { once: true });
}

// Aviso de conexión: sin red la app sigue usando lo guardado en el teléfono; esto solo lo dice, sin bloquear nada.
{
  let bar, hideT = 0;
  const say = (msg, ok) => {
    bar ||= Object.assign(document.body.appendChild(document.createElement("div")), { className: "netbar", role: "status" });
    clearTimeout(hideT); bar.textContent = msg; bar.dataset.ok = ok ? "1" : ""; void bar.offsetWidth; bar.classList.add("show");
    if (ok) hideT = setTimeout(() => bar.classList.remove("show"), 2200);
  };
  addEventListener("offline", () => self === top && say(t("offlineMsg"), false));
  addEventListener("online", () => self === top && say(t("onlineMsg"), true));
  if (!navigator.onLine && self === top) setTimeout(() => say(t("offlineMsg"), false), 1200);
}
