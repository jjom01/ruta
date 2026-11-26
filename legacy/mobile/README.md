# Ruta · app móvil (Expo)

Envoltorio de Expo que abre la app web de Ruta en una WebView, con permiso de ubicación del teléfono.
La app web y su servidor (`server.js`) siguen corriendo en el computador.

## Probar en el teléfono

1. Instala **Expo Go** en el teléfono. El teléfono y el computador deben estar en la misma red Wi‑Fi.
2. Desde la carpeta de Ruta: `npm run phone` (enciende el servidor y Expo).
3. Escanea el QR (cámara en iPhone, Expo Go en Android).

La dirección del servidor se toma de la IP que usa Expo, no hay que escribirla.
Para usar otra (por ejemplo un túnel https): `EXPO_PUBLIC_RUTA_URL=https://… npm run phone`.

## Notas

- La ubicación del navegador exige conexión segura; sobre `http://` en la red local puede fallar en algunos teléfonos. Si pasa, usa un túnel https (`EXPO_PUBLIC_RUTA_URL`).
- Esto no es una app independiente: sin el servidor encendido muestra "No se pudo abrir Ruta".
