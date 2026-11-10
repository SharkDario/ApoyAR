// src/lib/geoUtils.ts
// ─────────────────────────────────────────────────────────────────────────────
// Utilidad de Geocodificación Inversa Resiliente (Edge & Receptor).
//
// Diseñada para resolver coordenadas (latitud, longitud) a nombres de calles legibles:
// 1. Memoria caché para evitar consultas redundantes.
// 2. expo-location (Geocoder nativo cuando la app está en primer plano).
// 3. Fallback automático a OpenStreetMap Nominatim (HTTP) si el Geocoder nativo
//    falla o no está disponible (ej. en dispositivos Samsung o restricciones de SO).
// ─────────────────────────────────────────────────────────────────────────────

import * as Location from 'expo-location';

const geocodeCache = new Map<string, string>();

/**
 * Determina si un texto de dirección son solamente números de coordenadas
 * o un placeholder genérico sin nombre de calle.
 */
export function esSoloCoordenadas(texto?: string | null): boolean {
  if (!texto) return true;
  const t = texto.trim();
  if (
    t === 'Ubicación de emergencia' ||
    t === 'Ubicación no disponible' ||
    t === 'Ubicación de la alerta' ||
    t === 'Obteniendo dirección...' ||
    t === 'Dirección desconocida' ||
    t === ''
  ) {
    return true;
  }
  // Coordenadas con formato "-26.15924, -58.17875", "( -26.159, -58.178 )", etc.
  if (/^[\(\[]?\s*-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?\s*[\)\]]?$/.test(t)) return true;
  if (/^(lat|long|latitud|longitud|coords?)/i.test(t)) return true;
  return false;
}

/**
 * Resuelve coordenadas a una dirección legible de calle y localidad.
 */
export async function resolverDireccionAsync(lat: number, lng: number): Promise<string> {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return 'Ubicación de emergencia';
  }

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey)!;
  }

  // 1. Intento primario: Geocoder nativo del dispositivo (rápido en primer plano)
  try {
    const places = await Promise.race([
      Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);

    if (places && places.length > 0) {
      const p = places[0];
      const calle = [p.street, p.streetNumber].filter(Boolean).join(' ').trim();
      const ciudad = p.city || p.subregion || p.region || '';
      const texto = [calle, ciudad].filter(Boolean).join(', ').trim();
      if (texto.length > 3) {
        geocodeCache.set(cacheKey, texto);
        return texto;
      }
    }
  } catch (_) {
    // Si el Geocoder del SO no responde, continuamos al fallback HTTP
  }

  // 2. Fallback secundario: OpenStreetMap Nominatim vía HTTP
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'ApoyAR-Emergency/1.0 (Mobile Client)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      if (data?.address) {
        const a = data.address;
        const calle = a.road || a.pedestrian || a.street || '';
        const numero = a.house_number || '';
        const barrio = a.neighbourhood || a.suburb || '';
        const ciudad = a.city || a.town || a.village || a.county || '';

        const parteCalle = [calle, numero].filter(Boolean).join(' ').trim();
        const parteLocalidad = [barrio, ciudad].filter(Boolean).join(', ').trim();
        const resultado =
          [parteCalle, parteLocalidad].filter(Boolean).join(', ').trim() ||
          data.display_name?.split(',').slice(0, 3).join(',').trim();

        if (resultado && resultado.length > 3) {
          geocodeCache.set(cacheKey, resultado);
          return resultado;
        }
      }
    }
  } catch (_) {
    // Error de conexión o timeout
  }

  // 3. Fallback final: coordenadas limpias con 5 decimales (~1 metro de resolución)
  const coordsLimpias = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return coordsLimpias;
}
