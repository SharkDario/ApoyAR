// src/lib/ubicacionEvidencia.ts
// ─────────────────────────────────────────────────────────────────────────────
// Ubicación real de un incidente o evidencia. Si no hay señal no se inventa un
// punto: la tabla `incidente` exige coordenadas, por lo que (0, 0) significa
// "sin GPS" y el backend la excluye de la correlación Haversine (RF-3.6).
// ─────────────────────────────────────────────────────────────────────────────

import * as Location from 'expo-location';
import { esperarAsync } from './temporizadorAudio';

export const LATITUD_SIN_GPS = 0;
export const LONGITUD_SIN_GPS = 0;
export const DIRECCION_SIN_GPS = 'Ubicación no disponible';

const TIMEOUT_GPS_MS = 3500;
const ANTIGUEDAD_MAXIMA_MS = 10 * 60 * 1000;

export interface UbicacionEvidencia {
  latitud: number;
  longitud: number;
  precision_m: number | null;
  ubicacion_fecha: string;
  ubicacion_origen: 'gps' | 'ultima_conocida';
}

function aUbicacion(loc: Location.LocationObject, origen: UbicacionEvidencia['ubicacion_origen']): UbicacionEvidencia {
  let { latitude: latitud, longitude: longitud } = loc.coords;
  // Corrección defensiva ante posible transposición lat/lng
  if (Math.abs(latitud) > 50 && Math.abs(longitud) < 40) {
    [latitud, longitud] = [longitud, latitud];
  }
  return {
    latitud,
    longitud,
    precision_m: loc.coords.accuracy ?? null,
    ubicacion_fecha: new Date(loc.timestamp).toISOString(),
    ubicacion_origen: origen,
  };
}

/** Posición actual o, si tarda, la última conocida reciente. Devuelve null si no hay ninguna. */
export async function obtenerUbicacionAsync(): Promise<UbicacionEvidencia | null> {
  try {
    const actual = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      esperarAsync(TIMEOUT_GPS_MS).then(() => null),
    ]);
    if (actual?.coords) return aUbicacion(actual, 'gps');
  } catch (err) {
    console.warn('[Ubicación] Aviso obteniendo GPS:', err);
  }

  try {
    const ultima = await Location.getLastKnownPositionAsync({ maxAge: ANTIGUEDAD_MAXIMA_MS });
    if (ultima?.coords) return aUbicacion(ultima, 'ultima_conocida');
  } catch (err) {
    console.warn('[Ubicación] Aviso obteniendo última posición:', err);
  }
  return null;
}
