#!/usr/bin/env python3
"""Prepara el mapa esquemático de Inicio: web/data/src/map-{dark,light}.orig.svg -> web/data/map-{dark,light}.svg
Quita título, leyenda, notas y brújula (la app ya tiene su propia interfaz), recorta el encuadre a la red y
actualiza los nombres de estaciones según los datos oficiales actuales (ver RENAME).
Uso: python3 backend/tools/build-home-map.py"""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2] / "web" / "data"
VIEWBOX = "306 534 3493 2224"  # x y w h: red completa con 60 de margen (medido con getBoundingClientRect)
RENAME = {                  # esquema -> nombre oficial actual (network.geojson / GTFS)
    "Shaio": "Suba Calle 116",       # oficial «Suba - Calle 116»
    "Puente Largo": "Puentelargo",   # oficial «Puentelargo»
    "Boyacá": "Av. Boyacá",          # oficial «AV. Boyacá»
}
TOP, BOTTOM = 480, 2690

def ys_of(e):
    ys = [float(m) for m in re.findall(r'(?:\by|\bcy|\by1|\by2)="([-\d.]+)"', e)]
    m = re.search(r'translate\(([-\d.]+)[ ,]([-\d.]+)\)', e)
    if m: ys.append(float(m.group(2)))
    d = re.search(r' d="([^"]*)"', e)
    if d: ys += [float(v) for v in re.findall(r',([-\d.]+)', d.group(1))]
    return ys
def xs_of(e):
    xs = [float(m) for m in re.findall(r'(?:\bx|\bcx|\bx1|\bx2)="([-\d.]+)"', e)]
    m = re.search(r'translate\(([-\d.]+)[ ,]([-\d.]+)\)', e)
    if m: xs.append(float(m.group(1)))
    return xs

# Modo oscuro: etiquetas más grandes y gruesas con un halo más ancho (se leen sobre las líneas de color), y jerarquía clara:
# estaciones principales/intercambios en blanco y negrita, el resto en gris claro; la nota TRANSMICABLE más visible.
def contrast(s):
    def fix(m):
        e = m.group(0)
        fs = re.search(r'font-size="([\d.]+)"', e)
        if not fs or 'fill="#f5f5f5"' not in e: return e.replace('fill="#8c8c8c"', 'fill="#b8b8b8"')
        big = float(fs.group(1)) >= 25
        e = re.sub(r'font-size="[\d.]+"', f'font-size="{26 if big else 21}"' if float(fs.group(1)) != 19.5 else 'font-size="21"', e)
        e = re.sub(r'font-weight="\d+"', f'font-weight="{700 if big else 600}"', e)
        e = e.replace('fill="#f5f5f5"', 'fill="#ffffff"' if big else 'fill="#e4e4e4"')
        e = re.sub(r'stroke-width="5"', 'stroke-width="8"', e)
        return e
    return re.sub(r'<text\b[^>]*>', fix, s)

def build(theme):
    s = (ROOT / "src" / f"map-{theme}.orig.svg").read_text()
    out, drop = [], 0
    for m in re.finditer(r'<text\b[^>]*>.*?</text>|<(?:line|rect|circle|path)\b[^>]*/>|[^<]+|<[^>]*>', s, re.S):
        e = m.group(0)
        if re.match(r'<(text|line|rect|circle|path)\b', e) and 'width="3900"' not in e and 'r="1.6"' not in e:
            ys, xs = ys_of(e), xs_of(e)
            if ys and (max(ys) < TOP or min(ys) > BOTTOM - 10 or (xs and min(xs) > 3440 and min(ys) > 2630)):
                drop += 1; continue
        out.append(e)
    s = "".join(out)
    for a, b in RENAME.items(): s = s.replace(f">{a}</tspan>", f">{b}</tspan>")
    s = re.sub(r'<title>.*?</title>', '<title>TransMilenio, Bogotá. Mapa esquemático</title>', s)
    s = re.sub(r'\s+width="3900" height="2900"', '', s, count=1)
    s = s.replace('viewBox="0 0 3900 2900"', f'viewBox="{VIEWBOX}"', 1)
    if theme == "dark": s = contrast(s)
    (ROOT / f"map-{theme}.svg").write_text(s)
    print(theme, "quitados", drop)
for t in ("dark", "light"): build(t)
