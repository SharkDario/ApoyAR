// src/services/botonesFisicos.ts
// ─────────────────────────────────────────────────────────────────────────────
// Activación del Modo Resguardo con botones físicos (RF-2.4):
// apretar 3 veces Volumen abajo en menos de 2 segundos.
//
// La detección corre en el módulo nativo (BotonesFisicos.kt):
// - con la app a la vista, incluida la calculadora señuelo;
// - con la Escucha en vivo activa, también en segundo plano y con la pantalla apagada.
//
// La suscripción vive a nivel de módulo (no dentro de una pantalla) para que
// funcione aunque la interfaz no esté montada.
// ─────────────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { apoyarNativo } from '../../modules/apoyar-nativo';
import { resguardoService } from './resguardoService';
import { isCamouflageVisible } from '../screens/FakeCalculatorScreen';

export const STORAGE_KEY_BOTONES_FISICOS = '@apoyar_botones_fisicos';

let manejadorPantalla: (() => void) | null = null;
let suscrito = false;

/** False en plataformas o compilaciones sin el módulo nativo (por ejemplo, Expo Go). */
export function botonesFisicosDisponibles(): boolean {
  return typeof apoyarNativo?.configurarBotonesFisicos === 'function';
}

/** Lee la preferencia guardada y la aplica al módulo nativo. Desactivada por defecto. */
export async function cargarPreferenciaBotonesAsync(): Promise<boolean> {
  const valor = await AsyncStorage.getItem(STORAGE_KEY_BOTONES_FISICOS).catch(() => null);
  const habilitado = valor === 'true';
  if (botonesFisicosDisponibles()) apoyarNativo!.configurarBotonesFisicos(habilitado);
  return habilitado;
}

export async function guardarPreferenciaBotonesAsync(habilitado: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_BOTONES_FISICOS, habilitado ? 'true' : 'false');
  if (botonesFisicosDisponibles()) apoyarNativo!.configurarBotonesFisicos(habilitado);
}

/**
 * La pantalla principal registra cómo mostrar la cuenta regresiva cuando la app
 * está a la vista. Devuelve la función para quitar el registro.
 */
export function registrarManejadorPantalla(manejador: () => void): () => void {
  manejadorPantalla = manejador;
  return () => {
    if (manejadorPantalla === manejador) manejadorPantalla = null;
  };
}

/** Se suscribe una sola vez al evento nativo. Se llama al arrancar la app. */
export function iniciarActivacionPorBotones(): void {
  if (suscrito || !botonesFisicosDisponibles() || typeof apoyarNativo?.addListener !== 'function') return;
  suscrito = true;
  // Aplica la preferencia guardada al arrancar, sin esperar a la pantalla principal
  cargarPreferenciaBotonesAsync().catch(() => {});
  apoyarNativo.addListener('onPulsacionesVolumen', () => {
    if (resguardoService.isResguardoActive()) return;
    // App a la vista: misma cuenta regresiva que el SOS manual (se puede cancelar).
    if (AppState.currentState === 'active' && !isCamouflageVisible() && manejadorPantalla) {
      manejadorPantalla();
      return;
    }
    // Calculadora a la vista, segundo plano o pantalla apagada: activación directa y silenciosa.
    resguardoService.activarModoResguardoAsync('botones_fisicos').catch((err) => {
      console.warn('[botonesFisicos] Error activando el Modo Resguardo:', err);
    });
  });
}
