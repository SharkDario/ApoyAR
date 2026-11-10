// panel-web/src/services/mfaService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Servicio Nativo de Autenticación Multifactor (MFA TOTP) vía Supabase Auth.
// Compatible con Google Authenticator, Authy, Microsoft Authenticator, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase';

export interface TotpEnrollmentResult {
  factorId: string;
  secret: string;
  uri: string;
  qrCodeSvg?: string;
}

export interface MfaStatus {
  hasMfa: boolean;
  verifiedFactorId: string | null;
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2';
  requiresElevation: boolean;
}

/**
 * Consulta el estado actual de MFA (AAL1 vs AAL2 y factores TOTP verificados)
 * para la sesión activa en el cliente Supabase.
 */
export async function getMfaStatusAsync(): Promise<MfaStatus> {
  try {
    const [factorsRes, aalRes] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);

    const factors = factorsRes.data?.totp || [];
    const verifiedFactor = factors.find((f: any) => f.status === 'verified');

    const currentLevel = (aalRes.data?.currentLevel || 'aal1') as 'aal1' | 'aal2';
    const nextLevel = (aalRes.data?.nextLevel || 'aal1') as 'aal1' | 'aal2';
    const requiresElevation = (nextLevel === 'aal2' && currentLevel === 'aal1') || (!!verifiedFactor && currentLevel === 'aal1');

    return {
      hasMfa: !!verifiedFactor,
      verifiedFactorId: verifiedFactor ? verifiedFactor.id : null,
      currentLevel,
      nextLevel,
      requiresElevation,
    };
  } catch (err) {
    console.warn('[MFA Web] Error consultando estado de MFA:', err);
    return {
      hasMfa: false,
      verifiedFactorId: null,
      currentLevel: 'aal1',
      nextLevel: 'aal1',
      requiresElevation: false,
    };
  }
}

/**
 * Desafía y valida el código TOTP de 6 dígitos de Google Authenticator.
 * Eleva la sesión activa de AAL1 a AAL2.
 */
export async function challengeAndVerifyMfaAsync(factorId: string, code: string): Promise<boolean> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    throw new Error(`[MFA] Error al emitir desafío de autenticación: ${challenge.error.message}`);
  }

  const verification = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.trim(),
  });

  if (verification.error) {
    throw new Error('Código incorrecto o expirado. Verificá tu Google Authenticator.');
  }

  return true;
}

/**
 * Limpia cualquier factor TOTP en estado 'unverified' o huérfano.
 * Esencial cuando el usuario cancela, recarga o abandona el proceso antes de confirmar.
 */
export async function cleanupUnverifiedFactorsAsync(): Promise<void> {
  try {
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    const all = factorsData?.all || [];
    for (const f of all) {
      const status = (f as any).status;
      if (status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[MFA Web] Aviso limpiando factores no verificados:', err);
  }
}

/**
 * Inicia la inscripción de un nuevo factor TOTP en Supabase.
 * Limpia factores no verificados previos y previene colisiones de friendlyName.
 */
export async function enrollTotpAsync(friendlyName = 'ApoyAR Panel Web'): Promise<TotpEnrollmentResult> {
  // 1. Limpieza preventiva de factores huérfanos/no verificados
  await cleanupUnverifiedFactorsAsync();

  // 2. Si ya existía un factor previo con el mismo nombre, desvincularlo primero para permitir reinscripción
  try {
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    for (const f of factorsData?.all || []) {
      const name = ((f as any).friendly_name || (f as any).friendlyName || '').toLowerCase();
      if (name === friendlyName.toLowerCase() || (f as any).status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
    }
  } catch (cleanErr) {
    console.warn('[MFA Web] Aviso limpiando factores previos:', cleanErr);
  }

  // 3. Inscribir nuevo factor
  let { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'ApoyAR',
    friendlyName,
  });

  // 4. Si la API de Supabase responde que el friendlyName ya existe, purgarlo de `all` y reintentar
  if (error && error.message?.toLowerCase().includes('already exists')) {
    try {
      const { data: retryFactors } = await supabase.auth.mfa.listFactors();
      for (const f of retryFactors?.all || []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
      }
      const retryEnroll = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'ApoyAR',
        friendlyName,
      });
      data = retryEnroll.data;
      error = retryEnroll.error;
    } catch (retryErr) {
      console.warn('[MFA Web] Error en reintento de enroll:', retryErr);
    }
  }

  if (error || !data) {
    const rawMsg = error?.message || 'Sin datos';
    const cleanMsg = rawMsg.toLowerCase().includes('already exists')
      ? 'Se detectó una vinculación previa pendiente. Se ha restablecido; por favor volvé a presionar "Activar".'
      : rawMsg;
    throw new Error(cleanMsg);
  }

  return {
    factorId: data.id,
    secret: data.totp.secret,
    uri: data.totp.uri,
    qrCodeSvg: data.totp.qr_code,
  };
}

/**
 * Confirma y activa la inscripción del factor TOTP con el código de 6 dígitos.
 */
export async function confirmEnrollmentAsync(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    throw new Error(`[MFA Web] Error creando desafío: ${challenge.error.message}`);
  }

  const verification = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.trim(),
  });

  if (verification.error) {
    throw new Error(`[MFA Web] Código de verificación inválido: ${verification.error.message}`);
  }
}

/**
 * Desactiva un factor MFA registrado por su ID.
 */
export async function unenrollTotpAsync(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    throw new Error(`[MFA Web] Error al desvincular factor: ${error.message}`);
  }
}

/**
 * Desactiva todos los factores TOTP vinculados a la cuenta activa.
 */
export async function disableAllMfaAsync(): Promise<void> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    throw new Error(`[MFA Web] Error al consultar factores: ${error.message}`);
  }
  if (data?.totp && data.totp.length > 0) {
    for (const factor of data.totp) {
      await unenrollTotpAsync(factor.id);
    }
  }
}

