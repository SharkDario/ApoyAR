// src/lib/metadatosEvidencia.ts
// ─────────────────────────────────────────────────────────────────────────────
// Metadatos de una evidencia (RF-3.2 / RF-3.6). Las coordenadas quedan legibles
// porque la correlación Haversine las necesita; los datos del dispositivo se
// guardan cifrados con la DEK de la propia evidencia.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import {
  cifrarMetadatosAsync,
  obtenerDatosFirmaDispositivoAsync,
  type EnvelopeCifradoResult,
} from './cryptoForense';
import type { UbicacionEvidencia } from './ubicacionEvidencia';

export async function construirMetadataEvidenciaAsync(
  contexto: Record<string, unknown>,
  envelope: EnvelopeCifradoResult,
  ubicacion: UbicacionEvidencia | null
): Promise<Record<string, unknown>> {
  const firmaDispositivo = await obtenerDatosFirmaDispositivoAsync();

  return {
    plataforma: Platform.OS,
    ...contexto,
    ...(ubicacion ?? {}),
    enclave_seguro: firmaDispositivo?.nivel ?? 'no_disponible',
    firma_dispositivo: firmaDispositivo,
    sobre_digital: envelope.sobreDigital,
    metadatos_cifrados: await cifrarMetadatosAsync(
      {
        fabricante: Device.manufacturer,
        marca: Device.brand,
        modelo: Device.modelName,
        sistema_operativo: Device.osName,
        version_sistema: Device.osVersion,
        hash_archivo_plano: envelope.hashAudioPlano,
      },
      envelope.dekHex
    ),
  };
}
