import { t } from "../i18n.js";
import { getLang } from "../i18n.js";
import { openPanel } from "../detail.js";
import { simulate, panel } from "../card-sim.js";

const ILLU = `<svg viewBox="0 0 320 200" role="img" aria-hidden="true">
  <rect x="118" y="22" width="84" height="128" rx="16" fill="var(--surface)" stroke="currentColor" stroke-width="2"/>
  <rect x="148" y="32" width="24" height="5" rx="2.5" fill="currentColor" opacity=".25"/>
  <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
    <path class="w1" d="M142 104a18 18 0 0 1 36 0"/><path class="w2" d="M132 104a28 28 0 0 1 56 0"/><path class="w3" d="M122 104a38 38 0 0 1 76 0"/>
  </g>
  <g class="card-anim"><g transform="translate(100 112)">
    <rect width="120" height="76" rx="11" fill="#E8262B"/>
    <rect x="8" y="8" width="12" height="10" rx="2.5" fill="none" stroke="#fff" stroke-width="1.3"/><path d="M14 10.5v5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="72" cy="13" r="7" fill="#fff"/><text x="72" y="15.6" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="6.6" fill="#E8262B">tu</text>
    <text x="80" y="15.8" font-family="Inter,sans-serif" font-weight="800" font-size="10" fill="#fff">llave</text>
    <g fill="#fff"><circle cx="50" cy="22" r="1.8" opacity=".9"/><circle cx="55.5" cy="22" r="1.8" opacity=".65"/><circle cx="61" cy="22" r="1.8" opacity=".4"/></g>
    <g fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M32 58V38q0-3 3-3h3q3 0 3 3v20M44 58V30q0-3 3-3h3q3 0 3 3v28M56 58V42q0-3 3-3h3q3 0 3 3v16"/>
      <path d="M28 58h42" opacity=".7"/>
      <circle cx="16" cy="45" r="5"/><path d="M8 60q1-9 8-9t8 9"/>
      <circle cx="94" cy="45" r="4.5"/><circle cx="102" cy="50" r="3.5"/><path d="M84 60q8-6 20-4"/>
    </g>
    <g fill="#FBE74D"><rect x="8" y="66" width="34" height="3.2" rx="1.6"/><rect x="8" y="71" width="22" height="2" rx="1" opacity=".7"/></g>
    <rect x="102" y="62" width="10" height="10" rx="3" fill="#fff" opacity=".92"/>
  </g></g>

</svg>`;

export default {
  init(el) {
    el.innerHTML = `<div class="scroll">
      <div class="hero">${ILLU}<div class="state" id="st"><b>${t("nfcCheck")}</b><span>${t("nfcAsk")}</span></div></div>
      <div class="actions">
        <button class="btn full" id="chk">${t("nfcCheck")}</button>
        <a class="btn ghost full" href="https://recargasweb.tullaveplus.gov.co/" target="_blank" rel="noopener noreferrer">${t("topup")}</a>
        <button class="btn ghost full" id="rpts" type="button">${t("findRecharge")}</button>
      </div>
      <div class="rows">
        <div class="item" id="fare"><div class="head"><div class="grow"><div class="title">${t("fare")}</div><div class="sub mono" id="fsub"></div></div><span class="tail mono" id="fval"></span></div></div>
      </div>
      <ul class="notes"><li>${t("n1")}</li><li>${t("n2")}</li><li>${t("n3")}</li><li>${t("n4")}</li></ul></div>`;
    el.querySelector("#rpts").addEventListener("click", async () => {
      document.querySelector('#tabbar button[data-id="map"]')?.click();
      const m = (await import("./map.js")).default;
      for (let i = 0; i < 60 && !document.querySelector("#s-map #mf"); i++) await new Promise((r) => setTimeout(r, 50));
      m.api.ready().then(() => m.api.setMode("recharge"));
    });
    fetch("data/fare.json").then((r) => r.json()).then((f) => {
      const lang = getLang(), day = new Date(f.since + "T12:00:00").toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" });
      el.querySelector("#fval").textContent = new Intl.NumberFormat(lang === "es" ? "es-CO" : "en-US", { style: "currency", currency: "COP", maximumFractionDigits: 0, currencyDisplay: lang === "es" ? "narrowSymbol" : "code" }).format(f.cop).replace(/\s/g, lang === "es" ? "" : " ");
      el.querySelector("#fsub").textContent = t("fareSince", { d: day }) + " · " + t("fareScope");
    }).catch(() => el.querySelector("#fare")?.remove());
    const set = (a, b) => { el.querySelector("#st").innerHTML = `<b></b><span></span>`; el.querySelector("#st b").textContent = a; el.querySelector("#st span").textContent = b; };
    let ctrl = null; const sim = new URLSearchParams(location.search).get("balance") === "demo";
    el.querySelector("#chk").addEventListener("click", async () => {
      ctrl?.abort();
      if (sim) { // SIMULACIÓN (?balance=demo): lectura inventada para revisar el diseño
        set(t("nfcWait"), t("nfcAsk"));
        const f = await fetch("data/fare.json").then((r) => r.json()).catch(() => ({ cop: 3550 }));
        setTimeout(() => { set(t("nfcFound"), t("csSimShort")); const d = panel(simulate(f.cop)); openPanel(d.head, d.body); }, 1500);
        return;
      }
      if (!("NDEFReader" in window)) return set(t("nfcNo"), t("nfcNoMsg"));
      ctrl = new AbortController();
      try {
        const r = new NDEFReader();
        await r.scan({ signal: ctrl.signal });
        set(t("nfcWait"), t("nfcAsk"));
        r.onreading = () => { set(t("nfcFound"), t("nfcFoundMsg")); ctrl.abort(); };
        r.onreadingerror = () => set(t("nfcFail"), t("nfcFailMsg"));
      } catch (e) { e?.name === "NotAllowedError" ? set(t("nfcOff"), t("nfcOffMsg")) : set(t("nfcNo"), t("nfcNoMsg")); }
    });
  },
};
