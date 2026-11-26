# Rediseño completo de Ruta

## Estado del repositorio
```
backend/   API en vivo (se conserva; ver backend/README.md)
legacy/    Versión 1 completa: web, planificador (plan.js), datos GTFS procesados (data/), tools/, mobile/ (Expo), exports/
web/       Aquí empieza la versión 2 (vacía)
docs/      Este documento
../ruta-backups/ruta-v1-*.tar.gz   Copia íntegra de v1 antes de reorganizar
```
Para ver v1: `npm run start:v1`. Para v2: poner `web/index.html` y `npm start`.

## Qué se reutiliza de v1
- **Datos**: `legacy/data/*` (routes-index, route-stops, shapes, stops, service, cic-routes, colors, strings) y los scripts `legacy/tools/build-*.py` que los generan desde GTFS.
- **Lógica**: `legacy/plan.js` (Dijkstra por sistemas, alternativas, replan), colores por dirección SITP, calendario ciclovía/festivos (`app.js`), geocodificación (backend).
- **Marca**: wordmark/ícono en `legacy/assets`, `icon.svg`, tokens de estilo glass en `styles.css`, onboarding v2 (`onboarding.js`, aún en `?ob=2`).
- **Móvil**: `legacy/mobile` (WebView en Expo) — apuntar a la web nueva.

## Pendientes heredados de v1
- Verificar replan de cola y línea de ruta mixta; probar tema claro y reduced‑motion.
- Onboarding v2 como predeterminado; ícono 512 px de tienda.

## Reglas del backend durante el rediseño
1. No cambiar los contratos de `/api/*` sin versionar (`/api/v2/...`).
2. Antes de tocarlo: `curl localhost:5173/api/health` y guardar respuestas de `rt`, `est`, `geocode` como referencia.
3. Los datos `server-data/` se regeneran con `backend/tools`.

## v2 · estado (spec: Ruta_Especificacion_de_Producto.pdf)
Código en `web/` (módulos ES sin build: `js/main.js` router, `js/screens/*`, `js/i18n.js` es/en, `js/data.js`, `js/rt.js`). Barra inferior: Rutas · Planear · **Mapa** · Saldo · Novedades.

| Sección | Estado |
|---|---|
| 3 Mapa | Hecho: pantalla completa, sin buses hasta buscar, búsqueda por ruta/paradero/lugar, botón azul al escribir, filtros TM/Mixto/SITP/Cable, estados vacíos, rebote a Bogotá, tema del dispositivo. Pendiente: dibujar la ruta exacta (`legacy/data/shapes.json`) en vez del troncal completo; clasificación “Mixto” por confirmar. |
| 1 Rutas | Hecho: pestañas Rutas/Paraderos, filtros TM(+mixto)/SITP/Cable, tarjetas con paraderos y duración, Próxima parada con ubicación. Pendiente: horarios/frecuencias reales. |
| 4 Planear | Solo formulario. Portar `legacy/plan.js` + worker, listado estilo @proskuaaa (insignia, minutos, línea de tiempo). |
| 2 Saldo | Botón de recarga (recargasweb.tullaveplus.gov.co) y tarifa vigente (web/data/fare.json, $3.550 desde el 14 ene 2026). Pendiente: saldo (NFC). Sin puntos de recarga: el sistema no recibe pagos. |
| 5 Novedades | Lee `/api/alerts`, pero ese feed viene vencido/interno (todas las alertas expiradas). Hace falta un feed de X y portales autorizados (backend nuevo). |
| Transversal | Onboarding, ícono/wordmark, es/en completo, accesibilidad: pendientes. |

- Novedades: solo alertas oficiales (alerts.pb). La integración con X (@TransMilenio, @transmisitp, API v2 con X_BEARER_TOKEN) se retiró por ahora; requiere un plan de pago de la API.

## Tipografía (simplificada 2026-11-19)
- Escala de **5 tamaños** (variables en `:root`): `--fs-xs` 11, `--fs-s` 13, `--fs-m` 15, `--fs-l` 17, `--fs-xl` 24. Pesos: 400, 500, 600.
- **Inter** para todo el texto. **JetBrains Mono solo para números**: `js/numify.js` envuelve cada cifra (1.2, 3,550, 20:37…) en `<span class="n">`. Las insignias de ruta (códigos como B10) van completas en Inter.

## Red troncal del mapa (2026-11-19)
- La red troncal sale de los datos oficiales de TransMilenio (capa pública ArcGIS `Mapa_GeoVisor_TransmiGIS`: capa 5 trazados, capa 2 estaciones, capa 14 cable). `web/data/network.geojson` lo genera `backend/tools/build-network-official.py`: un color por troncal (colores oficiales de `colors.json`), tramos mixtos (`tipo_tra` 2) punteados y estaciones troncales en operación como puntos.
- Para actualizar: descargar las capas con `.../FeatureServer/{5,14,2}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson` y correr `python3 backend/tools/build-network-official.py layer5.json layer14.json layer2.json`. (`build-network.py` es el método heurístico anterior.)
- Limitación: los datos no traen el trazado oficial de cada troncal. Los cortes entre corredores (p. ej. dónde termina la NQS Central y empieza la NQS Sur) son aproximados.


## Auditoría de contraste

`web/dev/contrast-audit.js` recorre el texto visible y compara su contraste (WCAG AA: 4.5, texto grande 3) con el fondo real. Se ejecuta desde la consola del navegador en claro y oscuro: `(await import("/tools/contrast-audit.js")).audit()` (devuelve `[]` si todo cumple). Último resultado (2026-11-19): 0 fallos en Rutas, Paradas, Plan, Mapa (con leyenda), Saldo, Noticias y ventanas de ruta/parada, en ambos temas.

## Búsqueda de lugares y planificación robusta

- **Lugares conocidos** (`web/data/places.json`, ~5.000 sitios de OpenStreetMap: centros comerciales, universidades, hospitales, parques, museos, barrios, terminales…) se buscan en el teléfono, sin red: ignoran tildes, aceptan abreviaturas (`cc`, `u`, `hosp`, `pq`), prefijos y errores de escritura. Se regenera con `python3 backend/tools/build-places.py`.
- **Geocodificador** (`/api/geocode`): direcciones de Bogotá (calles numeradas) → lugares locales → Nominatim/Photon con reintentos (con y sin "Bogotá"); si un proveedor falla se prueba el siguiente, y los lugares locales responden aunque ambos caigan.
- **Planificador**: si no hay ninguna opción con 25 min de caminata, amplía a 3 y luego 6 km antes de rendirse; descarta opciones con más de 75 min a pie.
- **Mensajes**: lugar no encontrado / falta el origen / queda cerca (ve caminando) / fuera de la red / sin ruta.

### Fuentes de datos de la búsqueda

| Fuente | Qué aporta | Dónde corre |
|---|---|---|
| Lugares conocidos (OpenStreetMap, `places.json`, ~5.000) | centros comerciales, universidades, hospitales, parques, barrios | teléfono, sin red |
| **Overture Maps · places** (`server-data/poi.json`, ~119.000) | comercios y servicios (restaurantes, tiendas, farmacias…), con dirección; incluye datos de Meta, Microsoft y Foursquare | servidor, índice en memoria (~10 MB) |
| Calles numeradas de OSM (`streets.json`) | direcciones tipo "Calle 80 # 69-20" | servidor |
| Nominatim / Photon (OSM) | respaldo en línea solo si lo local no encuentra nada | servidor |

- Overture se regenera con `pip install duckdb && python3 backend/tools/build-poi.py [release]` (versión usada: 2026-11-18.0, confianza ≥ 0,3). Licencia CDLA-Permissive-2.0, © Overture Maps Foundation: debe citarse en la pantalla de créditos.
- Las búsquedas con zona ("mcdonalds fontibón") quitan el barrio/localidad del final y ordenan por cercanía a esa zona.
- Probado: "Toretos Carnes" (Fontibón, Cra 96H), que no estaba en OSM, ahora aparece.

## Recorridos por las calles

- `backend/tools/fetch-roads.sh` baja la red vial de Bogotá (OpenStreetMap) a `backend/tools/.cache/` y `backend/tools/build-shapes.py` calcula, para cada par de paraderos consecutivos de cada ruta, el camino más corto por las calles (respeta sentidos únicos y prefiere avenidas). Genera `server-data/shapes.json` (recorridos, ~1,3 MB) y `server-data/roads.json` (red para caminar, ~7 MB).
- `/api/shape?legs=rid:p0:p1,…&walks=lat,lon,lat,lon;…` devuelve el trazado por las calles solo del tramo que se viaja (del paradero de subida al de bajada) y el camino a pie de cada caminata. Si no hay trazado, el cliente dibuja líneas rectas como respaldo (≈1 % de los tramos).
- Planear: la lista de resultados tiene una barra para arrastrarla hacia abajo y ver todo el recorrido en el mapa.

## Puntos de recarga

El selector del mapa es **Puntos de recarga | Mapa**. Se marcan las estaciones y portales troncales en operación (datos oficiales de TransMilenio, todas con taquilla de recarga TuLlave). Los puntos en tiendas, papelerías, droguerías y otros establecimientos (terceros) salen de las listas oficiales de la Alcaldía de Bogotá del 29 de marzo de 2022 (bogota.gov.co, tres artículos por localidades, 3.382 direcciones): `backend/tools/build-recarga.js` las ubica con el geocodificador de calles numeradas (esquina aproximada) y genera `web/data/recharge-shops.json` (2.865 puntos, 85 %; el resto tiene direcciones con nombre propio o vías ausentes en OSM). Se agrupan por zoom y cada tarjeta avisa que la ubicación es aproximada y de 2022; el botón "Localizador oficial" lleva a tullaveplus.gov.co para confirmar.

### Trazado de rutas troncales

Las rutas troncales y duales se trazan sobre el **trazado oficial de TransMilenio** (`web/data/network.geojson`, capa 5 del geovisor oficial: carriles exclusivos y cruces entre corredores), no sobre las calles de OpenStreetMap, porque las estaciones están en el centro de las avenidas. Entre dos estaciones consecutivas se toma el camino más corto por el corredor; si no encaja (parada fuera del corredor, camino >1,5× la recta + 120 m) se usan las calles (sin respetar sentidos únicos) y, como último recurso, una recta. Revisión (2026-11-21): 144 rutas troncales/duales, razón camino/recta ≤ 1,27 en todas, 36 tramos en recta (30 rutas, casi todos de P85-M85 y otras duales que salen del corredor).

### Trazado de todas las rutas (TM, SITP y cable) — revisión 2026-11-21

`backend/tools/build-shapes.py` traza cada ruta según su sistema y `backend/tools/audit-shapes.py` la audita (rodeos > 2,2× la recta, horquillas de giro en U, rectas de respaldo):

- **Troncales y duales**: trazado oficial de los corredores, con las conexiones oficiales entre corredores y los retornos reales (p. ej. K16 baja por la NQS hasta el retorno CAD antes de entrar a la Calle 26). Si una parada no está en el corredor, calles.
- **Alimentadores y SITP (zonales)**: calles de OpenStreetMap respetando sentidos únicos. Cada parada prueba hasta 5 aristas cercanas (la acera de enfrente también cuenta) y se elige, por programación dinámica, la combinación que da el recorrido total más corto. Si un tramo da un rodeo absurdo (portales y terminales con vías internas no públicas) se prueba sin respetar sentidos y, si es corto, queda una línea directa dentro del portal.
- **TransMiCable**: líneas rectas oficiales entre torres/estaciones (capa 14).
- **Resultado**: tramos en recta de respaldo 436 → 5 (los 5 son saltos de 3 a 11 km en rutas rurales de Usme/Sumapaz, sin datos); rodeos sospechosos en SITP 772 → 462 y en troncales 14 → 3; mediana de razón camino/recta por ruta: SITP 1,14, alimentador 1,29, troncal 1,06.
- El mapa (búsqueda de ruta) y Planear usan estos recorridos vía `/api/shape`.

### Verificación contra el trazado oficial (2026-11-21)

La capa 15 "Servicios" del geovisor oficial de TransMilenio (939 servicios TM y SITP, descargada a `backend/tools/.cache/servicios-oficiales.json` con `…/FeatureServer/15/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`) tiene el **recorrido real de cada servicio**. `backend/tools/official_shapes.py` lo asocia a cada ruta (por código y, si no, por geometría), comprobando que las paradas queden sobre la línea y en orden (en el sentido de la ruta o al revés), y recorta la línea entre paradas. Si encaja, **reemplaza al recorrido calculado**; si no, se conserva el calculado.

- Rutas con trazado oficial: 413 de 1.052 (troncales 102/113, alimentadores 90/152, SITP 208/744, duales 11/31). Ahí el mapa muestra el recorrido real, con retornos y desvíos (K16 baja por la NQS hasta el retorno, gira en U, vuelve al empalme "Calle 26 – NQS central" y entra a la Calle 26).
- El recorrido calculado se contrastó contra el oficial en esas 413 rutas: la desviación media propia es de ~7–10 m (mediana) y el 93 % queda a menos de 40 m. Las que difieren (B26, F26, G52, alimentador 9-3, …) ya usan el oficial.
- Sin trazado oficial: 639 rutas (SITP sin servicio en la capa, variantes, cable). Allí se usa el calculado (corredores oficiales, calles de OSM, líneas del cable). Las formas GTFS (`routes.geojson`) se descartaron como segunda fuente: son demasiado gruesas (solo 36 rutas sin oficial encajaban y con vértices cada >120 m).
- Auditoría: `python3 backend/tools/audit-shapes.py`. Las horquillas que quedan en rutas oficiales (36 en SITP) son giros reales de la línea oficial.

## Auditoría de interfaz (2026-11-21)

`web/dev/ui-audit.js` recorre 20 pantallas y estados (Rutas y sus filtros, paradas, ventanas de ruta y de paradero, Planear vacío/sugerencias/resultados/tarjeta abierta/no encontrado, Mapa con leyenda, recarga y ruta buscada, Saldo, Noticias) y mide errores de consola, peticiones fallidas, solapes reales (recortados por los contenedores y comprobados con un toque de prueba), zonas táctiles, desbordes horizontales, números rotos dentro de flex/grid y contraste. Uso: `const {sweep} = await import("/dev/ui-audit.js"); await sweep();`. Resultado final en teléfono (375×812) oscuro y claro, tableta (820×1180) y teléfono horizontal (812×375): 0 errores, 0 peticiones fallidas, 0 solapes, 0 desbordes, 0 fallos de contraste.

## Inicio (antes Novedades)
La primera pestaña es **Inicio** (`web/js/screens/home.js`, sustituye a Novedades): estado del servicio (alertas oficiales de 24 h con traducción en el dispositivo, o tarjeta de calma con "Reintentar"), **rutas favoritas** (las del corazón; tocar abre la ficha de la ruta, el corazón la quita), **Ajustes** y **Créditos**.
- **Tema**: Auto (dispositivo) / Claro / Oscuro (`web/js/theme.js`, guardado en `localStorage ruta.theme`). Pone `data-theme` en `<html>`; los tokens oscuros se aplican con `:root[data-theme="dark"]` y con `prefers-color-scheme` solo si no hay `data-theme="light"`. `dark()` (data.js) respeta la elección; el mapa cambia de estilo al evento `themechange` y Rutas/Saldo se reconstruyen al volver. Planear conserva los colores del tema anterior hasta la próxima búsqueda.
- **Ubicación**: muestra el estado del permiso y un botón (Activar / Pedir de nuevo / Actualizar). Con permiso "prompt" el navegador vuelve a preguntar; si está bloqueado ningún sitio puede volver a preguntar, así que se explica cómo activarlo en los ajustes. Al concederse se emite `ruta:location` y el mapa pone el punto azul.
- **Créditos**: TransMilenio, Alcaldía de Bogotá, OpenStreetMap (ODbL), Overture Maps (CDLA-Permissive-2.0), OpenFreeMap/OpenMapTiles, MapLibre, Inter y JetBrains Mono.

### Mapa esquemático de Inicio
`web/data/map-{dark,light}.svg` se generan con `python3 backend/tools/build-home-map.py` a partir de los originales en `web/data/src/`: quita título, leyenda, notas y brújula, recorta el encuadre a la red y renombra estaciones según los datos oficiales actuales (Shaio → Suba Calle 116, Puente Largo → Puentelargo, Boyacá → Av. Boyacá). `web/js/home-map.js` lo muestra con zoom/desplazamiento; al tocar una estación enlaza su nombre con el paradero de GTFS (nombre base sin «Estación» ni patrocinio, con una tabla de excepciones) y abre su ficha en Rutas. Sin paradero equivalente (Hospitales, Recinto Ferial, Calle 19, Calle 34, Tercer Milenio, Hospital, La Victoria, Senderos de Altamira) avisa «sin datos en la app».

## Pulido global (esqueletos, transiciones, gestos)
- **Esqueletos de carga**: clase `.skel` (+ `skel.rows/cards/block` en `web/js/ui.js`). Se usan al arrancar (`#boot` en `index.html`), en la píldora de estado y el mapa de Inicio, y mientras el planificador calcula.
- **Elemento compartido**: `flip()` (`ui.js`) hace crecer un clon del origen hasta el destino (sin View Transitions, que congelaban la página medio fotograma). Las clases `.vt-tile` (insignia de ruta) y `.vt-title` (nombre de paradero) marcan lo que viaja entre la lista y la ventana de detalle; con «reducir movimiento» se abre con la animación normal.
- **Arrastrar para cerrar**: `swipeDismiss()` (`ui.js`) en la ventana de detalle (hacia abajo, solo en el borde superior del contenido), la leyenda del mapa (hacia arriba) y la ficha de punto de recarga (hacia abajo). Táctil y ratón; cierra por distancia o por velocidad.
- **Texto**: números tabulares en toda la app (`font-variant-numeric: tabular-nums`) y `text-wrap: balance/pretty`.

## Rendimiento
- **Servidor** (`backend/server.js`): estáticos en memoria con ETag, brotli/gzip precomprimidos y caché (`no-cache` + 304 para html/js/css; una hora fresca + un día `stale-while-revalidate` para datos, SVG e imágenes). Arranque en frío: de 2,4 MB a ≈0,5 MB; recarga: ≈4 KB.
- **Arranque**: `routes.geojson` (1,1 MB) se separó en `routes-meta.json` (66 KB, al arrancar; `backend/tools/split-routes.py`) y los trazados llegan después en un momento ocioso (`loadGeom()`). Los JSON y los módulos principales se precargan desde `index.html`.
- **MapLibre** (≈0,8 MB) ya no bloquea el inicio: se descarga al abrir Mapa o Planear (y se precarga en segundo plano); la API del mapa espera con `whenMap()`.
- **Animaciones**: se medió a 60 fps en Inicio (zoom), cambios de pestaña, ventanas de detalle, listas y leyenda. Mejoras: sin desenfoque en el velo de las ventanas, desenfoques de cristal limitados a 14 px, el mapa de Inicio quita los halos de las etiquetas mientras se mueve, `content-visibility` en la lista de rutas y precalentamiento de la ventana de detalle.
