#!/usr/bin/env python3
"""Construye data/route-stops.json (paradas de cada ruta) a partir de GTFS.zip.

    python3 tools/build-route-stops.py /ruta/a/GTFS.zip

Formato: { "times": { "<route_id>": [segundos desde la primera parada, ...] } (alineado con "routes"), "stops": [[nombre, lat, lon, banderas], ...]   (banderas: 1 = TM, 2 = zonal, 4 = alimentador), "routes": { "<route_id>": [índice de parada, ...] } }
Las paradas que pertenecen a una estación se funden en la estación (una sola marca por estación).
"""
import csv, io, json, sys, zipfile, collections

z = zipfile.ZipFile(sys.argv[1])
OUT = __file__.rsplit("/tools/", 1)[0] + "/data/route-stops.json"

stops = {}
for r in csv.DictReader(io.TextIOWrapper(z.open("stops.txt"), encoding="utf-8-sig")):
    stops[r["stop_id"]] = r
def anchor(sid):
    s = stops.get(sid)
    while s and s.get("parent_station") and s["parent_station"] in stops: s = stops[s["parent_station"]]
    return s

rep = {}
for r in csv.DictReader(io.TextIOWrapper(z.open("trips.txt"), encoding="utf-8-sig")):
    rep.setdefault(r["route_id"], r["trip_id"])
want = {t: r for r, t in rep.items()}

def secs(t):
    h, m, x = t.split(":"); return int(h) * 3600 + int(m) * 60 + int(x)
seqs = collections.defaultdict(list)
with z.open("stop_times.txt") as f:
    head = f.readline().decode().strip().split(",")
    ix = {k: i for i, k in enumerate(head)}
    for line in io.TextIOWrapper(f, encoding="utf-8-sig"):
        tid = line[: line.index(",")]
        if tid in want:
            p = line.rstrip("\n").split(",")
            seqs[want[tid]].append((int(p[ix["stop_sequence"]]), p[ix["stop_id"]], secs(p[ix["departure_time"]])))

idx = json.load(open(OUT.rsplit("/", 1)[0] + "/routes-index.json"))
FLAG = {"troncal": 1, "dual": 1, "transmicable": 1, "alimentador": 4}   # 1 = TM, 2 = zonal (SITP), 4 = alimentador
table, pos, routes, times, flags = [], {}, {}, {}, collections.defaultdict(int)
for rid, seq in seqs.items():
    out, tt = [], []
    t0 = min(x[2] for x in seq)
    for _, sid, sec in sorted(seq):
        s = anchor(sid)
        if not s: continue
        k = s["stop_id"]
        if k not in pos:
            pos[k] = len(table)
            table.append([s["stop_name"].strip(), round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)])
        flags[pos[k]] |= FLAG.get(idx.get(rid, {}).get("s"), 2)
        if not out or out[-1] != pos[k]:
            out.append(pos[k]); tt.append(sec - t0)
    routes[rid] = out; times[rid] = tt
table = [t + [flags[i]] for i, t in enumerate(table)]
json.dump({"stops": table, "routes": routes, "times": times}, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(routes), "rutas,", len(table), "paradas →", OUT)
