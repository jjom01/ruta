#!/usr/bin/env python3
"""Separa web/data/routes.geojson (1,1 MB, con los trazados) en un índice ligero de propiedades:
web/data/routes-meta.json. La app arranca con el índice y baja los trazados después, sin bloquear el primer pintado.
Uso: python3 backend/tools/split-routes.py   (repetir cada vez que cambie routes.geojson)"""
import json, pathlib
D = pathlib.Path(__file__).resolve().parents[2] / "web" / "data"
g = json.load(open(D / "routes.geojson"))
meta = [f["properties"] for f in g["features"]]
json.dump(meta, open(D / "routes-meta.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(meta), "rutas →", D / "routes-meta.json", (D / "routes-meta.json").stat().st_size, "bytes")
