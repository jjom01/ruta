#!/usr/bin/env python3
"""Construye server-data/shapes.json: el recorrido de cada ruta SIGUIENDO LAS CALLES (no líneas rectas entre paraderos).

Para cada par de paraderos consecutivos de una ruta se calcula el camino más corto por la red vial de OpenStreetMap
(respetando vías de un solo sentido y prefiriendo avenidas), y se guarda el trazado completo codificado como polilínea.
Requisitos: haber corrido fetch-roads.sh (red vial en .cache/). Uso:  python3 backend/tools/build-shapes.py
Formato: { rid: { "p": polilínea(5 decimales), "s": [índice de vértice de cada paradero], "f": nº de tramos sin camino (recta) } }"""
import json, glob, math, heapq, pathlib, sys, time, collections
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path(__file__).resolve().parent / ".cache"
KX, KY = 111320 * math.cos(4.65 * math.pi / 180), 110540
FACTOR = {"busway": .7, "bus_guideway": .7, "motorway": .8, "trunk": .85, "primary": .85, "secondary": .9, "tertiary": 1.0, "motorway_link": .9, "trunk_link": .9, "primary_link": .9, "secondary_link": .95, "tertiary_link": 1.0,
          "unclassified": 1.2, "residential": 1.3, "living_street": 1.5, "service": 2.2}

# ---------- red vial ----------
t0 = time.time()
ways = {}
for f in sorted(glob.glob(str(CACHE / "roads-*.json"))):
    for e in json.load(open(f))["elements"]:
        if e["type"] == "way" and e.get("geometry") and len(e["geometry"]) > 1: ways[e["id"]] = e
print(len(ways), "vías")
key = lambda g: (round(g["lat"] * 1e6), round(g["lon"] * 1e6))
use = {}
for w in ways.values():
    pts = w["geometry"]
    for i, g in enumerate(pts):
        k = key(g); use[k] = use.get(k, 0) + (2 if i in (0, len(pts) - 1) else 1)
nid, nodes = {}, []           # nodo (cruce) -> id; coordenadas
def node(k):
    if k not in nid: nid[k] = len(nodes); nodes.append((k[0] / 1e6, k[1] / 1e6))
    return nid[k]
edges = []                    # (u, v, geom[[lat,lon]], length, w, fwd_ok, bwd_ok)
adj = []
def add_edge(u, v, geom, length, wt, fwd, bwd):
    i = len(edges); edges.append((u, v, geom, length, wt, fwd, bwd))
    while len(adj) < len(nodes): adj.append([])
    if fwd: adj[u].append((v, i, 1))
    if bwd: adj[v].append((u, i, -1))
for w in ways.values():
    tg = w.get("tags", {}); hw = tg.get("highway"); fac = FACTOR.get(hw, 1.3)
    ow = tg.get("oneway", "")
    fwd, bwd = True, True
    if ow in ("yes", "true", "1") or tg.get("junction") == "roundabout": bwd = False
    elif ow == "-1": fwd = False
    pts = [(g["lat"], g["lon"]) for g in w["geometry"]]
    start, acc = 0, 0.0
    for i in range(1, len(pts)):
        acc += math.hypot((pts[i][0] - pts[i - 1][0]) * KY, (pts[i][1] - pts[i - 1][1]) * KX)
        k = (round(pts[i][0] * 1e6), round(pts[i][1] * 1e6))
        if use[k] >= 2 or i == len(pts) - 1:
            ks, ke = (round(pts[start][0] * 1e6), round(pts[start][1] * 1e6)), k
            u, v = node(ks), node(ke)
            if u != v or acc > 0: add_edge(u, v, pts[start:i + 1], acc, fac, fwd, bwd)
            start, acc = i, 0.0
while len(adj) < len(nodes): adj.append([])
adj_any = [[] for _ in adj]          # misma red sin respetar sentidos: para los carriles exclusivos de TransMilenio (las estaciones quedan entre calzadas)
for _i, (_u, _v, *_r) in enumerate(edges):
    adj_any[_u].append((_v, _i, 1)); adj_any[_v].append((_u, _i, -1))
print(len(nodes), "cruces,", len(edges), "tramos", round(time.time() - t0), "s")

# ---------- índice espacial de segmentos ----------
CELL = 0.002
grid = {}
for ei, (u, v, geom, L, wt, fwd, bwd) in enumerate(edges):
    for si in range(len(geom) - 1):
        a, b = geom[si], geom[si + 1]
        for ci in range(int(min(a[0], b[0]) / CELL), int(max(a[0], b[0]) / CELL) + 1):
            for cj in range(int(min(a[1], b[1]) / CELL), int(max(a[1], b[1]) / CELL) + 1):
                grid.setdefault((ci, cj), []).append((ei, si))
def snap_all(lat, lon, k=5):
    """Hasta k aristas cercanas (la mejor primero) como candidatos de enganche: (puntaje, arista, a lo largo, distancia, segmento, t).
    Una parada puede estar al lado de una calle de un solo sentido y también de la de enfrente: se prueban varias y se elige la que da el mejor recorrido."""
    found = {}
    for r in (1, 2, 4):
        ci, cj = int(lat / CELL), int(lon / CELL)
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for ei, si in grid.get((i, j), ()):
                    geom = edges[ei][2]; a, b = geom[si], geom[si + 1]
                    ax, ay = (a[1] - lon) * KX, (a[0] - lat) * KY; bx, by = (b[1] - lon) * KX, (b[0] - lat) * KY
                    dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy
                    t = max(0, min(1, -(ax * dx + ay * dy) / l2)) if l2 else 0
                    d = math.hypot(ax + dx * t, ay + dy * t)
                    sc = d + (edges[ei][4] - 0.85) * 25
                    if ei not in found or sc < found[ei][0]: found[ei] = (sc, ei, d, si, t, l2)
        if found and min(v[2] for v in found.values()) < 60 and len(found) >= 5: break
    out = []
    for sc, ei, d, si, t, l2 in sorted(found.values())[:k]:
        geom = edges[ei][2]
        along = sum(math.hypot((geom[q + 1][0] - geom[q][0]) * KY, (geom[q + 1][1] - geom[q][1]) * KX) for q in range(si)) + t * math.sqrt(l2)
        out.append((sc, ei, along, d, si, t))
    return out
def snap(lat, lon):
    r = snap_all(lat, lon, 1); return r[0] if r else None
def part(geom, s0, s1):
    """Trozo de la geometría de la arista entre las distancias s0 y s1 (s0<=s1 o al revés), devuelto en el orden s0→s1."""
    rev = s0 > s1; lo, hi = (s1, s0) if rev else (s0, s1)
    out, acc = [], 0.0
    def at(k, t): return (geom[k][0] + (geom[k + 1][0] - geom[k][0]) * t, geom[k][1] + (geom[k + 1][1] - geom[k][1]) * t)
    for k in range(len(geom) - 1):
        seg = math.hypot((geom[k + 1][0] - geom[k][0]) * KY, (geom[k + 1][1] - geom[k][1]) * KX)
        a, b = acc, acc + seg
        if b >= lo and a <= hi and seg > 0:
            t0_, t1_ = max(0, (lo - a) / seg), min(1, (hi - a) / seg)
            p0, p1 = at(k, t0_), at(k, t1_)
            if not out: out.append(p0)
            out.append(p1)
        acc = b
    if not out: out = [at(0, 0)]
    return out[::-1] if rev else out

def route(A, B, straight, anyway=False):
    """Camino de la posición A a la B (cada una = (_, arista, along, d, …)). Devuelve lista de puntos (lat, lon) o None."""
    _, ea, sa = A[0], A[1], A[2]; _, eb, sb = B[0], B[1], B[2]
    ua, va, ga, La, _, fa, ba = edges[ea]; ub, vb, gb, Lb, _, fb, bb = edges[eb]
    if anyway: fa = ba = fb = bb = True
    A_adj = adj_any if anyway else adj
    if ea == eb and ((sb >= sa and fa) or (sb <= sa and ba)): return part(ga, sa, sb)
    limit = max(1500.0, straight * 6)
    dist, prev, heap = {}, {}, []
    def push(n, c, via):
        if c < dist.get(n, 1e18): dist[n] = c; prev[n] = via; heapq.heappush(heap, (c, n))
    if fa: push(va, (La - sa) * edges[ea][4], ("start", 1))
    if ba: push(ua, sa * edges[ea][4], ("start", -1))
    tgt = {}
    if fb: tgt[ub] = sb * edges[eb][4]
    if bb: tgt[vb] = (Lb - sb) * edges[eb][4]
    best, bnode, seen = 1e18, None, set()
    while heap:
        c, n = heapq.heappop(heap)
        if c > dist.get(n, 1e18) or n in seen: continue
        seen.add(n)
        if c >= best or c > limit * 1.6: break
        if n in tgt and c + tgt[n] < best: best, bnode = c + tgt[n], n
        for m, ei, d in A_adj[n]:
            push(m, c + edges[ei][3] * edges[ei][4], (n, ei, d))
    if bnode is None: return None
    # reconstruir
    chain, n = [], bnode
    while True:
        p = prev[n]
        if p[0] == "start": chain.append(("start", p[1])); break
        chain.append((p[1], p[2], p[0])); n = p[0]
    chain.reverse()
    pts = []
    for it in chain:
        if it[0] == "start":
            pts += part(ga, sa, La) if it[1] == 1 else part(ga, sa, 0)
        else:
            ei, d, frm = it; g = edges[ei][2]; pts += (g if d == 1 else g[::-1])
    # tramo final hasta B
    pts += part(gb, 0, sb) if bnode == ub else part(gb, Lb, sb)
    return pts

# ---------- polilínea codificada ----------
def rdp(p, eps):
    if len(p) < 3: return p
    a, b = p[0], p[-1]; dx, dy = (b[1] - a[1]) * KX, (b[0] - a[0]) * KY; l2 = dx * dx + dy * dy
    idx, dm = 0, -1
    for i in range(1, len(p) - 1):
        px, py = (p[i][1] - a[1]) * KX, (p[i][0] - a[0]) * KY
        t = max(0, min(1, (px * dx + py * dy) / l2)) if l2 else 0
        d = math.hypot(px - dx * t, py - dy * t)
        if d > dm: dm, idx = d, i
    return rdp(p[:idx + 1], eps)[:-1] + rdp(p[idx:], eps) if dm > eps else [a, b]
def enc(pts):
    out, pl, pn = [], 0, 0
    for lat, lon in pts:
        la, lo = round(lat * 1e5), round(lon * 1e5)
        for v in (la - pl, lo - pn):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20: out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        pl, pn = la, lo
    return "".join(out)


# ---------- corredores troncales oficiales (web/data/network.geojson: trazados de TransMilenio) ----------
# Las rutas troncales siguen el trazado oficial del corredor (carriles exclusivos), no las calles de OpenStreetMap.
_net = json.load(open(ROOT / "web/data/network.geojson"))
cv, cadj = [], []               # vértices (lat, lon) y adyacencia [(vecino, longitud)]
_cell = {}
def _cv(lat, lon):
    cv.append((lat, lon)); cadj.append([]); return len(cv) - 1
for f in _net["features"]:
    pr = f["properties"]
    if pr.get("st") or pr.get("l") == "T": continue
    g = f["geometry"]; parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
    for prt in parts:
        prev = None
        # se densifica el trazado (un vértice cada ≤ 40 m) para que el enganche a la línea nunca falle en tramos rectos largos
        dense = []
        for (lon, lat) in prt:
            if dense:
                pl, po = dense[-1]; dd_ = math.hypot((lat - pl) * KY, (lon - po) * KX); n_ = int(dd_ // 40)
                for q_ in range(1, n_ + 1): dense.append((pl + (lat - pl) * q_ / (n_ + 1), po + (lon - po) * q_ / (n_ + 1)))
            dense.append((lat, lon))
        for lat, lon in dense:
            i = _cv(lat, lon)
            if prev is not None:
                d = math.hypot((cv[i][0] - cv[prev][0]) * KY, (cv[i][1] - cv[prev][1]) * KX)
                cadj[prev].append((i, d)); cadj[i].append((prev, d))
            prev = i
for i, (la, lo) in enumerate(cv): _cell.setdefault((int(la / 0.0005), int(lo / 0.0005)), []).append(i)
# cruces entre corredores (y entre partes): vértices a menos de 45 m se conectan
for i, (la, lo) in enumerate(cv):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for j in _cell.get((int(la / 0.0005) + dx, int(lo / 0.0005) + dy), ()):
                if j > i and all(j != k for k, _ in cadj[i]):
                    d = math.hypot((cv[j][0] - la) * KY, (cv[j][1] - lo) * KX)
                    if d < 45: cadj[i].append((j, d)); cadj[j].append((i, d))
# conexiones operacionales oficiales (capa 4 del geovisor: .cache/conexiones-oficiales.json): puntos donde se pasa de un corredor a otro.
# Cada una se vuelve un nodo unido a los vértices de los corredores a menos de 220 m, para que el trazado cambie de corredor por ahí.
try:
    for _f in json.load(open(CACHE / "conexiones-oficiales.json"))["features"]:
        if _f["properties"].get("esta_oper") != 1: continue
        _lon, _lat = _f["geometry"]["coordinates"][:2]; _n = _cv(_lat, _lon)
        for _j in range(len(cv) - 1):
            _d = math.hypot((cv[_j][0] - _lat) * KY, (cv[_j][1] - _lon) * KX)
            if _d < 220: cadj[_n].append((_j, _d)); cadj[_j].append((_n, _d))
except FileNotFoundError: pass
# Retornos reales por los que pasa un servicio entre dos estaciones (capa 3 oficial: .cache/retornos-oficiales.json).
# K16 y los demás servicios de Calle 26 que bajan por la NQS siguen hasta el retorno CAD (NQS con Av. Américas), giran en U y entran a la Calle 26.
VIA = {("Universidad Nacional", "Corferias"): [(4.62489, -74.08299)]}
def csnap(lat, lon, maxd=160):
    """Punto del corredor más cercano a (lat, lon): (d, a, b, t, (lat,lon)) sobre el segmento a-b."""
    best = None
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            for a in _cell.get((int(lat / 0.0005) + dx, int(lon / 0.0005) + dy), ()):
                for b, _ in cadj[a]:
                    if b < a and abs(a - b) > 1: continue          # solo segmentos del mismo trazo
                    A, B = cv[a], cv[b]; ax, ay = (A[1] - lon) * KX, (A[0] - lat) * KY; bx, by = (B[1] - lon) * KX, (B[0] - lat) * KY
                    ddx, ddy = bx - ax, by - ay; l2 = ddx * ddx + ddy * ddy
                    t = max(0, min(1, -(ax * ddx + ay * ddy) / l2)) if l2 else 0
                    d = math.hypot(ax + ddx * t, ay + ddy * t)
                    if best is None or d < best[0]: best = (d, a, b, t, (A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t))
    return best if best and best[0] <= maxd else None
def croute(A, B):
    """Camino por el corredor entre dos puntos enganchados; lista de (lat, lon) o None."""
    _, a1, b1, t1, p1 = A; _, a2, b2, t2, p2 = B
    dist, prev, heap = {}, {}, []
    def push(n, c, via):
        if c < dist.get(n, 1e18): dist[n] = c; prev[n] = via; heapq.heappush(heap, (c, n))
    dd = lambda P, Q: math.hypot((P[0] - Q[0]) * KY, (P[1] - Q[1]) * KX)
    for n in (a1, b1): push(n, dd(p1, cv[n]), None)
    tgt = {a2: dd(p2, cv[a2]), b2: dd(p2, cv[b2])}
    best, bn = 1e18, None; seen = set()
    while heap:
        c, n = heapq.heappop(heap)
        if c > dist[n] or n in seen: continue
        seen.add(n)
        if c >= best: break
        if n in tgt and c + tgt[n] < best: best, bn = c + tgt[n], n
        for m, d in cadj[n]: push(m, c + d, n)
    if bn is None: return None
    chain, n = [], bn
    while n is not None: chain.append(cv[n]); n = prev[n]
    chain.reverse()
    # segmento inicial/final: si el camino parte del vértice que queda "detrás" del punto proyectado, se evita el vaivén
    pts = [p1] + chain + [p2]
    # quita vaivenes en los extremos: si saltar el primer (o último) vértice no alarga el camino, se omite
    d2 = lambda P, Q: math.hypot((P[0] - Q[0]) * KY, (P[1] - Q[1]) * KX)
    while len(pts) > 3 and d2(pts[0], pts[2]) <= d2(pts[0], pts[1]) + d2(pts[1], pts[2]) - 3 and d2(pts[0], pts[2]) < d2(pts[1], pts[2]) + 5: pts.pop(1)
    while len(pts) > 3 and d2(pts[-1], pts[-3]) <= d2(pts[-1], pts[-2]) + d2(pts[-2], pts[-3]) - 3 and d2(pts[-1], pts[-3]) < d2(pts[-2], pts[-3]) + 5: pts.pop(-2)
    return pts

# ---------- rutas ----------
rs = json.load(open(ROOT / "web/data/route-stops.json")); ridx = json.load(open(ROOT / "web/data/routes-index.json"))
stops = rs["stops"]
plen = lambda p: sum(math.hypot((p[j + 1][0] - p[j][0]) * KY, (p[j + 1][1] - p[j][1]) * KX) for j in range(len(p) - 1))
_cand = {}
def cands(k):
    if k not in _cand: _cand[k] = [c for c in snap_all(stops[k][1], stops[k][2], 5) if c[3] < 450]
    return _cand[k]
_pp = {}
def combos(kp, k, anyway):
    """Caminos entre todos los enganches posibles de dos paradas consecutivas: {(i, j): (longitud, puntos)}."""
    key = (kp, k, anyway)
    if key not in _pp:
        Q, P = stops[kp], stops[k]; straight = math.hypot((P[1] - Q[1]) * KY, (P[2] - Q[2]) * KX); res = {}
        for i, A in enumerate(cands(kp)):
            for j, B in enumerate(cands(k)):
                pts = route(A, B, straight, anyway)
                if pts: res[(i, j)] = (plen(pts), pts)
        _pp[key] = res
    return _pp[key]
# cable: línea recta oficial entre estaciones (capa 14 del geovisor, ya en network.geojson como letra T)
cable_lines = []
for f in _net["features"]:
    if f["properties"].get("l") == "T" and not f["properties"].get("st"):
        g = f["geometry"]; cable_lines += [[(lat, lon) for lon, lat in (c)] for c in (g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]])]
def cable_seg(Q, P):
    for ln in cable_lines:
        if (math.hypot((ln[0][0] - Q[0]) * KY, (ln[0][1] - Q[1]) * KX) < 120 and math.hypot((ln[-1][0] - P[0]) * KY, (ln[-1][1] - P[1]) * KX) < 120): return [Q] + ln + [P]
        if (math.hypot((ln[-1][0] - Q[0]) * KY, (ln[-1][1] - Q[1]) * KX) < 120 and math.hypot((ln[0][0] - P[0]) * KY, (ln[0][1] - P[1]) * KX) < 120): return [Q] + ln[::-1] + [P]
    return [Q, P]            # la cable va en línea recta entre torres: es el trazado real
STAT = {"corredor": 0, "calles": 0, "recta": 0, "cable": 0}
def trunk_pair(kp, k, sysn):
    """Un tramo troncal/dual: corredor oficial; si no encaja, calles; último recurso, recta."""
    Q, P = (stops[kp][1], stops[kp][2]), (stops[k][1], stops[k][2]); straight = math.hypot((P[0] - Q[0]) * KY, (P[1] - Q[1]) * KX)
    CA, CB = csnap(*Q), csnap(*P)
    via = VIA.get((stops[kp][0], stops[k][0]))
    if via and CA and CB:
        w = [CA] + [csnap(*v, maxd=250) for v in via] + [CB]
        if all(w):
            legs_ = [croute(w[x], w[x + 1]) for x in range(len(w) - 1)]
            if all(legs_): STAT["corredor"] += 1; return [p for lg in legs_ for p in lg]
    if CA and CB:
        cs = croute(CA, CB)
        if cs and plen(cs) <= straight * 3.2 + 200: STAT["corredor"] += 1; return cs
    cm = combos(kp, k, sysn == "troncal")                # troncal: sin respetar sentidos (las estaciones quedan entre calzadas)
    if cm:
        L, pts = min(cm.values(), key=lambda v: v[0])
        if L <= max(800, straight * 3): STAT["calles"] += 1; return pts
    return None
def street_route(lst):
    """Ruta por calles: se elige UN enganche por parada (de entre los candidatos) que minimiza el recorrido total (programación dinámica)."""
    C = [cands(k) for k in lst]; n = len(lst)
    INF = 1e18; best = [{ci: (3 * c[3], None) for ci, c in enumerate(C[0])} or {0: (0, None)}]
    segs = []
    for i in range(1, n):
        kp, k = lst[i - 1], lst[i]; cm = combos(kp, k, False)
        Q, P = stops[kp], stops[k]; straight = math.hypot((P[1] - Q[1]) * KY, (P[2] - Q[2]) * KX)
        cur = {}
        for jb in (range(len(C[i])) if C[i] else [0]):
            nodec = 3 * C[i][jb][3] if C[i] else 0; bj = (INF, None)
            for ia, (cost_a, _) in best[-1].items():
                if (ia, jb) in cm: c = cost_a + cm[(ia, jb)][0] + nodec
                else: c = cost_a + straight * 4 + 1500 + nodec           # sin camino: se puentea con recta (muy penalizado)
                if c < bj[0]: bj = (c, ia)
            cur[jb] = bj
        best.append(cur)
    # reconstruir
    j = min(best[-1], key=lambda x: best[-1][x][0]); choice = [j]
    for i in range(n - 1, 0, -1): j = best[i][j][1]; choice.append(j)
    choice.reverse(); res = []
    for i in range(1, n):
        kp, k = lst[i - 1], lst[i]; cm = combos(kp, k, False)
        got = cm.get((choice[i - 1], choice[i])); seg = got[1] if got else None; L = got[0] if got else None
        Q, P = stops[kp], stops[k]; straight = math.hypot((P[1] - Q[1]) * KY, (P[2] - Q[2]) * KX)
        # rodeo absurdo (casi siempre vías internas de portales/terminales que OpenStreetMap no marca como públicas): se prueba sin respetar
        # sentidos (queda por las mismas calles) y, si el tramo es corto, se une con una línea directa dentro del portal
        if seg is None or L > 3 * straight + 400:
            alt = combos(kp, k, True)
            if alt:
                La, pa = min(alt.values(), key=lambda v: v[0])
                if La <= straight * 1.8 + 250: seg = pa; STAT["sin_sentido"] = STAT.get("sin_sentido", 0) + 1
            if (seg is None or plen(seg) > 3 * straight + 400) and straight < 500: seg = [(Q[1], Q[2]), (P[1], P[2])]; STAT["directo_corto"] = STAT.get("directo_corto", 0) + 1
        res.append(seg)
    return res
cache = {}
out, nbad, npairs = {}, 0, 0
# trazados oficiales de los servicios (capa 15): si encajan con las paradas, reemplazan al recorrido calculado
OFF = None
if (CACHE / "servicios-oficiales.json").exists() and "--no-official" not in sys.argv:
    from official_shapes import Official
    OFF = Official(CACHE / "servicios-oficiales.json")
OFFSTAT = collections.defaultdict(lambda: {"rutas": 0, "oficial": 0, "dev_ok": 0, "dev": []})
rids = list(rs["routes"].keys())
for n_, rid in enumerate(rids):
    lst = rs["routes"][rid]; sysn = ridx.get(rid, {}).get("s", ""); pts, sidx, bad = [], [], 0
    if sysn in ("troncal", "dual"): raw = [trunk_pair(lst[i - 1], lst[i], sysn) for i in range(1, len(lst))]
    elif sysn == "transmicable": raw = [cable_seg((stops[lst[i - 1]][1], stops[lst[i - 1]][2]), (stops[lst[i]][1], stops[lst[i]][2])) for i in range(1, len(lst))]; STAT["cable"] += len(raw)
    else: raw = street_route(lst) if len(lst) > 1 else []
    for i, k in enumerate(lst):
        P = (stops[k][1], stops[k][2])
        if i == 0: pts.append(P); sidx.append(0); continue
        kp = lst[i - 1]; Q = (stops[kp][1], stops[kp][2]); seg = raw[i - 1]; npairs += 1
        if seg is None: bad += 1; STAT["recta"] += 1; seg = [Q, P]
        elif sysn == "transmicable": pass
        else: seg = [Q] + rdp(seg, 2.5) + [P]
        pts += seg[1:]; sidx.append(len(pts) - 1)
    src = "c"
    if OFF and len(lst) > 1 and sysn != "transmicable":
        S_ = [(stops[k][1], stops[k][2]) for k in lst]; st_ = OFFSTAT[sysn]; st_["rutas"] += 1
        res = OFF.shape(ridx[rid]["c"], S_)
        if res:
            segs, info = res; st_["oficial"] += 1
            dv = OFF.deviation(info["line"], pts); st_["rev"] = st_.get("rev", 0) + (1 if info["rev"] else 0); md = sum(dv) / len(dv); st_["dev"].append((round(md), ridx[rid]["c"], round(max(dv))))
            if md < 40: st_["dev_ok"] += 1
            pts2, sidx2, bad2 = [], [], 0
            for i in range(1, len(lst)):
                seg = segs[i - 1]
                if seg is None:
                    # el trazado oficial no separa estas dos paradas: se usa el recorrido calculado (o, si no hay, una recta corta)
                    alt = raw[i - 1] if sysn != "transmicable" and i - 1 < len(raw) else None
                    seg = [S_[i - 1]] + rdp(alt, 2.5) + [S_[i]] if alt else [S_[i - 1], S_[i]]
                    if not alt and math.hypot((S_[i][0] - S_[i - 1][0]) * KY, (S_[i][1] - S_[i - 1][1]) * KX) > 80: bad2 += 1
                    seg = [S_[i - 1]] + seg[1:-1] + [S_[i]] if alt else seg
                else: seg = rdp(seg, 2.5)           # sobre la línea oficial, sin ramales hasta cada parada (el mapa ajusta los círculos a la línea)
                if not pts2: pts2 += seg; sidx2.append(0)
                else: pts2 += seg[1:] if math.hypot((pts2[-1][0] - seg[0][0]) * KY, (pts2[-1][1] - seg[0][1]) * KX) < 1 else seg
                sidx2.append(len(pts2) - 1)
            pts, sidx, bad, src = pts2, sidx2, bad2, "o"
    nbad += bad
    out[rid] = {"p": enc(pts), "s": sidx, "f": bad, "o": 1 if src == "o" else 0}
    if n_ % 100 == 0: print(f"{n_}/{len(rids)} rutas, {npairs} pares, {nbad} en recta, {round(time.time() - t0)} s", flush=True)
if "--no-roads" not in sys.argv:
    roads = {"n": [c for p in nodes for c in (round(p[0] * 1e5), round(p[1] * 1e5))],
             "e": [[u, v, round(L), wt, enc(rdp(list(g), 1.5))] for (u, v, g, L, wt, f, b) in edges]}
    rd = ROOT / "backend/server-data/roads.json"; rd.write_text(json.dumps(roads, separators=(",", ":")))
    print("roads.json", rd.stat().st_size // 1024, "KB")
dst = ROOT / "backend/server-data/shapes.json"
dst.write_text(json.dumps(out, separators=(",", ":")))
print(STAT)
if OFF:
    for k, v in sorted(OFFSTAT.items()):
        d = sorted(x[0] for x in v["dev"])
        print(f"  oficial {k:22s} rutas {v['rutas']:4d}  con trazado oficial {v['oficial']:4d} (al revés {v.get('rev', 0)})  propio≈oficial (<40 m) {v['dev_ok']:4d}  desviación media propia mediana {d[len(d)//2] if d else 0} m")
        for x in sorted(v["dev"], reverse=True)[:3]: print("       peor:", x)
print("listo:", len(out), "rutas;", npairs, "pares;", nbad, "tramos en recta;", dst.stat().st_size // 1024, "KB;", round(time.time() - t0), "s")
