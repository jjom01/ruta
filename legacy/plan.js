/* Planificador de viajes: ruta directa, tres opciones por sistema y variantes (más rápida, menos transbordos,
   menos caminata). Corre en un Web Worker (plan-worker.js) para no bloquear la pantalla; si no hay Worker, en el hilo principal.

   Supuestos, todos aproximados:
   - caminata en línea recta ×1,3 a 80 m/min; hasta 25 min a pie (1.538 m en línea recta) al subir/bajar y 250 m entre paradas al hacer transbordo;
   - espera al subir por sistema (no hay horarios por parada);
   - cada ruta del GTFS es de un solo sentido (K16 y B16 son los dos sentidos de un mismo servicio): solo se viaja hacia adelante;
   - al comparar opciones la caminata pesa el doble que el viaje (o más, según el perfil). */
const PL = (() => {
  const M_PER_MIN = 80, DETOUR = 1.3, MAX_WALK = 1538, XFER = 250, XFER_SEC = 60;
  const WAIT = { troncal: 4, dual: 5, transmicable: 3, alimentador: 5, zonal_urbano: 7, zonal_complementario: 8, zonal_especial: 8 };
  const isTm = (s) => ["troncal", "dual", "transmicable", "alimentador"].includes(s);
  const walkSec = (m) => Math.round(((m * DETOUR) / M_PER_MIN) * 60);
  const PROFILES = {
    fast: { walkW: 2, board: 120 },
    few: { walkW: 2, board: 1100 },     // castiga cada subida a un bus: menos transbordos
    walk: { walkW: 6, board: 120 },     // castiga la caminata: baja y sube más cerca
  };
  let G = null, dist, prev;

  const hav = (a, b) => {
    const p = Math.PI / 180, x = Math.sin(((b.lat - a.lat) * p) / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(x));
  };
  const pt = (k) => ({ lat: rstops.stops[k][1], lon: rstops.stops[k][2] });
  /* Hacia dónde va el bus desde la posición `pos`: su terminal final. Las rutas circulares (empiezan y terminan en el mismo sitio)
     tienen dos mitades: antes del punto más lejano van hacia ese punto (p. ej. B909 hacia Mazurén) y después, de vuelta al inicio. */
  const turnCache = new Map();
  function towardOf(rid, pos) {
    const list = rstops.routes[rid], first = list[0], last = list[list.length - 1];
    if (list.length < 10 || hav(pt(first), pt(last)) > 1200) return last;
    let m = turnCache.get(rid);
    if (m == null) { let best = -1; list.forEach((k, i) => { const d = hav(pt(first), pt(k)); if (d > best) { best = d; m = i; } }); turnCache.set(rid, m); }
    return pos < m ? list[m] : last;
  }
  const closest = (pts, p) => pts.reduce((b, q) => (hav(q, p) < hav(b, p) ? q : b), pts[0]);

  /* montículo binario mínimo con arreglos tipados */
  class Heap {
    constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; this.pc = 0; }
    clear() { this.n = 0; }
    push(c, v) {
      if (this.n === this.k.length) { const k = new Float64Array(this.n * 2), x = new Int32Array(this.n * 2); k.set(this.k); x.set(this.v); this.k = k; this.v = x; }
      let i = this.n++;
      while (i) { const p = (i - 1) >> 1; if (this.k[p] <= c) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
      this.k[i] = c; this.v[i] = v;
    }
    pop() {
      const c = this.k[0], v = this.v[0], n = --this.n;
      if (n > 0) {
        const lc = this.k[n], lv = this.v[n]; let i = 0;
        for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && this.k[l + 1] < this.k[l]) l++; if (this.k[l] >= lc) break; this.k[i] = this.k[l]; this.v[i] = this.v[l]; i = l; }
        this.k[i] = lc; this.v[i] = lv;
      }
      this.pc = c; return v;
    }
  }

  /* ---------- grafo (se arma una vez) ---------- */
  function build() {
    if (G) return G;
    const S = rstops.stops.length, cell = 0.005, grid = new Map();
    rstops.stops.forEach((s, k) => { const c = `${Math.floor(s[1] / cell)},${Math.floor(s[2] / cell)}`; if (!grid.has(c)) grid.set(c, []); grid.get(c).push(k); });
    const rids = Object.keys(rstops.routes).filter((r) => ridx[r] && rstops.times?.[r] && rstops.routes[r].length > 1);
    let B = 0;
    rids.forEach((r) => (B += rstops.routes[r].length));
    const bRoute = new Int32Array(B), bPos = new Int32Array(B), bStop = new Int32Array(B), bNext = new Float32Array(B);
    const rWait = new Int32Array(rids.length), rGrp = new Uint8Array(rids.length);
    const counts = new Int32Array(S + 1);
    let b = 0;
    rids.forEach((rid, ri) => {
      const list = rstops.routes[rid], times = rstops.times[rid], sys = ridx[rid].s;
      rWait[ri] = (WAIT[sys] || 6) * 60; rGrp[ri] = isTm(sys) ? 0 : 1;
      list.forEach((st, i) => { bRoute[b] = ri; bPos[b] = i; bStop[b] = st; bNext[b] = i + 1 < list.length ? Math.abs(times[i + 1] - times[i]) : -1; counts[st + 1]++; b++; });
    });
    for (let i = 0; i < S; i++) counts[i + 1] += counts[i];
    const sbStart = counts, sbList = new Int32Array(B), fill = new Int32Array(S);
    for (let k = 0; k < B; k++) { const st = bStop[k]; sbList[sbStart[st] + fill[st]++] = k; }
    const N = S + B;
    dist = new Float64Array(N * 4); prev = new Int32Array(N * 4);
    G = { S, B, N, grid, cell, rids, rWait, rGrp, bRoute, bPos, bStop, bNext, sbStart, sbList, nearCache: new Map(), heap: new Heap(N * 4) };
    return G;
  }
  function near(p, radius) {
    const g = G, out = [], r = Math.ceil(radius / 550), ci = Math.floor(p.lat / g.cell), cj = Math.floor(p.lon / g.cell);
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const cellStops = g.grid.get(`${i},${j}`);
      if (!cellStops) continue;
      for (const k of cellStops) { const d = hav(p, pt(k)); if (d <= radius) out.push([k, d]); }
    }
    return out;
  }
  function nearAny(pts, radius) {
    const m = new Map();
    pts.forEach((p) => near(p, radius).forEach(([k, d]) => { if (!m.has(k) || m.get(k) > d) m.set(k, d); }));
    return [...m];
  }
  /* Estaciones TransMilenio más cercanas sin límite de caminata (solo para la opción "Solo TransMilenio"). */
  function nearestTM(pts, n) {
    const m = new Map();
    pts.forEach((p) => {
      const l = [];
      rstops.stops.forEach((s, k) => { if (s[3] & 1) l.push([k, hav(p, pt(k))]); });
      l.sort((a, b) => a[1] - b[1]).slice(0, n).forEach(([k, d]) => { if (!m.has(k) || m.get(k) > d) m.set(k, d); });
    });
    return m;
  }
  function stopNear(k) {
    let c = G.nearCache.get(k);
    if (!c) {
      const l = near(pt(k), XFER).filter(([s]) => s !== k);
      c = { ids: Int32Array.from(l, (x) => x[0]), d: Float32Array.from(l, (x) => x[1]) };
      G.nearCache.set(k, c);
    }
    return c;
  }

  /* ---------- búsqueda: Dijkstra por estado (nodo, sistemas usados) ---------- */
  function search(profile, mode, origins, dests, oSeeds, dd, startMask = 0) {
    const g = G, { S, rWait, rGrp, bRoute, bStop, bNext, sbStart, sbList, heap } = g;
    const W = profile.walkW, BOARD = profile.board;
    dist.fill(Infinity); prev.fill(-1); heap.clear();
    const off = g.off, allow = (r) => !off[r] && (mode === "tm" ? rGrp[r] === 0 : mode === "sitp" ? rGrp[r] === 1 : true);
    for (const [k, d] of oSeeds) { const c = walkSec(d) * W, key = k * 4 + startMask; if (c < dist[key]) { dist[key] = c; heap.push(c, key); } }
    let best = Infinity, bestKey = -1;
    while (heap.n) {
      const key = heap.pop(), c = heap.pc;
      if (c > dist[key]) continue;
      if (c >= best) break;
      const node = key >> 2, mask = key & 3;
      if (node < S) {
        const wd = dd[node];
        if (wd >= 0 && (mode === "mixed" ? mask === 3 : mask > 0)) { const t = c + walkSec(wd) * W; if (t < best) { best = t; bestKey = key; } }
        for (let q = sbStart[node]; q < sbStart[node + 1]; q++) {
          const b = sbList[q], r = bRoute[b];
          if (!allow(r)) continue;
          const to = (S + b) * 4 + (mask | (rGrp[r] ? 2 : 1)), cost = c + rWait[r] + BOARD;
          if (cost < dist[to]) { dist[to] = cost; prev[to] = key; heap.push(cost, to); }
        }
        if (mask > 0) {
          const nb = stopNear(node);
          for (let q = 0; q < nb.ids.length; q++) {
            const to = nb.ids[q] * 4 + mask, cost = c + (walkSec(nb.d[q]) + XFER_SEC) * W;
            if (cost < dist[to]) { dist[to] = cost; prev[to] = key; heap.push(cost, to); }
          }
        }
      } else {
        const b = node - S, st = bStop[b] * 4 + mask;
        if (c < dist[st]) { dist[st] = c; prev[st] = key; heap.push(c, st); }
        if (bNext[b] >= 0) { const to = (node + 1) * 4 + mask, cost = c + bNext[b]; if (cost < dist[to]) { dist[to] = cost; prev[to] = key; heap.push(cost, to); } }
      }
    }
    if (bestKey < 0) return null;
    const keys = [];
    for (let k = bestKey; k >= 0; k = prev[k]) keys.push(k);
    return legsFrom(keys.reverse().map((k) => k >> 2), origins, dests);
  }

  function legsFrom(nodes, origins, dests) {
    const g = G, legs = [], S = g.S;
    const origin = closest(origins, pt(nodes[0]));
    legs.push({ t: "walk", m: hav(origin, pt(nodes[0])), to: nodes[0] });
    let i = 0;
    while (i < nodes.length) {
      const n = nodes[i];
      if (n >= S) {
        let j = i;
        while (j + 1 < nodes.length && nodes[j + 1] >= S) j++;
        const b0 = n - S, b1 = nodes[j] - S, ri = g.bRoute[b0], rid = g.rids[ri], info = ridx[rid], p0 = g.bPos[b0], p1 = g.bPos[b1], list = rstops.routes[rid], times = rstops.times[rid];
        legs.push({ t: "ride", rid, code: info.c, sys: info.s, from: g.bStop[b0], to: g.bStop[b1], p0, p1, stops: p1 - p0, sec: Math.abs(times[p1] - times[p0]), wait: g.rWait[ri], toward: towardOf(rid, p0) });
        i = j + 1;
      } else {
        const prevN = nodes[i - 1];
        if (i > 0 && prevN < S && prevN !== n) legs.push({ t: "xfer", m: hav(pt(prevN), pt(n)), from: prevN, to: n });
        i++;
      }
    }
    const last = nodes[nodes.length - 1], dest = closest(dests, pt(last));
    legs.push({ t: "walk", m: hav(pt(last), dest), dest: true });
    return { ...summarize(legs), origin, dest };
  }
  function summarize(legs) {
    let walk = 0, ride = 0, wait = 0;
    legs.forEach((l) => {
      if (l.t === "ride") { ride += l.sec; wait += l.wait; }
      else walk += walkSec(l.m) + (l.t === "xfer" ? XFER_SEC : 0);
    });
    return { legs, walk, ride, wait, total: walk + ride + wait, rides: legs.filter((l) => l.t === "ride").length };
  }
  const signature = (it) => it.legs.filter((l) => l.t === "ride").map((l) => `${l.rid}:${l.from}>${l.to}`).join("|");

  /* ruta directa: un solo viaje entre paradas cercanas al origen y al destino */
  function direct(origins, dests, od, dd) {
    const g = G, W = PROFILES.fast.walkW;
    let best = null;
    g.rids.forEach((rid, ri) => {
      if (g.off[ri]) return;
      const list = rstops.routes[rid], times = rstops.times[rid], w = g.rWait[ri];
      for (let i = 0; i < list.length - 1; i++) {
        if (od[list[i]] < 0) continue;
        for (let j = i + 1; j < list.length; j++) {
          if (dd[list[j]] < 0 || list[i] === list[j]) continue;
          const t = walkSec(od[list[i]]) * W + w + (times[j] - times[i]) + walkSec(dd[list[j]]) * W;
          if (!best || t < best.t) best = { t, rid, ri, i, j, list, times };
        }
      }
    });
    if (!best) return null;
    const { rid, ri, i, j, list, times } = best, info = ridx[rid];
    const origin = closest(origins, pt(list[i])), dest = closest(dests, pt(list[j]));
    return { ...summarize([
      { t: "walk", m: hav(origin, pt(list[i])), to: list[i] },
      { t: "ride", rid, code: info.c, sys: info.s, from: list[i], to: list[j], p0: i, p1: j, stops: j - i, sec: times[j] - times[i], wait: g.rWait[ri], toward: towardOf(rid, i) },
      { t: "walk", m: hav(pt(list[j]), dest), dest: true },
    ]), origin, dest };
  }

  /* Rutas alternativas de un tramo: todas las que llevan del origen (o de la parada de subida) al destino (o a la de bajada)
     y no tardan más de 1,5 veces lo que tarda la elegida (+5 min). En el primer tramo se sube en cualquier parada dentro del límite de
     caminata desde el origen; en el último se baja en cualquier parada dentro del límite del destino; en los tramos intermedios, a ≤ ALT_R m. */
  const ALT_R = 400, ALT_X = 1.5, ALT_PLUS = 300;
  const stopsOf = (arr) => { const m = []; for (let k = 0; k < G.S; k++) if (arr[k] >= 0) m.push([k, arr[k]]); return m; };
  function altsFor(leg, mode, fw, lw) {
    const g = G, out = new Map(), list0 = rstops.routes;
    if (mode === "leg") mode = isTm(leg.sys) ? "tm" : "sitp";      // ruta mixta: cada tramo mantiene su sistema
    const nearB = fw ? stopsOf(fw) : near(pt(leg.from), ALT_R), nearA = lw ? new Map(stopsOf(lw)) : new Map(near(pt(leg.to), ALT_R));
    const own = walkSec(fw ? Math.max(0, fw[leg.from]) : 0) + leg.wait + leg.sec + walkSec(lw ? Math.max(0, lw[leg.to]) : 0), limit = own * ALT_X + ALT_PLUS;
    for (const [kb, db] of nearB) {
      for (let q = g.sbStart[kb]; q < g.sbStart[kb + 1]; q++) {
        const b = g.sbList[q], r = g.bRoute[b];
        if (g.off[r] || (mode === "tm" && g.rGrp[r] !== 0) || (mode === "sitp" && g.rGrp[r] !== 1)) continue;
        const rid = g.rids[r], list = list0[rid], pos = g.bPos[b], times = rstops.times[rid];
        let j = -1, dj = 1e9;
        for (let x = pos + 1; x < list.length; x++) {
          const da = nearA.get(list[x]);
          if (da != null && da < dj) { dj = da; j = x; }
        }
        if (j < 0) continue;
        const info = ridx[rid], sec = times[j] - times[pos], cost = walkSec(db) + g.rWait[r] + sec + walkSec(dj);
        if (cost > limit && rid !== leg.rid) continue;
        const cur = out.get(rid);
        if (!cur || cost < cur.cost) out.set(rid, { rid, code: info.c, sys: info.s, from: kb, to: list[j], p0: pos, p1: j, stops: j - pos, sec, wait: g.rWait[r], wb: Math.round(db), wa: Math.round(dj), cost, toward: towardOf(rid, pos) });
      }
    }
    return [...out.values()].sort((x, y) => x.cost - y.cost);
  }
  function addAlts(it, mode, fw, lw) {
    if (!it) return;
    const rides = it.legs.map((l, i) => (l.t === "ride" ? i : -1)).filter((i) => i >= 0);
    rides.forEach((i, n) => { const l = it.legs[i]; l.alts = altsFor(l, mode, n === 0 ? fw : null, n === rides.length - 1 ? lw : null); });
  }

  function plan(origins, dests, off) {
    build();
    G.off = new Uint8Array(G.rids.length);
    if (off && off.length) { const s = new Set(off.map(String)); G.rids.forEach((rid, ri) => { if (s.has(String(rid))) G.off[ri] = 1; }); }
    const oSeeds = nearAny(origins, MAX_WALK), dSeeds = nearAny(dests, MAX_WALK);
    const out = { direct: null, tm: null, sitp: null, mixed: null, extras: [] };
    const od = new Float32Array(G.S).fill(-1), dd = new Float32Array(G.S).fill(-1);
    oSeeds.forEach(([k, d]) => (od[k] = d)); dSeeds.forEach(([k, d]) => (dd[k] = d));
    out.direct = direct(origins, dests, od, dd);
    out.sitp = search(PROFILES.fast, "sitp", origins, dests, oSeeds, dd);
    out.mixed = search(PROFILES.fast, "mixed", origins, dests, oSeeds, dd);
    let tmFrom = new Map(), tdd = new Float32Array(G.S).fill(-1);
    {
      // Solo TransMilenio: sin tope de caminata; se parte de/llega a las estaciones TM más cercanas
      const to = new Map(oSeeds), td = new Map(dSeeds);
      nearestTM(origins, 3).forEach((d, k) => { if (!to.has(k)) to.set(k, d); });
      nearestTM(dests, 3).forEach((d, k) => { if (!td.has(k)) td.set(k, d); });
      td.forEach((d, k) => (tdd[k] = d));
      tmFrom = to;
      out.tm = search(PROFILES.fast, "tm", origins, dests, [...to], tdd);
    }
    // cada tramo en bus lleva todas las rutas que van de su parada de subida a la de bajada (el cliente las ordena por el bus más próximo)
    const odTm = new Float32Array(G.S).fill(-1); tmFrom.forEach((d, k) => (odTm[k] = d));
    addAlts(out.direct, "any", od, dd); addAlts(out.tm, "tm", odTm, tdd); addAlts(out.sitp, "sitp", od, dd); addAlts(out.mixed, "leg", od, dd);
    return out;
  }

  /* Continuación de un viaje desde una parada ya escogida: se vuelve a planear solo lo que falta (hasta el destino) para que los tramos
     siguientes se adapten al bus que eligió el usuario. mode: tm | sitp | mixed | any; startMask: sistemas ya usados (1 = TM, 2 = SITP). */
  function replan(o) {
    build();
    G.off = new Uint8Array(G.rids.length);
    if (o.off && o.off.length) { const s = new Set(o.off.map(String)); G.rids.forEach((rid, ri) => { if (s.has(String(rid))) G.off[ri] = 1; }); }
    const dests = [o.dest], origin = pt(o.from);
    const dMap = new Map(nearAny(dests, MAX_WALK));
    if (o.mode === "tm") nearestTM(dests, 3).forEach((d, k) => { if (!dMap.has(k)) dMap.set(k, d); });
    const dd = new Float32Array(G.S).fill(-1); dMap.forEach((d, k) => (dd[k] = d));
    const it = search(PROFILES.fast, o.mode, [origin], dests, [[o.from, 0]], dd, o.startMask || 0);
    if (!it) return null;
    const fw = new Float32Array(G.S).fill(-1); near(origin, XFER).forEach(([k, d]) => (fw[k] = d));
    addAlts(it, o.kind === "mixed" ? "leg" : o.kind === "any" ? "any" : o.kind, fw, dd);
    return it.legs.filter((l) => l.t === "ride");
  }

  /* ---------- Worker ---------- */
  let worker = null, nextId = 1;
  const pending = new Map();
  function getWorker() {
    if (worker === null) {
      worker = false;
      try {
        if (typeof Worker !== "undefined" && typeof window !== "undefined") {
          worker = new Worker("plan-worker.js");
          worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.res); } };
          worker.onerror = () => { pending.forEach((p) => p.reject(new Error("worker"))); pending.clear(); worker = false; };
        }
      } catch { worker = false; }
    }
    return worker;
  }
  function planAsync(origins, dests, off) {
    const w = getWorker();
    if (!w) return Promise.resolve().then(() => plan(origins, dests, off));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, origins, dests, off });
    }).catch(() => plan(origins, dests, off));
  }
  function replanAsync(o) {
    const w = getWorker();
    if (!w) return Promise.resolve().then(() => replan(o));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, replan: o });
    }).catch(() => replan(o));
  }
  const warm = () => { const w = getWorker(); if (w) w.postMessage({ id: 0, warm: true }); };

  return { plan, planAsync, replan, replanAsync, warm, walkSec };
})();
