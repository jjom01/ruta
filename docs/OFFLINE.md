# Ruta sin Mac: instalable, con copia en el teléfono y sin conexión

Estado de cada paso y lo que falta. Probado = ejecutado y verificado aquí; sin probar = escrito pero no ejecutado en un teléfono.

## 1. App instalable con service worker (hecho y probado en Chrome)

- `web/manifest.webmanifest` + iconos `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (dibujados a partir de la geometría de `icon.svg`).
- `web/sw.js` lo genera `npm run build:sw` (también lo corre `npm start`). Guarda los 45 archivos de la app (3,4 MB: HTML, CSS, JS, datos, iconos)
  con una versión calculada del contenido; si algo cambia, el teléfono baja la copia nueva por detrás.
  **Si se cambia un archivo de `web/` hay que volver a generarlo**; si no, el teléfono seguirá con la copia vieja.
- Qué guarda: MapLibre y tipografías (para siempre, sus URL llevan versión), las teselas del mapa que ya se vieron (máx. 700),
  y la última respuesta de alertas, trazados y búsqueda de lugares. **Buses en vivo (`/api/rt`, `/api/est`) nunca se guardan.**
- Prueba hecha: con el servidor completamente apagado, la app abre desde la copia (Inicio, Rutas con las 41 rutas TM, búsqueda de F19).
- El navegador solo permite service workers en **https** (y localhost). En desarrollo no se activa; se prueba con `http://localhost:5173/?sw=1`.
  Algunos navegadores integrados en otras herramientas los bloquean: probar en Chrome o Safari.
- Aviso de conexión (`offline` / `online`) en la parte de arriba.

## 2. App de tienda con la web adentro (pendiente: necesita decisiones y compilar)

La app ya llama al servidor a través de `web/js/net.js`: se define `<meta name="ruta-api" content="https://…">` o `window.RUTA_API`.
El servidor ya responde con CORS (`ALLOW_ORIGIN`, por defecto `*`) en `/api/*`.
Falta: (a) alojar el servidor en un sitio siempre encendido con https; (b) meter `web/` dentro del paquete de la app
(Android: `assets/web`; iOS: carpeta en el bundle) y cargarla en el WebView con acceso a archivos locales;
(c) compilar con EAS o Xcode/Android Studio. Expo Go no puede hacerlo. En iOS los service workers no funcionan en un WebView
de una app, por eso allí la copia local es la única manera de abrir sin conexión.

## 3. Sin conexión de verdad (pendiente)

Lo que no se guarda hoy: la primera vez que se abre una zona del mapa, los buses en vivo y las alertas actuales.
Para mapa sin conexión: extracto de Bogotá en PMTiles (≈ 100–200 MB hasta zoom 15) guardado en el teléfono, y los trazados por calles
(`/api/shape`) y la búsqueda de lugares pasados a datos locales.
