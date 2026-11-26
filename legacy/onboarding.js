/* Bienvenida (versión 2): pantallas con piezas reales de la app, animadas, y un permiso de ubicación explicado.
   Vista previa: abre la app con ?ob=2 (ignora si ya se vio). Se activa por defecto cuando se apruebe. */
function onboardingV2() {
  const root = $("onboarding");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = 4;
  let i = 0;
  const done = () => { store.set("ruta.onboarded", "1"); root.classList.remove("v2"); root.hidden = true; };
  const html = (el) => el.outerHTML;
  const nm = (l) => (colors.routes[l] && colors.routes[l].name) || "";

  /* 1 · carriles que se desplazan con tarjetas reales: letra + nombre */
  const card = (code, letter, type, name) => `<div class="ob-card">${html(badge(code, letter, type))}<span>${name}</span></div>`;
  const rowOf = (items) => { const s = items.join(""); return `<div class="ob-lane"><div class="ob-track">${s}${s}</div></div>`; };
  const art1 = () => {
    const tm = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"].map((l) => card(l, l, "troncal", nm(l)));
    const sitp = [["BD909", "Mazurén"], ["DL205", "Kennedy"], ["K916", "Bosa"], ["291", "Usaquén"], ["GA538", "Suba"], ["HH710", "Engativá"]].map(([c, n]) => card(c, zl(c), "zonal", n));
    const mix = [["F", "Américas"], ["K", "Calle 26"], ["M", "Carrera 7"], ["Z", "Av. Ciudad de Cali"], ["P", "Perimetral"]].map(([l, n]) => card(l, l, "troncal", n));
    return `<div class="ob-lanes">${rowOf(tm)}${rowOf(sitp)}${rowOf(mix)}</div>`;
  };

  /* 2 · mapa en vivo: ruta con buses que avanzan + tarjeta con el próximo bus asomando */
  const art2 = () => {
    const c = routeColor("K"), d = "M24 210 C70 210 70 120 120 120 S190 160 230 100 S290 40 330 44";
    const bus = (begin, dur) => `<g><circle r="9" fill="#fff" fill-opacity=".92"/><circle r="9" fill="none" stroke="${c}" stroke-width="2.4"/><rect x="-3.2" y="-3.6" width="2.3" height="7.2" rx="1" fill="${c}"/><rect x="1" y="-3.6" width="2.3" height="7.2" rx="1" fill="${c}"/><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}" rotate="0"/></g>`;
    return `<div class="ob-map"><svg viewBox="0 0 360 250" aria-hidden="true">
      <g stroke="currentColor" stroke-opacity=".08" stroke-width="1" fill="none"><path d="M0 60H360M0 130H360M0 200H360M60 0V250M150 0V250M240 0V250M320 0V250"/></g>
      <path d="${d}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      ${[[24, 210], [120, 120], [230, 100], [330, 44]].map(([x, y]) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="3" fill="var(--bg)" stroke="#fff" stroke-width="1.6"/>`).join("")}
      ${reduced ? bus(0, 99999) : bus(0, 9) + bus(3, 9) + bus(6, 9)}
    </svg><div class="ob-pill"><i></i><span>${S.live} · ${S.ago} 3 s</span></div></div>
    <div class="ob-peek"><div class="ob-eta">${html(badge("K16", "K", "troncal"))}<b>${S.obEta}</b><em>${S.obEtaSub}</em></div></div>`;
  };

  /* 3 · selector real (se puede tocar) + tarjetas de opciones de viaje que suben */
  const SETS = {
    tm: [["Ruta directa", "38", [["D21", "D", "troncal"]], 11], ["Solo TransMilenio", "41", [["D81", "D", "troncal"], ["D22", "D", "troncal"]], 6], ["Menos transbordos", "45", [["K16", "K", "troncal"]], 14]],
    mixto: [["Ruta directa", "44", [["K86", "K", "troncal"]], 9], ["Mixto", "47", [["F19", "F", "troncal"], ["K86", "K", "troncal"]], 7], ["Menos caminata", "52", [["M12", "M", "troncal"]], 3]],
    sitp: [["Ruta directa", "46", [["291", null, "zonal"]], 10], ["Solo SITP", "59", [["GA538", null, "zonal"], ["DL205", null, "zonal"]], 9], ["Menos caminata", "63", [["BD909", null, "zonal"]], 4]],
  };
  const stackFor = (k) => SETS[k].map(([name, min, codes, walk], n) => `<div class="opt ob-opt o${n + 1}"><div class="opt-head"><div class="opt-top"><span class="eyebrow">${name}</span><span class="opt-total">${min} min</span></div><div class="opt-row"><span class="tags">${codes.map(([c, l, t]) => html(badge(c, l || zl(c), t))).join("")}</span>${n === 0 ? `<span class="opt-walk">${S.walkWord || "Caminata"} ${walk} min</span>` : ""}</div></div></div>`).join("");
  const art3 = () => `<div class="seg ob-seg" style="--i:0"><button class="chip" data-k="tm" aria-pressed="true">${S.tm}</button><button class="chip" data-k="mixto" aria-pressed="false">${S.mixto}</button><button class="chip" data-k="sitp" aria-pressed="false">${S.sitp}</button></div>
    <div class="ob-stack" aria-live="polite">${stackFor("tm")}</div>`;

  /* 4 · permiso de ubicación, con las razones por delante */
  const art4 = () => `<div class="ob-loc"><div class="ob-ring"><i></i></div></div>
    <ul class="ob-why">
      <li><b>${S.obWhy1t}</b><span>${S.obWhy1}</span></li>
      <li><b>${S.obWhy2t}</b><span>${S.obWhy2}</span></li>
      <li><b>${S.obWhy3t}</b><span>${S.obWhy3}</span></li>
    </ul>`;

  let bgMap = null;
  const dropBg = () => { if (bgMap) { bgMap.remove(); bgMap = null; } };
  const mountBg = () => {
    const el = root.querySelector(".ob-bg");
    if (!el || !window.maplibregl) return;
    bgMap = new maplibregl.Map({ container: el, style: STYLES[theme()], center: [-74.075, 4.655], zoom: 12.4, interactive: false, attributionControl: false, fadeDuration: 0 });
    bgMap.once("load", () => {
      try {
        bgMap.addSource("ob-routes", { type: "geojson", data: { type: "FeatureCollection", features: routes.features.filter((f) => f.properties.type === "troncal" && !f.properties.svc) } });
        bgMap.addLayer({ id: "ob-routes", type: "line", source: "ob-routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colorExpr(), "line-width": 2.6, "line-opacity": 0.85 } });
      } catch (e) {}
      if (!reduced) bgMap.easeTo({ center: [-74.05, 4.69], bearing: 24, zoom: 12.8, duration: 60000, easing: (t) => t });
    });
  };
  const ART = [art1, art2, art3, art4];
  const titles = [S.ob2t1, S.ob2t2, S.ob2t3, S.ob2t4], bodies = [S.ob2b1, S.ob2b2, S.ob2b3, S.ob2b4];

  const render = (dir = 1) => {
    const last = i === N - 1;
    dropBg();
    root.className = "v2 s" + i;
    root.innerHTML = `
      ${last ? `<div class="ob-bg"></div><div class="ob-vig"></div>` : ""}
      <div class="ob-top"><div class="ob-bars" role="progressbar" aria-valuemin="1" aria-valuemax="${N}" aria-valuenow="${i + 1}">${[...Array(N)].map((_, n) => `<i class="${n < i ? "past" : n === i ? "on" : ""}"></i>`).join("")}</div>${last ? "" : `<button class="link" id="skip">${S.skip}</button>`}</div>
      <div class="ob-art" aria-hidden="${last ? "false" : "true"}">${ART[i]()}</div>
      <div class="ob-copy"><h2>${titles[i]}</h2><p>${bodies[i]}</p></div>
      <button class="cta" id="cta">${last ? S.allowLocation : S.next}</button>
      ${last ? `<button class="link below" id="later">${S.notNow}</button>` : `<span class="ob-gap"></span>`}`;
    root.querySelector(".ob-art").classList.add(dir > 0 ? "in-r" : "in-l");
    if (last) mountBg();
    const settle = (ok) => { // el punto pasa a azul titilando si dio permiso; si no, se queda quieto y gris
      root.querySelector(".ob-loc")?.classList.add(ok ? "granted" : "denied");
      root.querySelector(".ob-copy h2").textContent = ok ? S.obOkT : S.obNoT;
      root.querySelector(".ob-copy p").textContent = ok ? S.obOkB : S.obNoB;
      $("cta").textContent = ok ? S.obDone : S.next;
      $("later")?.setAttribute("hidden", "");
      setTimeout(() => { dropBg(); done(); }, ok ? 2200 : 2600);
    };
    $("cta").onclick = () => { if (!last) { i++; render(1); return; } $("cta").disabled = true; $("cta").textContent = S.obWait; locate(settle); };
    $("skip")?.addEventListener("click", () => { dropBg(); done(); });
    $("later")?.addEventListener("click", () => { dropBg(); done(); });
    if (i === 2) { // el selector real: al tocar TM, Mixtos o SITP cambian las rutas; sin tocar, se recorre solo
      const seg = root.querySelector(".ob-seg"), chips = [...seg.querySelectorAll(".chip")], stack = root.querySelector(".ob-stack");
      let auto = null, cur = 0;
      const pick = (n, replay) => {
        cur = n;
        seg.style.setProperty("--i", n);
        chips.forEach((c, m) => c.setAttribute("aria-pressed", String(m === n)));
        if (replay) { stack.innerHTML = stackFor(chips[n].dataset.k); }
      };
      chips.forEach((c, n) => c.addEventListener("click", () => { clearInterval(auto); if (n !== cur) pick(n, true); }));
      if (!reduced) auto = setInterval(() => {
        if (!seg.isConnected) return clearInterval(auto);
        pick((cur + 1) % 3, true);
      }, 3200);
    }
  };
  root.hidden = false;
  render(1);
}
