#!/bin/sh
# Enciende Ruta v1 para probarla en el teléfono: backend (con la web v1) y Expo (escanea el QR con Expo Go).
cd "$(dirname "$0")"
STATIC_DIR=../legacy node ../backend/server.js & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM
cd mobile && npx expo start --lan --clear
