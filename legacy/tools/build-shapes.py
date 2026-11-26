#!/usr/bin/env python3
"""Construye data/shapes.json: el trazado real (shapes.txt) de cada ruta y la distancia sobre ese trazado de cada
parada, alineadas con data/route-stops.json. Con esto el mapa dibuja el recorrido exacto del bus.

    python3 tools/build-shapes.py /ruta/a/GTFS.zip      (ejecuta antes build-route-stops.py)

Formato: { "<route_id>": { "p": [lon,lat,lon,lat,...], "c": [metros acumulados por vértice], "d": [metros de cada parada] } }
"""
import csv, io, json, math, sys, zipfile, collections
z = zipfile.ZipFile(sys.argv[1])
ROOT = __file__.rsplit("/tools/", 1)[0]
rs = json.load(open(ROOT + "/data/route-stops.json"))
table = rs["stops"]

def hav(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))

stops = {r["stop_id"]: r for r in csv.DictReader(io.TextIOWrapper(z.open("stops.txt"), encoding="utf-8-sig"))}
def anchor(sid):
    s = stops.get(sid)
    while s and s.get("parent_station") and s["parent_station"] in stops: s = stops[s["parent_station"]]
    return s
byname = collections.defaultdict(list)
for i, s in enumerate(table): byname[(s[0], s[1], s[2])].append(i)

rep, shape_of = {}, {}
for r in csv.DictReader(io.TextIOWrapper(z.open("trips.txt"), encoding="utf-8-sig")):
    if r["route_id"] not in rep: rep[r["route_id"]] = r["trip_id"]; shape_of[r["route_id"]] = r["shape_id"]
want = {t: r for r, t in rep.items()}
seqs = collections.defaultdict(list)
with z.open("stop_times.txt") as f:
    ix = {k: i for i, k in enumerate(f.readline().decode().strip().split(","))}
    for line in io.TextIOWrapper(f, encoding="utf-8-sig"):
        tid = line[: line.index(",")]
        if tid in want:
            p = line.rstrip("\n").split(",")
            seqs[want[tid]].append((int(p[ix["stop_sequence"]]), p[ix["stop_id"]], float(p[ix["shape_dist_traveled"]] or 0)))
pts = collections.defaultdict(list)
need = set(shape_of.values())
for r in csv.DictReader(io.TextIOWrapper(z.open("shapes.txt"), encoding="utf-8-sig")):
    if r["shape_id"] in need: pts[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))

def simplify(p, eps):
    keep = [True] + [False] * (len(p) - 2) + [True]; st = [(0, len(p) - 1)]
    while st:
        a, b = st.pop()
        (x1, y1), (x2, y2) = p[a], p[b]; dx, dy = x2 - x1, y2 - y1; n = math.hypot(dx, dy)
        md, mi = 0, 0
        for i in range(a + 1, b):
            # rutas circulares: inicio = fin (cuerda de largo 0); se mide la distancia al punto de inicio
            d = abs(dy * p[i][0] - dx * p[i][1] + x2 * y1 - y2 * x1) / n if n > eps else math.hypot(p[i][0] - x1, p[i][1] - y1)
            if d > md: md, mi = d, i
        if md > eps: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [i for i, k in enumerate(keep) if k]

def project_dp(sh, cum, stops):
    """Distancia sobre el trazado de cada parada, por proyección: candidatos a ≤120 m y camino monótono de menor costo (resuelve los circuitos)."""
    CELL = 0.0015
    grid = collections.defaultdict(list)
    for i in range(len(sh) - 1):
        (x1, y1), (x2, y2) = sh[i], sh[i + 1]
        for gx in range(int(min(y1, y2) / CELL) - 1, int(max(y1, y2) / CELL) + 2):
            for gy in range(int(min(x1, x2) / CELL) - 1, int(max(x1, x2) / CELL) + 2):
                grid[(gx, gy)].append(i)
    kx = 111320 * math.cos(math.radians(4.65)); ky = 110540
    def cands(lat, lon, segs):
        out = []
        for i in segs:
            (x1, y1), (x2, y2) = sh[i], sh[i + 1]   # (lon, lat)
            ax, ay, bx, by = (x1 - lon) * kx, (y1 - lat) * ky, (x2 - lon) * kx, (y2 - lat) * ky
            dx, dy = bx - ax, by - ay; l = dx * dx + dy * dy
            t = max(0, min(1, -(ax * dx + ay * dy) / l)) if l else 0
            out.append((math.hypot(ax + t * dx, ay + t * dy), cum[i] + t * (cum[i + 1] - cum[i])))
        return out
    C = []
    for lat, lon in stops:
        segs = set()
        for gx in (int(lat / CELL) - 1, int(lat / CELL), int(lat / CELL) + 1):
            for gy in (int(lon / CELL) - 1, int(lon / CELL), int(lon / CELL) + 1):
                segs.update(grid.get((gx, gy), ()))
        cs = [c for c in cands(lat, lon, segs) if c[0] <= 120]
        if not cs: cs = sorted(cands(lat, lon, range(len(sh) - 1)))[:1]
        cs.sort(key=lambda c: c[1])
        kept = []                                  # un candidato por tramo de 150 m del trazado
        for c in cs:
            if kept and c[1] - kept[-1][1] < 150:
                if c[0] < kept[-1][0]: kept[-1] = c
            else: kept.append(c)
        C.append(kept)
    cost = [[c[0] for c in C[0]]]; back = []
    for i in range(1, len(C)):
        row, br = [], []
        for c in C[i]:
            best, bj = 1e18, 0
            for j, p in enumerate(C[i - 1]):
                v = cost[i - 1][j] + (0 if c[1] >= p[1] - 30 else 20000)
                if v < best: best, bj = v, j
            row.append(best + c[0]); br.append(bj)
        cost.append(row); back.append(br)
    j = min(range(len(C[-1])), key=lambda q: cost[-1][q]); pick = [0] * len(C)
    for i in range(len(C) - 1, -1, -1):
        pick[i] = C[i][j][1]
        if i: j = back[i - 1][j]
    for i in range(1, len(pick)): pick[i] = max(pick[i], pick[i - 1])
    return [round(v) for v in pick]

out, bad, proj = {}, 0, 0
for rid, route in rs["routes"].items():
    sh = [(b, a) for _, a, b in sorted(pts.get(shape_of.get(rid), []))]   # (lon, lat)
    seq = sorted(seqs.get(rid, []))
    if len(sh) < 2 or not seq: bad += 1; continue
    cum = [0.0]
    for a, b in zip(sh, sh[1:]): cum.append(cum[-1] + hav((a[1], a[0]), (b[1], b[0])))
    scale = cum[-1] / max(seq[-1][2], 1) if seq[-1][2] else 1
    # la escala de shape_dist_traveled puede ser m o km: se normaliza con el largo real
    ds, last = [], None
    for _, sid, d in seq:
        s = anchor(sid)
        if not s: continue
        k = (s["stop_name"].strip(), round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5))
        if last == k: continue
        last = k; ds.append(round(d * scale))
    if len(ds) != len(route): bad += 1; continue
    rep = max(collections.Counter(ds).values())
    mono = all(b >= a - 5 for a, b in zip(ds, ds[1:]))
    if rep > 0.1 * len(ds) or not mono:           # shape_dist_traveled inservible en esta ruta
        ds = project_dp(sh, cum, [(table[k][1], table[k][2]) for k in route]); proj += 1
    keep = simplify([(x, y) for x, y in sh], 1.2e-5)
    out[rid] = {"p": [round(v, 5) for i in keep for v in sh[i]], "c": [round(cum[i]) for i in keep], "d": ds}
json.dump(out, open(ROOT + "/data/shapes.json", "w"), separators=(",", ":"))
print(len(out), "rutas con trazado,", proj, "con paradas por proyección,", bad, "sin él →", ROOT + "/data/shapes.json")
