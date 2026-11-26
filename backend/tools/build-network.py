#!/usr/bin/env python3
"""Construye web/data/network.geojson: la red troncal con UN color por corredor.

Las rutas de una letra (p. ej. las B) pasan por muchas vías que no son su corredor, así que pintar cada ruta con su color
mezcla los colores. Aquí cada tramo se asigna al corredor por donde va:
  1. Corredores que siguen una calle numerada (Autopista Norte = Carrera 45, Calle 80, Calle 26, NQS = Carrera 30, Carrera 7,
     Carrera 10, Caracas = Carrera 14/15, Eje Ambiental = Calle 13), con las calles de server-data/streets.json (OpenStreetMap).
  2. Corredores sin calle numerada (Suba, Américas, cable, Av. Ciudad de Cali): el núcleo donde solo pasan servicios de esa letra.
  3. Todo lo demás se dibuja en gris neutro ("·").

    python3 backend/tools/build-network.py
"""
import json, math, collections, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
routes = json.load(open(f"{ROOT}/web/data/routes.geojson"))
streets = json.load(open(f"{ROOT}/backend/server-data/streets.json"))
feats = [f for f in routes["features"] if f["properties"]["type"] != "zonal"]
lines = lambda f: [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "LineString" else f["geometry"]["coordinates"]

RULES = [  # letra, calles, filtro (lon, lat) que acota el tramo del corredor
    ("B", ["carrera|45"], lambda lo, la: la >= 4.676),                       # Autopista Norte
    ("D", ["calle|80"], lambda lo, la: lo <= -74.0725),                        # Calle 80
    ("K", ["calle|26"], lambda lo, la: -74.19 <= lo <= -74.0765),              # Calle 26 (El Dorado)
    ("E", ["carrera|30"], lambda lo, la: 4.605 <= la <= 4.70),                 # NQS Central
    ("G", ["carrera|30"], lambda lo, la: la < 4.605),                          # NQS Sur
    ("M", ["carrera|7"], lambda lo, la: 4.60 <= la <= 4.78),                   # Carrera 7
    ("L", ["carrera|10"], lambda lo, la: la <= 4.625),                         # Carrera 10
    ("A", ["carrera|14", "carrera|15"], lambda lo, la: 4.598 <= la <= 4.70),   # Caracas
    ("H", ["carrera|14", "carrera|15"], lambda lo, la: la < 4.598),            # Caracas Sur
    ("J", ["calle|13"], lambda lo, la: -74.085 <= lo <= -74.06),               # Eje Ambiental
]
SPINE = set("CFJSZ")  # letras sin calle numerada: se resuelven por su núcleo exclusivo
REACH = {"C": 12, "F": 12, "Z": 8, "S": 8, "J": 6}  # celdas de 0.003° (~330 m) alrededor del núcleo de cada letra
STREET_M = 40

sidx = collections.defaultdict(list)
for L, keys, flt in RULES:
    for k in keys:
        for w in streets.get(k, []):
            for i in range(1, len(w)):
                a, b = w[i - 1], w[i]; la, lo = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                if flt(lo, la): sidx[(round(lo / 0.002), round(la / 0.002))].append((L, a, b))

def street_letter(lo, la):
    best = (1e9, None); kx = 111320 * math.cos(la * math.pi / 180); ky = 110540
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for L, a, b in sidx.get((round(lo / 0.002) + dx, round(la / 0.002) + dy), []):
                ax, ay = (a[1] - lo) * kx, (a[0] - la) * ky; bx, by = (b[1] - lo) * kx, (b[0] - la) * ky
                ddx, ddy = bx - ax, by - ay; s = ddx * ddx + ddy * ddy
                u = 0 if not s else max(0, min(1, -(ax * ddx + ay * ddy) / s))
                d = math.hypot(ax + ddx * u, ay + ddy * u)
                if d < best[0]: best = (d, L)
    return best[1] if best[0] <= STREET_M else None

# 1) etiqueta por calle
segs = []  # (feature, a, b, letra|None)
for f in feats:
    for co in lines(f):
        for i in range(1, len(co)):
            a, b = co[i - 1], co[i]
            segs.append([f, a, b, street_letter((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)])

# 2) núcleos de las letras sin calle numerada (celdas sin etiquetar donde solo pasa esa letra)
S = 0.003; cell = lambda a, b: (round((a[0] + b[0]) / 2 / S), round((a[1] + b[1]) / 2 / S))
present = collections.defaultdict(set)
for f, a, b, lab in segs:
    L = f["properties"]["letter"]
    if lab is None and L in "ABCDEFGHJKLMSTZ": present[cell(a, b)].add(L)
sole = collections.defaultdict(list)
for k, st in present.items():
    if len(st) == 1: sole[next(iter(st))].append(k)
core = {}
for L in SPINE:
    cs = set(sole.get(L, [])); seen = set(); best = []
    for c in cs:
        if c in seen: continue
        comp, stack = [], [c]; seen.add(c)
        while stack:
            x, y = stack.pop(); comp.append((x, y))
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    n = (x + dx, y + dy)
                    if n in cs and n not in seen: seen.add(n); stack.append(n)
        if len(comp) > len(best): best = comp
    core[L] = best
def near_core(L, c):
    return any(math.hypot(x - c[0], y - c[1]) <= REACH.get(L, 5) for x, y in core.get(L, []))

# 3) etiqueta final de cada tramo
out_segs = {}
for f, a, b, lab in segs:
    p = f["properties"]; L = p["letter"]
    if p["type"] == "cable": lab = "T"
    elif lab is None and L in SPINE and near_core(L, cell(a, b)): lab = L
    elif lab is None: lab = "·"
    key = tuple(sorted([(round(a[0], 5), round(a[1], 5)), (round(b[0], 5), round(b[1], 5))]))
    mixed = 1 if (p.get("mixed") or p["type"] == "dual") else 0
    if key not in out_segs or (out_segs[key][0] == "·" and lab != "·"): out_segs[key] = (lab, mixed, a, b)

# 4) uniones: tramos contiguos con la misma etiqueta forman una sola línea
adj = collections.defaultdict(list)
for key, (lab, mixed, a, b) in out_segs.items(): adj[(lab, mixed)].append((tuple(a), tuple(b)))
feat_out = []
for (lab, mixed), ss in adj.items():
    ends = collections.defaultdict(list)
    for i, (a, b) in enumerate(ss): ends[a].append(i); ends[b].append(i)
    used = [False] * len(ss)
    for i in range(len(ss)):
        if used[i]: continue
        used[i] = True; path = [ss[i][0], ss[i][1]]
        for grow in (1, 0):
            while True:
                tip = path[-1] if grow else path[0]; nxt = None
                for j in ends[tip]:
                    if not used[j]: nxt = j; break
                if nxt is None: break
                used[nxt] = True; a, b = ss[nxt]; other = b if a == tip else a
                if grow: path.append(other)
                else: path.insert(0, other)
        feat_out.append({"type": "Feature", "properties": {"l": lab, "mixed": mixed}, "geometry": {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in path]}})
json.dump({"type": "FeatureCollection", "features": feat_out}, open(f"{ROOT}/web/data/network.geojson", "w"), separators=(",", ":"))
cnt = collections.Counter(f["properties"]["l"] for f in feat_out)
print("tramos únicos:", len(out_segs), "líneas:", len(feat_out), dict(cnt))
print("núcleos:", {L: len(c) for L, c in core.items()})
