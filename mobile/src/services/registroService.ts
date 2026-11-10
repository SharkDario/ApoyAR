// src/services/registroService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Apoyos del registro de cuenta civil: comprobar que el correo, el DNI y el
// teléfono no estén en uso, y armar la dirección a partir de la ubicación actual.
// ─────────────────────────────────────────────────────────────────────────────

import * as Location from 'expo-location';

import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import type { CampoUnico } from '../hooks/useRegistrationForm';

/**
 * Pregunta al servidor qué datos ya pertenecen a otra cuenta.
 * Devuelve un mensaje por campo en uso; si el servidor no responde, lanza un error.
 */
export async function verificarDisponibilidadRegistro(
  datos: Partial<Record<CampoUnico, string>>,
): Promise<Partial<Record<CampoUnico, string>>> {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/usuarios/validar-registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Secret': getApiSecretKey() },
    body: JSON.stringify(datos),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json?.errores ?? {}) as Partial<Record<CampoUnico, string>>;
}

/**
 * Dirección aproximada ("Calle Nro, Barrio, Ciudad") de la ubicación actual.
 * Devuelve null si se niega el permiso o no se puede resolver.
 */
export async function obtenerDireccionActual(): Promise<{ direccion: string | null; error?: string }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { direccion: null, error: 'Para completar la dirección hace falta permitir el acceso a la ubicación.' };
  }
  const posicion = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const lugares = await Location.reverseGeocodeAsync({
    latitude: posicion.coords.latitude,
    longitude: posicion.coords.longitude,
  });
  const lugar = lugares?.[0];
  if (!lugar) return { direccion: null, error: 'No se pudo encontrar la dirección de tu ubicación.' };

  const calle = [lugar.street || lugar.name, lugar.streetNumber].filter(Boolean).join(' ').trim();
  const partes = [calle, lugar.district, lugar.city || lugar.subregion].filter((p, i, todas) => p && todas.indexOf(p) === i);
  const direccion = partes.join(', ').trim();
  return direccion ? { direccion } : { direccion: null, error: 'No se pudo encontrar la dirección de tu ubicación.' };
}
