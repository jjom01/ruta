import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import * as Location from 'expo-location';

const PORT = 5173;

/* Dirección de la app web de Ruta (el servidor server.js del Mac).
   - Por defecto usa la misma IP del Mac que sirve Expo (así no hay que escribirla).
   - Se puede forzar con EXPO_PUBLIC_RUTA_URL (por ejemplo un túnel https). */
function appUrl() {
  if (process.env.EXPO_PUBLIC_RUTA_URL) return process.env.EXPO_PUBLIC_RUTA_URL;
  const host = (Constants.expoConfig?.hostUri || '').split(':')[0];
  return `http://${host || 'localhost'}:${PORT}/`;
}

// Colores del sistema de diseño de Ruta (Páramo en claro, Rojo Troncal en oscuro)
const THEME = { dark: { bg: '#140C0E', fg: '#FBF3F4', accent: '#FF4D63', on: '#140C0E' }, light: { bg: '#F2F6F3', fg: '#0E2420', accent: '#0F6B5C', on: '#FFFFFF' } };

export default function App() {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark', C = THEME[scheme], styles = makeStyles(C);
  const url = appUrl();
  const origin = new URL(url).origin;
  const web = useRef(null);
  const canBack = useRef(false);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [attempt, setAttempt] = useState(0);

  // Permiso de ubicación del teléfono (la página lo usa para "Mi ubicación" y los paraderos cercanos).
  useEffect(() => {
    Location.requestForegroundPermissionsAsync().catch(() => {});
  }, []);

  // Botón "atrás" de Android: navega dentro de la app web antes de salir.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canBack.current && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  const retry = useCallback(() => { setState('loading'); setAttempt((n) => n + 1); }, []);

  // Los enlaces fuera de Ruta (Máas, bogota.gov.co…) se abren en el navegador del teléfono.
  const onShould = useCallback((req) => {
    if (req.url.startsWith(origin) || req.url.startsWith('about:') || req.url.startsWith('data:') || req.url.startsWith('blob:')) return true;
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, [origin]);

  return (
    <View style={styles.root}>
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <WebView
        key={attempt}
        ref={web}
        source={{ uri: url }}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={['*']}
        geolocationEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        decelerationRate="normal"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        scrollEnabled={false}
        scalesPageToFit={false}
        allowsLinkPreview={false}
        textZoom={100}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        hideKeyboardAccessoryView
        automaticallyAdjustsScrollIndicatorInsets={false}
        allowsBackForwardNavigationGestures
        onShouldStartLoadWithRequest={onShould}
        onNavigationStateChange={(s) => { canBack.current = s.canGoBack; }}
        onLoadEnd={() => setState((s) => (s === 'error' ? s : 'ready'))}
        onError={() => setState('error')}
        onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setState('error'); }}
      />
      {state === 'loading' && (
        <View style={styles.cover} pointerEvents="none">
          <ActivityIndicator color={C.fg} />
        </View>
      )}
      {state === 'error' && (
        <View style={styles.cover}>
          <Text style={styles.title}>No se pudo abrir Ruta</Text>
          <Text style={styles.msg}>
            Revisa que el servidor esté encendido en tu computador (npm start en la carpeta de Ruta) y que el teléfono esté en la misma red Wi‑Fi.
          </Text>
          <Text style={styles.url}>{url}</Text>
          <Pressable onPress={retry} style={styles.btn} accessibilityRole="button">
            <Text style={styles.btnText}>Reintentar</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (C) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  web: { flex: 1, backgroundColor: C.bg },
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, alignItems: 'flex-start', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: C.fg, fontSize: 24, fontWeight: '600' },
  msg: { color: C.fg, opacity: 0.7, fontSize: 15, lineHeight: 22 },
  url: { color: C.fg, opacity: 0.5, fontSize: 13, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  btn: { marginTop: 8, paddingHorizontal: 24, height: 48, borderRadius: 24, backgroundColor: C.accent, justifyContent: 'center' },
  btnText: { color: C.on, fontSize: 16, fontWeight: '500' },
});
