# Ruta · backend en vivo

Servidor Node sin dependencias (Node 18+). **Es la parte que se conserva** en el rediseño: la web nueva (`../web`) solo consume esta API.

```sh
npm start        # desde la raíz: API + ../web (si existe)
npm run start:v1 # API + la versión 1 (../legacy)
```
Puerto `5173` (`PORT`). Configuración en `backend/.env.local` (no se sube; ver `.env.example`).

## Endpoints
| Ruta | Qué devuelve | Fuente | Caché |
|---|---|---|---|
| `GET /api/rt` | Posiciones de buses (protobuf GTFS‑RT `positions.pb`) | `GTFS_RT_URL` (TransMilenio, gratis) | 10 s, sirve la copia previa si falla |
| `GET /api/alerts` | Alertas de servicio (protobuf `alerts.pb`) | `ALERTS_URL` o junto a `GTFS_RT_URL` | 60 s |
| `GET /api/est` | JSON `{asOf, vehicles[]}`: buses con viaje activo pero sin GPS fresco, ubicados con horario + retraso (`tripupdates.pb`) | `server-data/schedule.json` | 20 s, refresco en segundo plano |
| `GET /api/fleet?lat&lon&r` | Flota en vivo por zona (Croma, de pago por lectura) | `CROMA_API_KEY` | 120 s, tope diario `DAILY_CALLS`=5, reserva de créditos |
| `GET /api/geocode?q&mode=suggest\|submit` | Direcciones de la malla (local, OSM) + lugares (Photon/Nominatim) | `server-data/streets.json` | memoria, 500 entradas |
| `GET /api/health` | Estado: feeds configurados, horario cargado, créditos | — | — |

## Estructura
- `server.js` — rutas HTTP y archivos estáticos (`STATIC_DIR`, por defecto `../web`).
- `src/env.js` — carga `.env.local` (importar primero).
- `src/gtfs-rt.js` — feeds `positions/alerts/tripupdates`, decodificador protobuf mínimo, estimación de posición.
- `src/fleet.js` — cliente Croma con presupuesto diario (`.credits.json`).
- `src/geocode.js` — parser de direcciones bogotanas (Calle/Carrera/Diagonal/Transversal, “con”, “#”) + Photon/Nominatim.
- `server-data/` — `schedule.json` y `streets.json` (generados; se regeneran con `tools/`).
- `tools/build-schedule.py`, `tools/build-streets.py` — reconstruyen esos datos desde `GTFS.zip` (https://gtfs.transmilenio.gov.co/GTFS.zip) y OSM.

## Notas para el rediseño
- Clave de Croma y URL del feed solo viven aquí; nunca llegan al navegador.
- Los feeds se cachean en memoria del proceso: para varias instancias, mover caché a Redis/KV.
- Siguientes mejoras sugeridas: `/api/rt` en JSON ya decodificado, SSE/WebSocket para vehículos, tests de contrato con las respuestas guardadas, desplegar fuera del Mac (el estático puede ir a CDN).
