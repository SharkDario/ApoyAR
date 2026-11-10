// src/navigation/RootNavigator.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Navigator raíz. Decide qué stack montar en función del estado de sesión.
// En Iteración 1 el estado se simula con una variable local;
// en Iteración 2 se reemplaza por el contexto de Supabase Auth.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { AuthNavigator } from './AuthNavigator';
import { VictimNavigator } from './VictimNavigator';
import { ContactNavigator } from './ContactNavigator';

const Root = createNativeStackNavigator<RootStackParamList>();

interface RootNavigatorProps {
  /**
   * Estado de autenticación:
   *   null = sin sesión → muestra AuthNavigator
   *   'victim' = sesión activa como Víctima
   *   'contact' = sesión activa como Contacto de Emergencia
   *
   * TODO (Iter 2): reemplazar por useSupabaseSession() del contexto de Auth.
   */
  authState: null | 'victim' | 'contact';
}

export function RootNavigator({ authState }: RootNavigatorProps) {
  return (
    <Root.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {authState === null ? (
        <Root.Screen name="Auth" component={AuthNavigator} />
      ) : authState === 'victim' ? (
        <Root.Screen name="VictimMain" component={VictimNavigator} />
      ) : (
        <Root.Screen name="ContactMain" component={ContactNavigator} />
      )}
    </Root.Navigator>
  );
}
