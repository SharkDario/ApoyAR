// src/components/RegistrationForm.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Componente de Formulario de Registro con Validación Estricta en Tiempo Real
// Multiplataforma (Expo / React Native: Web y Android/iOS).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { useTheme } from '@theme';
import { TextInput } from './TextInput';
import { Button } from './Button';
import { PrivacyInfoModal } from './PrivacyInfoModal';
import {
  useRegistrationForm,
  type RegistrationFormValues,
} from '../hooks/useRegistrationForm';

import { obtenerDireccionActual, verificarDisponibilidadRegistro } from '../services/registroService';

export type { RegistrationFormValues };

// Opcional: si no se elige ninguna queda "No especificado". Tocar la elegida la desmarca.
const GENEROS = ['Femenino', 'Masculino', 'No binario'];

export interface RegistrationFormProps {
  onSubmit: (values: RegistrationFormValues) => Promise<void> | void;
  onCancel?: () => void;
  submitButtonLabel?: string;
  cancelButtonLabel?: string;
  initialValues?: Partial<RegistrationFormValues>;
  minAge?: number;
  debounceMs?: number;
  containerStyle?: any;
}

export function RegistrationForm({
  onSubmit,
  onCancel,
  submitButtonLabel = 'Registrarse',
  cancelButtonLabel = 'Cancelar',
  initialValues,
  minAge = 16,
  debounceMs = 300,
  containerStyle,
}: RegistrationFormProps) {
  const { colors, typography, spacing, radii, touchTargets } = useTheme();

  // Estados locales para visualización de contraseñas, datepicker y aceptación legal
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNativeDatePicker, setShowNativeDatePicker] = useState(false);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
  const [errorUbicacion, setErrorUbicacion] = useState<string | null>(null);

  // Hook principal de estado, sanitización y validación en tiempo real
  const {
    values,
    errors,
    touched,
    isValid,
    isSubmitting,
    verificando,
    passwordRequirements,
    handleChangeText,
    handleBlur,
    handleSubmit,
  } = useRegistrationForm({
    initialValues,
    debounceMs,
    minAge,
    onSubmit,
    verificarDisponibilidad: verificarDisponibilidadRegistro,
  });

  const usarUbicacion = async () => {
    setBuscandoUbicacion(true);
    setErrorUbicacion(null);
    try {
      const { direccion, error } = await obtenerDireccionActual();
      if (direccion) handleChangeText('direccion', direccion);
      else setErrorUbicacion(error || 'No se pudo obtener tu ubicación.');
    } catch {
      setErrorUbicacion('No se pudo obtener tu ubicación. Revisá que el GPS esté activado.');
    } finally {
      setBuscandoUbicacion(false);
    }
  };

  // Handler para DatePicker nativo en Android / iOS
  const handleNativeDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowNativeDatePicker(false);
    if (selectedDate) {
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const formatted = `${year}-${month}-${day}`;
      handleChangeText('fechaNacimiento', formatted);
      handleBlur('fechaNacimiento');
    }
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {/* ── 1. Nombre y Apellido ────────────────────────────────────────────── */}
      <View style={styles.row}>
        <View style={styles.halfCol}>
          <TextInput
            label="Nombre *"
            leftIcon={<Feather name="user" size={18} color={colors.text.secondary} />}
            value={values.nombre}
            onChangeText={(t) => handleChangeText('nombre', t)}
            onBlur={() => handleBlur('nombre')}
            error={touched.nombre ? errors.nombre : undefined}
            placeholder="ej: María"
            autoCapitalize="words"
            returnKeyType="next"
            containerStyle={{ marginBottom: spacing.sm }}
          />
        </View>

        <View style={styles.halfCol}>
          <TextInput
            label="Apellido *"
            leftIcon={<Feather name="user" size={18} color={colors.text.secondary} />}
            value={values.apellido}
            onChangeText={(t) => handleChangeText('apellido', t)}
            onBlur={() => handleBlur('apellido')}
            error={touched.apellido ? errors.apellido : undefined}
            placeholder="ej: Rossi"
            autoCapitalize="words"
            returnKeyType="next"
            containerStyle={{ marginBottom: spacing.sm }}
          />
        </View>
      </View>

      {/* ── 2. DNI (Documento Nacional de Identidad Argentino) ──────────────── */}
      <TextInput
        label="DNI (Documento Nacional de Identidad) *"
        leftIcon={<Feather name="credit-card" size={18} color={colors.text.secondary} />}
        value={values.dni}
        onChangeText={(t) => handleChangeText('dni', t)}
        onBlur={() => handleBlur('dni')}
        error={touched.dni ? errors.dni : undefined}
        placeholder="7 u 8 números sin puntos (ej: 38123456)"
        keyboardType="numeric"
        maxLength={8}
        returnKeyType="next"
        containerStyle={{ marginBottom: spacing.sm }}
      />

      {/* ── 3. Teléfono de Contacto (10 Dígitos) ────────────────────────────── */}
      <TextInput
        label="Teléfono Móvil (Código de área + Número) *"
        leftIcon={<Feather name="phone" size={18} color={colors.text.secondary} />}
        value={values.telefono}
        onChangeText={(t) => handleChangeText('telefono', t)}
        onBlur={() => handleBlur('telefono')}
        error={touched.telefono ? errors.telefono : undefined}
        placeholder="10 dígitos sin 0 ni 15 (ej: 3704123456)"
        keyboardType="phone-pad"
        maxLength={10}
        returnKeyType="next"
        containerStyle={{ marginBottom: spacing.sm }}
      />

      {/* ── 4. Fecha de Nacimiento ─────────────────────────────────────────── */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text
          style={[
            typography.scale.bodyBold,
            { color: colors.text.secondary, marginBottom: spacing['2xs'] },
          ]}
          allowFontScaling
        >
          Fecha de Nacimiento *
        </Text>

        {Platform.OS === 'web' ? (
          <View>
            <input
              type="date"
              value={values.fechaNacimiento}
              onChange={(e: any) => {
                handleChangeText('fechaNacimiento', e.target.value);
                handleBlur('fechaNacimiento');
              }}
              style={{
                height: touchTargets.comfortable,
                minHeight: touchTargets.comfortable,
                borderRadius: radii.sm,
                borderWidth: touched.fechaNacimiento && errors.fechaNacimiento ? 2 : 1.5,
                borderStyle: 'solid',
                borderColor:
                  touched.fechaNacimiento && errors.fechaNacimiento
                    ? colors.semantic.danger
                    : colors.border.default,
                backgroundColor: colors.bg.surface,
                color: values.fechaNacimiento ? colors.text.primary : colors.text.disabled,
                paddingLeft: spacing.md,
                paddingRight: spacing.md,
                fontSize: typography.scale.body.fontSize,
                outline: 'none',
                fontFamily: 'inherit',
                width: '100%',
                boxSizing: 'border-box' as any,
              }}
            />
            {touched.fechaNacimiento && errors.fechaNacimiento ? (
              <View
                style={[styles.errorRow, { marginTop: spacing['2xs'] }]}
                accessible
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
              >
                <Feather
                  name="alert-circle"
                  size={16}
                  color={colors.semantic.danger}
                  accessibilityElementsHidden
                />
                <Text
                  style={[
                    typography.scale.caption,
                    { color: colors.semantic.danger, marginLeft: spacing['2xs'], flex: 1 },
                  ]}
                  allowFontScaling
                >
                  {errors.fechaNacimiento}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View>
            <Pressable
              onPress={() => setShowNativeDatePicker(true)}
              style={[
                styles.nativeDateButton,
                {
                  backgroundColor: colors.bg.surface,
                  borderColor:
                    touched.fechaNacimiento && errors.fechaNacimiento
                      ? colors.semantic.danger
                      : colors.border.default,
                  borderWidth: touched.fechaNacimiento && errors.fechaNacimiento ? 2 : 1.5,
                  borderRadius: radii.sm,
                  minHeight: touchTargets.comfortable,
                  paddingHorizontal: spacing.md,
                },
              ]}
            >
              <Feather name="calendar" size={18} color={colors.text.secondary} style={{ marginRight: spacing.sm }} />
              <Text
                style={[
                  typography.scale.body,
                  {
                    color: values.fechaNacimiento ? colors.text.primary : colors.text.disabled,
                    flex: 1,
                  },
                ]}
              >
                {values.fechaNacimiento || 'Seleccionar fecha (AAAA-MM-DD)'}
              </Text>
            </Pressable>

            {showNativeDatePicker && (
              <DateTimePicker
                value={values.fechaNacimiento ? new Date(values.fechaNacimiento) : new Date(2000, 0, 1)}
                mode="date"
                display="default"
                maximumDate={new Date()}
                onChange={handleNativeDateChange}
              />
            )}

            {touched.fechaNacimiento && errors.fechaNacimiento ? (
              <View
                style={[styles.errorRow, { marginTop: spacing['2xs'] }]}
                accessible
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
              >
                <Feather
                  name="alert-circle"
                  size={16}
                  color={colors.semantic.danger}
                  accessibilityElementsHidden
                />
                <Text
                  style={[
                    typography.scale.caption,
                    { color: colors.semantic.danger, marginLeft: spacing['2xs'], flex: 1 },
                  ]}
                  allowFontScaling
                >
                  {errors.fechaNacimiento}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      {/* ── 4b. Género (opcional) ───────────────────────────────────────────── */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text style={[typography.scale.bodyBold, { color: colors.text.secondary, marginBottom: spacing['2xs'] }]} allowFontScaling>
          Género (opcional)
        </Text>
        <View style={styles.chips}>
          {GENEROS.map((opcion) => {
            const elegido = values.genero === opcion;
            return (
              <Pressable
                key={opcion}
                onPress={() => handleChangeText('genero', elegido ? '' : opcion)}
                accessibilityRole="radio"
                accessibilityState={{ selected: elegido }}
                style={[
                  styles.chip,
                  {
                    borderRadius: radii.full,
                    borderColor: elegido ? colors.semantic.info : colors.border.default,
                    backgroundColor: elegido ? colors.semantic.infoBg : colors.bg.surface,
                  },
                ]}
              >
                <Text style={[typography.scale.caption, { color: elegido ? colors.semantic.info : colors.text.secondary, fontWeight: elegido ? '700' : '500' }]}>
                  {opcion}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── 4c. Dirección (opcional, se puede completar con la ubicación) ──── */}
      <TextInput
        label="Dirección (opcional)"
        leftIcon={<Feather name="map-pin" size={18} color={colors.text.secondary} />}
        value={values.direccion}
        onChangeText={(t) => handleChangeText('direccion', t)}
        placeholder="Calle y número, barrio, ciudad"
        autoCapitalize="words"
        maxLength={200}
        containerStyle={{ marginBottom: spacing['2xs'] }}
      />
      <TouchableOpacity
        onPress={usarUbicacion}
        disabled={buscandoUbicacion}
        style={[styles.ubicacionBtn, { borderColor: colors.border.default, borderRadius: radii.sm, marginBottom: spacing.sm }]}
        accessibilityLabel="Completar la dirección con mi ubicación actual"
      >
        {buscandoUbicacion ? (
          <ActivityIndicator size="small" color={colors.semantic.info} />
        ) : (
          <Feather name="crosshair" size={16} color={colors.semantic.info} />
        )}
        <Text style={[typography.scale.caption, { color: colors.semantic.info, fontWeight: '700', marginLeft: 6 }]}>
          {buscandoUbicacion ? 'Buscando tu ubicación…' : 'Usar mi ubicación actual'}
        </Text>
      </TouchableOpacity>
      {errorUbicacion ? (
        <Text style={[typography.scale.caption, { color: colors.semantic.danger, marginBottom: spacing.sm }]}>{errorUbicacion}</Text>
      ) : null}

      {/* ── 5. Correo Electrónico ───────────────────────────────────────────── */}
      <TextInput
        label="Correo Electrónico *"
        leftIcon={<Feather name="mail" size={18} color={colors.text.secondary} />}
        value={values.email}
        onChangeText={(t) => handleChangeText('email', t)}
        onBlur={() => handleBlur('email')}
        error={touched.email ? errors.email : undefined}
        placeholder="usuario@dominio.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        returnKeyType="next"
        containerStyle={{ marginBottom: spacing.sm }}
      />

      {/* ── 6. Contraseña Estricta (Mínimo 8, Mayúscula, Número, Especial) ── */}
      <View style={{ marginBottom: spacing.sm }}>
        <TextInput
          label="Contraseña de Seguridad *"
          leftIcon={<Feather name="lock" size={18} color={colors.text.secondary} />}
          value={values.password}
          onChangeText={(t) => handleChangeText('password', t)}
          onBlur={() => handleBlur('password')}
          error={touched.password ? errors.password : undefined}
          secureTextEntry={!showPassword}
          actionIcon={<Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.text.secondary} />}
          actionLabel={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
          onActionPress={() => setShowPassword((prev) => !prev)}
          placeholder="Mínimo 8 caracteres seguros"
          autoCapitalize="none"
          returnKeyType="next"
          containerStyle={{ marginBottom: 4 }}
        />

        {/* Checklist interactivo de requisitos de contraseña en tiempo real */}
        <View style={[styles.passwordChecklistBox, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
          <Text style={[styles.checklistHeader, { color: colors.text.secondary }]}>
            Requisitos de seguridad:
          </Text>
          <View style={styles.checklistGrid}>
            <View style={styles.checkItem}>
              <Feather
                name={passwordRequirements.hasMinLength ? 'check-circle' : 'circle'}
                size={14}
                color={passwordRequirements.hasMinLength ? '#22C55E' : colors.text.disabled}
              />
              <Text
                style={[
                  styles.checkText,
                  { color: passwordRequirements.hasMinLength ? '#86EFAC' : colors.text.disabled },
                ]}
              >
                Mínimo 8 caracteres
              </Text>
            </View>

            <View style={styles.checkItem}>
              <Feather
                name={passwordRequirements.hasUppercase ? 'check-circle' : 'circle'}
                size={14}
                color={passwordRequirements.hasUppercase ? '#22C55E' : colors.text.disabled}
              />
              <Text
                style={[
                  styles.checkText,
                  { color: passwordRequirements.hasUppercase ? '#86EFAC' : colors.text.disabled },
                ]}
              >
                1 mayúscula (A-Z)
              </Text>
            </View>

            <View style={styles.checkItem}>
              <Feather
                name={passwordRequirements.hasNumber ? 'check-circle' : 'circle'}
                size={14}
                color={passwordRequirements.hasNumber ? '#22C55E' : colors.text.disabled}
              />
              <Text
                style={[
                  styles.checkText,
                  { color: passwordRequirements.hasNumber ? '#86EFAC' : colors.text.disabled },
                ]}
              >
                1 número (0-9)
              </Text>
            </View>

            <View style={styles.checkItem}>
              <Feather
                name={passwordRequirements.hasSpecialChar ? 'check-circle' : 'circle'}
                size={14}
                color={passwordRequirements.hasSpecialChar ? '#22C55E' : colors.text.disabled}
              />
              <Text
                style={[
                  styles.checkText,
                  { color: passwordRequirements.hasSpecialChar ? '#86EFAC' : colors.text.disabled },
                ]}
              >
                1 símbolo especial (!@#$%)
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── 7. Confirmar Contraseña ─────────────────────────────────────────── */}
      <TextInput
        label="Confirmar Contraseña *"
        leftIcon={<Feather name="shield" size={18} color={colors.text.secondary} />}
        value={values.confirmPassword}
        onChangeText={(t) => handleChangeText('confirmPassword', t)}
        onBlur={() => handleBlur('confirmPassword')}
        error={touched.confirmPassword ? errors.confirmPassword : undefined}
        secureTextEntry={!showConfirmPassword}
        actionIcon={<Feather name={showConfirmPassword ? 'eye-off' : 'eye'} size={18} color={colors.text.secondary} />}
        actionLabel={showConfirmPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
        onActionPress={() => setShowConfirmPassword((prev) => !prev)}
        placeholder="Repetí la contraseña exactamente igual"
        autoCapitalize="none"
        returnKeyType="done"
        containerStyle={{ marginBottom: spacing.md }}
      />

      {/* ── 8. Checkbox Obligatorio de Términos, Privacidad y Ley 25.326 ────── */}
      <View
        style={[
          styles.termsBox,
          {
            backgroundColor: colors.bg.base,
            borderColor: aceptaTerminos
              ? (colors.semantic?.danger || '#7A1F1F')
              : colors.border.default,
            borderRadius: radii.sm,
          },
        ]}
      >
        <Pressable
          onPress={() => setAceptaTerminos(!aceptaTerminos)}
          style={styles.termsTouchable}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: aceptaTerminos }}
          accessibilityLabel="Acepto los Términos y Condiciones, Política de Privacidad y Consentimiento Ley 25.326"
        >
          <View
            style={[
              styles.checkboxCustom,
              {
                borderColor: aceptaTerminos
                  ? (colors.semantic?.danger || '#7A1F1F')
                  : colors.border.default,
                backgroundColor: aceptaTerminos
                  ? (colors.semantic?.danger || '#7A1F1F')
                  : colors.bg.surface,
              },
            ]}
          >
            {aceptaTerminos && (
              <Feather
                name="check"
                size={13}
                color="#FFFFFF"
              />
            )}
          </View>

          <Text
            style={[
              typography.scale.caption,
              { color: colors.text.secondary, flex: 1, fontSize: 12, lineHeight: 17, marginLeft: 8 },
            ]}
          >
            Acepto los{' '}
            <Text
              onPress={() => setShowPrivacyModal(true)}
              style={{
                color: colors.semantic?.danger || '#7A1F1F',
                fontWeight: '700',
                textDecorationLine: 'underline',
              }}
            >
              Términos de Uso
            </Text>
            {', la '}
            <Text
              onPress={() => setShowPrivacyModal(true)}
              style={{
                color: colors.semantic?.danger || '#7A1F1F',
                fontWeight: '700',
                textDecorationLine: 'underline',
              }}
            >
              Política de Privacidad
            </Text>
            {' y el consentimiento de auxilio bajo Ley 25.326. *'}
          </Text>
        </Pressable>
      </View>

      {/* ── 9. Botones de Acción: Submit Condicional y Cancelar ─────────────── */}
      <View style={styles.actionsContainer}>
        {onCancel && (
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: colors.border.default }]}
            onPress={onCancel}
            disabled={isSubmitting}
          >
            <Text style={[styles.cancelBtnText, { color: colors.text.primary }]}>
              {cancelButtonLabel}
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ flex: onCancel ? 1 : undefined, width: onCancel ? undefined : '100%' }}>
          <Button
            label={submitButtonLabel}
            onPress={() => {
              if (!aceptaTerminos) {
                return;
              }
              handleSubmit();
            }}
            disabled={!isValid || !aceptaTerminos || isSubmitting}
            loading={isSubmitting}
            variant="primary"
            icon={<Feather name="check" size={18} color="#FFFFFF" />}
            style={
              (!isValid || !aceptaTerminos)
                ? {
                    ...styles.submitBtn,
                    opacity: 0.45,
                    backgroundColor: colors.bg.surface,
                    borderWidth: 1.5,
                    borderColor: colors.border.default,
                  }
                : styles.submitBtn
            }
          />
        </View>
      </View>

      {/* Hint accesible cuando el botón está deshabilitado */}
      {isValid && !aceptaTerminos && (
        <Text style={[styles.disabledHintText, { color: colors.semantic.warning }]}>
          ⚠ Debés marcar la casilla de aceptación de Términos y Privacidad para crear tu cuenta.
        </Text>
      )}

      {verificando && (
        <Text style={[styles.disabledHintText, { color: colors.text.secondary }]}>
          Comprobando que el correo, el DNI y el teléfono no estén registrados…
        </Text>
      )}

      {!isValid && (
        <Text style={[styles.disabledHintText, { color: colors.text.disabled }]}>
          ℹ Completa todos los campos obligatorios (*) y corrige los errores para habilitar el registro.
        </Text>
      )}

      {/* Modal de lectura rápida de Términos y Privacidad */}
      <PrivacyInfoModal
        visible={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        onAceptar={() => {
          setAceptaTerminos(true);
          setShowPrivacyModal(false);
        }}
        title="Términos, Privacidad y Ley 25.326"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfCol: {
    flex: 1,
  },
  nativeDateButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  passwordChecklistBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
  },
  checklistHeader: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checklistGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
    columnGap: 12,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: '45%',
  },
  checkText: {
    fontSize: 11,
    fontWeight: '500',
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 8,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    height: 48,
  },
  disabledHintText: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1.5,
    minHeight: 36,
    justifyContent: 'center',
  },
  ubicacionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  termsBox: {
    padding: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  termsTouchable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkboxCustom: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
});
