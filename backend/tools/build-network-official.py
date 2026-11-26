#!/usr/bin/env python3
"""Red troncal del mapa a partir de la capa pública oficial de TransMilenio
(ArcGIS Online, Mapa_GeoVisor_TransmiGIS: capa 5 trazados troncales, capa 14 cable).
Uso: python3 build-network-official.py layer5.json layer14.json [layer2.json]  ->  web/data/network.geojson
Propiedades: l = letra del troncal (T = cable), mixed = 1 si el tramo es mixto (tipo_tra 2)."""
import json, sys, pathlib
L5, L14 = json.load(open(sys.argv[1]))["features"], json.load(open(sys.argv[2]))["features"]
ST = json.load(open(sys.argv[3]))["features"] if len(sys.argv) > 3 else []
def rnd(c): return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rnd(x) for x in c]
out = []
for f in L5:
    p = f["properties"]; l = p["le_troncal"]
    if len(l) != 1: continue
    if p["esta_oper"] != 1 and l != "S": continue          # solo lo que opera hoy (+ Soacha)
    out.append({"type": "Feature", "properties": {"l": l, "mixed": 1 if p["tipo_tra"] == 2 else 0, "n": p["nom_tronc"]},
                "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}})
for f in L14:
    p = f["properties"]
    if p["esta_oper"] != 1: continue
    out.append({"type": "Feature", "properties": {"l": "T", "mixed": 0, "n": p["cable"]},
                "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}})
for f in ST:   # estaciones troncales en operación (capa 2)
    p = f["properties"]
    if p["esta_oper"] != 1: continue
    out.append({"type": "Feature", "properties": {"st": 1, "n": p["nom_est"]}, "geometry": {"type": "Point", "coordinates": rnd(f["geometry"]["coordinates"])}})
dst = pathlib.Path(__file__).resolve().parents[2] / "web/data/network.geojson"
dst.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":")))
print(len(out), "features ->", dst)
