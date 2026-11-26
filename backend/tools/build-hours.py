#!/usr/bin/env python3
"""Construye web/data/hours.json: primer y último servicio por ruta y tipo de día, desde GTFS.zip.

Para cada ruta toma la hora de salida del primer paradero de cada viaje y guarda la menor y la mayor
(en minutos desde medianoche; pueden pasar de 1440 si el servicio cruza la medianoche).
Tipo de día según calendar.txt: h = hábil (lun-vie), s = sábado, d = domingo; f = festivo (viajes que calendar_dates.txt agrega en los festivos).
La clave "_hol" lista las fechas festivas (AAAAMMDD).
Uso: python3 tools/build-hours.py /ruta/a/GTFS.zip
"""
import csv, io, json, sys, zipfile, collections

z = zipfile.ZipFile(sys.argv[1])
OUT = __file__.rsplit("/tools/", 1)[0].rsplit("/backend", 1)[0] + "/web/data/hours.json"

cal = {}
for r in csv.DictReader(io.TextIOWrapper(z.open("calendar.txt"), encoding="utf-8-sig")):
    days = set()
    if int(r["monday"]): days.add("h")
    if int(r["saturday"]): days.add("s")
    if int(r["sunday"]): days.add("d")
    cal[r["service_id"]] = days

hol, holsvc = set(), set()   # festivos: fechas y servicios que se agregan esos días
for r in csv.DictReader(io.TextIOWrapper(z.open("calendar_dates.txt"), encoding="utf-8-sig")):
    if r["exception_type"] == "1": hol.add(r["date"]); holsvc.add(r["service_id"])
for sid in holsvc: cal[sid] = cal.get(sid, set()) | {"f"}

trip = {}   # trip_id -> (route_id, service_id)
for r in csv.DictReader(io.TextIOWrapper(z.open("trips.txt"), encoding="utf-8-sig")):
    trip[r["trip_id"]] = (r["route_id"], r["service_id"])

first = {}   # trip_id -> (secuencia, salida)
with z.open("stop_times.txt") as f:
    head = f.readline().decode("utf-8-sig").strip().split(",")
    ix = {k: i for i, k in enumerate(head)}; it, iq, idp = ix["trip_id"], ix["stop_sequence"], ix["departure_time"]
    for line in io.TextIOWrapper(f, encoding="utf-8"):
        p = line.rstrip("\n").split(",")
        tid = p[it]
        if tid not in trip: continue
        q = int(p[iq])
        if tid not in first or q < first[tid][0]:
            h, m, _ = p[idp].split(":"); first[tid] = (q, int(h) * 60 + int(m))

# Transmicable no trae stop_times: sus horas salen de frequencies.txt (inicio de la primera franja, fin de la última)
for r in csv.DictReader(io.TextIOWrapper(z.open("frequencies.txt"), encoding="utf-8-sig")):
    if r["trip_id"] in trip:
        s = lambda v: int(v[:2]) * 60 + int(v[3:5])
        first[r["trip_id"] + "#a"] = (0, s(r["start_time"])); first[r["trip_id"] + "#b"] = (0, s(r["end_time"]))
        trip[r["trip_id"] + "#a"] = trip[r["trip_id"] + "#b"] = trip[r["trip_id"]]

# Se agrupa por código de ruta (una tarjeta de la app reúne varios route_id)
code = {r["route_id"]: r["route_short_name"] for r in csv.DictReader(io.TextIOWrapper(z.open("routes.txt"), encoding="utf-8-sig"))}
out = collections.defaultdict(dict)
for tid, (_, mins) in first.items():
    rid, sid = trip[tid]
    c = code.get(rid)
    if not c: continue
    for d in cal.get(sid, ()):
        a = out[c].setdefault(d, [mins, mins])
        a[0] = min(a[0], mins); a[1] = max(a[1], mins)
out["_hol"] = sorted(hol)
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(len(out), "rutas →", OUT)
