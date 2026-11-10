// src/components/InfoRow.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Componente reutilizable para filas de información Label-Valor y Acciones.
// Previene el recorte de texto y el encimado de botones mediante:
// 1. flexShrink: 0 en el label.
// 2. flex: 1, minWidth: 0, flexShrink: 1 en el valor (regla de oro en React Native).
// 3. Layout responsive: se adapta a columna o wrap automático en pantallas
//    angostas (< 360dp) o con fuentes ampliadas por accesibilidad (fontScale > 1.2).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';

interface InfoRowProps {
  label: string;
  value?: string | React.ReactNode;
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  valueColor?: string;
  numberOfLines?: number;
  action?: React.ReactNode;
  subvalue?: string;
  bordered?: boolean;
}

export function InfoRow({
  label,
  value,
  icon,
  iconColor,
  valueColor,
  numberOfLines = 1,
  action,
  subvalue,
  bordered = false,
}: InfoRowProps) {
  const { colors, typography, spacing } = useTheme();
  const { width, fontScale } = useWindowDimensions();

  // Si la pantalla es angosta (< 360dp) o la fuente está muy agrandada,
  // permitimos que el layout pase a columna si hay una acción presente.
  const isCompact = width < 360 || fontScale > 1.2;

  return (
    <View
      style={[
        styles.rowContainer,
        bordered && {
          borderTopWidth: 1,
          borderTopColor: colors.border.default,
          paddingTop: spacing.sm,
          marginTop: spacing.sm,
        },
        isCompact && action ? styles.columnLayout : styles.rowLayout,
      ]}
    >
      {/* Contenedor de Label e Ícono */}
      <View style={styles.leftContainer}>
        {icon && (
          <Feather
            name={icon}
            size={16}
            color={iconColor || colors.text.secondary}
            style={{ marginRight: spacing.xs, flexShrink: 0 }}
          />
        )}
        <Text
          style={[
            typography.scale.body,
            styles.label,
            { color: colors.text.secondary },
          ]}
          numberOfLines={1}
        >
          {label}:
        </Text>

        {/* Valor en línea si no es un nodo React complejo */}
        {value !== undefined && (
          <View style={styles.valueWrapper}>
            {typeof value === 'string' ? (
              <Text
                style={[
                  typography.scale.bodyBold,
                  styles.valueText,
                  { color: valueColor || colors.text.primary },
                ]}
                numberOfLines={numberOfLines}
                ellipsizeMode="tail"
              >
                {value}
              </Text>
            ) : (
              value
            )}
          </View>
        )}
      </View>

      {/* Acción o botón secundario (ej: [Activar] / [Desactivar]) */}
      {action && (
        <View
          style={[
            styles.actionWrapper,
            isCompact && { marginTop: spacing.xs, alignSelf: 'flex-start' },
          ]}
        >
          {action}
        </View>
      )}

      {/* Subvalor opcional en segunda línea si aplica */}
      {subvalue && (
        <Text
          style={[
            typography.scale.caption,
            { color: colors.text.secondary, width: '100%', marginTop: 2 },
          ]}
        >
          {subvalue}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rowContainer: {
    width: '100%',
    paddingVertical: 3,
  },
  rowLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  columnLayout: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  label: {
    flexShrink: 0,
    marginRight: 4,
  },
  valueWrapper: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    justifyContent: 'center',
  },
  valueText: {
    flexShrink: 1,
    minWidth: 0,
  },
  actionWrapper: {
    flexShrink: 0,
  },
});
