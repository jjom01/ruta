#!/usr/bin/env node
// Puntos de recarga TuLlave en tiendas, papelerías, droguerías y otros establecimientos (terceros).
// Fuente: listados oficiales de la Alcaldía de Bogotá (bogota.gov.co, 29 mar 2022), guardados en tools/.cache/recarga/*.html.
// Cada dirección ("Cr. 92 #151 -01") se ubica con el mismo geocodificador de calles numeradas del servidor (esquina aproximada, sin servicios externos).
// Uso: node backend/tools/build-recarga.js   →   web/data/recharge-shops.json  [[lat, lon, tipo, barrio, dirección], …]
const fs = require("fs");
const path = require("path");
const { resolveAddress, parseAddress } = require("../src/geocode");
const dir = path.join(__dirname, ".cache", "recarga");
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
// "Cr. 68G Bis #30 -36 Sur": el "Sur" del final es de la calle (la vía este-oeste); el geocodificador lo espera pegado a su número
// avenidas con nombre → su carrera (la numeración "#NN" que sigue es la de la calle transversal)
const AVE = [[/^(av\.?|avenida|autopista)?\s*boyac[aá]\b\s*/i, "Cr. 72 "], [/^(av\.?|avenida)?\s*(carrera\s*)?caracas\b\s*/i, "Cr. 14 "], [/^(av\.?|avenida)?\s*(ciudad de cali)\b\s*/i, "Cr. 86 "], [/^(av\.?|avenida)?\s*(nqs|carrera 30)\b\s*/i, "Cr. 30 "], [/^(autopista norte|av\.? autopista norte)\b\s*/i, "Cr. 45 "]];
function fixSur(a) {
  for (const [re, to] of AVE) if (re.test(a)) { a = a.replace(re, to); break; }
  const m = /^(.*?)\s+(sur|este)\s*$/i.exec(a); if (!m) return a; let x = m[1];
  if (/^(cl|cll|calle|dg|diag|diagonal)\b/i.test(x)) return x.replace(/^(\S+\s*\d+\s*[a-z]{0,2}(?:\s*bis)?)/i, "$1 Sur");
  return x.replace(/(#\s*\d+\s*[a-z]{0,2}(?:\s*bis)?)/i, "$1 Sur");
}
// centro de cada barrio (places.json: kind "area") para elegir el cruce correcto cuando dos vías se cruzan en varios sitios de la ciudad
const nrm = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const AREAS = new Map();
try { for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-data", "places.json"), "utf8"))) if (r[3] === "area") { const k = nrm(r[0]).replace(/^localidad /, ""); if (!AREAS.has(k)) AREAS.set(k, [r[1], r[2]]); } } catch {}
const hintOf = (barrio) => AREAS.get(nrm(barrio)) || null;
// Direcciones de Overture Maps (comercios con coordenadas reales): si la misma dirección aparece ahí, se usa esa posición (a nivel de predio)
const clean0 = (a) => a.replace(/\b(local|interior|int|bloque|bl|apartamento|apto|oficina|of|piso|cc\.?|centro comercial|manzana|casa|torre|etapa|lote|bodega|bg)\b.*$/i, "").replace(/\s+/g, " ").trim();
const addrKey = (q) => { const p = parseAddress(q); return p && p.plate > 0 ? `${p.a}|${p.b}|${p.plate}` : null; };
const OV = new Map();
try { for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server-data", "poi.json"), "utf8"))) { const k = addrKey(clean0(r[4] || "")); if (k) { const l = OV.get(k) || []; l.push([r[1], r[2]]); OV.set(k, l); } } } catch {}
let upgraded = 0;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
const out = [], seen = new Set(); let total = 0, miss = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(dir, f), "utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const lines = decode(html.replace(/<[^>]+>/g, "\n")).split("\n").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m = /^Establecimiento:\s*(.+)$/.exec(lines[i]); if (!m) continue;
    const type = m[1].trim(); let rest = (lines[i + 1] || "").replace(/^Barrio y dirección:\s*/, "");
    const k = rest.indexOf(","); if (k < 0) continue;
    const barrio = rest.slice(0, k).trim(), addr = rest.slice(k + 1).trim(); total++;
    // se quitan locales, interiores, bloques y centros comerciales: quedan la vía y la placa
    const clean = addr.replace(/\b(local|interior|int|bloque|bl|apartamento|apto|oficina|of|piso|cc\.?|centro comercial|manzana|casa|torre|etapa|lote)\b.*$/i, "").replace(/\s+/g, " ").trim();
    const r = resolveAddress(fixSur(clean), true, hintOf(barrio)) || resolveAddress(fixSur(clean).replace(/^(Av\.?|Avenida)\s+/i, ""), true, hintOf(barrio));
    if (!r || r.lat < 4.45 || r.lat > 4.85 || r.lon < -74.25 || r.lon > -73.98) { miss++; continue; }
    const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}|${type}|${addr}`; if (seen.has(key)) continue; seen.add(key);
    let la = r.lat, lo = r.lon;
    const ov = OV.get(addrKey(fixSur(clean)) || "");
    if (ov) { const c = ov.reduce((b, q) => (dist(q, [la, lo]) < dist(b, [la, lo]) ? q : b)); if (dist(c, [la, lo]) < 500) { la = c[0]; lo = c[1]; upgraded++; } }
    out.push([+la.toFixed(5), +lo.toFixed(5), type, barrio, addr]);
  }
}
// se descartan puntos aislados (a más de 2 km de otros 3): casi siempre son direcciones mal ubicadas por el geocodificador
const near = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180)) < 2000;
const kept = out.filter((p) => out.reduce((n, q) => n + (q !== p && near(p, q) ? 1 : 0), 0) >= 3);
console.log(`${out.length - kept.length} puntos aislados descartados; ${upgraded} con posición de predio (Overture)`); out.length = 0; out.push(...kept);
const dst = path.join(__dirname, "..", "..", "web", "data", "recharge-shops.json");
fs.writeFileSync(dst, JSON.stringify(out));
console.log(`${total} puntos en las listas; ${out.length} ubicados; ${miss} sin ubicar (${Math.round((100 * miss) / total)} %) → ${dst} (${Math.round(fs.statSync(dst).size / 1024)} KB)`);
