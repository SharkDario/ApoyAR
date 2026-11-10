// src/components/DateFilterBar.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Componente compartido de barra de filtrado por fecha y texto.
// Unifica el look & feel entre "Mis Pruebas Periciales" y el "Centro de Alertas".
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';

export type FiltroFechaRapido = 'todas' | 'hoy' | '7dias';

interface DateFilterBarProps {
  filtroRapido: FiltroFechaRapido;
  onSelectFiltroRapido: (modo: FiltroFechaRapido) => void;
  fechaCalendario: string | null;
  onOpenCalendar: () => void;
  onClearCalendar: () => void;
  textoBusqueda: string;
  onChangeTextoBusqueda: (text: string) => void;
  placeholderBusqueda?: string;
  onLimpiarTodo?: () => void;
  limpiarTodoLabel?: string;
  mostrarToggleDescartadas?: boolean;
  verDescartadas?: boolean;
  onToggleVerDescartadas?: (val: boolean) => void;
  descartadasCount?: number;
}

export function DateFilterBar({
  filtroRapido,
  onSelectFiltroRapido,
  fechaCalendario,
  onOpenCalendar,
  onClearCalendar,
  textoBusqueda,
  onChangeTextoBusqueda,
  placeholderBusqueda = 'Buscar por dirección o contacto...',
  onLimpiarTodo,
  limpiarTodoLabel = 'Limpiar',
  mostrarToggleDescartadas = false,
  verDescartadas = false,
  onToggleVerDescartadas,
  descartadasCount,
}: DateFilterBarProps) {
  const { colors, typography, spacing, radii } = useTheme();

  return (
    <View
      style={[
        styles.filterBar,
        {
          backgroundColor: colors.bg.surface,
          borderBottomColor: colors.border.default,
          borderBottomWidth: 1,
          paddingHorizontal: 0,
          paddingVertical: spacing.sm,
        },
      ]}
    >
      {/* ── FILA 1 (SUPERIOR): BARRA DE BÚSQUEDA A ANCHO COMPLETO ── */}
      <View
        style={[
          styles.filterInputBox,
          {
            backgroundColor: colors.bg.base,
            borderColor: textoBusqueda ? colors.border.focus : colors.border.default,
            borderRadius: radii.md,
            borderWidth: 1,
            width: '100%',
            height: 38,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing.sm,
          },
        ]}
      >
        <Feather name="search" size={15} color={colors.text.secondary} />
        <TextInput
          value={textoBusqueda}
          onChangeText={onChangeTextoBusqueda}
          placeholder={placeholderBusqueda}
          placeholderTextColor={colors.text.disabled}
          style={[
            styles.filterTextInput,
            { color: colors.text.primary, flex: 1, marginLeft: spacing.xs, fontSize: 13 },
          ]}
        />
        {textoBusqueda.length > 0 && (
          <Pressable onPress={() => onChangeTextoBusqueda('')} style={{ padding: 4 }}>
            <Feather name="x" size={14} color={colors.text.secondary} />
          </Pressable>
        )}
      </View>

      {/* ── FILA 2: ACCIÓN LIMPIAR (ARRIBA DE FECHAS) Y PAPELERA ── */}
      <View style={[styles.actionRow, { marginTop: spacing.xs }]}>
        {onLimpiarTodo ? (
          <Pressable
            onPress={onLimpiarTodo}
            style={({ pressed }) => [
              styles.clearBtn,
              {
                backgroundColor: pressed ? colors.semantic.dangerBg : colors.bg.elevated,
                borderColor: colors.semantic.danger,
                borderWidth: 1,
                borderRadius: radii.sm,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
              },
            ]}
          >
            <Feather name="trash-2" size={12} color={colors.semantic.danger} />
            <Text
              style={[
                typography.scale.caption,
                { color: colors.semantic.danger, marginLeft: 4, fontWeight: '700', fontSize: 11 },
              ]}
            >
              {limpiarTodoLabel}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}

        {/* Botón Papelera / Ver Descartadas */}
        {mostrarToggleDescartadas && onToggleVerDescartadas && (
          <Pressable
            onPress={() => onToggleVerDescartadas(!verDescartadas)}
            style={({ pressed }) => [
              styles.papeleraBtn,
              {
                backgroundColor: verDescartadas ? colors.semantic.warningBg : colors.bg.elevated,
                borderColor: verDescartadas ? colors.semantic.warning : colors.border.default,
                borderWidth: 1,
                borderRadius: radii.sm,
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Feather
              name={verDescartadas ? 'inbox' : 'trash-2'}
              size={12}
              color={verDescartadas ? colors.semantic.warning : colors.text.secondary}
            />
            <Text
              style={[
                typography.scale.caption,
                {
                  color: verDescartadas ? colors.semantic.warning : colors.text.primary,
                  fontWeight: '700',
                  marginLeft: 4,
                  fontSize: 11,
                },
              ]}
            >
              {verDescartadas ? 'Ver activas' : 'Papelera'}
              {descartadasCount !== undefined && descartadasCount > 0 ? ` (${descartadasCount})` : ''}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── FILA 3: BOTONES DE FILTRO RÁPIDO (TODAS, HOY, ÚLTIMOS 7 DÍAS) ── */}
      <View style={[styles.dateRow, { marginTop: spacing.xs }]}>
        <View style={styles.pillGroup}>
          {(['todas', 'hoy', '7dias'] as const).map((modo) => {
            const isSelected = filtroRapido === modo && !fechaCalendario;
            const label = modo === 'todas' ? 'Todas' : modo === 'hoy' ? 'Hoy' : 'Últimos 7 días';
            return (
              <Pressable
                key={modo}
                onPress={() => onSelectFiltroRapido(modo)}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: isSelected ? colors.border.focus : colors.bg.elevated,
                    borderColor: isSelected ? colors.border.focus : colors.border.default,
                    borderRadius: radii.full,
                    borderWidth: 1,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 4,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.scale.caption,
                    {
                      color: isSelected ? '#FFFFFF' : colors.text.secondary,
                      fontWeight: isSelected ? '700' : '500',
                      fontSize: 11,
                    },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── FILA 4: BOTÓN DE CALENDARIO / FECHA ESPECÍFICA (ABAJO, SIN OVERFLOW) ── */}
      <View style={{ marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          onPress={onOpenCalendar}
          style={({ pressed }) => [
            styles.calendarBtn,
            {
              backgroundColor: fechaCalendario ? colors.border.focus : colors.bg.elevated,
              borderColor: fechaCalendario ? colors.border.focus : colors.border.default,
              borderRadius: radii.sm,
              borderWidth: 1,
              paddingHorizontal: spacing.sm,
              paddingVertical: 5,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather
            name="calendar"
            size={12}
            color={fechaCalendario ? '#FFFFFF' : colors.text.secondary}
          />
          <Text
            style={[
              typography.scale.caption,
              {
                color: fechaCalendario ? '#FFFFFF' : colors.text.primary,
                fontWeight: fechaCalendario ? '700' : '500',
                marginLeft: 5,
                fontSize: 11,
              },
            ]}
          >
            {fechaCalendario ? `Fecha: ${fechaCalendario}` : 'Filtrar por fecha...'}
          </Text>
          {fechaCalendario && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onClearCalendar();
              }}
              style={{ marginLeft: 6, padding: 2 }}
              hitSlop={8}
            >
              <Feather name="x" size={12} color="#FFFFFF" />
            </Pressable>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    width: '100%',
  },
  filterInputBox: {
    justifyContent: 'center',
  },
  filterTextInput: {
    paddingVertical: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  papeleraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pillGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  filterPill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
