#!/usr/bin/env python3
"""Construye data/service.json y data/cic-routes.geojson a partir de GTFS.zip (calendario de servicio).

    python3 tools/build-service.py /ruta/a/GTFS.zip      (después de build-shapes.py)

service.json: { "holidays": ["20260101", ...],            festivos (usan el servicio del domingo)
                "days": { "<route_id>": máscara },        1 = hábil, 2 = sábado, 4 = domingo/festivo
                "cic": { "<ruta ciclovía>": { "base": "<ruta normal>"|null, "from": s (primera salida), "to": s (última salida + 20 min) } } }
cic-routes.geojson: el trazado de las variantes "Ciclovía" (solo circulan domingos y festivos mientras hay ciclovía).
"""
import csv, io, json, re, sys, zipfile, collections
z = zipfile.ZipFile(sys.argv[1])
ROOT = __file__.rsplit("/tools/", 1)[0]
rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
mask = {}
for r in rd("calendar.txt"):
    mask[r["service_id"]] = (1 if any(r[d] == "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday")) else 0) | (2 if r["saturday"] == "1" else 0) | (4 if r["sunday"] == "1" else 0)
holidays = sorted({r["date"] for r in rd("calendar_dates.txt") if r["service_id"] == "4" and r["exception_type"] == "1"})
routes = {r["route_id"]: r for r in rd("routes.txt")}
days, trips = collections.defaultdict(int), {}
for t in rd("trips.txt"):
    days[t["route_id"]] |= mask.get(t["service_id"], 0)
    trips[t["trip_id"]] = t["route_id"]
isc = lambda r: "iclov" in r["route_long_name"].lower()
cic = {k for k, r in routes.items() if isc(r)}
norm = lambda r: (r["route_short_name"], re.sub(r"\s*cicl[oó]v[ií]a\s*", " ", r["route_long_name"], flags=re.I).strip().lower())
bases = collections.defaultdict(list)
for k, r in routes.items():
    if k not in cic: bases[norm(r)].append(k)
first = {}   # trip_id -> (secuencia, salida en la primera parada)
secs = lambda s: int(s[:2]) * 3600 + int(s[3:5]) * 60 + int(s[6:8])
with z.open("stop_times.txt") as f:
    ix = {k: i for i, k in enumerate(f.readline().decode().strip().split(","))}
    for line in io.TextIOWrapper(f, encoding="utf-8-sig"):
        t = line[: line.index(",")]
        if trips.get(t) in cic:
            p = line.split(",")
            q = int(p[ix["stop_sequence"]]); d = secs(p[ix["departure_time"]])
            if t not in first or q < first[t][0]: first[t] = (q, d)
ft, lt = {}, {}
for t, (_, d) in first.items():
    r = trips[t]; ft[r] = min(ft.get(r, 1e9), d); lt[r] = max(lt.get(r, 0), d)
out = {}
for k in cic:
    b = [x for x in bases.get(norm(routes[k]), []) if days.get(x, 0) & 4]
    out[k] = {"base": b[0] if b else None, "from": ft.get(k, 7 * 3600), "to": lt.get(k, 13 * 3600) + 1200}
json.dump({"holidays": holidays, "days": {k: v for k, v in days.items()}, "cic": out}, open(ROOT + "/data/service.json", "w"), separators=(",", ":"))
shapes, idx = json.load(open(ROOT + "/data/shapes.json")), json.load(open(ROOT + "/data/routes-index.json"))
feats = []
for k in cic:
    s, i = shapes.get(k), idx.get(k)
    if not s or not i: continue
    feats.append({"type": "Feature", "properties": {"id": f"{i['c']}#{k}", "code": i["c"], "letter": "Z0", "type": "zonal", "svc": 1, "cic": 1, "name": i["n"]}, "geometry": {"type": "LineString", "coordinates": [[s["p"][j], s["p"][j + 1]] for j in range(0, len(s["p"]), 2)]}})
json.dump({"type": "FeatureCollection", "features": feats}, open(ROOT + "/data/cic-routes.geojson", "w"), separators=(",", ":"))
print(len(out), "variantes,", sum(1 for v in out.values() if v["base"]), "con ruta base,", len(feats), "trazados,", len(holidays), "festivos")
