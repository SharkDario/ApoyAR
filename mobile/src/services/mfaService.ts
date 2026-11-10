// src/services/mfaService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Servicio Nativo de Autenticación Multifactor (MFA TOTP) vía Supabase.
// Compatible con Google Authenticator, Authy, etc.
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
 * Inicia la inscripción (Enrollment) de un nuevo factor TOTP en Supabase.
 * Limpia automáticamente cualquier factor previo no verificado para evitar conflictos de friendlyName.
 * Genera el secreto criptográfico y la URI compatible con Google Authenticator.
 */
export async function enrollTotpAsync(friendlyName = 'Google Authenticator'): Promise<TotpEnrollmentResult> {
  // 1. Purgar factores previos no verificados o con el mismo friendlyName para evitar conflictos
  try {
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    if (factorsData?.totp) {
      for (const f of factorsData.totp) {
        const statusStr = (f as any).status;
        const matchesName = (f as any).friendly_name?.toLowerCase() === friendlyName.toLowerCase();
        if (statusStr === 'unverified' || matchesName) {
          await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
        }
      }
    }
  } catch (cleanErr) {
    console.warn('[MFA] Aviso limpiando factores previos:', cleanErr);
  }

  // 2. Inscribir factor limpio
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'ApoyAR',
    friendlyName,
  });

  if (error || !data) {
    throw new Error(`[MFA] Error al inscribir factor TOTP: ${error?.message || 'Sin datos'}`);
  }

  return {
    factorId: data.id,
    secret: data.totp.secret,
    uri: data.totp.uri,
    qrCodeSvg: data.totp.qr_code,
  };
}

/**
 * Confirma y activa la inscripción del factor TOTP con el primer código de 6 dígitos.
 */
export async function confirmEnrollmentAsync(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    throw new Error(`[MFA] Error creando desafío de verificación: ${challenge.error.message}`);
  }

  const verification = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.trim(),
  });

  if (verification.error) {
    throw new Error(`[MFA] Código de verificación inválido: ${verification.error.message}`);
  }
}

/**
 * Consulta el estado actual del MFA para la sesión activa (AAL1 vs AAL2 y factores verificados).
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
    const requiresElevation = nextLevel === 'aal2' && currentLevel === 'aal1';

    return {
      hasMfa: !!verifiedFactor,
      verifiedFactorId: verifiedFactor ? verifiedFactor.id : null,
      currentLevel,
      nextLevel,
      requiresElevation,
    };
  } catch (err) {
    console.warn('[MFA] Error consultando estado de MFA:', err);
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
 * Desafía y valida el código de 6 dígitos de Google Authenticator durante el inicio de sesión.
 * Eleva la sesión activa de AAL1 a AAL2.
 */
export async function challengeAndVerifyMfaAsync(factorId: string, code: string): Promise<boolean> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) {
    throw new Error(`[MFA] Error al emitir desafío: ${challenge.error.message}`);
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
 * Desactiva un factor MFA registrado.
 */
export async function unenrollTotpAsync(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    throw new Error(`[MFA] Error al desvincular factor: ${error.message}`);
  }
}

/**
 * Desactiva todos los factores TOTP vinculados a la cuenta actual.
 */
export async function desactivarMfaAsync(): Promise<void> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(`[MFA] Error listando factores: ${error.message}`);

  if (data?.totp && data.totp.length > 0) {
    for (const factor of data.totp) {
      await unenrollTotpAsync(factor.id);
    }
  }
}
