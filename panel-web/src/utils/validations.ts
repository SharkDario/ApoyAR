// src/utils/validations.ts
// ─────────────────────────────────────────────────────────────────────────────
// Utilidades Centralizadas de Validación Agnósticas a la Plataforma (TypeScript Puro)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export interface PasswordRequirements {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}

export interface PasswordValidationResult extends ValidationResult {
  requirements: PasswordRequirements;
}

export interface DateValidationResult extends ValidationResult {
  age?: number;
}

// ── Expresiones Regulares ──────────────────────────────────────────────────────

export const REGEX_PATTERNS = {
  /** Exclusivamente dígitos numéricos */
  NUMERIC_ONLY: /^\d+$/,
  /** DNI argentino: exactamente 7 u 8 números */
  DNI_ARG: /^\d{7,8}$/,
  /** Teléfono argentino estándar: exactamente 10 dígitos */
  PHONE_ARG_10_DIGITS: /^\d{10}$/,
  /** Al menos una letra mayúscula */
  HAS_UPPERCASE: /[A-Z]/,
  /** Al menos un número */
  HAS_NUMBER: /[0-9]/,
  /** Al menos un carácter especial */
  HAS_SPECIAL_CHAR: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/,
  /** Formato de email estándar */
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /** Nombres de personas */
  PERSON_NAME: /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]{2,50}$/,
  /** Formato de fecha ISO YYYY-MM-DD */
  DATE_ISO: /^\d{4}-\d{2}-\d{2}$/,
  /** Formato de fecha regional DD/MM/YYYY */
  DATE_REGIONAL: /^\d{2}\/\d{2}\/\d{4}$/,
};

// ── Sanitizadores de Input ────────────────────────────────────────────────────

export function cleanNumericOnly(val: string): string {
  if (!val) return '';
  return val.replace(/\D/g, '');
}

export function sanitizeDni(val: string): string {
  return cleanNumericOnly(val).slice(0, 8);
}

export function sanitizeTelefono(val: string): string {
  return cleanNumericOnly(val).slice(0, 10);
}

// ── Validadores Específicos ───────────────────────────────────────────────────

export function validateDni(dni: string): ValidationResult {
  const clean = cleanNumericOnly(dni);

  if (!clean) {
    return { isValid: false, error: 'El DNI es obligatorio.' };
  }

  if (dni.length !== clean.length || clean.length < 7 || clean.length > 8 || !REGEX_PATTERNS.DNI_ARG.test(clean)) {
    return { isValid: false, error: 'El DNI debe contener 7 u 8 números sin puntos' };
  }

  return { isValid: true };
}

export function validateTelefono(telefono: string): ValidationResult {
  const clean = cleanNumericOnly(telefono);

  if (!clean) {
    return { isValid: false, error: 'El teléfono es obligatorio.' };
  }

  if (telefono.length !== clean.length || clean.length !== 10 || !REGEX_PATTERNS.PHONE_ARG_10_DIGITS.test(clean)) {
    return { isValid: false, error: 'Ingresa un número válido de 10 dígitos (ej: 3704123456)' };
  }

  return { isValid: true };
}

export function parseDateFlexible(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();

  if (REGEX_PATTERNS.DATE_ISO.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
      return d;
    }
    return null;
  }

  if (REGEX_PATTERNS.DATE_REGIONAL.test(trimmed)) {
    const [day, month, year] = trimmed.split('/').map(Number);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
      return d;
    }
    return null;
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export function calcularEdad(fecha: string | Date): number {
  const d = typeof fecha === 'string' ? parseDateFlexible(fecha) : fecha;
  if (!d || isNaN(d.getTime())) return -1;

  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const mesActual = hoy.getMonth();
  const mesNac = d.getMonth();

  if (mesActual < mesNac || (mesActual === mesNac && hoy.getDate() < d.getDate())) {
    edad--;
  }

  return edad;
}

export function validateFechaNacimiento(fecha: string | Date, minAge = 16): DateValidationResult {
  if (!fecha) {
    return { isValid: false, error: 'La fecha de nacimiento es obligatoria.' };
  }

  const dateObj = typeof fecha === 'string' ? parseDateFlexible(fecha) : fecha;

  if (!dateObj || isNaN(dateObj.getTime()) || dateObj > new Date() || dateObj.getFullYear() < 1900) {
    return { isValid: false, error: 'Fecha inválida' };
  }

  const edad = calcularEdad(dateObj);
  if (edad < 0) {
    return { isValid: false, error: 'Fecha inválida' };
  }

  if (edad < minAge) {
    return {
      isValid: false,
      error: minAge === 18 ? 'Debe ser mayor de 18 años para ser registrado' : `Debes ser mayor de ${minAge} años para registrarte`,
      age: edad,
    };
  }

  return { isValid: true, age: edad };
}

export function validatePassword(password: string): PasswordValidationResult {
  const requirements: PasswordRequirements = {
    hasMinLength: (password || '').length >= 8,
    hasUppercase: REGEX_PATTERNS.HAS_UPPERCASE.test(password || ''),
    hasNumber: REGEX_PATTERNS.HAS_NUMBER.test(password || ''),
    hasSpecialChar: REGEX_PATTERNS.HAS_SPECIAL_CHAR.test(password || ''),
  };

  if (!password) {
    return {
      isValid: false,
      error: 'La contraseña es obligatoria.',
      requirements,
    };
  }

  if (!requirements.hasMinLength) {
    const faltan = 8 - password.length;
    return {
      isValid: false,
      error: `Mínimo 8 caracteres (faltan ${faltan})`,
      requirements,
    };
  }

  if (!requirements.hasUppercase) {
    return {
      isValid: false,
      error: 'Falta una letra mayúscula (A-Z)',
      requirements,
    };
  }

  if (!requirements.hasNumber) {
    return {
      isValid: false,
      error: 'Falta agregar al menos un número (0-9)',
      requirements,
    };
  }

  if (!requirements.hasSpecialChar) {
    return {
      isValid: false,
      error: 'Falta agregar un carácter especial (ej: !@#$%^&*)',
      requirements,
    };
  }

  return {
    isValid: true,
    requirements,
  };
}

export function validatePasswordConfirm(password: string, confirm: string): ValidationResult {
  if (!confirm) {
    return { isValid: false, error: 'Repetí tu contraseña para confirmarla.' };
  }

  if (password !== confirm) {
    return { isValid: false, error: 'Las contraseñas no coinciden.' };
  }

  return { isValid: true };
}

export function validateEmail(email: string): ValidationResult {
  if (!email || !email.trim()) {
    return { isValid: false, error: 'El correo electrónico es obligatorio.' };
  }

  if (!REGEX_PATTERNS.EMAIL.test(email.trim())) {
    return { isValid: false, error: 'Ingresa un correo electrónico válido (ej: usuario@dominio.com).' };
  }

  return { isValid: true };
}

export function validateNombreApellido(val: string, fieldLabel = 'El nombre'): ValidationResult {
  if (!val || !val.trim()) {
    return { isValid: false, error: `${fieldLabel} es obligatorio.` };
  }

  const trimmed = val.trim();
  if (trimmed.length < 2) {
    return { isValid: false, error: `${fieldLabel} debe tener al menos 2 letras.` };
  }

  if (!REGEX_PATTERNS.PERSON_NAME.test(trimmed)) {
    return { isValid: false, error: `${fieldLabel} solo puede contener letras y espacios.` };
  }

  return { isValid: true };
}
