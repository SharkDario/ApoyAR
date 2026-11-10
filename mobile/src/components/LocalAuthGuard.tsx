// src/components/LocalAuthGuard.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Middleware / Guardián de Seguridad Local (Biometría / PIN del Dispositivo).
// Exige validación con expo-local-authentication cada vez que la app pasa
// de 'background' a 'active'.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import {
  AppState,
  AppStateStatus,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { isCamouflageVisible } from '../screens/FakeCalculatorScreen';

interface Props {
  children: ReactNode;
  enabled?: boolean;
}

export function LocalAuthGuard({ children, enabled = true }: Props) {
  const { colors, typography, spacing, radii } = useTheme();

  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isAuthenticatingRef = useRef(false);
  const backgroundTimestampRef = useRef<number>(0);

  const solicitarDesbloqueoLocal = useCallback(async () => {
    // Si la app está en Modo Invisible (Calculadora señuelo), NUNCA pedir huella ni bloquear la pantalla
    if (isAuthenticatingRef.current || isCamouflageVisible()) {
      setIsLocked(false);
      return;
    }

    try {
      isAuthenticatingRef.current = true;
      setAuthError(null);

      // Verificar si el dispositivo cuenta con hardware y PIN/biometría configurada
      const [tieneHardware, tieneBiometria] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);

      if (!tieneHardware || !tieneBiometria) {
        // Dispositivo sin bloqueo de pantalla configurado (ej: emulador sin PIN)
        setIsLocked(false);
        return;
      }

      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloqueá ApoyAR',
        fallbackLabel: 'Ingresar PIN / Patrón',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false, // Permite PIN/Patrón si la huella falla
      });

      if (res.success) {
        setIsLocked(false);
        setAuthError(null);
      } else {
        setIsLocked(true);
        setAuthError(res.error === 'user_cancel' ? 'Desbloqueo cancelado por el usuario.' : 'No se pudo verificar tu identidad.');
      }
    } catch (e: any) {
      console.warn('[LocalAuthGuard] Error en autenticación biométrica:', e);
      setIsLocked(true);
      setAuthError('Ocurrió un error al solicitar autenticación local.');
    } finally {
      isAuthenticatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      // Registrar momento en que la app pasa a background real (ignorar 'inactive' de modales y diálogos)
      if (nextAppState === 'background') {
        backgroundTimestampRef.current = Date.now();
      }

      // Si la app está en Modo Invisible (Calculadora señuelo), NO bloquear ni pedir huella/patrón
      if (isCamouflageVisible()) {
        setIsLocked(false);
        appStateRef.current = nextAppState;
        return;
      }

      // Solo bloquear si la app estuvo en segundo plano real por más de 1 minuto
      if (
        appStateRef.current === 'background' &&
        nextAppState === 'active' &&
        backgroundTimestampRef.current > 0
      ) {
        const timeInBackground = Date.now() - backgroundTimestampRef.current;
        backgroundTimestampRef.current = 0;

        // Si solo fueron unos segundos (ej: configurar batería, ver permisos o diálogo nativo), no bloquear
        if (timeInBackground > 60000 && !isAuthenticatingRef.current) {
          setIsLocked(true);
          solicitarDesbloqueoLocal();
        }
      }

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, solicitarDesbloqueoLocal]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {isLocked && !isCamouflageVisible() && (
        <View style={[styles.lockScreen, { backgroundColor: colors.bg.base }]}>
          <View style={[styles.lockCard, { backgroundColor: colors.bg.surface, borderRadius: radii.lg, padding: spacing.xl }]}>
            <View style={[styles.iconCircle, { backgroundColor: colors.semantic.dangerBg, borderRadius: radii.full, marginBottom: spacing.lg }]}>
              <Feather name="lock" size={36} color={colors.semantic.danger} />
            </View>

            <Text style={[typography.scale.h2, { color: colors.text.primary, textAlign: 'center' }]}>
              ApoyAR Protegida
            </Text>

            <Text style={[typography.scale.body, { color: colors.text.secondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.xl }]}>
              Por tu seguridad, verificá tu huella o PIN para acceder a la aplicación.
            </Text>

            {authError ? (
              <Text style={[typography.scale.caption, { color: colors.semantic.danger, textAlign: 'center', marginBottom: spacing.md }]}>
                {authError}
              </Text>
            ) : null}

            <Pressable
              onPress={solicitarDesbloqueoLocal}
              style={[styles.unlockBtn, { backgroundColor: colors.semantic.danger, borderRadius: radii.md, paddingVertical: spacing.md }]}
            >
              <Feather name="shield" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={[typography.scale.bodyBold, { color: '#FFFFFF' }]}>
                Reintentar Desbloqueo
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lockScreen: {
    ...(StyleSheet.absoluteFill as any),
    zIndex: 99999,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  lockCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
  },
  iconCircle: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
});
