#!/usr/bin/env python3
"""Auditoría de server-data/shapes.json: busca recorridos con rodeos, vaivenes (giros en U de ≥160° con tramos largos) o rectas.
Por sistema: razón camino/recta por tramo entre paraderos, nº de tramos con razón > R, horquillas y rectas de respaldo.
Uso: python3 backend/tools/audit-shapes.py [--top N]"""
import json, math, sys, collections, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = json.load(open(ROOT / "backend/server-data/shapes.json")); rs = json.load(open(ROOT / "web/data/route-stops.json")); idx = json.load(open(ROOT / "web/data/routes-index.json"))
KX, KY = 111320 * math.cos(4.65 * math.pi / 180), 110540
def dec(s):
    out = []; i = 0; la = lo = 0
    while i < len(s):
        for k in (0, 1):
            sh = r = 0
            while True:
                b = ord(s[i]) - 63; i += 1; r |= (b & 31) << sh; sh += 5
                if b < 32: break
            d = ~(r >> 1) if r & 1 else r >> 1
            if k == 0: la += d
            else: lo += d
        out.append((la / 1e5, lo / 1e5))
    return out
dm = lambda a, b: math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX)
def hairpins(p):
    n = 0
    for a, b, c in zip(p, p[1:], p[2:]):
        u, v = ((b[1] - a[1]) * KX, (b[0] - a[0]) * KY), ((c[1] - b[1]) * KX, (c[0] - b[0]) * KY)
        lu, lv = math.hypot(*u), math.hypot(*v)
        if lu > 25 and lv > 25 and (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < -0.94: n += 1
    return n
TOP = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 8
by = collections.defaultdict(lambda: {"routes": 0, "pairs": 0, "bad_ratio": 0, "hair": 0, "straight": 0, "worst": []})
for rid, r in S.items():
    info = idx.get(rid); 
    if not info: continue
    st = rs["routes"][rid]; P = dec(r["p"]); sx = r["s"]; sysn = info["s"]; b = by[sysn]; b["routes"] += 1; b["straight"] += r["f"]
    rh = 0; rb = 0; worst = 0
    for i in range(1, len(st)):
        seg = P[sx[i - 1]: sx[i] + 1]; A, B = rs["stops"][st[i - 1]], rs["stops"][st[i]]
        straight = dm((A[1], A[2]), (B[1], B[2])); L = sum(dm(x, y) for x, y in zip(seg, seg[1:]))
        ratio = L / straight if straight > 30 else 1; b["pairs"] += 1; worst = max(worst, ratio)
        if ratio > 2.2 and L - straight > 250: rb += 1
        rh += hairpins(seg)
    b["bad_ratio"] += rb; b["hair"] += rh
    if rb or rh: b["worst"].append((rb + rh, info["c"], rid, rb, rh, round(worst, 1), r["f"]))
for sysn, b in sorted(by.items()):
    print(f"{sysn:22s} rutas {b['routes']:4d}  pares {b['pairs']:6d}  rodeos(>2.2x) {b['bad_ratio']:4d}  horquillas {b['hair']:4d}  rectas {b['straight']:4d}")
    for w in sorted(b["worst"], reverse=True)[:TOP]: print("     ", w[1], f"rodeos={w[3]} horquillas={w[4]} peor_razón={w[5]} rectas={w[6]}")
