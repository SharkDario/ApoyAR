// src/components/TechValue.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Componente reutilizable para valores técnicos periciales largos
// (Hashes SHA-256, Algoritmos de cifrado, Tokens RFC 3161, UUIDs, URLs).
// Muestra versión compacta truncada al medio y abre un modal con el valor
// completo y botón de copiado pericial para no perder el dato original.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';

interface TechValueProps {
  value: string;
  label?: string;
  prefix?: string;
  mode?: 'middle' | 'chip' | 'full';
  maxLength?: number;
  color?: string;
  badgeBg?: string;
}

export function TechValue({
  value,
  label = 'Dato Técnico Forense',
  prefix,
  mode = 'middle',
  maxLength = 18,
  color,
  badgeBg,
}: TechValueProps) {
  const { colors, typography, spacing, radii } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);

  if (!value) return null;

  // Formato truncado al medio: ej. "a3f9...c21d"
  const formatTruncated = (str: string, max: number): string => {
    if (str.length <= max) return str;
    const half = Math.floor((max - 3) / 2);
    return `${str.substring(0, half)}...${str.substring(str.length - half)}`;
  };

  const displayText = mode === 'full' ? value : formatTruncated(value, maxLength);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert('Copiado', 'El valor técnico completo fue copiado al portapapeles.');
    } catch {
      Alert.alert('Error', 'No se pudo copiar el valor.');
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setModalVisible(true)}
        accessibilityLabel={`Ver ${label} completo`}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.container,
          mode === 'chip' && [
            styles.chip,
            {
              backgroundColor: badgeBg || colors.bg.overlay,
              borderRadius: radii.full,
              borderColor: colors.border.default,
            },
          ],
          pressed && { opacity: 0.7 },
        ]}
      >
        {prefix ? (
          <Text style={[typography.scale.caption, { color: colors.text.secondary, marginRight: 2 }]}>
            {prefix}
          </Text>
        ) : null}

        <Text
          style={[
            typography.scale.caption,
            styles.monoText,
            {
              color: color || (mode === 'chip' ? colors.semantic.info : colors.text.primary),
              fontWeight: '700',
            },
          ]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {displayText}
        </Text>

        <Feather
          name="maximize-2"
          size={11}
          color={color || colors.text.secondary}
          style={{ marginLeft: 4, opacity: 0.8 }}
        />
      </Pressable>

      {/* Modal de Detalle Pericial y Copia */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)}>
          <Pressable
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.bg.surface,
                borderColor: colors.border.default,
                borderRadius: radii.md,
                padding: spacing.lg,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}>
                <Feather name="file-text" size={18} color={colors.semantic.info} style={{ marginRight: 6 }} />
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]} numberOfLines={1}>
                  {label}
                </Text>
              </View>
              <Pressable onPress={() => setModalVisible(false)} style={{ padding: 4 }}>
                <Feather name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            <Text style={[typography.scale.caption, { color: colors.text.secondary, marginVertical: spacing.xs }]}>
              Valor íntegro sin truncar preservado para validez judicial:
            </Text>

            <View
              style={[
                styles.codeBox,
                {
                  backgroundColor: colors.bg.base,
                  borderColor: colors.border.focus,
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
            >
              <ScrollView style={{ maxHeight: 180 }}>
                <Text
                  selectable
                  style={[
                    styles.monoText,
                    typography.scale.caption,
                    { color: colors.text.primary, lineHeight: 20 },
                  ]}
                >
                  {value}
                </Text>
              </ScrollView>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                onPress={handleCopy}
                style={[
                  styles.copyBtn,
                  { backgroundColor: colors.border.focus, borderRadius: radii.sm, marginRight: spacing.sm },
                ]}
              >
                <Feather name="copy" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={[typography.scale.caption, { color: '#FFFFFF', fontWeight: '700' }]}>
                  Copiar Dato
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setModalVisible(false)}
                style={[
                  styles.closeBtn,
                  { backgroundColor: colors.bg.overlay, borderRadius: radii.sm },
                ]}
              >
                <Text style={[typography.scale.caption, { color: colors.text.primary, fontWeight: '600' }]}>
                  Cerrar
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  monoText: {
    fontFamily: 'monospace',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  codeBox: {
    borderWidth: 1,
    marginVertical: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
