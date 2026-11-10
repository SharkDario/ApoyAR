// App.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Punto de entrada de la aplicación ApoyAR.
// Monta: ThemeProvider → AuthProvider → SosProvider → NavigationContainer → RootNavigator
// Resuelve require cycles al delegar autenticación en src/contexts/AuthContext.tsx.
// Soporta "Modo Invisible (Calculadora)" señuelo al iniciar si la usuaria lo configuró.
// ─────────────────────────────────────────────────────────────────────────────

import 'react-native-gesture-handler'; // ← debe ser el primer import
import './src/tasks/locationTask'; // ← Registrar la tarea en segundo plano

import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeProvider, useTheme } from './src/theme';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { SosProvider } from './src/contexts/SosContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { FakeCalculatorScreen } from './src/screens/FakeCalculatorScreen';
import { LocalAuthGuard } from './src/components/LocalAuthGuard';
import { MfaSecurityModal } from './src/components/MfaSecurityModal';
import { colaEvidencias } from './src/services/colaEvidencias';
import { iniciarPresencia } from './src/lib/presencia';
import { iniciarActivacionPorBotones } from './src/services/botonesFisicos';

// RF-2.4: 3 pulsaciones de Volumen abajo activan el Modo Resguardo, aunque la interfaz no esté montada
iniciarActivacionPorBotones();

function AppInner() {
  const { colors, isDark } = useTheme();
  const {
    session,
    loading,
    mfaElevationRequired,
    mfaFactorId,
    completeMfaVerification,
    signOut,
  } = useAuth();
  const [isCamouflaged, setIsCamouflaged] = useState(false);
  const [checkingCamouflage, setCheckingCamouflage] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('@apoyar_camuflaje_activo').then((val) => {
      if (val === 'true') {
        setIsCamouflaged(true);
      }
      setCheckingCamouflage(false);
    });
  }, []);

  useEffect(() => {
    if (session) colaEvidencias.iniciar();
  }, [session]);

  const usuarioId = session?.user?.id;
  useEffect(() => (usuarioId ? iniciarPresencia(usuarioId) : undefined), [usuarioId]);

  const authState: null | 'victim' | 'contact' =
    session && !mfaElevationRequired ? 'victim' : null;

  const navigationTheme = {
    dark: isDark,
    colors: {
      primary: colors.border.focus,
      background: colors.bg.base,
      card: colors.bg.overlay,
      text: colors.text.primary,
      border: colors.border.default,
      notification: colors.semantic.danger,
    },
    fonts: {
      regular: { fontFamily: 'Inter_400Regular', fontWeight: '400' as const },
      medium: { fontFamily: 'Inter_500Medium', fontWeight: '500' as const },
      bold: { fontFamily: 'Inter_700Bold', fontWeight: '700' as const },
      heavy: { fontFamily: 'Inter_800ExtraBold', fontWeight: '800' as const },
    },
  };

  if (loading || checkingCamouflage) return null;

  // Si la usuaria configuró iniciar en Modo Invisible, mostrar la calculadora señuelo
  if (isCamouflaged) {
    return (
      <SafeAreaProvider>
        <FakeCalculatorScreen onUnlock={() => setIsCamouflaged(false)} />
      </SafeAreaProvider>
    );
  }

  // Si la cuenta exige verificación de Doble Factor (TOTP / Google Authenticator) al iniciar sesión
  if (session && mfaElevationRequired) {
    return (
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <MfaSecurityModal
          visible={true}
          mode="verify"
          factorId={mfaFactorId}
          onSuccess={completeMfaVerification}
          onCancel={signOut}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SosProvider>
      <SafeAreaProvider>
        <LocalAuthGuard enabled={!!session}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <NavigationContainer theme={navigationTheme}>
            <RootNavigator authState={authState} />
          </NavigationContainer>
        </LocalAuthGuard>
      </SafeAreaProvider>
    </SosProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
