// SIMULACIÓN de lo que mostraría la lectura de una tarjeta TuLlave: saldo, gasto reciente y dónde se gasta.
// Los datos son inventados (generador con semilla fija). Hoy la app solo detecta la tarjeta; leer saldo e historial
// de verdad requiere acceso que el navegador no da (ver el mensaje de la pantalla Saldo).
import { t, getLang } from "./i18n.js";
import { token, colorOf, onColor } from "./data.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rng = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const SYS = {
  tm: { codes: ["B10", "F23", "K86", "H50", "D20", "G43", "C25", "M81"], places: ["Portal Norte", "Calle 100", "Calle 72", "Av. Jiménez", "Museo del Oro", "Portal 80", "Ricaurte", "Calle 45"], w: 0.62 },
  sitp: { codes: ["T62", "Z8", "B926", "BD909", "C17"], places: ["Br. Caobos Salazar", "Calle 146", "Colegio Anglo Colombiano", "Av. Boyacá", "Toberín"], w: 0.33 },
  cable: { codes: ["CABLE"], places: ["Juan Pablo II", "Manitas", "Cable Portal Tunal"], w: 0.05 },
};

export function simulate(fare = 3550, days = 30) {
  const r = rng(4821), now = new Date(), moves = [];
  const pick = (a) => a[Math.floor(r() * a.length)];
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(now); day.setDate(now.getDate() - d); day.setHours(0, 0, 0, 0);
    const wk = day.getDay() % 6 !== 0; // lunes a viernes
    for (const [h0, h1] of [[6.2, 8.8], [16.8, 19.8]]) {
      if (r() > (wk ? 0.86 : 0.3)) continue;
      const k = r() < SYS.tm.w ? "tm" : r() < SYS.sitp.w / (1 - SYS.tm.w) ? "sitp" : "cable", S = SYS[k];
      const when = new Date(day.getTime() + (h0 + r() * (h1 - h0)) * 3600e3);
      if (when > now) continue;
      moves.push({ kind: "trip", sys: k, code: pick(S.codes), place: pick(S.places), when, amount: -fare });
    }
    for (const [dd, amt] of [[days - 3, 30000], [Math.round(days / 2), 20000]]) if (d === dd) moves.push({ kind: "topup", when: new Date(day.getTime() + 12 * 3600e3), amount: amt });
  }
  moves.sort((a, b) => b.when - a.when);
  const spent = -moves.filter((m) => m.kind === "trip").reduce((s, m) => s + m.amount, 0), topups = moves.filter((m) => m.kind === "topup").reduce((s, m) => s + m.amount, 0);
  const balance = 12350;
  return { card: "4821", balance, fare, moves, spent, trips: moves.filter((m) => m.kind === "trip").length, topups, days };
}

const cop = (n) => new Intl.NumberFormat(getLang() === "es" ? "es-CO" : "en-US", { style: "currency", currency: "COP", maximumFractionDigits: 0, currencyDisplay: getLang() === "es" ? "narrowSymbol" : "code" }).format(n).replace(/\s/g, getLang() === "es" ? "" : " ");
const dayKey = (d) => d.toDateString();

export function panel(s) {
  const lang = getLang(), tripsLeft = Math.floor(s.balance / s.fare);
  const trips = s.moves.filter((m) => m.kind === "trip");
  // gasto diario, últimos 14 días
  const bars = [], today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); const v = trips.filter((m) => dayKey(m.when) === dayKey(d)).length * s.fare; bars.push({ d, v }); }
  const top = Math.max(1, ...bars.map((b) => b.v));
  const chart = `<div class="cs-chart" role="img" aria-label="${t("csLast14")}">${bars.map((b, i) => `<div class="cs-col"><i style="height:${Math.max(4, Math.round((b.v / top) * 64))}px" class="${b.v ? "" : "z"}${i === 13 ? " now" : ""}"></i><span class="mono">${new Intl.DateTimeFormat(lang, { weekday: "narrow" }).format(b.d)}</span></div>`).join("")}</div>`;
  // por sistema
  const by = { tm: 0, sitp: 0, cable: 0 }; trips.forEach((m) => by[m.sys]++);
  const sysName = { tm: t("kTm"), sitp: t("kSitp"), cable: t("cableName") }, sysColor = { tm: token("accent"), sitp: colorOf("Z", "zonal"), cable: colorOf("T", "cable") };
  const sysRows = Object.keys(by).filter((k) => by[k]).map((k) => `<div class="cs-sys"><div class="cs-sh"><span>${esc(sysName[k])}</span><span class="mono">${cop(by[k] * s.fare)} · ${Math.round((by[k] / s.trips) * 100)}%</span></div><div class="cs-bar"><i style="width:${(by[k] / s.trips) * 100}%;background:${sysColor[k]}"></i></div></div>`).join("");
  // sitios más usados
  const cnt = new Map(); trips.forEach((m) => cnt.set(m.place, (cnt.get(m.place) || 0) + 1));
  const places = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n], i) => `<div class="cs-place"><span class="cs-rank mono">${i + 1}</span><span class="grow">${esc(p)}</span><span class="cs-n mono">${t("csTimes", { n })}</span></div>`).join("");
  // movimientos agrupados por día
  const fmtDay = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "short" }), fmtT = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", hour12: false });
  let cur = "", mv = "";
  for (const m of s.moves.slice(0, 14)) {
    const k = dayKey(m.when);
    if (k !== cur) { cur = k; mv += `<div class="cs-day mono">${esc(fmtDay.format(m.when))}</div>`; }
    if (m.kind === "topup") mv += `<div class="cs-mv"><span class="cs-ic up"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><span class="grow"><b>${t("csTopup")}</b><span class="sub mono">${fmtT.format(m.when)}</span></span><span class="cs-amt pos mono">+${cop(m.amount)}</span></div>`;
    else {
      const p = m.sys === "cable" ? colorOf("T", "cable") : m.sys === "sitp" ? colorOf("Z", "zonal") : colorOf(m.code[0], "troncal");
      mv += `<div class="cs-mv"><span class="tile" style="min-width:0;height:28px;font-size:var(--fs-xs);background:${p};color:${onColor(p)}">${esc(m.code === "CABLE" ? "TC" : m.code)}</span><span class="grow"><b>${esc(m.place)}</b><span class="sub mono">${fmtT.format(m.when)}</span></span><span class="cs-amt mono">${cop(m.amount)}</span></div>`;
    }
  }
  const head = `<div class="dtop"><header class="sign cs-head"><i class="busico"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg></i><div class="grow"><div class="kicker mono">TuLlave ••${s.card}</div><h2>${cop(s.balance)}</h2></div></header><button type="button" class="dclose" aria-label="${t("close")}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
  const body = `<div class="cs-sim mono">${t("csSim")}</div>
    <div class="sub mono cs-left">${t("csLeft", { n: tripsLeft })}</div>
    <div class="cs-stats"><div><span class="mono">${cop(s.spent)}</span><small>${t("csSpent")}</small></div><div><span class="mono">${s.trips}</span><small>${t("csTrips")}</small></div><div><span class="mono">${cop(Math.round(s.spent / s.days))}</span><small>${t("csPerDay")}</small></div></div>
    <h3 class="cs-h">${t("csLast14")}</h3>${chart}
    <h3 class="cs-h">${t("csBySys")}</h3>${sysRows}
    <h3 class="cs-h">${t("csWhere")}</h3><div class="cs-places">${places}</div>
    <h3 class="cs-h">${t("csActivity")}</h3>${mv}`;
  return { head, body };
}
