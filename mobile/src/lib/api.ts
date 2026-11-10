// src/lib/api.ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { NativeModules, Platform } from 'react-native';

const BACKEND_PORT = 8000;

/**
 * Extrae una dirección IP o hostname limpio de una cadena candidata
 * (URL completa, host:port o esquema exp://).
 * Descarta 'localhost', '127.0.0.1' y '10.0.2.2' para buscar la IP real de la PC en la red.
 */
function extraerHostDeCadena(cadena?: string | null): string | null {
  if (!cadena || typeof cadena !== 'string') return null;
  // Remover esquemas tipo http://, https://, exp://
  const sinProtocolo = cadena.replace(/^[a-zA-Z]+:\/\//, '');
  const hostYPuerto = sinProtocolo.split('/')[0];
  const host = hostYPuerto.split(':')[0]?.trim();

  if (
    host &&
    host.length > 0 &&
    host !== 'localhost' &&
    host !== '127.0.0.1' &&
    host !== '10.0.2.2'
  ) {
    return host;
  }
  return null;
}

/**
 * Deduce automáticamente la URL del backend FastAPI en cualquier red.
 *
 * Obtiene dinámicamente la IP de la computadora a partir de la conexión de Metro
 * (que la app móvil usa para descargar el JavaScript en vivo). Esto funciona
 * automáticamente en cualquier Wi-Fi (Casa, Universidad, Hotspot) sin tener que
 * buscar la IP con ipconfig ni editar el archivo .env.
 */
function autoDetectBaseUrl(): string | null {
  // 1. Web: mismo host desde el que se cargó la página
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return `http://${window.location.hostname}:${BACKEND_PORT}`;
    }
    return null;
  }

  // 2. Móvil (React Native / Expo Dev Client / Expo Go):
  // El bundle JS fue descargado desde Metro en tu PC.
  // Buscamos la IP del host en todas las fuentes disponibles del runtime:
  const candidatos = [
    // NativeModules: URL exacta de descarga del bundle en runtime de React Native
    (NativeModules as any)?.SourceCode?.scriptURL,
    // Expo Constants en dev client y expo go
    Constants.expoConfig?.hostUri,
    (Constants as any)?.expoGoConfig?.debuggerHost,
    (Constants as any)?.manifest?.debuggerHost,
    (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost,
    Constants.linkingUri,
    (Constants as any)?.experienceUrl,
  ];

  for (const candidato of candidatos) {
    const host = extraerHostDeCadena(candidato);
    if (host) {
      return `http://${host}:${BACKEND_PORT}`;
    }
  }

  // 3. Emulador Android oficial (Android Studio) sin host detectado
  if (Platform.OS === 'android' && !Device.isDevice) {
    return `http://10.0.2.2:${BACKEND_PORT}`;
  }

  return null;
}

/**
 * Obtiene y normaliza la URL base del backend FastAPI.
 * Prioridad:
 *   1) Si EXPO_PUBLIC_API_BASE_URL está definida y NO es 'auto', se usa esa.
 *   2) Autodetección automática de la IP de la PC (según la red actual de Metro).
 *   3) Fallback a http://localhost:8000 (funciona con cable USB vía `adb reverse tcp:8000 tcp:8000`).
 */
let hasLoggedBaseUrl = false;

export function getApiBaseUrl(): string {
  const envUrl = (
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    ''
  ).trim();

  // Si está configurada como 'auto' o no está definida, forzar autodetección
  let rawUrl: string | null = null;
  if (envUrl && envUrl.toLowerCase() !== 'auto') {
    rawUrl = envUrl;
  }

  if (!rawUrl) {
    rawUrl = autoDetectBaseUrl() || `http://localhost:${BACKEND_PORT}`;
  }

  let trimmed = rawUrl.trim();

  // Permite rutas relativas (ej. "/api" en el panel web dockerizado con nginx)
  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/+$/, '');
  }

  // Si no especifica protocolo, anteponer http://
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }

  const finalUrl = trimmed.replace(/\/+$/, '');
  if (__DEV__ && !hasLoggedBaseUrl) {
    hasLoggedBaseUrl = true;
    console.log(`[ApoyAR API] Backend FastAPI resuelto en: ${finalUrl}`);
  }

  return finalUrl;
}

/**
 * Obtiene la clave secreta compartida con el backend para endpoints protegidos.
 */
export function getApiSecretKey(): string {
  return (process.env.EXPO_PUBLIC_API_SECRET_KEY || '').trim();
}
