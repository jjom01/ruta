/* Web Worker del planificador: carga los datos una vez y calcula fuera del hilo de la pantalla. */
let rstops, ridx, ready;
importScripts("/js/planner.js");
function load() {
  ready ||= Promise.all([fetch("/data/route-stops.json").then((r) => r.json()), fetch("/data/routes-index.json").then((r) => r.json())]).then(([a, b]) => { rstops = a; ridx = b; self.rstops = a; self.ridx = b; PL.plan([{ lat: 4.65, lon: -74.07 }], [{ lat: 4.66, lon: -74.07 }]); });
  return ready;
}
onmessage = async (e) => {
  const m = e.data;
  try {
    await load();
    if (m.warm) return postMessage({ id: m.id, res: true });
    postMessage({ id: m.id, res: m.replan ? PL.replan(m.replan) : PL.plan(m.origins, m.dests, m.off) });
  } catch (err) {
    postMessage({ id: m.id, error: String(err && err.message) });
  }
};
