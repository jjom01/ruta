/* Buses en vivo desde un feed GTFS Realtime (VehiclePositions, protobuf) o JSON simple.
   Sin dependencias. Configuración en data/config.json. */
const RT = (() => {
  const STALE_S = 60;
  const GLIDE_MS = 4000;
  let shouldPoll, loadedAt = 0, onBusy, dirty = true, active = null, lastQuery = {}, status = {}, onStatus, known = new Set(), map, cfg, resolve, allow = () => true, timer, raf;
  let prev = new Map(), curr = new Map(), t0 = 0, last = 0;

  /* ---- protobuf mínimo ---- */
  const varint = (b, i) => { let r = 0, s = 0, x; do { x = b[i++]; r += (x & 127) * 2 ** s; s += 7; } while (x & 128); return [r, i]; };
  function fields(b, i, end, cb) {
    while (i < end) {
      let k; [k, i] = varint(b, i);
      const f = k >>> 3, w = k & 7;
      if (w === 0) { let v; [v, i] = varint(b, i); cb(f, v); }
      else if (w === 1) { cb(f, new DataView(b.buffer, b.byteOffset + i, 8)); i += 8; }
      else if (w === 2) { let l; [l, i] = varint(b, i); cb(f, [i, i + l]); i += l; }
      else if (w === 5) { cb(f, new DataView(b.buffer, b.byteOffset + i, 4)); i += 4; }
      else break;
    }
  }
  const str = (b, [a, e]) => new TextDecoder().decode(b.subarray(a, e));
  function decode(b) {
    const out = [];
    fields(b, 0, b.length, (f, v) => {
      if (f !== 2) return;
      fields(b, v[0], v[1], (f2, v2) => {
        if (f2 !== 4) return;
        const x = { id: "", rid: "", lat: NaN, lon: NaN, bearing: null, ts: 0 };
        fields(b, v2[0], v2[1], (f3, v3) => {
          if (f3 === 1) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 5) x.rid = str(b, v4); });
          else if (f3 === 2) fields(b, v3[0], v3[1], (f4, v4) => {
            if (f4 === 1) x.lat = v4.getFloat32(0, true);
            else if (f4 === 2) x.lon = v4.getFloat32(0, true);
            else if (f4 === 3) x.bearing = v4.getFloat32(0, true);
          });
          else if (f3 === 5) x.ts = v3;
          else if (f3 === 8) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 1 && !x.id) x.id = str(b, v4); });
        });
        if (isFinite(x.lat) && isFinite(x.lon)) out.push(x);
      });
    });
    return out;
  }

  function decodeAlerts(b) {
    const out = [];
    const text = (v) => { let t = ""; fields(b, v[0], v[1], (f, x) => { if (f === 1 && !t) fields(b, x[0], x[1], (f2, y) => { if (f2 === 1) t = str(b, y); }); }); return t; };
    fields(b, 0, b.length, (f, v) => {
      if (f !== 2) return;
      const a = { id: "", start: 0, end: 0, routes: [], stops: [], cause: 0, effect: 0, title: "", desc: "", url: "" };
      fields(b, v[0], v[1], (f2, v2) => {
        if (f2 === 1) a.id = str(b, v2);
        if (f2 !== 5) return;
        fields(b, v2[0], v2[1], (f3, v3) => {
          if (f3 === 1) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 1) a.start = v4; else if (f4 === 2) a.end = v4; });
          else if (f3 === 5) fields(b, v3[0], v3[1], (f4, v4) => { if (f4 === 2) a.routes.push(str(b, v4)); else if (f4 === 5) a.stops.push(str(b, v4)); });
          else if (f3 === 6) a.cause = v3;
          else if (f3 === 7) a.effect = v3;
          else if (f3 === 8) a.url = text(v3);
          else if (f3 === 10) a.title = text(v3);
          else if (f3 === 11) a.desc = text(v3);
        });
      });
      out.push(a);
    });
    return out;
  }

  /* ---- datos ---- */
  // Sin sondeo: cada lectura cuesta créditos, así que solo se pide cuando el usuario lo pide.
  async function read(src, query) {
    const r = await fetch(`${src.url}?${new URLSearchParams(query)}`, { cache: "no-store" });
    const buf = new Uint8Array(await r.arrayBuffer());
    let j = null;
    if (src.format === "json" || !r.ok) { try { j = JSON.parse(new TextDecoder().decode(buf)); } catch {} }
    if (!r.ok) { const e = new Error(j?.error || r.status); e.code = j?.error; throw e; }
    return { list: src.format === "json" ? (j.vehicles || j) : decode(buf), meta: j || {} };
  }
  async function load(query) {
    lastQuery = query;
    onBusy?.(true);
    try {
      let got = null;
      for (const src of cfg.sources) {
        try { got = await read(src, query); active = src; break; }
        catch (e) { if (e.code !== "no_feed") throw e; }
      }
      if (!got) throw new Error("no_source");
      if (active?.format === "gtfs-rt") {
        // buses asignados a un viaje en curso sin GPS fresco: posición estimada por horario
        try { const e = await fetch("/api/est", { cache: "no-store" }); if (e.ok) got.list.push(...(await e.json()).vehicles.map((v) => ({ ...v, est: true }))); } catch {}
      }
      const { list, meta: j } = got;
      const now = Date.now() / 1000;
      prev = new Map([...curr].map(([id, v]) => [id, { ...v, ...cur(id, v) }]));
      curr = new Map();
      list.forEach((v, n) => {
        if (v.ts && now - v.ts > STALE_S * 5) return;
        const id = v.id || "v" + n, p = prev.get(id);
        if (v.bearing == null) {
          const dx = (v.lon - (p?.lon ?? v.lon)) * 111e3 * Math.cos(v.lat * Math.PI / 180), dy = (v.lat - (p?.lat ?? v.lat)) * 111e3;
          v.bearing = Math.hypot(dx, dy) > 5 ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : (p?.bearing ?? null);
        }
        curr.set(id, v);
      });
      t0 = performance.now(); loadedAt = t0; dirty = true;
      status = { ok: true, asOf: j.asOf || new Date().toISOString(), credits: j.credits ?? null, resetsAt: j.resetsAt ?? null, callsLeft: j.callsLeft ?? null };
    } catch (e) {
      status = { ok: false, error: String(e.message), credits: status.credits, resetsAt: status.resetsAt, callsLeft: status.callsLeft };
    }
    onBusy?.(false);
    if (cfg.pollMs && active?.format === "gtfs-rt") schedule(cfg.pollMs);
    onStatus?.(status);
    return status;
  }
  const cur = (id, v) => {
    const t = Math.min(1, (performance.now() - t0) / GLIDE_MS);
    const p = prev.get(id);
    return p ? { lat: p.lat + (v.lat - p.lat) * t, lon: p.lon + (v.lon - p.lon) * t } : {};
  };

  /* ---- mapa ---- */
  /* Anillo tintado: aro con relleno translúcido del color de la ruta y punta al frente. */
  const SIZE = 64;
  function marker(color, arrow, dashed) {
    const c = document.createElement("canvas"); c.width = c.height = SIZE;
    const g = c.getContext("2d");
    g.scale(2, 2); g.translate(16, 16);
    g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
    g.globalAlpha = 0.3; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = color; g.lineWidth = 2.5; if (dashed) g.setLineDash([3.2, 2.6]); g.beginPath(); g.arc(0, 0, 7, 0, 7); g.stroke(); g.setLineDash([]);
    if (arrow) {
      g.beginPath(); g.moveTo(0, -15); g.lineTo(3.8, -10); g.lineTo(-3.8, -10); g.closePath();
      g.lineJoin = "round"; g.lineWidth = 2; g.strokeStyle = "#fff"; g.stroke();
      g.fillStyle = color; g.fill();
    }
    return g.getImageData(0, 0, SIZE, SIZE);
  }
  function pause(color) {
    const c = document.createElement("canvas"); c.width = c.height = SIZE;
    const g = c.getContext("2d");
    g.scale(2, 2); g.translate(16, 16);
    g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(0, 0, 7.5, 0, 7); g.fill();
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 7.5, 0, 7); g.stroke();
    g.fillStyle = color;
    [[-3.2, 2.2], [1, 2.2]].forEach(([x, w]) => { g.beginPath(); g.roundRect(x, -3.4, w, 6.8, 1); g.fill(); });
    return g.getImageData(0, 0, SIZE, SIZE);
  }
  function attach(m, letters, colorFor) {
    map = m; known = new Set(letters);
    letters.forEach((l) => {
      if (!map.hasImage("rb-" + l)) map.addImage("rb-" + l, marker(colorFor(l), true), { pixelRatio: 2 });
      if (!map.hasImage("re-" + l)) map.addImage("re-" + l, marker(colorFor(l), true, true), { pixelRatio: 2 });
      if (!map.hasImage("rd-" + l)) map.addImage("rd-" + l, marker(colorFor(l), false), { pixelRatio: 2 });
    });
    if (!map.hasImage("rp")) map.addImage("rp", pause(colorFor("Z0")), { pixelRatio: 2 });
    if (!map.getSource("buses")) map.addSource("buses", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    if (!map.getLayer("buses")) map.addLayer({
      id: "buses", type: "symbol", source: "buses",
      layout: {
        "icon-image": ["case", ["get", "idle"], "rp", ["get", "est"], ["concat", "re-", ["get", "letter"]], ["concat", ["case", ["==", ["get", "bearing"], null], "rd-", "rb-"], ["get", "letter"]]],
        "icon-size": 0.85, "icon-rotate": ["to-number", ["get", "bearing"], 0], "icon-rotation-alignment": "map",
        "icon-allow-overlap": true, "icon-ignore-placement": true,
      },
    });
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    if (now - last < 150 || document.hidden || !map?.getSource("buses")) return;
    const t = Math.min(1, (now - t0) / GLIDE_MS);
    if (t >= 1 && !dirty) return;
    last = now; dirty = t < 1;
    const feats = [];
    curr.forEach((v, id) => {
      const info = resolve(v);
      if (!allow(info)) return;
      const p = prev.get(id);
      const lon = p ? p.lon + (v.lon - p.lon) * t : v.lon, lat = p ? p.lat + (v.lat - p.lat) * t : v.lat;
      const letter = known.has(info.letter) ? info.letter : "Z0";
      const idle = letter === "Z0" && !!info.props && info.props.type !== "zonal";
      feats.push({ type: "Feature", properties: { id, rid: v.rid, letter, idle: idle && !v.est, est: !!v.est, bearing: v.bearing ?? (v.est ? 0 : null) }, geometry: { type: "Point", coordinates: [lon, lat] } });
    });
    map.getSource("buses").setData({ type: "FeatureCollection", features: feats });
  }
  // Refresco encadenado: cada lectura agenda la siguiente a pollMs; si no toca leer (pestaña oculta o
  // sin búsqueda) se vuelve a revisar a los 3 s, así nunca pasan más de pollMs entre lecturas.
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!document.hidden && active?.format === "gtfs-rt" && (!shouldPoll || shouldPoll())) load(lastQuery);
      else schedule(3000);
    }, ms);
  }
  function init(config, resolver, cb, busy, wants) {
    cfg = config; resolve = resolver; onStatus = cb; onBusy = busy; shouldPoll = wants;
    if (!cfg?.sources?.length) return;
    raf = requestAnimationFrame(frame);
    if (cfg.pollMs) schedule(cfg.pollMs);
  }
  return { init, load, attach, decode, decodeAlerts, vehicles: () => [...curr.values()], age: () => (loadedAt ? performance.now() - loadedAt : Infinity), touch: () => { dirty = true; }, setAllow: (f) => { allow = f; } };
})();
