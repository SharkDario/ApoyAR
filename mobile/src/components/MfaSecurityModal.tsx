// src/components/MfaSecurityModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal de Seguridad MFA (Google Authenticator / TOTP).
// Soporta los dos flujos:
// 1. "verify": Desafío de inicio de sesión (código de 6 dígitos para elevar a AAL2).
// 2. "enroll": Inscripción de nuevo factor (QR SVG + secreto copiable + confirmación).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { KeyboardAvoidingWrapper } from './KeyboardAvoidingWrapper';
import {
  enrollTotpAsync,
  confirmEnrollmentAsync,
  challengeAndVerifyMfaAsync,
} from '../services/mfaService';

interface Props {
  visible: boolean;
  mode: 'verify' | 'enroll';
  factorId?: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function MfaSecurityModal({
  visible,
  mode,
  factorId: initialFactorId,
  onSuccess,
  onCancel,
}: Props) {
  const { colors, typography, spacing, radii } = useTheme();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estado para Enrollment
  const [activeFactorId, setActiveFactorId] = useState<string | null>(initialFactorId || null);
  const [totpSecret, setTotpSecret] = useState<string>('');
  const [totpUri, setTotpUri] = useState<string>('');
  const [enrollLoading, setEnrollLoading] = useState(false);

  useEffect(() => {
    if (visible && mode === 'enroll') {
      if (!totpSecret) {
        setCode('');
        setErrorMsg(null);
        setEnrollLoading(true);
        enrollTotpAsync()
          .then((res) => {
            setActiveFactorId(res.factorId);
            setTotpSecret(res.secret);
            setTotpUri(res.uri);
          })
          .catch((err) => {
            setErrorMsg(err.message || 'Error iniciando configuración de MFA.');
          })
          .finally(() => {
            setEnrollLoading(false);
          });
      }
    } else if (visible && mode === 'verify') {
      setCode('');
      setErrorMsg(null);
      setActiveFactorId(initialFactorId || null);
    } else if (!visible) {
      // Limpiar estado al cerrar para la próxima apertura
      setCode('');
      setErrorMsg(null);
      setTotpSecret('');
      setTotpUri('');
      setActiveFactorId(null);
    }
  }, [visible, mode, initialFactorId, totpSecret]);

  const handleCopySecret = async () => {
    if (totpSecret) {
      await Clipboard.setStringAsync(totpSecret);
      Alert.alert('Copiado', 'Clave secreta copiada al portapapeles. Pegala en Google Authenticator.');
    }
  };

  const handleVerify = async () => {
    if (code.trim().length !== 6) {
      setErrorMsg('Ingresá el código de 6 dígitos generado por tu aplicación.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      if (mode === 'enroll') {
        if (!activeFactorId) throw new Error('Identificador de factor no disponible.');
        await confirmEnrollmentAsync(activeFactorId, code.trim());
        Alert.alert('¡MFA Activado!', 'Tu cuenta ahora está protegida con Google Authenticator.');
        onSuccess();
      } else {
        if (!activeFactorId) throw new Error('Factor MFA no registrado.');
        await challengeAndVerifyMfaAsync(activeFactorId, code.trim());
        onSuccess();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Código incorrecto. Verificá la hora y reintentá.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent={true}
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingWrapper
        mode="modal"
        style={styles.backdrop}
        extraScrollHeight={16}
      >
        <View style={[styles.container, { backgroundColor: colors.bg.surface, borderRadius: radii.lg }]}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.xl, alignItems: 'center' }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Encabezado */}
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.semantic.dangerBg, borderRadius: radii.full, marginBottom: spacing.md },
              ]}
            >
              <Feather name="shield" size={32} color={colors.semantic.danger} />
            </View>

            <Text style={[typography.scale.h2, { color: colors.text.primary, textAlign: 'center' }]}>
              {mode === 'enroll' ? 'Configurar Google Authenticator' : 'Verificación de Seguridad'}
            </Text>

            <Text
              style={[
                typography.scale.body,
                { color: colors.text.secondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.lg },
              ]}
            >
              {mode === 'enroll'
                ? 'Escaneá el código QR o copiá la clave en Google Authenticator para vincular tu cuenta.'
                : 'Ingresá el código de 6 dígitos que muestra tu app Google Authenticator.'}
            </Text>

            {/* Error Banner */}
            {errorMsg ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: colors.semantic.dangerBg, borderColor: colors.semantic.danger, borderRadius: radii.sm },
                ]}
              >
                <Feather name="alert-circle" size={16} color={colors.semantic.danger} style={{ marginRight: 6 }} />
                <Text style={[typography.scale.caption, { color: colors.semantic.danger, flex: 1 }]}>
                  {errorMsg}
                </Text>
              </View>
            ) : null}

            {/* Bloque de QR y Secreto para Enroll */}
            {mode === 'enroll' && (
              <>
                {enrollLoading ? (
                  <View style={{ padding: spacing['2xl'] }}>
                    <ActivityIndicator size="large" color={colors.semantic.danger} />
                  </View>
                ) : totpUri ? (
                  <View style={styles.qrContainer}>
                    <View style={styles.qrWrapper}>
                      <QRCode value={totpUri} size={180} />
                    </View>

                    <View style={styles.secretRow}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                          Clave manual:
                        </Text>
                        <Text
                          style={[typography.scale.bodyBold, { color: colors.text.primary, letterSpacing: 1 }]}
                          numberOfLines={1}
                        >
                          {totpSecret}
                        </Text>
                      </View>
                      <Pressable
                        onPress={handleCopySecret}
                        style={[styles.copyBtn, { backgroundColor: colors.bg.elevated, borderRadius: radii.sm }]}
                      >
                        <Feather name="copy" size={16} color={colors.text.primary} />
                        <Text style={[typography.scale.caption, { color: colors.text.primary, marginLeft: 4 }]}>
                          Copiar
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </>
            )}

            {/* Input de 6 dígitos */}
            <View style={{ width: '100%', marginVertical: spacing.md }}>
              <TextInput
                label="Código de verificación (6 dígitos)"
                placeholder="123456"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={setCode}
                leftIcon={<Feather name="key" size={18} color={colors.text.secondary} />}
              />
            </View>

            {/* Botones de acción */}
            <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button
                label={loading ? 'Verificando…' : mode === 'enroll' ? 'Confirmar y Activar' : 'Continuar'}
                onPress={handleVerify}
                disabled={loading || code.trim().length !== 6}
                loading={loading}
              />
              <Button
                label="Cancelar"
                variant="ghost"
                onPress={onCancel}
                disabled={loading}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingWrapper>
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
  container: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorBox: {
    width: '100%',
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  qrContainer: {
    alignItems: 'center',
    width: '100%',
    marginVertical: 8,
  },
  qrWrapper: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
  },
  secretRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 8,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
