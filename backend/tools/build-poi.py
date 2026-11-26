#!/usr/bin/env python3
"""Construye server-data/poi.json: comercios y lugares de Bogotá (restaurantes, tiendas, servicios, sitios históricos…) de
Overture Maps (tema "places", licencia CDLA-Permissive-2.0, © Overture Maps Foundation; incluye datos de Meta, Microsoft y Foursquare).
Requiere:  pip install duckdb      Uso:  python3 backend/tools/build-poi.py [release] [parquet-local]
El servidor lo carga en memoria y lo consulta desde /api/geocode (es demasiado grande para enviarlo al teléfono)."""
import json, sys, pathlib, re, unicodedata
import duckdb
ROOT = pathlib.Path(__file__).resolve().parents[2]
REL = sys.argv[1] if len(sys.argv) > 1 else "2026-11-18.0"
SRC = sys.argv[2] if len(sys.argv) > 2 else None
MIN_CONF = 0.3
c = duckdb.connect()
if SRC:
    frm = f"read_parquet('{SRC}')"
    sel = "name, cat, conf, addr, lon, lat"
else:
    c.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    frm = f"""(select names.primary as name, taxonomy.primary as cat, confidence as conf, addresses[1].freeform as addr, bbox.xmin as lon, bbox.ymin as lat
      from read_parquet('s3://overturemaps-us-west-2/release/{REL}/theme=places/type=place/*', hive_partitioning=1)
      where bbox.xmin between -74.25 and -73.98 and bbox.ymin between 4.45 and 4.85 and names.primary is not null)"""
    sel = "*"
rows = c.execute(f"select {sel} from {frm} where conf >= {MIN_CONF} and length(name) between 2 and 80").fetchall()
def norm(s): return re.sub(r"[^a-z0-9ñ ]+", " ", unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()).strip()
seen, out = {}, []
for name, cat, conf, addr, lon, lat in rows:
    k = norm(name)
    if not k: continue
    key = (k, round(lat, 3), round(lon, 3))       # mismo nombre a menos de ~100 m: un solo registro (el de más confianza)
    if key in seen:
        if conf > out[seen[key]][5]: out[seen[key]] = [name.strip(), round(lat, 5), round(lon, 5), cat or "", (addr or "").strip(), round(conf, 2)]
        continue
    seen[key] = len(out)
    out.append([name.strip(), round(lat, 5), round(lon, 5), cat or "", (addr or "").strip(), round(conf, 2)])
dst = ROOT / "backend/server-data/poi.json"
dst.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print(len(out), "lugares ->", dst, dst.stat().st_size // 1024, "KB")
