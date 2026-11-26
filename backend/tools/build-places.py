#!/usr/bin/env python3
"""Construye server-data/places.json y web/data/places.json: lugares conocidos de Bogotá (centros comerciales, universidades,
hospitales, parques, museos, estadios, barrios, localidades, terminales…) a partir de OpenStreetMap vía Overpass.
Se ejecuta una sola vez (o para refrescar):  python3 backend/tools/build-places.py
Cada lugar: [nombre, lat, lon, tipo, zona]. Datos © colaboradores de OpenStreetMap (ODbL)."""
import json, subprocess, sys, time, pathlib, unicodedata, re
ROOT = pathlib.Path(__file__).resolve().parents[2]
BBOX = "4.45,-74.25,4.85,-73.98"
UA = "Ruta/1.0"
Q = f"""[out:json][timeout:240];
(
 nwr["shop"="mall"]["name"]({BBOX});
 nwr["amenity"~"^(university|college|hospital|library|theatre|cinema|marketplace|bus_station|townhall|courthouse|arts_centre|clinic)$"]["name"]({BBOX});
 nwr["leisure"~"^(park|stadium|sports_centre|garden|nature_reserve)$"]["name"]({BBOX});
 nwr["tourism"~"^(museum|attraction|gallery|zoo|hotel|viewpoint)$"]["name"]({BBOX});
 nwr["historic"]["name"]({BBOX});
 nwr["aeroway"~"^(terminal|aerodrome)$"]["name"]({BBOX});
 nwr["building"~"^(cathedral|church|stadium|train_station|public|government)$"]["name"]["wikidata"]({BBOX});
 nwr["place"~"^(suburb|neighbourhood|quarter|locality|town|village)$"]["name"]({BBOX});
 nwr["boundary"="administrative"]["admin_level"="9"]["name"]({BBOX});
 nwr["landuse"="retail"]["name"]["wikidata"]({BBOX});
 nwr["amenity"~"^(restaurant|cafe|bar|bank|pharmacy|school|place_of_worship|fast_food)$"]["name"]["wikidata"]({BBOX});
 nwr["shop"~"^(supermarket|department_store|books|electronics)$"]["name"]["wikidata"]({BBOX});
);
out center tags;"""
def run():
    for a in range(10):
        out = subprocess.run(["curl", "-s", "-m", "300", "-A", UA, "--data-urlencode", "data=" + Q, "https://overpass-api.de/api/interpreter"], capture_output=True, text=True).stdout
        try: return json.loads(out)["elements"]
        except Exception:
            w = 20 * (a + 1); print(f"Overpass ocupado, reintento en {w}s", flush=True); time.sleep(w)
    sys.exit("Overpass no respondió")
def kind(t):
    if t.get("shop") == "mall" or t.get("landuse") == "retail": return "mall"
    if t.get("amenity") in ("university", "college"): return "university"
    if t.get("amenity") in ("hospital", "clinic"): return "hospital"
    if t.get("amenity") in ("library", "theatre", "cinema", "arts_centre") or t.get("tourism") in ("museum", "gallery"): return "culture"
    if t.get("leisure") in ("park", "garden", "nature_reserve"): return "park"
    if t.get("leisure") in ("stadium", "sports_centre") or t.get("building") == "stadium": return "sport"
    if t.get("aeroway"): return "airport"
    if t.get("amenity") == "bus_station" or t.get("building") == "train_station": return "terminal"
    if t.get("place") or t.get("boundary"): return "area"
    if t.get("tourism") in ("attraction", "viewpoint", "zoo") or t.get("historic"): return "landmark"
    if t.get("amenity") in ("townhall", "courthouse") or t.get("building") in ("public", "government"): return "gov"
    if t.get("tourism") == "hotel": return "hotel"
    if t.get("amenity") == "place_of_worship" or t.get("building") in ("cathedral", "church"): return "church"
    return "place"
def norm(s): return re.sub(r"[^a-z0-9 ]", "", unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()).strip()
els = run(); print(len(els), "elementos")
seen, out = {}, []
for e in els:
    t = e.get("tags", {}); n = (t.get("name") or "").strip()
    c = e.get("center") or ({"lat": e.get("lat"), "lon": e.get("lon")} if "lat" in e else None)
    if not n or not c or c.get("lat") is None: continue
    k = kind(t)
    if k == "area" and t.get("boundary") and t.get("admin_level") == "9": k = "area"
    key = norm(n) + "|" + k
    # un mismo nombre/tipo: se queda el primero (los parques y centros comerciales se parten en varias partes)
    if key in seen and abs(seen[key][1] - c["lat"]) < 0.01 and abs(seen[key][2] - c["lon"]) < 0.01: continue
    zone = t.get("addr:suburb") or t.get("addr:neighbourhood") or t.get("addr:district") or ""
    rec = [n, round(c["lat"], 5), round(c["lon"], 5), k, zone]
    seen[key] = rec; out.append(rec)
out.sort(key=lambda r: (r[3], r[0]))
from collections import Counter; print(Counter(r[3] for r in out))
for p in (ROOT / "web/data/places.json", ROOT / "backend/server-data/places.json"):
    p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"))); print(p, p.stat().st_size // 1024, "KB")
