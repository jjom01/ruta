# Ruta

App de transporte público de Bogotá: TransMilenio, SITP y TransMiCable. Rutas y horarios, planificador de viajes,
buses en el mapa, puntos de recarga y una introducción de primer uso. En español e inglés, con tema claro y oscuro.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `web/` | La app (módulos ES sin compilación, MapLibre GL) |
| `backend/` | Servidor Node sin dependencias: buses en vivo, alertas, trazados y búsqueda de lugares. Ver [backend/README.md](backend/README.md) |
| `docs/` | Notas de diseño, revisión de calidad y estado del modo sin conexión |
| `legacy/` | Primera versión y envoltorio de Expo |

## Correrla

Necesita Node 18 o superior.

```sh
cp backend/.env.example backend/.env.local   # completar GTFS_RT_URL (y la clave opcional)
npm start                                    # genera el service worker y sirve en http://localhost:5173
```

Para el modo instalable y sin conexión, ver [docs/OFFLINE.md](docs/OFFLINE.md).

## Datos

TransMilenio S.A. (GTFS y geovisor oficial), Alcaldía Mayor de Bogotá, OpenStreetMap (ODbL), Overture Maps Foundation
(CDLA-Permissive-2.0), OpenFreeMap y OpenMapTiles. Los nombres, logos y colores oficiales pertenecen a sus dueños.
Este no es un producto oficial de TransMilenio.
