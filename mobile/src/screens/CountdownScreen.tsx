// src/screens/CountdownScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CU-05 / RF-3.1 — Cuenta regresiva + Modo Resguardo y Preservación Forense
//
// Ahora opera con arquitectura "Background-First" desacoplada:
// La ejecución operativa completa (creación de incidente, despacho prioritario,
// grabación de audio de 5s, cifrado AES-256-GCM, subida a Storage, sellado RFC 3161
// y telemetría continua) vive en resguardoService.ts y NO se interrumpe si la usuaria
// sale de la app o bloquea la pantalla.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { useAuth } from '../contexts/AuthContext';
import { useSos } from '../contexts/SosContext';
import { resguardoService, ResguardoOrigin } from '../services/resguardoService';
import { verificarIdentidadLocalAsync } from '../lib/verificacionLocal';

type Props = NativeStackScreenProps<any, 'Countdown'>;

const COUNTDOWN_SECONDS = 5;
const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1000;

export function CountdownScreen({ route, navigation }: Props) {
  const { colors, typography, spacing, radii } = useTheme();
  const { user } = useAuth();
  const { setModoResguardo } = useSos();

  const origen: ResguardoOrigin = (route.params?.origen as ResguardoOrigin) || 'manual';
  const esAutomatico = origen !== 'manual' && origen !== 'botones_fisicos';

  const getOrigenSubtitle = () => {
    switch (origen) {
      case 'palabra_clave':
        return 'Voz: Palabra clave detectada por Vosk';
      case 'violencia_ambiental':
        return 'Acústico: Violencia ambiental detectada por YAMNet';
      case 'amenaza_verbal_vosk':
        return 'Fusión IA: Amenaza verbal detectada en habla';
      case 'automatico':
        return 'Detección autónoma en segundo plano';
      case 'botones_fisicos':
        return 'Activación con 3 pulsaciones de Volumen abajo';
      default:
        return 'Activación manual por botón SOS';
    }
  };

  const [timeLeft, setTimeLeft] = useState(esAutomatico ? 0 : COUNTDOWN_SECONDS);
  const [sosStatus, setSosStatus] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(esAutomatico ? 0 : 1)).current;
  const flujoIniciadoRef = useRef(false);

  // ── Suscripción reactiva al estado del motor de resguardo ───────────────────
  useEffect(() => {
    const unsubscribe = resguardoService.subscribe((state) => {
      if (state.statusMessage) {
        setSosStatus(state.statusMessage);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // ── Ejecutar el flujo centralizado de resguardo ─────────────────────────────
  const ejecutarFlujoSOS = useCallback(async () => {
    if (!user) {
      Alert.alert('Error', 'No hay sesión activa.');
      navigation.navigate('Home');
      return;
    }

    try {
      setModoResguardo(true);
      await resguardoService.activarModoResguardoAsync(origen);
      setTimeout(() => {
        navigation.navigate('Home', { sosDisparado: true });
      }, 1500);
    } catch (err: any) {
      console.error('[CountdownScreen] Error en activación:', err?.message);
      Alert.alert(
        'Aviso de Emergencia',
        'Se presentó un inconveniente completando el pipeline de alerta. Por favor verificá tu conexión.',
        [{ text: 'Entendido', onPress: () => navigation.navigate('Home') }]
      );
    }
  }, [user, navigation, origen, setModoResguardo]);

  // ── Timer principal (Cuenta regresiva si es activación manual) ───────────────
  useEffect(() => {
    if (esAutomatico) {
      return;
    }

    Animated.timing(progressAnim, {
      toValue: 0,
      duration: COUNTDOWN_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      progressAnim.stopAnimation();
    };
  }, [esAutomatico, progressAnim]);

  // ── Disparo seguro del Modo Resguardo al terminar la cuenta o si es automático ─
  useEffect(() => {
    if ((esAutomatico || timeLeft === 0) && !flujoIniciadoRef.current) {
      flujoIniciadoRef.current = true;
      ejecutarFlujoSOS();
    }
  }, [esAutomatico, timeLeft, ejecutarFlujoSOS]);

  // ── Cancelar ───────────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    progressAnim.stopAnimation();

    if (!flujoIniciadoRef.current) {
      navigation.navigate('Home');
      return;
    }
    // Ya activado: terminarlo exige PIN, patrón o biometría (8.10.3.5)
    verificarIdentidadLocalAsync('Confirmá tu identidad para terminar el Modo Resguardo').then((verificacion) => {
      if (verificacion === 'rechazado') return;
      resguardoService.desactivarModoResguardoAsync().catch(() => {});
      setModoResguardo(false);
      navigation.navigate('Home');
    });
  }, [navigation, progressAnim, setModoResguardo]);

  // ── Interpolaciones ────────────────────────────────────────────────────────
  const barWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.base }]} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.flexSpacer} />

        <View style={[styles.centerContent, { paddingHorizontal: spacing.xl }]}>
          {sosStatus ? (
            <View style={styles.statusContainer}>
              <Feather
                name={sosStatus.startsWith('✓') ? 'check-circle' : 'shield'}
                size={52}
                color={sosStatus.startsWith('✓') ? colors.semantic.success : colors.semantic.warning}
              />
              <Text style={[typography.scale.h2, { color: colors.text.primary, marginTop: spacing.lg, textAlign: 'center' }]}>
                {sosStatus}
              </Text>
            </View>
          ) : (
            <>
              <Text
                style={[typography.scale.h1, { color: colors.semantic.danger, marginBottom: spacing['2xs'], textAlign: 'center' }]}
                accessibilityLiveRegion="assertive"
              >
                MODO RESGUARDO
              </Text>
              <Text
                style={[typography.scale.body, { color: colors.text.secondary, marginBottom: spacing.xl, textAlign: 'center' }]}
              >
                {getOrigenSubtitle()}
              </Text>

              <View style={[styles.numberContainer, { borderColor: colors.semantic.warning }]}>
                <Text
                  style={[typography.scale.display, styles.hugeNumber, { color: colors.text.primary }]}
                  allowFontScaling={false}
                >
                  {timeLeft}
                </Text>
              </View>

              <View style={[styles.progressTrack, { backgroundColor: colors.bg.overlay, borderRadius: radii.full, marginTop: spacing['2xl'] }]}>
                <Animated.View
                  style={[styles.progressFill, { backgroundColor: colors.semantic.warning, width: barWidth, borderRadius: radii.full }]}
                />
              </View>

              <Text style={[typography.scale.bodyLg, { color: colors.text.secondary, textAlign: 'center', marginTop: spacing['2xl'] }]}>
                {esAutomatico
                  ? 'Modo Resguardo activado automáticamente. Grabando evidencia forense inmutable y alertando a tu red de apoyo.'
                  : 'Tus contactos recibirán la alerta geolocalizada y se iniciará la preservación probatoria.'}
              </Text>
            </>
          )}
        </View>

        <View style={styles.flexSpacer} />

        {!sosStatus && !esAutomatico && (
          <View style={[styles.bottomContainer, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
            <Pressable
              onPress={handleCancel}
              style={({ pressed }) => [
                styles.cancelButton,
                {
                  backgroundColor: colors.bg.surface,
                  borderColor: colors.text.secondary,
                  borderRadius: radii.md,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="x-circle" size={24} color={colors.text.primary} />
              <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm }]}>
                CANCELAR ACTIVACIÓN
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const CIRCLE_SIZE = 160;

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, alignItems: 'center', width: '100%' },
  flexSpacer: { flex: 1 },
  centerContent: { alignItems: 'center', width: '100%' },
  statusContainer: { alignItems: 'center', padding: 32 },
  numberContainer: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  hugeNumber: { fontSize: 84, lineHeight: 96 },
  progressTrack: { width: '100%', height: 12, overflow: 'hidden' },
  progressFill: { height: '100%' },
  bottomContainer: { width: '100%' },
  cancelButton: {
    flexDirection: 'row',
    width: '100%',
    minHeight: 64,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
});
