#!/usr/bin/env python3
"""Construye server-data/schedule.json a partir de GTFS.zip (https://gtfs.transmilenio.gov.co/GTFS.zip).

Por cada ruta guarda su trazado simplificado con distancia acumulada (m) y la curva
tiempo→distancia de un viaje representativo. El servidor la usa para estimar dónde va
un bus asignado a un viaje que no aparece en positions.pb. Uso:

    python3 tools/build-schedule.py /ruta/a/GTFS.zip
"""
import csv, io, json, math, sys, zipfile, collections

zpath = sys.argv[1]
OUT = __file__.rsplit("/tools/", 1)[0] + "/server-data/schedule.json"
z = zipfile.ZipFile(zpath)

def hav(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(x))

def secs(t):
    h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + int(s)

# 1. un viaje representativo por ruta
rep, shape_of = {}, {}
for r in csv.DictReader(io.TextIOWrapper(z.open("trips.txt"), encoding="utf-8-sig")):
    rep.setdefault(r["route_id"], r["trip_id"]); shape_of[r["route_id"]] = r["shape_id"]
want = {t: r for r, t in rep.items()}

# 2. sus horas y distancias
rows = collections.defaultdict(list)
with z.open("stop_times.txt") as f:
    head = f.readline().decode().strip().split(",")
    ix = {k: i for i, k in enumerate(head)}
    for line in io.TextIOWrapper(f, encoding="utf-8-sig"):
        tid = line[: line.index(",")]
        if tid in want:
            p = line.rstrip("\n").split(",")
            rows[want[tid]].append((int(p[ix["stop_sequence"]]), secs(p[ix["departure_time"]]), float(p[ix["shape_dist_traveled"]] or 0)))

# 3. trazados
pts = collections.defaultdict(list)
for r in csv.DictReader(io.TextIOWrapper(z.open("shapes.txt"), encoding="utf-8-sig")):
    pts[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))

def simplify(p, eps=6e-5):
    if len(p) < 3: return p
    (x1, y1), (x2, y2) = p[0], p[-1]; dx, dy = x2 - x1, y2 - y1; n = math.hypot(dx, dy) or 1e-12
    md, mi = 0, 0
    for i in range(1, len(p) - 1):
        d = abs(dy * p[i][0] - dx * p[i][1] + x2 * y1 - y2 * x1) / n
        if d > md: md, mi = d, i
    return simplify(p[: mi + 1], eps)[:-1] + simplify(p[mi:], eps) if md > eps else [p[0], p[-1]]

out = {}
for rid, st in rows.items():
    st.sort()
    sh = [(a, b) for _, a, b in sorted(pts.get(shape_of[rid], []))]
    if len(sh) < 2 or len(st) < 2: continue
    cum = [0.0]
    for a, b in zip(sh, sh[1:]): cum.append(cum[-1] + hav(a, b))
    # distancia por vértice, para conservar la simplificación sin perder metros
    tagged = list(zip(sh, cum))
    keep = set(map(tuple, simplify([list(p) for p in sh])))
    line = [(p[0], p[1], d) for p, d in tagged if tuple(p) in keep]
    t0 = st[0][1]
    out[rid] = {
        "p": [[round(a, 5), round(b, 5)] for a, b, _ in line],
        "c": [round(d) for _, _, d in line],
        "t": [[s - t0, round(d)] for _, s, d in st],
        "len": round(cum[-1]),
    }
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(len(out), "rutas →", OUT)
