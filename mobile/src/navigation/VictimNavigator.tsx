// src/navigation/VictimNavigator.tsx
// Stack de navegación para el rol Víctima (sesión activa).

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { VictimStackParamList } from './types';
import { HomeScreen } from '@screens/HomeScreen';
import { CountdownScreen } from '@screens/CountdownScreen';
import { ContactsScreen } from '@screens/ContactsScreen';
import { AlertReceivedScreen } from '@screens/AlertReceivedScreen';
import { FakeCalculatorScreen } from '@screens/FakeCalculatorScreen';
import { useTheme } from '@theme';

const Stack = createNativeStackNavigator<VictimStackParamList>();

export function VictimNavigator() {
  const { colors, typography } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: colors.bg.overlay },
        headerTintColor:  colors.text.primary,
        headerTitleStyle: { ...typography.scale.h2 },
        contentStyle:     { backgroundColor: colors.bg.base },
        animation:        'slide_from_right',
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Countdown"
        component={CountdownScreen}
        options={{
          headerShown: false,
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{ title: 'Mi Red de Apoyo' }}
      />
      <Stack.Screen
        name="AlertReceived"
        component={AlertReceivedScreen}
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="FakeCalculator"
        component={FakeCalculatorScreen}
        options={{
          headerShown: false,
          animation: 'none',
        }}
      />
    </Stack.Navigator>
  );
}
