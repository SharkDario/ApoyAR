// src/lib/supabase.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cliente Supabase singleton para toda la app móvil.
// Usa la clave anon/public, que respeta las RLS policies.
//
// NOTA sobre la URL: el SDK espera la URL base del proyecto SIN /rest/v1/ al final.
// Correcto:  https://abcdefgh.supabase.co
// Incorrecto: https://abcdefgh.supabase.co/rest/v1/
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Extraemos la URL base eliminando cualquier path extra que el usuario
// haya copiado por error desde el Dashboard de Supabase.
const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_URL = rawUrl.replace(/\/(rest\/v1\/?|auth\/v1\/?|storage\/v1\/?)$/, '');

const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[Supabase] Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY en .env'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // AsyncStorage persiste la sesión entre reinicios de la app.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // No usamos OAuth redirect en Iter 1
  },
});
