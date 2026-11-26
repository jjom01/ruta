#!/usr/bin/env python3
"""Construye server-data/streets.json: las calles numeradas de Bogotá (Calle, Carrera, Diagonal, Transversal)
con su trazado, a partir de OpenStreetMap vía Overpass. Se ejecuta una sola vez (o cuando quieras refrescar):

    python3 tools/build-streets.py

El servidor las usa para ubicar direcciones como "Calle 80 # 69-20" en la esquina de Calle 80 con Carrera 69,
sin enviar la dirección a ningún servicio externo. Datos © colaboradores de OpenStreetMap (ODbL).
"""
import json, math, re, subprocess, sys, time

OUT = __file__.rsplit("/tools/", 1)[0] + "/server-data/streets.json"
BBOX = "4.40,-74.35,4.90,-73.90"
UA = "Ruta/1.0"
TYPES = {"calle": "Calle", "carrera": "Carrera", "diagonal": "Diagonal", "transversal": "Transversal"}

def overpass(name_re):
    q = f'[out:json][timeout:180];way["highway"]["name"~"{name_re}"]({BBOX});out geom tags;'
    for attempt in range(10):
        out = subprocess.run(["curl", "-s", "-m", "240", "-A", UA, "--data-urlencode", "data=" + q, "https://overpass-api.de/api/interpreter"], capture_output=True, text=True).stdout
        try:
            return json.loads(out)["elements"]
        except Exception:
            wait = 15 * (attempt + 1)
            print(f"  Overpass ocupado, reintento en {wait}s ({attempt + 1}/10)", flush=True)
            time.sleep(wait)
    sys.exit("Overpass no respondió; vuelve a intentarlo más tarde.")

def key_of(name):
    """'Avenida Calle 80 Bis Sur' -> ('calle', '80bs'); None si no es una vía numerada."""
    n = re.sub(r"^(Avenida|Autopista|Av\.?)\s+", "", name.strip(), flags=re.I)
    m = re.match(r"^(Calle|Carrera|Diagonal|Transversal)\s+(\d+)\s*([A-Za-z]{0,2})?\s*(Bis)?\s*(Sur|Este)?\s*$", n, re.I)
    if not m: return None
    t, num, letter, bis, side = m.groups()
    return t.lower(), f"{int(num)}{(letter or '').lower()}{'b' if bis else ''}{'s' if (side or '').lower() == 'sur' else ''}"

def dp(p, eps):
    if len(p) < 3: return p
    (x1, y1), (x2, y2) = p[0], p[-1]
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1e-12
    md, mi = 0, 0
    for i in range(1, len(p) - 1):
        d = abs(dy * p[i][0] - dx * p[i][1] + x2 * y1 - y2 * x1) / n
        if d > md: md, mi = d, i
    return dp(p[: mi + 1], eps)[:-1] + dp(p[mi:], eps) if md > eps else [p[0], p[-1]]

streets = {}
for label in ("Calle", "Carrera", "Diagonal", "Transversal"):
    print(f"Descargando {label}…", flush=True)
    for w in overpass(f"^(Avenida |Autopista )?{label} [0-9]+"):
        k = key_of(w["tags"].get("name", ""))
        if not k: continue
        pts = [[round(g["lat"], 5), round(g["lon"], 5)] for g in w["geometry"]]
        streets.setdefault(f"{k[0]}|{k[1]}", []).append(dp(pts, 4e-5))
    time.sleep(8)
json.dump(streets, open(OUT, "w"), separators=(",", ":"))
print(len(streets), "vías →", OUT)
