// src/components/TextInput.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Input de formulario accesible con label, estados error/disabled/focus,
// y soporte de ícono izquierdo + botón de acción derecho (ej. 👁 contraseña).
// Touch target del botón de acción: mínimo 48×48dp.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef } from 'react';
import {
  View,
  TextInput as RNTextInput,
  Text,
  Pressable,
  StyleSheet,
  type TextInputProps as RNTextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@theme';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface TextInputProps extends RNTextInputProps {
  label: string;
  /** Mensaje de error: si está presente, activa el estado de error */
  error?: string;
  /** Ícono a la izquierda (ej. <Feather name="mail" />) */
  leftIcon?: React.ReactNode;
  /** Botón de acción derecho (ej. <Feather name="eye" />) */
  actionIcon?: React.ReactNode;
  actionLabel?: string;
  onActionPress?: () => void;
  containerStyle?: ViewStyle;
}

export function TextInput({
  label,
  error,
  leftIcon,
  actionIcon,
  actionLabel,
  onActionPress,
  containerStyle,
  editable = true,
  ...inputProps
}: TextInputProps) {
  const { colors, typography, spacing, radii, touchTargets } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<RNTextInput>(null);

  const isDisabled = !editable;
  const hasError = Boolean(error);

  // ── Color del borde según estado ─────────────────────────────────────────
  const borderColor = hasError
    ? colors.semantic.danger
    : isFocused
    ? colors.border.focus
    : colors.border.default;

  const borderWidth = isFocused || hasError ? 2 : 1.5;

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {/* Label visible + vinculado con accessibilityLabel en el input */}
      <Text
        style={[
          typography.scale.bodyBold,
          { color: isDisabled ? colors.text.disabled : colors.text.secondary, marginBottom: spacing['2xs'] },
        ]}
        allowFontScaling
      >
        {label}
      </Text>

      {/* Contenedor del input */}
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessibilityElementsHidden
      >
        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: isDisabled ? colors.bg.elevated : colors.bg.surface,
              borderColor,
              borderWidth,
              borderRadius: radii.sm,
              minHeight: touchTargets.comfortable,
              paddingHorizontal: spacing.md,
            },
          ]}
        >
          {/* Ícono izquierdo */}
          {leftIcon && (
            <View
              style={styles.leftIcon}
              accessibilityElementsHidden
            >
              {leftIcon}
            </View>
          )}

          {/* Input nativo */}
          <RNTextInput
            ref={inputRef}
            {...inputProps}
            editable={!isDisabled}
            accessible
            accessibilityLabel={label}
            accessibilityState={{ disabled: isDisabled }}
            accessibilityHint={hasError ? error : undefined}
            onFocus={(e) => {
              setIsFocused(true);
              inputProps.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              inputProps.onBlur?.(e);
            }}
            style={[
              styles.input,
              {
                ...typography.scale.body,
                color: isDisabled ? colors.text.disabled : colors.text.primary,
                flex: 1,
              },
            ]}
            placeholderTextColor={colors.text.disabled}
            selectionColor={colors.border.focus}
            allowFontScaling
          />

          {/* Botón de acción derecho (ej. 👁) */}
          {actionIcon && (
            <Pressable
              onPress={onActionPress}
              accessible
              accessibilityRole="button"
              accessibilityLabel={actionLabel ?? (typeof actionIcon === 'string' ? actionIcon : 'Acción')}
              style={({ pressed }) => [
                styles.actionButton,
                { minWidth: touchTargets.min, minHeight: touchTargets.min },
                pressed && { opacity: 0.6 },
              ]}
            >
              <View style={styles.actionIcon}>
                {actionIcon}
              </View>
            </Pressable>
          )}
        </View>
      </Pressable>

      {/* Mensaje de error: ícono + texto (doble canal) */}
      {hasError && (
        <View
          style={[styles.errorRow, { marginTop: spacing['2xs'] }]}
          accessible
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          <Text style={{ color: colors.semantic.danger, marginRight: spacing['2xs'], fontSize: 16 }}>
            ⚠
          </Text>
          <Text
            style={[typography.scale.body, { color: colors.semantic.danger, flexShrink: 1 }]}
            allowFontScaling
          >
            {error}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Estilos estáticos ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftIcon: {
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    paddingVertical: 0,  // evita doble padding en Android
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  actionIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
});
