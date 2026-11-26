// Inicio: estado del servicio (alertas oficiales de 24 h), rutas favoritas, ajustes (tema, ubicación) y créditos.
import { t, getLang } from "../i18n.js";
import { MARK, HEART, allFavs, toggleFav, glassSeg } from "../ui.js";
import { D, propsOfRid, onColor } from "../data.js";
import { openRoute, openPanel } from "../detail.js";
import { getTheme, setTheme } from "../theme.js";
import { locate, simulated } from "../loc.js";
import { mountHomeMap } from "../home-map.js";
import { fetchAlerts } from "../rt.js";

const DAY = 24 * 3600e3;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const OFFICIAL = { color: "#8A5200", short: "!" };
let el, timer = 0;

/* ---------- datos ---------- */
async function load() {
  const now = Date.now(), items = [];
  try {
    for (const a of await fetchAlerts()) if ((!a.end || a.end * 1000 > now) && (a.title || a.desc)) items.push({ name: t("srcAlerts"), text: [a.title, a.desc].filter(Boolean).join("\n"), time: (a.start || now / 1000) * 1000, lang: "es" });
  } catch { /* sin respuesta: se muestra la pantalla de calma */ }
  return { items: items.filter((i) => now - i.time < DAY).sort((a, b) => b.time - a.time), at: now };
}

/* ---------- traducción en el dispositivo (API Translator de Chrome); si no existe, se muestra el original ---------- */
const trCache = new Map(), trEngines = new Map();
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
async function translate(text, from, to) {
  if (!from || from === to || !("Translator" in self)) return null;
  const k = from + to + text; if (trCache.has(k)) return trCache.get(k);
  try {
    const pair = from + ">" + to;
    if (!trEngines.has(pair)) {
      const av = await within(self.Translator.availability({ sourceLanguage: from, targetLanguage: to }), 3000);
      if (av === "unavailable") return null;
      trEngines.set(pair, await within(self.Translator.create({ sourceLanguage: from, targetLanguage: to }), 6000));
    }
    const out = await within(trEngines.get(pair).translate(text), 8000); trCache.set(k, out); return out;
  } catch { return null; }
}

/* ---------- presentación ---------- */
function rel(ts) {
  const d = Math.round((ts - Date.now()) / 60e3), f = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto", style: "short" });
  if (Math.abs(d) < 1) return f.format(0, "minute");
  if (Math.abs(d) < 60) return f.format(d, "minute");
  return f.format(Math.round(d / 60), "hour");
}
function rich(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+|\b[\w-]+\.(?:gov\.co|com|co|org)(?:\/[^\s<]*)?)/g, (u) => `<a href="${/^https?:/.test(u) ? u : "https://" + u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/(^|\s)@(\w{1,15})/g, '$1<a href="https://x.com/$2" target="_blank" rel="noopener noreferrer">@$2</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, '$1<a href="https://x.com/hashtag/$2" target="_blank" rel="noopener noreferrer">#$2</a>')
    .replace(/\n/g, "<br>");
}
const hhmm = (ts) => new Date(ts).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit", hour12: false });

function mascot(mood) {
  const happy = mood === "happy";
  const eyes = happy
    ? '<path d="M72 96q8-11 17 0M111 96q8-11 17 0" class="mk"/>'
    : '<circle cx="82" cy="94" r="4.5" class="mf"/><circle cx="118" cy="94" r="4.5" class="mf"/>';
  const mouth = happy ? '<path d="M84 108q16 15 32 0" class="mk"/>' : '<path d="M88 112h24" class="mk"/>';
  const extra = happy
    ? '<ellipse cx="68" cy="106" rx="7" ry="4" class="mc"/><ellipse cx="132" cy="106" rx="7" ry="4" class="mc"/><path class="sp s1" d="M162 44l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><path class="sp s2" d="M38 62l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path class="sp s3" d="M150 26l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"/>'
    : '<text x="150" y="52" class="q">?</text>';
  return `<svg class="mascot ${mood}" viewBox="0 0 200 190" role="img" aria-hidden="true"><circle cx="100" cy="104" r="80" class="halo"/><g class="bus"><rect x="38" y="50" width="124" height="104" rx="34" class="body"/><rect x="52" y="68" width="96" height="58" rx="22" class="win"/>${eyes}${mouth}${extra}<circle cx="62" cy="140" r="6" class="win"/><circle cx="138" cy="140" r="6" class="win"/><circle cx="68" cy="158" r="13" class="wh"/><circle cx="68" cy="158" r="5" class="win"/><circle cx="132" cy="158" r="13" class="wh"/><circle cx="132" cy="158" r="5" class="win"/></g></svg>`;
}
function card(it) {
  const a = document.createElement("article"); a.className = "post";
  a.innerHTML = `<header><span class="av" style="background:${OFFICIAL.color}">${OFFICIAL.short}</span><div class="who"><b>${esc(it.name)}</b><span class="mono">${t("srcAlertsSub")} · ${rel(it.time)}</span></div></header>
    <p class="ptxt">${rich(it.text)}</p><footer></footer>`;
  const to = getLang(), from = (it.lang || "es").slice(0, 2);
  if (from !== to && (from === "es" || from === "en")) {
    const ftr = a.querySelector("footer"), txt = a.querySelector(".ptxt");
    translate(it.text, from, to).then((out) => {
      if (!out) { ftr.innerHTML = `<span class="tag mono">${t(from === "es" ? "origEs" : "origEn")}</span>`; return; }
      let shown = true; txt.innerHTML = rich(out);
      ftr.innerHTML = `<span class="tag mono">${t(from === "es" ? "trFromEs" : "trFromEn")}</span><button type="button" class="lnk">${t("showOriginal")}</button>`;
      ftr.querySelector("button").onclick = (e) => { shown = !shown; txt.innerHTML = rich(shown ? out : it.text); e.target.textContent = t(shown ? "showOriginal" : "showTranslation"); };
    });
  }
  return a;
}

let alerts = [], at = Date.now();
const REFRESH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/></svg>', CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
async function paint(spin) {
  const d = await load(); alerts = d.items; at = d.at;
  const row = el.querySelector("#hsvc"), n = alerts.length;
  row.className = "hsvc " + (n ? "warn" : "ok");
  row.querySelectorAll(".tt, .ss").forEach((x) => { x.classList.remove("skel", "line"); x.removeAttribute("style"); });
  row.querySelector(".tt").textContent = n ? t(n === 1 ? "alerts1" : "alertsN", { n }) : t("newsOkTitle");
  row.querySelector(".ss").textContent = t("newsUpdated", { t: hhmm(at) });
  row.querySelector(".ic").innerHTML = n ? CHEV : REFRESH;
  row.setAttribute("aria-label", n ? t(n === 1 ? "alerts1" : "alertsN", { n }) : t("retry"));
  row.classList.remove("spin");
}
function openAlerts() {
  openPanel(`<div class="dtop"><header class="sign cs-head"><div class="grow"><h2>${t("svcStatus")}</h2></div></header><button type="button" class="dclose" aria-label="${t("close")}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`, `<div class="feed" id="alp"></div>`);
  setTimeout(() => { const box = document.getElementById("alp"); alerts.forEach((it, i) => { const c = card(it); c.style.setProperty("--i", Math.min(i, 8)); box?.append(c); }); }, 0);
}

/* ---------- rutas favoritas ---------- */
const MAXFAV = 8;
function favRoutes() {
  const favs = allFavs(), by = new Map();
  if (favs.size) for (const rid of Object.keys(D.rs.routes)) {
    const p = propsOfRid(rid); if (!p || !favs.has(p.code)) continue;
    const c = by.get(p.code) || { p, rid }; if ((D.rs.routes[rid]?.length || 0) > (D.rs.routes[c.rid]?.length || 0)) c.rid = rid; by.set(p.code, c);
  }
  return [...by.values()].sort((a, b) => a.p.code.localeCompare(b.p.code, "es", { numeric: true }));
}
const chip = ({ p, rid }) => { const b = document.createElement("button"); b.type = "button"; b.className = "fchip vt-tile"; b.style.background = p.color; b.style.color = onColor(p.color); b.textContent = p.code.slice(0, 4); b.setAttribute("aria-label", (D.ridx[rid]?.n || p.code) + " · " + p.code); b.addEventListener("click", () => openRoute(p.code, rid, b)); return b; };
function paintFavs() {
  const box = el.querySelector("#hfav"), list = favRoutes();
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = `<p class="hnote">${t("favEmpty")}</p>`; return; }
  list.slice(0, MAXFAV).forEach((f) => box.append(chip(f)));
  if (list.length > MAXFAV) {
    const m = document.createElement("button"); m.type = "button"; m.className = "fchip more"; m.textContent = "+" + (list.length - MAXFAV);
    m.addEventListener("click", () => openPanel(`<div class="dtop"><header class="sign cs-head"><div class="grow"><h2>${t("favRoutes")}</h2></div></header><button type="button" class="dclose" aria-label="${t("close")}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`, `<div class="fgrid" id="fall"></div>`) || setTimeout(() => { const g = document.getElementById("fall"); list.forEach((f) => g?.append(chip(f))); }, 0));
    box.append(m);
  }
}

/* ---------- ajustes ---------- */
function paintTheme() {
  const cur = getTheme();
  el.querySelectorAll("#hth button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cur)));
}
let perm = "prompt";
function paintLoc(msg) {      // con la ubicación activada no hay nada que ajustar: la fila desaparece
  const row = el.querySelector("#hloc"), sub = el.querySelector("#hlocs"), sw = el.querySelector("#hlocb");
  row.hidden = perm === "granted";
  sub.textContent = msg ?? (perm === "denied" ? t("locBlockedHelp") : t("locOffS"));
  sw.setAttribute("aria-checked", "false");
}
async function readPerm() {
  if (simulated) return (perm = "granted");
  try { const q = await navigator.permissions.query({ name: "geolocation" }); perm = q.state; q.onchange = () => { perm = q.state; paintLoc(); }; } catch { perm = "prompt"; }
  return perm;
}
async function askLoc() {
  const sw = el.querySelector("#hlocb"); sw.disabled = true; sw.setAttribute("aria-checked", "true");   // el interruptor se enciende mientras el navegador pregunta
  const p = await locate();      // con permiso "prompt" el navegador vuelve a preguntar; si está bloqueado no puede
  await readPerm(); sw.disabled = false;
  if (p) dispatchEvent(new Event("ruta:location"));
  paintLoc();
}

const LINKS = [
  ["cr_tm", "cr_tmD", "https://www.transmilenio.gov.co"], ["cr_alc", "cr_alcD", "https://bogota.gov.co"],
  ["cr_osm", "cr_osmD", "https://www.openstreetmap.org/copyright"], ["cr_ovt", "cr_ovtD", "https://overturemaps.org"],
  ["cr_ofm", "cr_ofmD", "https://openfreemap.org"], ["cr_mlg", "cr_mlgD", "https://maplibre.org"], ["cr_fnt", "cr_fntD", "https://fonts.google.com"],
];

export default {
  init(root) {
    el = root;
    el.innerHTML = `<div class="scroll homescroll">${MARK}
      <button type="button" class="hsvc" id="hsvc"><span class="dot"></span><span class="grow"><b class="tt skel line" style="width:62%">${t("loading")}</b><span class="ss skel line" style="width:38%;margin-top:6px"></span></span><i class="ic"></i></button>
      <section class="hsec"><h2 class="hlabel">${t("favRoutes")}</h2><div id="hfav" class="fchips"></div></section>
      <section class="hsec"><div class="hrow" id="hloc"><div class="grow"><div class="title">${t("locationL")}</div><div class="sub" id="hlocs"></div></div><button type="button" class="sw" id="hlocb" role="switch" aria-checked="false" aria-label="${t("locationL")}"><i></i></button></div></section>
      <div class="hmap" id="hmap"></div>
      <section class="hsec hth"><div class="hrow"><div class="seg" id="hth" aria-label="${t("appearance")}">${[["auto", "themeAuto"], ["light", "themeLight"], ["dark", "themeDark"]].map(([v, k]) => `<button type="button" data-v="${v}" aria-pressed="false">${t(k)}</button>`).join("")}</div></div></section>
      <button type="button" class="hrow hcred" id="hcred"><span>${t("credits")}</span>${CHEV}</button>
    </div>`;
    glassSeg(el.querySelector("#hth"));
    el.querySelector("#hth").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { setTheme(b.dataset.v); paintTheme(); } });
    el.querySelector("#hlocb").addEventListener("click", askLoc);
    el.querySelector("#hsvc").addEventListener("click", (e) => { const r = e.currentTarget; if (alerts.length) openAlerts(); else { r.classList.add("spin"); setTimeout(paint, 450); } });
    el.querySelector("#hcred").addEventListener("click", () => openPanel(
      `<div class="dtop"><header class="sign cs-head"><div class="grow"><h2>${t("credits")}</h2></div></header><button type="button" class="dclose" aria-label="${t("close")}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`,
      `<p class="hnote">${t("creditsIntro")}</p><ul class="clist">${LINKS.map(([a, b, u]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer"><b>${t(a)}</b><span>${t(b)}</span></a></li>`).join("")}</ul>`));
    paintTheme(); paintLoc(); mountHomeMap(el.querySelector("#hmap"));
    addEventListener("themechange", paintTheme);   // el tema también se cambia desde la introducción
  },
  show() {
    paint(); paintFavs(); paintTheme(); readPerm().then(() => paintLoc());
    clearInterval(timer); timer = setInterval(() => !document.hidden && paint(), 5 * 60e3);
  },
  hide() { clearInterval(timer); },
};
