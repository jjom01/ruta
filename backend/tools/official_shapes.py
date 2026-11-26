"""Recorridos oficiales de los servicios (capa 15 "Servicios" del geovisor de TransMilenio, .cache/servicios-oficiales.json).
Para cada ruta se busca el trazado oficial que mejor encaja con sus paradas (por código y, si no hay, por geometría) y se recorta entre
cada par de paradas. Así el mapa muestra el recorrido real del servicio (retornos, lados de la vía, desvíos) en vez de uno calculado."""
import json, math, re, collections
import numpy as np
KX, KY = 111320 * math.cos(4.65 * math.pi / 180), 110540
norm = lambda c: re.sub(r"[^a-z0-9]", "", str(c).lower())

class Official:
    def __init__(self, path):
        self._rev = {}; self.lines = []; self.by_code = collections.defaultdict(list); self.grid = collections.defaultdict(set)
        for f in json.load(open(path))["features"]:
            g = f["geometry"]; parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
            pts = [(lat, lon) for part in parts for lon, lat in part]
            if len(pts) < 2: continue
            P = np.array([(lat * KY, lon * KX) for lat, lon in pts]); seg = np.hypot(*(P[1:] - P[:-1]).T)
            cum = np.concatenate([[0], np.cumsum(seg)]); i = len(self.lines)
            self.lines.append({"p": f["properties"], "ll": np.array(pts), "xy": P, "cum": cum, "len": cum[-1]})
            pr = f["properties"]
            for key in {norm(pr.get("cod_linea")), norm(re.sub(r"-\d+[a-z]?$", "", str(pr.get("cod_ruta")))), norm(pr.get("cod_ruta"))}:
                if key: self.by_code[key].append(i)
            # índice espacial: un punto cada ≤ 100 m
            for a, b in zip(pts, pts[1:]):
                n = max(1, int(math.hypot((b[0] - a[0]) * KY, (b[1] - a[1]) * KX) // 100))
                for q in range(n + 1): self.grid[(int((a[0] + (b[0] - a[0]) * q / n) / 0.002), int((a[1] + (b[1] - a[1]) * q / n) / 0.002))].add(i)

    def _near(self, lat, lon, r=1):
        s = set(); ci, cj = int(lat / 0.002), int(lon / 0.002)
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1): s |= self.grid.get((i, j), set())
        return s

    def reversed(self, ci):
        """La misma línea recorrida al revés (el servicio de regreso suele usar las mismas calles)."""
        key = -ci - 1
        if key not in self._rev:
            L = self.lines[ci]; self._rev[key] = {"p": L["p"], "ll": L["ll"][::-1].copy(), "xy": L["xy"][::-1].copy(), "cum": (L["cum"][-1] - L["cum"][::-1]).copy(), "len": L["len"], "rev": True}
        return self._rev[key]

    def candidates(self, code, stops):
        c = list(dict.fromkeys(self.by_code.get(norm(code), [])))
        if c: return c
        f, l, m = stops[0], stops[-1], stops[len(stops) // 2]
        return list(self._near(*f) & self._near(*l) & self._near(*m))

    def project(self, L, S):
        """Candidatos de posición (m a lo largo de la línea, distancia) de cada parada: hasta 8 por parada, separados ≥ 60 m."""
        A, B = L["xy"][:-1], L["xy"][1:]; V = B - A; l2 = (V ** 2).sum(1); out = []
        for s in S:
            sp = np.array([s[0] * KY, s[1] * KX]); t = np.clip(((sp - A) * V).sum(1) / np.where(l2 > 0, l2, 1), 0, 1)
            proj = A + V * t[:, None]; d = np.hypot(*(sp - proj).T); along = L["cum"][:-1] + t * np.sqrt(l2)
            order = np.argsort(d); got = []
            for k in order:
                if d[k] > 150: break
                if all(abs(along[k] - g[0]) > 60 for g in got): got.append((float(along[k]), float(d[k])))
                if len(got) >= 8: break
            out.append(got)
        return out

    def fit(self, L, S):
        C = self.project(L, S); n = len(S); miss = sum(1 for c in C if not c)
        INF = 1e18; prev = None; back = []
        for i, cs in enumerate(C):
            if not cs: cs = [(prev[0][0][0] if prev else 0.0, 200.0)]; C[i] = cs
            cur = []; bk = []
            for (a, d) in cs:
                if prev is None: cur.append(d); bk.append(-1); continue
                best, bj = INF, -1
                for j, (pa, _) in enumerate(prev[0]):
                    if a < pa - 40: continue
                    step = a - pa; straight = math.hypot((S[i][0] - S[i - 1][0]) * KY, (S[i][1] - S[i - 1][1]) * KX)
                    c = prev[1][j] + d + 0.02 * max(0.0, step - 3 * max(straight, 120))
                    if c < best: best, bj = c, j
                cur.append(best); bk.append(bj)
            prev = (cs, cur); back.append(bk)
        if prev is None: return None
        j = int(np.argmin(prev[1]))
        if prev[1][j] >= INF: return None
        pos = [0] * n; ds = [0] * n
        for i in range(n - 1, -1, -1):
            pos[i], ds[i] = C[i][j]; j = back[i][j] if i else j
        return {"pos": pos, "d": ds, "miss": miss, "cost": float(min(prev[1]))}

    def slice(self, L, a, b):
        cum, ll = L["cum"], L["ll"]
        i = int(np.searchsorted(cum, a, "right")) - 1; j = int(np.searchsorted(cum, b, "right")) - 1
        def at(x, k):
            k = min(max(k, 0), len(cum) - 2); seg = cum[k + 1] - cum[k]; t = 0 if seg <= 0 else (x - cum[k]) / seg
            return (ll[k][0] + (ll[k + 1][0] - ll[k][0]) * t, ll[k][1] + (ll[k + 1][1] - ll[k][1]) * t)
        out = [at(a, i)] + [tuple(ll[k]) for k in range(i + 1, j + 1)] + [at(b, j)]
        return out

    def shape(self, code, stops_ll):
        """(puntos por tramo, ajuste) con el mejor trazado oficial, o None si ninguno encaja bien.
        Las paradas de los extremos (portales, cabeceras) pueden quedar fuera del trazado oficial: se prueban recortes de hasta 2 paradas por lado
        y esos tramos (None) se resuelven con el recorrido calculado."""
        n0 = len(stops_ll); best = None
        for ci in self.candidates(code, stops_ll):
            for L in (self.lines[ci], self.reversed(ci)):
                for ta, tb in ((0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (0, 2), (2, 1), (1, 2), (2, 2)):
                    S = stops_ll[ta: n0 - tb]
                    if len(S) < 3 and (ta or tb): continue
                    r = self.fit(L, S)
                    if not r: continue
                    d = sorted(r["d"]); n = len(d); p90 = d[int(n * 0.9)]; med = d[n // 2]
                    ok = r["miss"] <= max(1, int(0.08 * n)) and med <= 45 and p90 <= 100
                    score = (ta + tb, r["miss"], r["cost"] / n)
                    if ok and (best is None or score < best[0]): best = (score, L, r, ta, tb)
                    if ok: break                      # el recorte menor que sirve es el que vale
        if not best: return None
        _, L, r, ta, tb = best; pos = r["pos"]; segs = []
        for i in range(1, n0):
            ia, ib = i - 1 - ta, i - ta                 # índices en la lista recortada
            if ia < 0 or ib >= len(pos): segs.append(None); continue
            a, b = pos[ia], pos[ib]
            segs.append(self.slice(L, a, b) if b > a + 1 else None)
        return segs, {"line": L, "len": float(L["len"]), "miss": r["miss"], "med": sorted(r["d"])[len(r["d"]) // 2], "rev": bool(L.get("rev")), "trim": ta + tb}

    def deviation(self, L, pts):
        """Distancia (m) de cada punto del recorrido propio al trazado oficial: para medir qué tan bien quedó el cálculo propio."""
        A, B = L["xy"][:-1], L["xy"][1:]; V = B - A; l2 = np.where((V ** 2).sum(1) > 0, (V ** 2).sum(1), 1); out = []
        for lat, lon in pts[:: max(1, len(pts) // 120)]:
            sp = np.array([lat * KY, lon * KX]); t = np.clip(((sp - A) * V).sum(1) / l2, 0, 1)
            out.append(float(np.hypot(*(sp - (A + V * t[:, None])).T).min()))
        return out
