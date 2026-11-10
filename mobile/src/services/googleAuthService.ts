// src/services/googleAuthService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Servicio de Inicio de Sesión con Google (OAuth) y Auditoría Estructurada.
// Integrado nativamente con Supabase Auth y expo-auth-session / WebBrowser.
// ─────────────────────────────────────────────────────────────────────────────

import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '../lib/supabase';
import { getMfaStatusAsync, MfaStatus } from './mfaService';

let WebBrowserModule: typeof import('expo-web-browser') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebBrowserModule = require('expo-web-browser');
  WebBrowserModule?.maybeCompleteAuthSession();
} catch (e) {
  console.warn('[GoogleAuth] Módulo nativo expo-web-browser no disponible aún en este APK:', e);
}

export interface GoogleAuthAuditResult {
  etapaToken: {
    exito: boolean;
    tipo: 'id_token' | 'oauth_redirect';
    tokenPresente: boolean;
    detalle?: string;
  };
  etapaSesion: {
    exito: boolean;
    usuarioId?: string;
    email?: string;
    expiraEn?: number;
    error?: string;
  };
  etapaMfa: MfaStatus;
}

export interface GoogleSignInResponse {
  exito: boolean;
  auditoria: GoogleAuthAuditResult;
  requiresMfa: boolean;
  factorId?: string | null;
  error?: string;
}

/**
 * Función de Auditoría Estructurada: Imprime y valida explícitamente en consola
 * las 3 etapas críticas exigidas: Token Google, Sesión Supabase y Estado MFA.
 */
export function registrarAuditoriaGoogleAuth(auditoria: GoogleAuthAuditResult): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔐 [AUDITORÍA SEGURIDAD GOOGLE OAUTH & SUPABASE AUTH]');
  console.log('───────────────────────────────────────────────────────────────');
  
  // (a) Obtención del Token de Google
  if (auditoria.etapaToken.exito) {
    console.log('✅ (a) TOKEN GOOGLE: Token OAuth obtenido con éxito.');
    console.log(`    Tipo: ${auditoria.etapaToken.tipo} | Token Presente: ${auditoria.etapaToken.tokenPresente}`);
  } else {
    console.error('❌ (a) TOKEN GOOGLE: Falló la obtención del token.');
    console.error(`    Detalle: ${auditoria.etapaToken.detalle}`);
  }

  // (b) Creación de Sesión en Supabase
  if (auditoria.etapaSesion.exito) {
    console.log('✅ (b) SESIÓN SUPABASE: Sesión creada exitosamente.');
    console.log(`    Usuario UUID: ${auditoria.etapaSesion.usuarioId}`);
    console.log(`    Email: ${auditoria.etapaSesion.email}`);
    console.log(`    Expira en: ${auditoria.etapaSesion.expiraEn} seg`);
  } else {
    console.error('❌ (b) SESIÓN SUPABASE: No se pudo crear la sesión.');
    console.error(`    Error: ${auditoria.etapaSesion.error}`);
  }

  // (c) Estado del Factor MFA
  console.log('🛡️ (c) ESTADO FACTOR MFA (TOTP / Google Authenticator):');
  console.log(`    MFA Registrado: ${auditoria.etapaMfa.hasMfa ? 'SÍ' : 'NO'}`);
  console.log(`    Factor ID: ${auditoria.etapaMfa.verifiedFactorId || 'Ninguno'}`);
  console.log(`    Nivel Actual: ${auditoria.etapaMfa.currentLevel}`);
  console.log(`    Nivel Requerido: ${auditoria.etapaMfa.nextLevel}`);
  console.log(`    ¿Exige Elevación AAL2?: ${auditoria.etapaMfa.requiresElevation ? 'SÍ (Código TOTP Requerido)' : 'NO'}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

/**
 * Ejecuta el flujo completo de inicio de sesión con Google:
 * 1. Invoca OAuth con Supabase.
 * 2. Abre el navegador seguro con WebBrowser.
 * 3. Captura el redirect y establece la sesión.
 * 4. Audita y verifica si se debe solicitar desafío MFA (AAL2).
 */
export async function iniciarSesionConGoogleAsync(): Promise<GoogleSignInResponse> {
  const auditoria: GoogleAuthAuditResult = {
    etapaToken: { exito: false, tipo: 'oauth_redirect', tokenPresente: false },
    etapaSesion: { exito: false },
    etapaMfa: {
      hasMfa: false,
      verifiedFactorId: null,
      currentLevel: 'aal1',
      nextLevel: 'aal1',
      requiresElevation: false,
    },
  };

  try {
    const redirectTo = makeRedirectUri({
      scheme: 'apoyar',
      path: 'auth/callback',
    });

    // 1. Iniciar flujo OAuth en Supabase
    const { data: oauthData, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (oauthError || !oauthData?.url) {
      auditoria.etapaToken.detalle = oauthError?.message || 'No se obtuvo URL de autorización.';
      registrarAuditoriaGoogleAuth(auditoria);
      return { exito: false, auditoria, requiresMfa: false, error: auditoria.etapaToken.detalle };
    }

    if (!WebBrowserModule?.openAuthSessionAsync) {
      throw new Error(
        'El módulo nativo del navegador no está disponible en este APK. Recompilá la aplicación con run:android para habilitarlo.'
      );
    }

    // 2. Abrir navegador del sistema para autenticación con Google
    const authResult = await WebBrowserModule.openAuthSessionAsync(oauthData.url, redirectTo);

    if (authResult.type !== 'success' || !authResult.url) {
      auditoria.etapaToken.detalle =
        authResult.type === 'cancel' || authResult.type === 'dismiss'
          ? 'El usuario canceló el inicio de sesión con Google.'
          : 'Respuesta inválida del navegador.';
      registrarAuditoriaGoogleAuth(auditoria);
      return { exito: false, auditoria, requiresMfa: false, error: auditoria.etapaToken.detalle };
    }

    // 3. Extraer access_token y refresh_token del fragmento de URL (# o ?)
    const urlString = authResult.url;
    auditoria.etapaToken.exito = true;
    auditoria.etapaToken.tokenPresente = true;

    // Supabase devuelve tokens en el hash (#access_token=...&refresh_token=...) o en query params
    const hashPart = urlString.includes('#') ? urlString.split('#')[1] : '';
    const queryPart = urlString.includes('?') ? urlString.split('?')[1].split('#')[0] : '';
    const paramsString = hashPart || queryPart;

    const params = new URLSearchParams(paramsString);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      // Si el callback vino como código de autorización (flow code)
      const code = params.get('code');
      if (code) {
        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError || !exchangeData.session) {
          auditoria.etapaSesion.error = exchangeError?.message || 'Error intercambiando código por sesión.';
          registrarAuditoriaGoogleAuth(auditoria);
          return { exito: false, auditoria, requiresMfa: false, error: auditoria.etapaSesion.error };
        }
        auditoria.etapaSesion = {
          exito: true,
          usuarioId: exchangeData.session.user.id,
          email: exchangeData.session.user.email,
          expiraEn: exchangeData.session.expires_in,
        };
      } else {
        auditoria.etapaSesion.error = 'No se encontraron tokens ni código en el callback.';
        registrarAuditoriaGoogleAuth(auditoria);
        return { exito: false, auditoria, requiresMfa: false, error: auditoria.etapaSesion.error };
      }
    } else {
      // Establecer sesión directa con tokens obtenidos
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError || !sessionData.session) {
        auditoria.etapaSesion.error = sessionError?.message || 'Fallo al establecer sesión en Supabase.';
        registrarAuditoriaGoogleAuth(auditoria);
        return { exito: false, auditoria, requiresMfa: false, error: auditoria.etapaSesion.error };
      }

      auditoria.etapaSesion = {
        exito: true,
        usuarioId: sessionData.session.user.id,
        email: sessionData.session.user.email,
        expiraEn: sessionData.session.expires_in,
      };
    }

    // 4. Auditar Estado MFA y requerimiento de elevación AAL2
    const mfaStatus = await getMfaStatusAsync();
    auditoria.etapaMfa = mfaStatus;

    registrarAuditoriaGoogleAuth(auditoria);

    return {
      exito: true,
      auditoria,
      requiresMfa: mfaStatus.requiresElevation,
      factorId: mfaStatus.verifiedFactorId,
    };
  } catch (err: any) {
    auditoria.etapaSesion.error = err?.message || 'Excepción no controlada en flujo Google Auth.';
    registrarAuditoriaGoogleAuth(auditoria);
    return {
      exito: false,
      auditoria,
      requiresMfa: false,
      error: err?.message || 'Error en autenticación.',
    };
  }
}
