// src/screens/LoginScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CU-01 / RF-1.1 — Autenticación y Registro de Usuario
//
// Diseño: docs/08-diseño.md §2.1 (Rediseño asimétrico y distintivo)
// Tokens: src/theme/tokens.ts (vía useTheme — sin colores hardcodeados)
// Componentes reutilizados: Button, TextInput
//
// NOTA DE ARQUITECTURA:
//   Google OAuth NO está documentado en docs/06-arquitectura.md.
//   El botón "Continuar con Google" es un PLACEHOLDER visual completo
//   que simula el flujo de demora + navegación.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Animated,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
  UIManager,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '@theme';
import { Button } from '@components/Button';
import { TextInput } from '@components/TextInput';
import { RegistrationForm, type RegistrationFormValues } from '@components/RegistrationForm';
import type { AuthStackParamList } from '@navigation/types';
import { supabase } from '../lib/supabase';
import { getApiBaseUrl } from '../lib/api';
import { iniciarSesionConGoogleAsync } from '../services/googleAuthService';
import { MfaSecurityModal } from '../components/MfaSecurityModal';
import { KeyboardAvoidingWrapper } from '../components';
import { PrivacyInfoModal } from '../components/PrivacyInfoModal';
import { getMfaStatusAsync } from '../services/mfaService';

// Habilitar LayoutAnimation en Android solo en Old Architecture (en New Architecture/Fabric es un no-op con warning)
if (Platform.OS === 'android' && !(globalThis as any).nativeFabricUIManager && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

type AuthMode = 'login' | 'register';

// ── Validación ────────────────────────────────────────────────────────────────

function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'El correo es obligatorio.';
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email.trim())) return 'Ingresá un correo con formato válido (ej: usuario@dominio.com).';
  return undefined;
}

function validatePassword(password: string): string | undefined {
  if (!password) return 'La contraseña es obligatoria.';
  if (password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  return undefined;
}

function validateName(name: string): string | undefined {
  if (!name.trim()) return 'El nombre es obligatorio para el registro.';
  if (name.trim().length < 2) return 'Ingresá tu nombre completo.';
  return undefined;
}

function validatePasswordConfirm(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Repetí tu contraseña para confirmarla.';
  if (password !== confirm) return 'Las contraseñas no coinciden.';
  return undefined;
}

// ── Componente ────────────────────────────────────────────────────────────────

export function LoginScreen({ navigation: _navigation }: Props) {
  const { colors, typography, spacing, radii, animation } = useTheme();

  // ── Estado del formulario ──────────────────────────────────────────────────
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [dni, setDni] = useState('');
  const [telefono, setTelefono] = useState('');
  const [genero, setGenero] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [direccion, setDireccion] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);

  // ── Estado de Seguridad MFA (Google Authenticator) ─────────────────────────
  const [mfaModalVisible, setMfaModalVisible] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  // Date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateObj, setDateObj] = useState<Date>(new Date(2000, 0, 1));

  // ── Estado de Recuperación de Contraseña Civil (Contexto Móvil) ────────────
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [showRecoveryConfirmPassword, setShowRecoveryConfirmPassword] = useState(false);

  // ── Bloqueo Temporal por Intentos Fallidos (3 fallos / 15 min) ─────────────
  const [lockoutActive, setLockoutActive] = useState(false);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0);

  // Temporizador de cuenta regresiva para rehabilitación automática
  React.useEffect(() => {
    if (!lockoutActive || lockoutRemainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemainingSeconds((prev) => {
        if (prev <= 1) {
          setLockoutActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutActive, lockoutRemainingSeconds]);

  const checkEmailLockout = useCallback(async (emailToCheck: string) => {
    const clean = emailToCheck.trim().toLowerCase();
    if (!clean || !clean.includes('@')) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/estado-bloqueo?email=${encodeURIComponent(clean)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.bloqueado && data.segundos_restantes > 0) {
          setLockoutActive(true);
          setLockoutRemainingSeconds(data.segundos_restantes);
        } else {
          setLockoutActive(false);
          setLockoutRemainingSeconds(0);
        }
      }
    } catch (_) {}
  }, []);
  const [recoveryStep, setRecoveryStep] = useState<1 | 2>(1);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  const recoveryPasswordReqs = {
    hasMinLength: recoveryNewPassword.length >= 8,
    hasUppercase: /[A-Z]/.test(recoveryNewPassword),
    hasNumber: /[0-9]/.test(recoveryNewPassword),
    hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(recoveryNewPassword),
  };
  const isRecoveryPasswordValid =
    recoveryPasswordReqs.hasMinLength &&
    recoveryPasswordReqs.hasUppercase &&
    recoveryPasswordReqs.hasNumber &&
    recoveryPasswordReqs.hasSpecialChar;

  const handleSolicitarRecuperacionMovil = async () => {
    const emailErr = validateEmail(recoveryEmail);
    if (emailErr) {
      setRecoveryError(emailErr);
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError(null);
    setRecoverySuccess(null);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/v1/auth/recuperar-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: recoveryEmail.trim().toLowerCase(),
          contexto: 'movil',
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j.detail || 'Error solicitando recuperación');
      }
      setRecoverySuccess(j.message || 'Código de verificación de 6 dígitos enviado.');
      setRecoveryStep(2);
    } catch (e: any) {
      setRecoveryError(e.message || 'Error de conexión');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleConfirmarRecuperacionMovil = async () => {
    if (recoveryCode.trim().length !== 6) {
      setRecoveryError('Ingresá el código de 6 dígitos enviado a tu correo.');
      return;
    }
    if (!isRecoveryPasswordValid) {
      setRecoveryError('La contraseña debe tener mínimo 8 caracteres, 1 mayúscula, 1 número y 1 símbolo especial.');
      return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setRecoveryError('Las contraseñas no coinciden.');
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError(null);
    setRecoverySuccess(null);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/v1/auth/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: recoveryEmail.trim().toLowerCase(),
          codigo: recoveryCode.trim(),
          nueva_password: recoveryNewPassword,
          contexto: 'movil',
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j.detail || 'Error restableciendo contraseña');
      }
      setRecoverySuccess('¡Contraseña civil actualizada exitosamente! Ya podés iniciar sesión.');
      setEmail(recoveryEmail);
      setTimeout(() => {
        setShowRecoveryModal(false);
        showErrorBanner('Contraseña restablecida exitosamente. Ingresá con tu nueva clave.', 'success');
      }, 1500);
    } catch (e: any) {
      setRecoveryError(e.message || 'Error al restablecer contraseña');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // ── Errores de campo ───────────────────────────────────────────────────────
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [nombreError, setNombreError] = useState<string | undefined>();
  const [apellidoError, setApellidoError] = useState<string | undefined>();
  const [dniError, setDniError] = useState<string | undefined>();
  const [telefonoError, setTelefonoError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [authError, setAuthError] = useState<string | undefined>();

  // ── Animación del banner de error ──────────────────────────────────────────
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  const showErrorBanner = useCallback(
    (message: string, type: 'error' | 'success' = 'error') => {
      setAuthError(type === 'success' ? `✓ ${message}` : `⚠ ${message}`);
      Animated.sequence([
        Animated.timing(bannerOpacity, {
          toValue: 1,
          duration: animation.transitionDefault,
          useNativeDriver: true,
        }),
        Animated.delay(5000), // Más tiempo para leer mensajes de éxito
        Animated.timing(bannerOpacity, {
          toValue: 0,
          duration: animation.transitionDefault,
          useNativeDriver: true,
        }),
      ]).start(() => setAuthError(undefined));
    },
    [bannerOpacity, animation.transitionDefault],
  );

  // ── Toggle de modo (login ↔ registro) ─────────────────────────────────────
  const toggleMode = useCallback(() => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        animation.transitionDefault,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
    setEmailError(undefined);
    setPasswordError(undefined);
    setNombreError(undefined);
    setApellidoError(undefined);
    setDniError(undefined);
    setTelefonoError(undefined);
    setConfirmError(undefined);
    setAuthError(undefined);
    setNombre('');
    setApellido('');
    setDni('');
    setTelefono('');
    setGenero('');
    setFechaNacimiento('');
    setDireccion('');
    setConfirmPassword('');
  }, [animation.transitionDefault]);

  // ── Handlers Adicionales ─────────────────────────────────────────────────
  const handleGetLocation = async () => {
    setLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showErrorBanner('Permiso de ubicación denegado.', 'error');
        return;
      }

      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (geocode && geocode.length > 0) {
        const place = geocode[0];
        const addr = `${place.street || place.name || ''} ${place.streetNumber || ''}, ${place.city || place.subregion || ''}`;
        setDireccion(addr.trim().replace(/^,|,$/g, '').trim());
      } else {
        showErrorBanner('No se pudo resolver la dirección.', 'error');
      }
    } catch (err: any) {
      showErrorBanner('Error obteniendo ubicación.', 'error');
    } finally {
      setLoadingLocation(false);
    }
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setDateObj(selectedDate);
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const year = selectedDate.getFullYear();
      setFechaNacimiento(`${year}-${month}-${day}`);
    }
  };

  const handleEmailBlur = useCallback(() => {
    setEmailError(validateEmail(email));
    if (mode === 'login' && email.trim()) {
      checkEmailLockout(email);
    }
  }, [email, mode, checkEmailLockout]);
  const handlePasswordBlur = useCallback(() => setPasswordError(validatePassword(password)), [password]);
  const handleNombreBlur = useCallback(() => setNombreError(mode === 'register' && !nombre.trim() ? 'El nombre es obligatorio.' : undefined), [nombre, mode]);
  const handleApellidoBlur = useCallback(() => setApellidoError(mode === 'register' && !apellido.trim() ? 'El apellido es obligatorio.' : undefined), [apellido, mode]);
  const handleConfirmBlur = useCallback(() => setConfirmError(validatePasswordConfirm(password, confirmPassword)), [password, confirmPassword]);

  const validateAll = useCallback((): boolean => {
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const nErr = mode === 'register' && !nombre.trim() ? 'El nombre es obligatorio.' : undefined;
    const aErr = mode === 'register' && !apellido.trim() ? 'El apellido es obligatorio.' : undefined;
    const dErr = mode === 'register' && !dni.trim() ? 'El DNI es obligatorio.' : undefined;
    const tErr = mode === 'register' && !telefono.trim() ? 'El teléfono es obligatorio.' : undefined;
    const cErr = mode === 'register' ? validatePasswordConfirm(password, confirmPassword) : undefined;

    setEmailError(eErr);
    setPasswordError(pErr);
    setNombreError(nErr);
    setApellidoError(aErr);
    setDniError(dErr);
    setTelefonoError(tErr);
    setConfirmError(cErr);

    return !eErr && !pErr && !nErr && !aErr && !dErr && !tErr && !cErr;
  }, [email, password, nombre, apellido, dni, telefono, confirmPassword, mode]);

  const handleRegisterSubmit = useCallback(async (formValues: RegistrationFormValues) => {
    setLoading(true);
    setAuthError(undefined);
    try {
      let fechaNorm = formValues.fechaNacimiento.trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(fechaNorm)) {
        const [d, m, y] = fechaNorm.split('/');
        fechaNorm = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(fechaNorm)) {
        const [d, m, y] = fechaNorm.split('-');
        fechaNorm = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formValues.email.trim(),
        password: formValues.password,
        options: {
          data: {
            nombre: formValues.nombre.trim(),
            apellido: formValues.apellido.trim(),
            dni: formValues.dni.trim().replace(/\D/g, ''),
            telefono: formValues.telefono.trim(),
            genero: formValues.genero.trim(),
            fecha_nacimiento: fechaNorm,
            direccion: formValues.direccion.trim(),
          },
        },
      });

      if (signUpError) throw signUpError;

      if (data.user && !data.session) {
        showErrorBanner('Registro exitoso. Revisá tu bandeja de entrada para confirmar tu correo antes de iniciar sesión.', 'success');
        setTimeout(() => setMode('login'), 3000);
      } else {
        showErrorBanner('¡Cuenta creada exitosamente! Iniciando sesión...', 'success');
      }
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      const friendly = msg.includes('User already registered')
        ? 'Este correo ya tiene una cuenta. Iniciá sesión en su lugar.'
        : `${msg || 'Error al registrar la cuenta. Intentá de nuevo.'}`;
      showErrorBanner(friendly, 'error');
    } finally {
      setLoading(false);
    }
  }, [showErrorBanner]);

  const handleSubmit = useCallback(async () => {
    if (loading || lockoutActive) return;

    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    if (eErr || pErr) {
      setEmailError(eErr);
      setPasswordError(pErr);
      return;
    }

    setLoading(true);
    setAuthError(undefined);

    try {
      let usedBackend = false;

      // 1. Intentar inicio de sesión protegido a través del backend FastAPI
      try {
        const apiUrl = getApiBaseUrl();
        const res = await fetch(`${apiUrl}/api/v1/auth/login-movil`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        });

        const json = await res.json().catch(() => ({}));
        usedBackend = true;

        if (!res.ok) {
          if (res.status === 429 || json.bloqueado) {
            const segs = json.segundos_restantes || 900;
            setLockoutRemainingSeconds(segs);
            setLockoutActive(true);
            const min = Math.floor(segs / 60);
            const s = segs % 60;
            const tiempoStr = min > 0 ? `${min} min y ${s} s` : `${s} s`;
            showErrorBanner(
              `Demasiados intentos fallidos (3). Cuenta bloqueada temporalmente por 15 minutos. Reintentá en ${tiempoStr}.`,
              'error',
            );
            return;
          }
          throw new Error(json.detail || 'Credenciales incorrectas. Revisá tu correo y contraseña.');
        }

        // Éxito: restablecer bloqueo y aplicar tokens en cliente Supabase
        setLockoutActive(false);
        setLockoutRemainingSeconds(0);

        if (json.session?.access_token && json.session?.refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: json.session.access_token,
            refresh_token: json.session.refresh_token,
          });
          if (sessionError) throw sessionError;
        }
      } catch (beErr: any) {
        if (usedBackend) {
          throw beErr;
        }
      }

      // 2. Si el backend no respondió por red local, fallback a GoTrue directo
      if (!usedBackend) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }

      const mfaStatus = await getMfaStatusAsync();
      if (mfaStatus.requiresElevation && mfaStatus.verifiedFactorId) {
        setMfaFactorId(mfaStatus.verifiedFactorId);
        setMfaModalVisible(true);
        return;
      }
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      const friendly = msg.includes('bloqueada') || msg.includes('intentos fallidos')
        ? msg
        : msg.includes('Invalid login credentials') || msg.includes('Credenciales')
        ? 'Credenciales incorrectas. Revisá tu correo y contraseña.'
        : msg.includes('Email not confirmed')
        ? 'Revisá tu email: hay un correo de confirmación pendiente.'
        : `${msg || 'Error de conexión. Intentá de nuevo.'}`;
      showErrorBanner(friendly, 'error');
    } finally {
      setLoading(false);
    }
  }, [email, password, loading, lockoutActive, showErrorBanner]);

  const handleGoogleSignIn = useCallback(async () => {
    setLoadingGoogle(true);
    setAuthError(undefined);

    try {
      const res = await iniciarSesionConGoogleAsync();

      if (!res.exito) {
        if (res.error && !res.error.includes('canceló')) {
          showErrorBanner(res.error, 'error');
        }
        return;
      }

      if (res.requiresMfa) {
        setMfaFactorId(res.factorId || null);
        setMfaModalVisible(true);
      } else {
        showErrorBanner('Sesión iniciada con Google correctamente.', 'success');
      }
    } catch (err: any) {
      showErrorBanner(err?.message || 'Error al conectar con Google.', 'error');
    } finally {
      setLoadingGoogle(false);
    }
  }, [showErrorBanner]);

  const isSubmitEnabled =
    email.trim().length > 0 &&
    password.length >= 6 &&
    (mode === 'login' || (nombre.trim().length >= 2 && apellido.trim().length >= 2 && dni.trim().length >= 7 && telefono.trim().length >= 8 && confirmPassword === password));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.base }]}
      edges={['top']} // Solo margen superior. El margen inferior será manejado por el bottom sheet.
    >
      <KeyboardAvoidingWrapper
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        extraScrollHeight={36}
      >
        {/* ── SECCIÓN SUPERIOR: Marca y Contexto (Asimétrica) ────────────── */}
        <View style={[styles.headerBlock, { paddingHorizontal: spacing.xl, paddingVertical: spacing['2xl'] }]}>

          {/* Banner de Error Flotante */}
          {authError && (
            <Animated.View
              style={[
                styles.authBanner,
                {
                  backgroundColor: authError.startsWith('✓') ? colors.semantic.successBg : colors.semantic.dangerBg,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  marginBottom: spacing.lg,
                  opacity: bannerOpacity,
                  borderLeftWidth: 4,
                  borderLeftColor: authError.startsWith('✓') ? colors.semantic.success : colors.semantic.danger,
                },
              ]}
              accessible
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              <Text
                style={[typography.scale.body, { color: authError.startsWith('✓') ? colors.semantic.success : colors.semantic.danger }]}
                allowFontScaling
              >
                {authError}
              </Text>
            </Animated.View>
          )}

          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel="Logo de ApoyAR"
          />

          <Text
            style={[
              typography.scale.display,
              { color: colors.text.primary, marginTop: spacing.md, textAlign: 'center' },
            ]}
            allowFontScaling
          >
            ApoyAR
          </Text>

          <Text
            style={[
              typography.scale.bodyLg,
              { color: colors.text.secondary, marginTop: spacing['2xs'], textAlign: 'center' },
            ]}
            allowFontScaling
          >
            Tu red de protección
          </Text>
        </View>

        {/* ── SECCIÓN INFERIOR: Surface Formulario ────────────────────────── */}
        <View
          style={[
            styles.surfaceBlock,
            {
              backgroundColor: colors.bg.surface,
              borderTopLeftRadius: 36,
              borderTopRightRadius: 36,
              paddingHorizontal: spacing.xl,
              paddingTop: spacing['2xl'],
              paddingBottom: spacing['3xl'], // Extra padding al final
              // Sombra sutil para despegarlo del fondo (visible más en light mode)
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.05,
              shadowRadius: 12,
              elevation: 10,
            },
          ]}
        >
          {/* Título de la zona de acción */}
          <Text
            style={[
              typography.scale.h2,
              { color: colors.text.primary, marginBottom: spacing.lg },
            ]}
          >
            {mode === 'login' ? 'Bienvenid@ de nuevo' : 'Registrate'}
          </Text>

          {mode === 'register' ? (
            <>
              <RegistrationForm
                onSubmit={handleRegisterSubmit}
                submitButtonLabel="Crear cuenta"
              />

              {/* Toggle a modo login */}
              <View style={[styles.toggleRow, { marginTop: spacing.lg }]}>
                <Text
                  style={[typography.scale.body, { color: colors.text.secondary }]}
                  allowFontScaling
                >
                  ¿Ya tenés cuenta?{' '}
                </Text>
                <Pressable
                  onPress={toggleMode}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Ir a inicio de sesión"
                  style={({ pressed }) => [
                    styles.toggleButton,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      typography.scale.bodyBold,
                      { color: colors.semantic.info },
                    ]}
                    allowFontScaling
                  >
                    Iniciá sesión
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {/* Email */}
              <TextInput
                label="Correo electrónico"
                leftIcon={<Feather name="mail" size={20} color={colors.text.secondary} />}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (emailError) setEmailError(validateEmail(t));
                }}
                onBlur={handleEmailBlur}
                error={emailError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                placeholder="usuario@dominio.com"
                containerStyle={{ marginBottom: spacing.md }}
              />

              {/* Contraseña */}
              <TextInput
                label="Contraseña"
                leftIcon={<Feather name="lock" size={20} color={colors.text.secondary} />}
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (passwordError) setPasswordError(validatePassword(t));
                }}
                onBlur={handlePasswordBlur}
                error={passwordError}
                secureTextEntry={!showPassword}
                actionIcon={<Feather name={showPassword ? "eye-off" : "eye"} size={20} color={colors.text.secondary} />}
                actionLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onActionPress={() => setShowPassword((v) => !v)}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                placeholder="••••••••••••"
                containerStyle={{ marginBottom: spacing.md }}
              />

              {/* Bloqueo temporal por intentos fallidos */}
              {lockoutActive && (
                <View
                  style={{
                    backgroundColor: colors.semantic.dangerBg || '#3B1212',
                    borderColor: colors.semantic.danger,
                    borderWidth: 1,
                    borderRadius: radii.md,
                    padding: spacing.md,
                    marginBottom: spacing.md,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="alert-triangle" size={18} color={colors.semantic.danger} />
                    <Text style={[typography.scale.body, { color: colors.semantic.danger, fontWeight: '700' }]}>
                      Cuenta Bloqueada Temporalmente
                    </Text>
                  </View>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                    Superaste el límite de 3 intentos fallidos consecutivos.
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Feather name="clock" size={16} color={colors.semantic.danger} />
                    <Text style={[typography.scale.body, { color: colors.semantic.danger, fontWeight: '700' }]}>
                      Podrás reintentar en: {Math.floor(lockoutRemainingSeconds / 60).toString().padStart(2, '0')}:{(lockoutRemainingSeconds % 60).toString().padStart(2, '0')}
                    </Text>
                  </View>
                </View>
              )}

              {/* Botón principal de submit para Login */}
              <Button
                label={
                  lockoutActive
                    ? `Bloqueado (${Math.floor(lockoutRemainingSeconds / 60)}:${(lockoutRemainingSeconds % 60).toString().padStart(2, '0')})`
                    : "Iniciar sesión"
                }
                variant="primary"
                loading={loading}
                disabled={!email.trim() || password.length < 6 || lockoutActive}
                onPress={handleSubmit}
                style={{ marginTop: spacing.xs }}
                accessibilityHint="Inicia sesión con tu correo y contraseña"
              />

              {/* Enlace Recuperar Contraseña Civil */}
              <TouchableOpacity
                onPress={() => {
                  setRecoveryEmail(email || '');
                  setRecoveryCode('');
                  setRecoveryNewPassword('');
                  setRecoveryConfirmPassword('');
                  setRecoveryStep(1);
                  setRecoveryError(null);
                  setRecoverySuccess(null);
                  setShowRecoveryModal(true);
                }}
                style={{ marginTop: spacing.md, alignItems: 'center' }}
                accessibilityRole="button"
                accessibilityLabel="Recuperar contraseña olvidada"
              >
                <Text
                  style={[
                    typography.scale.body,
                    { color: colors.semantic.info, textDecorationLine: 'underline' },
                  ]}
                >
                  ¿Olvidaste tu contraseña?
                </Text>
              </TouchableOpacity>

              {/* Toggle a modo registro */}
              <View style={[styles.toggleRow, { marginTop: spacing.lg }]}>
                <Text
                  style={[typography.scale.body, { color: colors.text.secondary }]}
                  allowFontScaling
                >
                  ¿No tenés cuenta?{' '}
                </Text>
                <Pressable
                  onPress={toggleMode}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Ir a registro"
                  style={({ pressed }) => [
                    styles.toggleButton,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      typography.scale.bodyBold,
                      { color: colors.semantic.info },
                    ]}
                    allowFontScaling
                  >
                    Registrate
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Separador "O" */}{/*
          <View style={[styles.dividerRow, { marginVertical: spacing.lg }]}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border.default }]} />
            <Text
              style={[typography.scale.body, { color: colors.text.secondary, marginHorizontal: spacing.md }]}
              accessibilityElementsHidden
            >
              O
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border.default }]} />
          </View>*/}

          {/* Botón Google */}{/*
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={loadingGoogle}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Continuar con Google"
            accessibilityHint="Inicia sesión usando tu cuenta de Google. Función en desarrollo."
            accessibilityState={{ busy: loadingGoogle }}
            style={({ pressed }) => [
              styles.googleButton,
              {
                backgroundColor: colors.bg.base, // Invierte un poco para que destaque en el surface
                borderRadius: radii.md,
                borderWidth: 1.5,
                borderColor: colors.border.default,
                minHeight: 56,
                paddingHorizontal: spacing.md,
              },
              pressed && { opacity: 0.82 },
              loadingGoogle && { opacity: 0.38 },
            ]}
          >
            <View style={[styles.googleIconContainer, { backgroundColor: colors.bg.surface, borderRadius: radii.sm }]}>
              <Text style={[styles.googleIconText, { color: colors.text.primary }]}>G</Text>
            </View>

            <Text
              style={[typography.scale.bodyBold, { color: colors.text.primary, marginLeft: spacing.md, flex: 1 }]}
              allowFontScaling
            >
              {loadingGoogle ? 'Conectando…' : 'Continuar con Google'}
            </Text>
          </Pressable>*/}

          {/* Nota legal / privacidad */}
          <Text
            style={[
              typography.scale.caption,
              { color: colors.text.disabled, textAlign: 'center', marginTop: spacing['2xl'] },
            ]}
            allowFontScaling
          >
            Al continuar, aceptás los{' '}
            <Text
              onPress={() => setShowPrivacyModal(true)}
              style={{ color: colors.semantic.info, textDecorationLine: 'underline' }}
            >
              Términos de Uso
            </Text>
            {', la '}
            <Text
              onPress={() => setShowPrivacyModal(true)}
              style={{ color: colors.semantic.info, textDecorationLine: 'underline' }}
            >
              Política de Privacidad
            </Text>
            {' de ApoyAR.'}
          </Text>
        </View>
      </KeyboardAvoidingWrapper>

      <MfaSecurityModal
        visible={mfaModalVisible}
        mode="verify"
        factorId={mfaFactorId}
        onSuccess={() => {
          setMfaModalVisible(false);
          showErrorBanner('Autenticación completada con éxito.', 'success');
        }}
        onCancel={() => {
          setMfaModalVisible(false);
          supabase.auth.signOut().catch(() => { });
        }}
      />

      {/* ── Modal de Recuperación de Contraseña Civil ── */}
      <Modal
        visible={showRecoveryModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRecoveryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.recoveryCard, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
            {/* Header del Modal */}
            <View style={[styles.modalHeaderRow, { borderBottomColor: colors.border.default }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View style={[styles.iconCircle, { backgroundColor: colors.semantic.infoBg }]}>
                  <Feather name="key" size={20} color={colors.semantic.info} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.scale.h3, { color: colors.text.primary }]}>
                    Recuperar Contraseña
                  </Text>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                    {recoveryStep === 1 ? 'Paso 1: Solicitar código a tu email' : 'Paso 2: Validar código y nueva clave'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowRecoveryModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
              {recoverySuccess && (
                <View style={[styles.alertBox, { backgroundColor: colors.semantic.successBg, borderColor: colors.semantic.success }]}>
                  <Feather name="check-circle" size={16} color={colors.semantic.success} style={{ marginRight: 8 }} />
                  <Text style={[typography.scale.body, { color: colors.semantic.success, flex: 1 }]}>
                    {recoverySuccess}
                  </Text>
                </View>
              )}

              {recoveryError && (
                <View style={[styles.alertBox, { backgroundColor: colors.semantic.dangerBg, borderColor: colors.semantic.danger }]}>
                  <Feather name="alert-triangle" size={16} color={colors.semantic.danger} style={{ marginRight: 8 }} />
                  <Text style={[typography.scale.body, { color: colors.semantic.danger, flex: 1 }]}>
                    {recoveryError}
                  </Text>
                </View>
              )}

              {recoveryStep === 1 ? (
                <View>
                  <TextInput
                    label="Correo electrónico registrado"
                    leftIcon={<Feather name="mail" size={20} color={colors.text.secondary} />}
                    value={recoveryEmail}
                    onChangeText={setRecoveryEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholder="usuario@dominio.com"
                    containerStyle={{ marginBottom: spacing.md }}
                  />
                  <Text style={[typography.scale.caption, { color: colors.text.secondary, marginBottom: spacing.lg }]}>
                    Te enviaremos un código temporal de 6 dígitos para verificar tu identidad y restablecer tu contraseña.
                  </Text>

                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md }}>
                    <Button
                      label="Cancelar"
                      variant="secondary"
                      onPress={() => setShowRecoveryModal(false)}
                      disabled={recoveryLoading}
                    />
                    <Button
                      label="Enviar código"
                      variant="primary"
                      loading={recoveryLoading}
                      disabled={!recoveryEmail.trim() || recoveryLoading}
                      onPress={handleSolicitarRecuperacionMovil}
                    />
                  </View>
                </View>
              ) : (
                <View>
                  <TextInput
                    label="Código de verificación (6 dígitos)"
                    leftIcon={<Feather name="shield" size={20} color={colors.text.secondary} />}
                    value={recoveryCode}
                    onChangeText={setRecoveryCode}
                    keyboardType="numeric"
                    maxLength={6}
                    placeholder="123456"
                    containerStyle={{ marginBottom: spacing.md }}
                  />

                  <TextInput
                    label="Nueva contraseña"
                    leftIcon={<Feather name="lock" size={20} color={colors.text.secondary} />}
                    value={recoveryNewPassword}
                    onChangeText={setRecoveryNewPassword}
                    secureTextEntry={!showRecoveryPassword}
                    actionIcon={<Feather name={showRecoveryPassword ? "eye-off" : "eye"} size={20} color={colors.text.secondary} />}
                    actionLabel={showRecoveryPassword ? 'Ocultar' : 'Mostrar'}
                    onActionPress={() => setShowRecoveryPassword((v) => !v)}
                    placeholder="••••••••••••"
                    containerStyle={{ marginBottom: spacing.sm }}
                  />

                  {/* Checklist interactivo de requisitos de contraseña */}
                  <View style={[styles.checklistCard, { backgroundColor: colors.bg.base, borderColor: colors.border.default, marginBottom: spacing.md }]}>
                    <Text style={[typography.scale.caption, { color: colors.text.primary, fontWeight: '700', marginBottom: 6 }]}>
                      Requisitos de seguridad estricta:
                    </Text>
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather
                          name={recoveryPasswordReqs.hasMinLength ? 'check-circle' : 'circle'}
                          size={13}
                          color={recoveryPasswordReqs.hasMinLength ? colors.semantic.success : colors.text.disabled}
                        />
                        <Text style={[typography.scale.caption, { color: recoveryPasswordReqs.hasMinLength ? colors.semantic.success : colors.text.secondary }]}>
                          Mínimo 8 caracteres ({recoveryNewPassword.length}/8)
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather
                          name={recoveryPasswordReqs.hasUppercase ? 'check-circle' : 'circle'}
                          size={13}
                          color={recoveryPasswordReqs.hasUppercase ? colors.semantic.success : colors.text.disabled}
                        />
                        <Text style={[typography.scale.caption, { color: recoveryPasswordReqs.hasUppercase ? colors.semantic.success : colors.text.secondary }]}>
                          Al menos una letra mayúscula (A-Z)
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather
                          name={recoveryPasswordReqs.hasNumber ? 'check-circle' : 'circle'}
                          size={13}
                          color={recoveryPasswordReqs.hasNumber ? colors.semantic.success : colors.text.disabled}
                        />
                        <Text style={[typography.scale.caption, { color: recoveryPasswordReqs.hasNumber ? colors.semantic.success : colors.text.secondary }]}>
                          Al menos un número (0-9)
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather
                          name={recoveryPasswordReqs.hasSpecialChar ? 'check-circle' : 'circle'}
                          size={13}
                          color={recoveryPasswordReqs.hasSpecialChar ? colors.semantic.success : colors.text.disabled}
                        />
                        <Text style={[typography.scale.caption, { color: recoveryPasswordReqs.hasSpecialChar ? colors.semantic.success : colors.text.secondary }]}>
                          Al menos un símbolo especial (!@#$%^&*)
                        </Text>
                      </View>
                    </View>
                  </View>

                  <TextInput
                    label="Confirmar nueva contraseña"
                    leftIcon={<Feather name="lock" size={20} color={colors.text.secondary} />}
                    value={recoveryConfirmPassword}
                    onChangeText={setRecoveryConfirmPassword}
                    secureTextEntry={!showRecoveryConfirmPassword}
                    actionIcon={<Feather name={showRecoveryConfirmPassword ? "eye-off" : "eye"} size={20} color={colors.text.secondary} />}
                    actionLabel={showRecoveryConfirmPassword ? 'Ocultar' : 'Mostrar'}
                    onActionPress={() => setShowRecoveryConfirmPassword((v) => !v)}
                    placeholder="••••••••••••"
                    containerStyle={{ marginBottom: spacing.lg }}
                  />

                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md }}>
                    <Button
                      label="Volver"
                      variant="secondary"
                      onPress={() => setRecoveryStep(1)}
                      disabled={recoveryLoading}
                    />
                    <Button
                      label="Restablecer"
                      variant="primary"
                      loading={recoveryLoading}
                      disabled={!recoveryCode.trim() || !isRecoveryPasswordValid || recoveryNewPassword !== recoveryConfirmPassword || recoveryLoading}
                      onPress={handleConfirmarRecuperacionMovil}
                    />
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <PrivacyInfoModal
        visible={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
        title="Términos, Privacidad y Ley 25.326"
      />
    </SafeAreaView>
  );
}

// ── Estilos estáticos ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBanner: {
    width: '100%',
  },
  logoImage: {
    width: 124,
    height: 124,
  },
  surfaceBlock: {
    flex: 1, // Se expande para llenar el espacio inferior
    width: '100%',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  toggleButton: {
    minHeight: 48,
    justifyContent: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  googleIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
  },
  googleIconText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  // Modal de Recuperación
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  recoveryCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    maxHeight: '85%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  checklistCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
});
