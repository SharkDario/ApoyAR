// src/contexts/AuthContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Contexto de Autenticación de Supabase desacoplado de App.tsx.
// Elimina dependencias circulares (Require cycle: App.tsx -> Navigator -> Screens -> App.tsx).
// Administra sesión, usuario actual, datos de perfil (persona) y cierre de sesión.
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { registrarPushToken } from '../lib/pushNotifications';
import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import { getMfaStatusAsync } from '../services/mfaService';

export interface PersonaData {
  id?: string;
  nombre: string;
  apellido: string;
  dni?: string;
  telefono?: string;
  direccion?: string;
  genero?: string;
  palabraClave_encriptada?: string;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  persona: PersonaData | null;
  loading: boolean;
  mfaElevationRequired: boolean;
  mfaFactorId: string | null;
  signOut: () => Promise<void>;
  refreshPersona: () => Promise<void>;
  actualizarPersona: (data: Partial<PersonaData>) => Promise<boolean>;
  completeMfaVerification: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  persona: null,
  loading: true,
  mfaElevationRequired: false,
  mfaFactorId: null,
  signOut: async () => {},
  refreshPersona: async () => {},
  actualizarPersona: async () => false,
  completeMfaVerification: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [persona, setPersona] = useState<PersonaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaElevationRequired, setMfaElevationRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  const fetchPersona = useCallback(async (userId: string) => {
    try {
      // 1. Intentar vía cliente Supabase a través de relación usuario -> persona
      const { data, error } = await supabase
        .from('usuario')
        .select('usu_id_usuario, persona:per_id_persona(*)')
        .eq('usu_id_usuario', userId)
        .maybeSingle();

      if (!error && data && (data as any).persona) {
        const raw = (data as any).persona;
        const normalizedPersona: PersonaData = {
          ...raw,
          id: raw.per_id_persona ?? raw.id,
          nombre: raw.per_nombre ?? raw.nombre ?? 'Usuario',
          apellido: raw.per_apellido ?? raw.apellido ?? '',
          dni: raw.per_dni ?? raw.dni,
          telefono: raw.per_telefono ?? raw.telefono,
          genero: raw.per_genero ?? raw.genero,
          direccion: raw.per_direccion ?? raw.direccion,
        };
        setPersona(normalizedPersona);
        return;
      }

      // 2. Fallback de alta confiabilidad vía Backend (bypassea RLS restrictivo)
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = {
        'X-Api-Secret': getApiSecretKey(),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/v1/incidentes/persona/${userId}`, {
        headers,
      });

      if (res.ok) {
        const backendPersona = await res.json();
        setPersona(backendPersona);
      }
    } catch (e) {
      console.warn('[AuthContext] No se pudo cargar perfil de persona:', e);
    }
  }, []);

  const actualizarPersona = useCallback(async (data: Partial<PersonaData>): Promise<boolean> => {
    const userId = session?.user?.id;
    if (!userId) return false;

    try {
      // 1. Guardar vía Backend usando credenciales administrativas
      const token = session?.access_token || (await supabase.auth.getSession()).data.session?.access_token;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Api-Secret': getApiSecretKey(),
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${getApiBaseUrl()}/api/v1/incidentes/persona/${userId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data),
      });

      // 2. Intentar actualizar directamente en Supabase si RLS lo permite
      try {
        const sbPayload: Record<string, any> = {};
        if (data.nombre !== undefined) sbPayload.per_nombre = data.nombre;
        if (data.apellido !== undefined) sbPayload.per_apellido = data.apellido;
        if (data.dni !== undefined) sbPayload.per_dni = data.dni;
        if (data.telefono !== undefined) sbPayload.per_telefono = data.telefono;
        if (data.genero !== undefined) sbPayload.per_genero = data.genero;
        if (data.direccion !== undefined) sbPayload.per_direccion = data.direccion;

        if (persona?.id) {
          await supabase
            .from('persona')
            .update(sbPayload)
            .eq('per_id_persona', persona.id);
        }
      } catch (sbErr) {
        // Ignorar si RLS bloquea la escritura directa
      }

      if (res.ok) {
        setPersona((prev) => (prev ? { ...prev, ...data } : ({ ...data, nombre: data.nombre || 'Usuario', apellido: data.apellido || '' } as PersonaData)));
        return true;
      }
    } catch (err) {
      console.warn('[AuthContext] Error actualizando perfil de persona:', err);
    }
    return false;
  }, [session?.user?.id]);

  const refreshPersona = useCallback(async () => {
    if (session?.user) {
      await fetchPersona(session.user.id);
    }
  }, [session, fetchPersona]);

  const completeMfaVerification = useCallback(() => {
    setMfaElevationRequired(false);
    setMfaFactorId(null);
  }, []);

  useEffect(() => {
    // 1. Obtener sesión activa inicial
    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      setSession(initialSession);
      if (initialSession?.user) {
        try {
          const mfaStatus = await getMfaStatusAsync();
          if (mfaStatus.requiresElevation && mfaStatus.verifiedFactorId) {
            setMfaElevationRequired(true);
            setMfaFactorId(mfaStatus.verifiedFactorId);
          } else {
            setMfaElevationRequired(false);
            setMfaFactorId(null);
          }
        } catch {
          setMfaElevationRequired(false);
          setMfaFactorId(null);
        }
        fetchPersona(initialSession.user.id);
      }
      setLoading(false);
    });

    // 2. Suscribirse a cambios de estado de autenticación
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);

      if (newSession?.user) {
        try {
          const mfaStatus = await getMfaStatusAsync();
          if (mfaStatus.requiresElevation && mfaStatus.verifiedFactorId) {
            setMfaElevationRequired(true);
            setMfaFactorId(mfaStatus.verifiedFactorId);
          } else {
            setMfaElevationRequired(false);
            setMfaFactorId(null);
          }
        } catch {
          setMfaElevationRequired(false);
          setMfaFactorId(null);
        }

        fetchPersona(newSession.user.id);
        registrarPushToken(newSession.user.id).catch(() => {});
      } else {
        setPersona(null);
        setMfaElevationRequired(false);
        setMfaFactorId(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchPersona]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setPersona(null);
      setMfaElevationRequired(false);
      setMfaFactorId(null);
    } catch (err) {
      console.error('[AuthContext] Error cerrando sesión:', err);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        persona,
        loading,
        mfaElevationRequired,
        mfaFactorId,
        signOut,
        refreshPersona,
        actualizarPersona,
        completeMfaVerification,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
