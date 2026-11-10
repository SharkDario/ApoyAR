// src/navigation/ContactNavigator.tsx
// Stack de navegación para el rol Contacto de Emergencia (sesión activa).

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ContactStackParamList } from './types';
import { AlertReceivedScreen } from '@screens/AlertReceivedScreen';
import { HomeScreen } from '@screens/HomeScreen';
import { useTheme } from '@theme';

const Stack = createNativeStackNavigator<ContactStackParamList>();

export function ContactNavigator() {
  const { colors, typography } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: colors.bg.overlay },
        headerTintColor:  colors.text.primary,
        headerTitleStyle: { ...typography.scale.h2 },
        contentStyle:     { backgroundColor: colors.bg.base },
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AlertReceived"
        component={AlertReceivedScreen}
        options={{
          headerShown: false,
          // La alerta de emergencia se presenta en pantalla completa sin header
          presentation: 'fullScreenModal',
          animation: 'fade',
        }}
      />
    </Stack.Navigator>
  );
}
