// src/components/BatteryOptimizationModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal persuasivo para solicitar la desactivación del ahorro de batería
// (Doze Mode / Reposo Profundo en Android).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { Button } from './Button';
import {
  solicitarExclusionBateriaAsync,
  marcarAvisoBateriaGestionadoAsync,
} from '../services/batteryOptimizationService';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export function BatteryOptimizationModal({ visible, onDismiss }: Props) {
  const { colors, typography, spacing, radii } = useTheme();

  const handleDisableOptimization = async () => {
    await marcarAvisoBateriaGestionadoAsync();
    await solicitarExclusionBateriaAsync();
    onDismiss();
  };

  const handleDismiss = async () => {
    await marcarAvisoBateriaGestionadoAsync();
    onDismiss();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.bg.surface, borderRadius: radii.lg, padding: spacing.xl }]}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: colors.semantic.warningBg, borderRadius: radii.full, marginBottom: spacing.md },
            ]}
          >
            <Feather name="battery-charging" size={36} color={colors.semantic.warning} />
          </View>

          <Text style={[typography.scale.h2, { color: colors.text.primary, textAlign: 'center' }]}>
            Funcionamiento en Pantalla Bloqueada
          </Text>

          <Text
            style={[
              typography.scale.body,
              { color: colors.text.secondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.md },
            ]}
          >
            Android suspende las aplicaciones cuando la pantalla se bloquea (Doze Mode).
          </Text>

          <View
            style={[
              styles.infoBox,
              { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.md, padding: spacing.md },
            ]}
          >
            <Feather name="info" size={18} color={colors.semantic.info} style={{ marginRight: 8, marginTop: 2 }} />
            <Text style={[typography.scale.caption, { color: colors.text.primary, flex: 1 }]}>
              Para que <Text style={{ fontWeight: '700' }}>"Escucha en vivo"</Text> y el <Text style={{ fontWeight: '700' }}>"Modo Resguardo"</Text> no se interrumpan con el teléfono en el bolsillo o bloqueado, es necesario excluir a ApoyAR del ahorro de batería.
            </Text>
          </View>

          <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              label="Excluir de Ahorro de Batería"
              onPress={handleDisableOptimization}
            />
            <Button
              label="Recordármelo más tarde"
              variant="ghost"
              onPress={handleDismiss}
            />
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
