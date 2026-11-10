// src/components/CalendarModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Selector Visual de Fecha mediante Calendario Interactivo Mensual
//
// Diseñado para "Mis Pruebas Periciales" (CU-08 / RF-3.5):
// - Navegación mensual y anual (< Octubre 2026 >)
// - Grilla de días de la semana: Lu Ma Mi Ju Vi Sá Do
// - Resaltado del día actual y día seleccionado
// - Indicador de punto bajo los días que poseen evidencias forenses registradas
// - Soporte completo para Modo Claro y Modo Oscuro mediante tokens de useTheme
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

interface Props {
  visible: boolean;
  fechaSeleccionada: string | null; // Formato 'DD/MM/AAAA' o null
  fechasConEvidencias?: Set<string>; // Set de cadenas 'DD/MM/AAAA'
  onSeleccionarFecha: (fechaFormateada: string) => void;
  onLimpiarFecha: () => void;
  onCerrar: () => void;
}

export function CalendarModal({
  visible,
  fechaSeleccionada,
  fechasConEvidencias,
  onSeleccionarFecha,
  onLimpiarFecha,
  onCerrar,
}: Props) {
  const { colors, typography, spacing, radii } = useTheme();

  // Fecha de referencia para el mes visible en el calendario
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    if (fechaSeleccionada) {
      const parts = fechaSeleccionada.split('/');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        return new Date(y, m, d);
      }
    }
    return new Date();
  });

  // Al abrir el modal, sincronizar el mes visible con la fecha seleccionada si existe
  useEffect(() => {
    if (visible && fechaSeleccionada) {
      const parts = fechaSeleccionada.split('/');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          setCurrentDate(new Date(y, m, d));
        }
      }
    }
  }, [visible, fechaSeleccionada]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const hoy = useMemo(() => new Date(), []);
  const diaHoy = hoy.getDate();
  const mesHoy = hoy.getMonth();
  const anioHoy = hoy.getFullYear();

  // Calcular días del mes actual y desfase del primer día (Lunes = 0, Domingo = 6)
  const { daysArray, emptySlots } = useMemo(() => {
    // Primer día del mes
    const firstDayOfMonth = new Date(year, month, 1);
    // getDay() devuelve 0 para domingo, 1 para lunes... convertimos a lunes = 0
    const dayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

    // Cantidad total de días en el mes
    const totalDays = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 1; i <= totalDays; i++) {
      days.push(i);
    }

    return {
      daysArray: days,
      emptySlots: dayOfWeek,
    };
  }, [year, month]);

  const irMesAnterior = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const irMesSiguiente = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const irAHoy = () => {
    setCurrentDate(new Date());
  };

  const handleSeleccionarDia = (day: number) => {
    const diaStr = String(day).padStart(2, '0');
    const mesStr = String(month + 1).padStart(2, '0');
    const anioStr = String(year);
    const formateada = `${diaStr}/${mesStr}/${anioStr}`;
    onSeleccionarFecha(formateada);
    onCerrar();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent={true} onRequestClose={onCerrar}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: colors.bg.surface,
              borderColor: colors.border.default,
              borderRadius: radii.lg,
            },
          ]}
        >
          {/* Cabecera del Calendario: Navegación de Mes y Año */}
          <View style={[styles.header, { borderBottomColor: colors.border.default }]}>
            <Pressable
              onPress={irMesAnterior}
              style={({ pressed }) => [
                styles.navButton,
                { backgroundColor: colors.bg.elevated, borderRadius: radii.full, opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityLabel="Mes anterior"
            >
              <Feather name="chevron-left" size={20} color={colors.text.primary} />
            </Pressable>

            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.scale.h3, { color: colors.text.primary, fontWeight: '700' }]}>
                {MESES[month]} {year}
              </Text>
            </View>

            <Pressable
              onPress={irMesSiguiente}
              style={({ pressed }) => [
                styles.navButton,
                { backgroundColor: colors.bg.elevated, borderRadius: radii.full, opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityLabel="Mes siguiente"
            >
              <Feather name="chevron-right" size={20} color={colors.text.primary} />
            </Pressable>
          </View>

          {/* Días de la semana */}
          <View style={[styles.weekDaysRow, { marginTop: spacing.sm }]}>
            {DIAS_SEMANA.map((dia) => (
              <View key={dia} style={styles.dayCol}>
                <Text
                  style={[
                    typography.scale.caption,
                    {
                      color: dia === 'Do' || dia === 'Sá' ? colors.semantic.warning : colors.text.secondary,
                      fontWeight: '700',
                      fontSize: 12,
                    },
                  ]}
                >
                  {dia}
                </Text>
              </View>
            ))}
          </View>

          {/* Grilla de Días del Mes */}
          <View style={styles.daysGrid}>
            {/* Celdas vacías previas al primer día del mes */}
            {Array.from({ length: emptySlots }).map((_, index) => (
              <View key={`empty-${index}`} style={styles.dayCellContainer} />
            ))}

            {/* Días del mes */}
            {daysArray.map((dia) => {
              const diaStr = String(dia).padStart(2, '0');
              const mesStr = String(month + 1).padStart(2, '0');
              const fechaStr = `${diaStr}/${mesStr}/${year}`;

              const esHoy = dia === diaHoy && month === mesHoy && year === anioHoy;
              const esSeleccionado = fechaSeleccionada === fechaStr;
              const tieneEvidencias = fechasConEvidencias?.has(fechaStr) || false;

              return (
                <View key={`dia-${dia}`} style={styles.dayCellContainer}>
                  <Pressable
                    onPress={() => handleSeleccionarDia(dia)}
                    style={({ pressed }) => [
                      styles.dayButton,
                      {
                        backgroundColor: esSeleccionado
                          ? colors.border.focus
                          : esHoy
                          ? colors.bg.elevated
                          : 'transparent',
                        borderColor: esSeleccionado
                          ? colors.border.focus
                          : esHoy
                          ? colors.semantic.info
                          : 'transparent',
                        borderWidth: esHoy || esSeleccionado ? 1.5 : 0,
                        borderRadius: radii.full,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        typography.scale.bodyBold,
                        {
                          color: esSeleccionado
                            ? '#FFFFFF'
                            : esHoy
                            ? colors.semantic.info
                            : colors.text.primary,
                          fontSize: 13,
                        },
                      ]}
                    >
                      {dia}
                    </Text>

                    {/* Punto indicador de evidencia forense existente en esa fecha */}
                    {tieneEvidencias && (
                      <View
                        style={[
                          styles.evidenceDot,
                          {
                            backgroundColor: esSeleccionado ? '#FFFFFF' : colors.semantic.info,
                          },
                        ]}
                      />
                    )}
                  </Pressable>
                </View>
              );
            })}
          </View>

          {/* Botonera inferior: Ir a Hoy, Limpiar Fecha y Cerrar */}
          <View style={[styles.footer, { borderTopColor: colors.border.default, marginTop: spacing.md }]}>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Pressable
                onPress={irAHoy}
                style={[
                  styles.actionButton,
                  { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, borderRadius: radii.sm },
                ]}
              >
                <Text style={[typography.scale.caption, { color: colors.text.primary, fontWeight: '600' }]}>
                  Hoy
                </Text>
              </Pressable>

              {fechaSeleccionada && (
                <Pressable
                  onPress={() => {
                    onLimpiarFecha();
                    onCerrar();
                  }}
                  style={[
                    styles.actionButton,
                    { backgroundColor: colors.semantic.dangerBg, borderColor: colors.semantic.danger, borderRadius: radii.sm },
                  ]}
                >
                  <Feather name="x" size={13} color={colors.semantic.danger} style={{ marginRight: 3 }} />
                  <Text style={[typography.scale.caption, { color: colors.semantic.danger, fontWeight: '700' }]}>
                    Ver todas
                  </Text>
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={onCerrar}
              style={[
                styles.actionButton,
                { backgroundColor: colors.bg.base, borderColor: colors.border.default, borderRadius: radii.sm },
              ]}
            >
              <Text style={[typography.scale.caption, { color: colors.text.secondary, fontWeight: '600' }]}>
                Cerrar
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  navButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekDaysRow: {
    flexDirection: 'row',
    width: '100%',
    paddingBottom: 8,
  },
  dayCol: {
    flex: 1,
    alignItems: 'center',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  dayCellContainer: {
    width: '14.28%', // 100% / 7 días
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  dayButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  evidenceDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    bottom: 3,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
});
