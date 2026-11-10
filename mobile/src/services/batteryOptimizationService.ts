// src/services/batteryOptimizationService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Servicio para solicitar la exclusión de optimización de batería (Doze Mode)
// en Android mediante expo-intent-launcher.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform, Linking, Alert } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY_BATTERY_OPT_ASKED = '@apoyar_battery_opt_asked';

/**
 * Abre el diálogo nativo de Android para solicitar la exclusión
 * de optimizaciones de batería con cadena estricta de 3 fallbacks:
 * 1. android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (diálogo directo del sistema)
 * 2. android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS (lista general de optimización)
 * 3. Linking.openSettings() (detalle de la aplicación en Ajustes)
 * Si todos fallan, muestra instrucciones claras para configuración manual.
 */
export async function solicitarExclusionBateriaAsync(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  const packageName = 'com.anonymous.mobile';

  // 1. Intento Directo: Diálogo nativo del sistema
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${packageName}` }
    );
    return true;
  } catch (err1) {
    console.warn('[Battery] Falló intento 1 (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS):', err1);
  }

  // 2. Fallback a Lista General de Optimización de Batería
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'
    );
    return true;
  } catch (err2) {
    console.warn('[Battery] Falló intento 2 (IGNORE_BATTERY_OPTIMIZATION_SETTINGS):', err2);
  }

  // 3. Fallback al Detalle de Ajustes de la App
  try {
    await Linking.openSettings();
    return true;
  } catch (err3) {
    console.warn('[Battery] Falló intento 3 (Linking.openSettings):', err3);
  }

  // 4. Si fallaron todos los intents, guiar a la usuaria manualmente
  Alert.alert(
    'Ajuste Manual Requerido',
    'No pudimos abrir la configuración de batería automáticamente.\n\nPor favor seguí estos pasos:\n1. Abrí Ajustes en tu teléfono.\n2. Ingresá a Aplicaciones > ApoyAR.\n3. Tocá en Batería y seleccioná "Sin restricciones".',
    [{ text: 'Entendido' }]
  );
  return false;
}

/**
 * Consulta si el usuario ya vio el aviso de optimización de batería.
 */
export async function debeMostrarAvisoBateriaAsync(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const yaConsultado = await AsyncStorage.getItem(STORAGE_KEY_BATTERY_OPT_ASKED);
  return yaConsultado !== 'true';
}

/**
 * Marca que el aviso de batería ya fue gestionado.
 */
export async function marcarAvisoBateriaGestionadoAsync(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_BATTERY_OPT_ASKED, 'true');
}
