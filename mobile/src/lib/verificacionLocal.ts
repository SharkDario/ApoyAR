// src/lib/verificacionLocal.ts
// ─────────────────────────────────────────────────────────────────────────────
// Verificación de identidad con el bloqueo del propio teléfono (8.10.3.5).
// Usa lo que la usuaria tenga configurado: huella, rostro, PIN, patrón o
// contraseña. Si el teléfono no tiene ningún bloqueo, no hay nada que pedir.
// ─────────────────────────────────────────────────────────────────────────────
import * as LocalAuthentication from 'expo-local-authentication';

export type ResultadoVerificacion = 'verificado' | 'sin_bloqueo' | 'rechazado';

export async function verificarIdentidadLocalAsync(motivo: string): Promise<ResultadoVerificacion> {
  try {
    const nivel = await LocalAuthentication.getEnrolledLevelAsync();
    if (nivel === LocalAuthentication.SecurityLevel.NONE) {
      return 'sin_bloqueo';
    }
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: motivo,
      cancelLabel: 'Cancelar',
      disableDeviceFallback: false, // si falla la biometría, ofrece PIN, patrón o contraseña
    });
    return res.success ? 'verificado' : 'rechazado';
  } catch (err) {
    console.warn('[verificacionLocal] No se pudo verificar la identidad:', err);
    return 'rechazado';
  }
}
