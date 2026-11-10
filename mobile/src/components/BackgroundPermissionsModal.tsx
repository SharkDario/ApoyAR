// src/components/BackgroundPermissionsModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal de Gestión de Segundo Plano y Permisos Críticos (Menú Hamburguesa).
// Permite auditar y solicitar:
// 1. Ahorro de Batería (Exclusión de Doze Mode)
// 2. Micrófono (Captura continua y FGS)
// 3. Ubicación en Segundo Plano ("Permitir todo el tiempo")
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAudioRecorder, requestRecordingPermissionsAsync, AudioModule } from 'expo-audio';
import { useTheme } from '@theme';
import { Button } from './Button';
import { solicitarExclusionBateriaAsync } from '../services/batteryOptimizationService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function BackgroundPermissionsModal({ visible, onClose }: Props) {
  const { colors, typography, spacing, radii } = useTheme();

  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [hasBgLocation, setHasBgLocation] = useState<boolean | null>(null);

  const verificarPermisos = useCallback(async () => {
    try {
      // 1. Verificar Micrófono (Solo consultar estado, no disparar diálogo del sistema)
      const micStatus = await AudioModule.getRecordingPermissionsAsync();
      setHasMicPermission(micStatus.granted);

      // 2. Verificar Ubicación en Segundo Plano
      const bgLoc = await Location.getBackgroundPermissionsAsync();
      setHasBgLocation(bgLoc.granted);
    } catch (e) {
      console.warn('[BackgroundPermissions] Error verificando permisos:', e);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      verificarPermisos();
      const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'active') {
          verificarPermisos();
        }
      });
      return () => sub.remove();
    }
  }, [visible, verificarPermisos]);

  const handleSolicitarBateria = async () => {
    await solicitarExclusionBateriaAsync();
  };

  const handleSolicitarMic = async () => {
    const res = await requestRecordingPermissionsAsync();
    setHasMicPermission(res.granted);
  };

  const handleSolicitarBgLocation = async () => {
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.granted) {
        const bg = await Location.requestBackgroundPermissionsAsync();
        setHasBgLocation(bg.granted);
      }
    } catch (e) {
      console.warn('[BackgroundPermissions] Error solicitando background location:', e);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent={true} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.bg.surface, borderRadius: radii.lg }]}>
          {/* Cabecera */}
          <View style={[styles.header, { borderBottomColor: colors.border.default }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View
                style={[
                  styles.iconBadge,
                  { backgroundColor: colors.semantic.infoBg, borderRadius: radii.sm, marginRight: spacing.sm },
                ]}
              >
                <Feather name="cpu" size={20} color={colors.semantic.info} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.scale.h2, { color: colors.text.primary }]}>
                  Segundo Plano
                </Text>
                <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                  Permisos de ejecución y pantalla bloqueada
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={22} color={colors.text.secondary} />
            </Pressable>
          </View>

          <ScrollView style={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
            {/* Tarjeta 1: Ahorro de Batería */}
            <View
              style={[
                styles.itemBox,
                { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.md },
              ]}
            >
              <View style={styles.itemHeader}>
                <Feather name="battery-charging" size={18} color={colors.semantic.warning} />
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm, flex: 1 }]}>
                  Ahorro de Batería (Doze Mode)
                </Text>
              </View>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 4, marginBottom: spacing.md }]}>
                Android suspende las aplicaciones cuando el dispositivo entra en reposo profundo. Excluí a ApoyAR para que no se apague con la pantalla bloqueada.
              </Text>
              <Pressable
                onPress={handleSolicitarBateria}
                style={[styles.actionBtn, { backgroundColor: colors.bg.surface, borderColor: colors.border.focus, borderRadius: radii.sm }]}
              >
                <Text style={[typography.scale.caption, { color: colors.border.focus, fontWeight: '700' }]}>
                  Abrir Configuración de Batería
                </Text>
                <Feather name="external-link" size={14} color={colors.border.focus} style={{ marginLeft: 6 }} />
              </Pressable>

              {/* Nota de ayuda para fabricantes con capas agresivas */}
              <View
                style={{
                  backgroundColor: colors.bg.surface,
                  borderRadius: radii.sm,
                  padding: spacing.sm,
                  marginTop: spacing.sm,
                  borderLeftWidth: 3,
                  borderLeftColor: colors.semantic.warning,
                }}
              >
                <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11, lineHeight: 16 }]}>
                  💡 <Text style={{ fontWeight: '700', color: colors.text.primary }}>Samsung / Xiaomi:</Text> En 'Ajustes → Aplicaciones → ApoyAR → Batería', seleccioná <Text style={{ fontWeight: '700', color: colors.semantic.warning }}>Sin restricciones</Text> y verificá que 'Inicio automático' esté permitido para garantizar que el micrófono no se pause al apagar la pantalla.
                </Text>
              </View>
            </View>

            {/* Tarjeta 2: Micrófono */}
            <View
              style={[
                styles.itemBox,
                { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.md },
              ]}
            >
              <View style={styles.itemHeader}>
                <Feather name="mic" size={18} color={colors.semantic.danger} />
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm, flex: 1 }]}>
                  Micrófono y Escucha Activa
                </Text>
                {hasMicPermission && (
                  <View style={[styles.statusBadge, { backgroundColor: colors.semantic.successBg, borderRadius: radii.full }]}>
                    <Text style={[typography.scale.caption, { color: colors.semantic.success, fontWeight: '700', fontSize: 11 }]}>
                      ✓ Concedido
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 4, marginBottom: spacing.md }]}>
                Permite la detección continua de palabras clave de auxilio y ruidos de agresión acústica.
              </Text>
              {!hasMicPermission && (
                <Pressable
                  onPress={handleSolicitarMic}
                  style={[styles.actionBtn, { backgroundColor: colors.semantic.danger, borderRadius: radii.sm }]}
                >
                  <Text style={[typography.scale.caption, { color: '#FFFFFF', fontWeight: '700' }]}>
                    Solicitar Permiso de Micrófono
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Tarjeta 3: Ubicación en Segundo Plano */}
            <View
              style={[
                styles.itemBox,
                { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.md },
              ]}
            >
              <View style={styles.itemHeader}>
                <Feather name="map-pin" size={18} color={colors.semantic.info} />
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm, flex: 1 }]}>
                  Ubicación ("Todo el tiempo")
                </Text>
                {hasBgLocation && (
                  <View style={[styles.statusBadge, { backgroundColor: colors.semantic.successBg, borderRadius: radii.full }]}>
                    <Text style={[typography.scale.caption, { color: colors.semantic.success, fontWeight: '700', fontSize: 11 }]}>
                      ✓ Concedido
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 4, marginBottom: spacing.md }]}>
                Requerido para actualizar a tu red de confianza en tiempo real cuando se activa el Modo Resguardo con el móvil guardado.
              </Text>
              {!hasBgLocation && (
                <Pressable
                  onPress={handleSolicitarBgLocation}
                  style={[styles.actionBtn, { backgroundColor: colors.border.focus, borderRadius: radii.sm }]}
                >
                  <Text style={[typography.scale.caption, { color: '#FFFFFF', fontWeight: '700' }]}>
                    Permitir Ubicación "Todo el tiempo"
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Tarjeta 4: Transparencia y Notificación Discreta */}
            <View
              style={[
                styles.itemBox,
                { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.md },
              ]}
            >
              <View style={styles.itemHeader}>
                <Feather name="shield" size={18} color={colors.semantic.info} />
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.sm, flex: 1 }]}>
                  Notificación Discreta del Sistema
                </Text>
              </View>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 4, marginBottom: spacing.xs }]}>
                Android 14+ exige mostrar una notificación fija para mantener activa la escucha en segundo plano. Para tu protección, ApoyAR la disfraza como «Servicio de sincronización» de forma totalmente silenciosa y oculta en la pantalla de bloqueo, sin delatar la aplicación ante terceros.
              </Text>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11, fontStyle: 'italic' }]}>
                🔒 Tenés el control total: podés encender o pausar la Escucha en vivo en cualquier momento desde el interruptor principal.
              </Text>
            </View>

            <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
              <Button label="Cerrar" variant="ghost" onPress={onClose} />
            </View>
          </ScrollView>
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
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  iconBadge: {
    padding: 8,
  },
  closeBtn: {
    padding: 6,
  },
  itemBox: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
