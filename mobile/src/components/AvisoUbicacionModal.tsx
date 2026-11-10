// src/components/AvisoUbicacionModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Aviso que aparece al abrir la app si falta algo para conocer la ubicación:
// el GPS del teléfono, el permiso de ubicación o "Permitir todo el tiempo".
// Nunca se muestra en el Modo Invisible ni durante el Modo Resguardo.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useTheme } from '@theme';
import { Button } from './Button';
import { isCamouflageVisible } from '../screens/FakeCalculatorScreen';
import { resguardoService } from '../services/resguardoService';

type Problema = 'ubicacion_apagada' | 'sin_permiso' | 'sin_segundo_plano';

interface EstadoAviso {
  problema: Problema;
  puedePreguntar: boolean;
}

const CONTENIDO: Record<Problema, { titulo: string; descripcion: string; detalle: string; accion: string }> = {
  ubicacion_apagada: {
    titulo: 'Activá la ubicación',
    descripcion: 'La ubicación de tu teléfono está apagada.',
    detalle: 'Si pedís ayuda, tu red de apoyo no va a poder ver dónde estás.',
    accion: 'Activar ubicación',
  },
  sin_permiso: {
    titulo: 'Permití el acceso a tu ubicación',
    descripcion: 'ApoyAR no tiene permiso para usar la ubicación.',
    detalle: 'Si pedís ayuda, tu red de apoyo no va a poder ver dónde estás.',
    accion: 'Permitir ubicación',
  },
  sin_segundo_plano: {
    titulo: 'Permití la ubicación todo el tiempo',
    descripcion: 'Con el teléfono bloqueado, ApoyAR no puede obtener tu ubicación.',
    detalle: 'En los ajustes elegí "Permitir todo el tiempo". Se usa para enviar tu posición durante una emergencia.',
    accion: 'Abrir ajustes de ubicación',
  },
};

async function detectarProblemaAsync(): Promise<EstadoAviso | null> {
  if (!(await Location.hasServicesEnabledAsync())) {
    return { problema: 'ubicacion_apagada', puedePreguntar: true };
  }

  const primerPlano = await Location.getForegroundPermissionsAsync();
  if (!primerPlano.granted) {
    return { problema: 'sin_permiso', puedePreguntar: primerPlano.canAskAgain };
  }

  const segundoPlano = await Location.getBackgroundPermissionsAsync();
  if (!segundoPlano.granted) {
    return { problema: 'sin_segundo_plano', puedePreguntar: segundoPlano.canAskAgain };
  }
  return null;
}

async function resolverProblemaAsync({ problema, puedePreguntar }: EstadoAviso): Promise<void> {
  if (problema === 'ubicacion_apagada') {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      if (Platform.OS === 'android') {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
      } else {
        await Linking.openSettings();
      }
    }
    return;
  }

  if (!puedePreguntar) {
    await Linking.openSettings();
  } else if (problema === 'sin_permiso') {
    await Location.requestForegroundPermissionsAsync();
  } else {
    await Location.requestBackgroundPermissionsAsync();
  }
}

export function AvisoUbicacionModal() {
  const { colors, typography, spacing, radii } = useTheme();
  const enPantalla = useIsFocused();
  const [aviso, setAviso] = useState<EstadoAviso | null>(null);
  const [resolviendo, setResolviendo] = useState(false);
  const descartado = useRef(false); // "Ahora no" vale hasta la próxima vez que se abra la app

  const verificarAsync = useCallback(async () => {
    if (!enPantalla || isCamouflageVisible() || resguardoService.isResguardoActive()) {
      setAviso(null);
      return;
    }

    try {
      const estado = await detectarProblemaAsync();
      if (!estado) descartado.current = false;
      setAviso(estado && !descartado.current ? estado : null);
    } catch (err) {
      console.warn('[AvisoUbicacion] No se pudo verificar la ubicación:', err);
    }
  }, [enPantalla]);

  useEffect(() => {
    verificarAsync();
    const suscripcion = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') verificarAsync();
    });
    return () => suscripcion.remove();
  }, [verificarAsync]);

  const handleResolver = async () => {
    if (!aviso) return;
    setResolviendo(true);
    try {
      await resolverProblemaAsync(aviso);
    } catch (err) {
      console.warn('[AvisoUbicacion] No se pudo abrir la configuración:', err);
    } finally {
      setResolviendo(false);
      verificarAsync();
    }
  };

  const handleDescartar = () => {
    descartado.current = true;
    setAviso(null);
  };

  if (!aviso) return null;

  const { problema, puedePreguntar } = aviso;
  const contenido = CONTENIDO[problema];
  const accion = !puedePreguntar ? 'Abrir ajustes' : contenido.accion;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={handleDescartar}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.bg.surface, borderRadius: radii.lg, padding: spacing.xl }]}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: colors.semantic.warningBg, borderRadius: radii.full, marginBottom: spacing.md },
            ]}
          >
            <Feather name="map-pin" size={32} color={colors.semantic.warning} />
          </View>

          <Text style={[typography.scale.h2, { color: colors.text.primary, textAlign: 'center' }]}>
            {contenido.titulo}
          </Text>

          <Text
            style={[
              typography.scale.body,
              { color: colors.text.secondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.md },
            ]}
          >
            {contenido.descripcion}
          </Text>

          <View
            style={[
              styles.infoBox,
              { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.md, padding: spacing.md },
            ]}
          >
            <Feather name="info" size={18} color={colors.semantic.info} style={{ marginRight: 8, marginTop: 2 }} />
            <Text style={[typography.scale.caption, { color: colors.text.primary, flex: 1 }]}>
              {contenido.detalle}
            </Text>
          </View>

          <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              label={accion}
              loading={resolviendo}
              icon={<Feather name="map-pin" size={18} color={colors.text.primary} />}
              onPress={handleResolver}
            />
            <Button label="Ahora no" variant="ghost" onPress={handleDescartar} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  iconCircle: {
    width: 68,
    height: 68,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    width: '100%',
  },
});
