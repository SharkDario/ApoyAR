// src/components/Button.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Botón accesible con mínimo 48×48dp de touch target (docs/08-diseño.md §1.5).
// Regla de doble canal: nunca comunica estado solo por color.
// Estados: default | pressed | disabled | loading
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  type PressableProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@theme';

// ── Variantes ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: ButtonVariant;
  /** Icono a la izquierda del label (cualquier componente React) */
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Override del ancho. Por defecto ocupa el 100%. */
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  ...pressableProps
}: ButtonProps) {
  const { colors, typography, spacing, radii, touchTargets } = useTheme();

  const isDisabled = disabled || loading;

  // ── Estilos dinámicos por variante ─────────────────────────────────────────
  const variantStyles = StyleSheet.create({
    primary: {
      backgroundColor: colors.bg.overlay,
      borderWidth: 0,
    },
    secondary: {
      backgroundColor: colors.bg.surface,
      borderWidth: 1.5,
      borderColor: colors.border.default,
    },
    danger: {
      backgroundColor: colors.semantic.danger,
      borderWidth: 0,
    },
    ghost: {
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
  });

  const textColor: Record<ButtonVariant, string> = {
    primary:   colors.text.primary,
    secondary: colors.text.primary,
    danger:    colors.text.inverse,
    ghost:     colors.text.secondary,
  };

  return (
    <Pressable
      {...pressableProps}
      disabled={isDisabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { minHeight: touchTargets.comfortable, borderRadius: radii.md },
        fullWidth && styles.fullWidth,
        variantStyles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={textColor[variant]}
          accessibilityLabel="Procesando…"
        />
      ) : (
        <>
          {icon && <>{icon}</>}
          <Text
            style={[
              styles.label,
              {
                ...typography.scale.bodyBold,
                color: isDisabled ? colors.text.disabled : textColor[variant],
                marginLeft: icon ? spacing.xs : 0,
              },
            ]}
            allowFontScaling
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ── Estilos estáticos ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fullWidth: {
    width: '100%',
  },
  label: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.38,
  },
});
