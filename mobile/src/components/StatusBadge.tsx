// src/components/StatusBadge.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Badge de estado semántico: SIEMPRE muestra ícono + texto + color semántico.
// Nunca comunica estado solo por color (docs/08-diseño.md §1.6, §4 regla 1).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@theme';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  /** Sub-texto opcional debajo del label */
  description?: string;
  /** Ícono emoji o string (e.g. "✓", "⚠", "ℹ") */
  icon: string;
  /** Si true, ocupa el ancho disponible */
  fullWidth?: boolean;
}

export function StatusBadge({
  variant,
  label,
  description,
  icon,
  fullWidth = false,
}: StatusBadgeProps) {
  const { colors, typography, spacing, radii } = useTheme();

  const colorMap: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
    success: {
      bg:   colors.semantic.successBg,
      text: colors.semantic.success,
      dot:  colors.semantic.success,
    },
    warning: {
      bg:   colors.semantic.warningBg,
      text: colors.semantic.warning,
      dot:  colors.semantic.warning,
    },
    danger: {
      bg:   colors.semantic.dangerBg,
      text: colors.semantic.danger,
      dot:  colors.semantic.danger,
    },
    info: {
      bg:   colors.semantic.infoBg,
      text: colors.semantic.info,
      dot:  colors.semantic.info,
    },
    neutral: {
      bg:   colors.bg.surface,
      text: colors.text.secondary,
      dot:  colors.text.disabled,
    },
  };

  const c = colorMap[variant];

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${label}${description ? ': ' + description : ''}`}
      style={[
        styles.container,
        {
          backgroundColor: c.bg,
          borderRadius: radii.md,
          padding: spacing.md,
          borderLeftWidth: 3,
          borderLeftColor: c.dot,
        },
        fullWidth && { width: '100%' },
      ]}
    >
      {/* Fila principal: punto indicador + ícono + label */}
      <View style={styles.row}>
        {/* Punto de color semántico */}
        <View
          style={[
            styles.dot,
            { backgroundColor: c.dot, marginRight: spacing.xs },
          ]}
          accessibilityElementsHidden
        />
        {/* Ícono textual (emoji o símbolo) */}
        <Text
          style={[
            styles.icon,
            { color: c.text, marginRight: spacing['2xs'] },
          ]}
          accessibilityElementsHidden
        >
          {icon}
        </Text>
        {/* Label principal */}
        <Text
          style={[
            typography.scale.bodyBold,
            { color: c.text, flexShrink: 1 },
          ]}
          allowFontScaling
        >
          {label}
        </Text>
      </View>

      {/* Descripción secundaria */}
      {description && (
        <Text
          style={[
            typography.scale.body,
            {
              color: colors.text.secondary,
              marginTop: spacing['2xs'],
              marginLeft: spacing.md + spacing.xs, // alinear con label
            },
          ]}
          allowFontScaling
        >
          {description}
        </Text>
      )}
    </View>
  );
}

// ── Estilos estáticos ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  icon: {
    fontSize: 16,
    lineHeight: 20,
  },
});
