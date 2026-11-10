// src/hooks/useRegistrationForm.ts
// ─────────────────────────────────────────────────────────────────────────────
// Custom Hook para Validación de Formularios de Registro en Tiempo Real
// con Debounce y Sanitización Instantánea.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  validateDni,
  validateTelefono,
  validateFechaNacimiento,
  validatePassword,
  validatePasswordConfirm,
  validateEmail,
  validateNombreApellido,
  sanitizeDni,
  sanitizeTelefono,
  calcularEdad,
  type PasswordRequirements,
} from '../utils/validations';

export interface RegistrationFormValues {
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  telefono: string;
  fechaNacimiento: string;
  genero: string;
  direccion: string;
  password: string;
  confirmPassword: string;
}

export type RegistrationFormField = keyof RegistrationFormValues;

export type FormErrors = Partial<Record<RegistrationFormField, string>>;
export type FormTouched = Partial<Record<RegistrationFormField, boolean>>;

/** Campos que no pueden repetirse entre cuentas (se consultan en el servidor). */
export type CampoUnico = 'email' | 'dni' | 'telefono';
export type VerificarDisponibilidad = (
  datos: Partial<Record<CampoUnico, string>>,
) => Promise<Partial<Record<CampoUnico, string>>>;

interface UseRegistrationFormOptions {
  initialValues?: Partial<RegistrationFormValues>;
  debounceMs?: number;
  minAge?: number;
  onSubmit?: (values: RegistrationFormValues) => Promise<void> | void;
  /** Consulta si el correo, el DNI o el teléfono ya pertenecen a otra cuenta. */
  verificarDisponibilidad?: VerificarDisponibilidad;
}

const CAMPOS_UNICOS: CampoUnico[] = ['email', 'dni', 'telefono'];

const DEFAULT_INITIAL_VALUES: RegistrationFormValues = {
  nombre: '',
  apellido: '',
  email: '',
  dni: '',
  telefono: '',
  fechaNacimiento: '',
  // Opcionales: vacío significa "prefiero no decirlo" / sin dirección
  genero: '',
  direccion: '',
  password: '',
  confirmPassword: '',
};

export function useRegistrationForm(options: UseRegistrationFormOptions = {}) {
  const {
    initialValues = {},
    debounceMs = 300,
    minAge = 16,
    onSubmit,
    verificarDisponibilidad,
  } = options;
  const [verificando, setVerificando] = useState(false);

  // ── Estados Principales ───────────────────────────────────────────────────
  const [values, setValues] = useState<RegistrationFormValues>({
    ...DEFAULT_INITIAL_VALUES,
    ...initialValues,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<FormTouched>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Timers para Debounce por cada campo individual
  const timersRef = useRef<Record<string, any>>({});

  // ── Limpieza de timers al desmontar ───────────────────────────────────────
  useEffect(() => {
    const currentTimers = timersRef.current;
    return () => {
      Object.values(currentTimers).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  // ── Requisitos de Contraseña en Tiempo Real (Sincrónico para la UI) ──────
  const passwordRequirements: PasswordRequirements = useMemo(() => {
    return validatePassword(values.password).requirements;
  }, [values.password]);

  // ── Edad Calculada en Tiempo Real ─────────────────────────────────────────
  const edadCalculada = useMemo(() => {
    if (!values.fechaNacimiento) return null;
    const age = calcularEdad(values.fechaNacimiento);
    return age >= 0 ? age : null;
  }, [values.fechaNacimiento]);

  // ── Validador Unitario por Campo ──────────────────────────────────────────
  const validateField = useCallback(
    (field: RegistrationFormField, currentValues: RegistrationFormValues): string | undefined => {
      switch (field) {
        case 'dni': {
          const res = validateDni(currentValues.dni);
          return res.isValid ? undefined : res.error;
        }
        case 'telefono': {
          const res = validateTelefono(currentValues.telefono);
          return res.isValid ? undefined : res.error;
        }
        case 'fechaNacimiento': {
          const res = validateFechaNacimiento(currentValues.fechaNacimiento, minAge);
          return res.isValid ? undefined : res.error;
        }
        case 'password': {
          const res = validatePassword(currentValues.password);
          return res.isValid ? undefined : res.error;
        }
        case 'confirmPassword': {
          const res = validatePasswordConfirm(currentValues.password, currentValues.confirmPassword);
          return res.isValid ? undefined : res.error;
        }
        case 'email': {
          const res = validateEmail(currentValues.email);
          return res.isValid ? undefined : res.error;
        }
        case 'nombre': {
          const res = validateNombreApellido(currentValues.nombre, 'El nombre');
          return res.isValid ? undefined : res.error;
        }
        case 'apellido': {
          const res = validateNombreApellido(currentValues.apellido, 'El apellido');
          return res.isValid ? undefined : res.error;
        }
        default:
          return undefined;
      }
    },
    [minAge],
  );

  // ── Ejecutar Validación Inmediata de un Campo ─────────────────────────────
  const executeFieldValidation = useCallback(
    (field: RegistrationFormField, currentValues: RegistrationFormValues) => {
      const err = validateField(field, currentValues);
      setErrors((prev) => {
        if (prev[field] === err) return prev;
        return { ...prev, [field]: err };
      });
    },
    [validateField],
  );

  // ── Manejo de Cambio de Texto con Sanitización y Debounce ────────────────
  const handleChangeText = useCallback(
    (field: RegistrationFormField, rawText: string) => {
      let sanitizedText = rawText;

      // Sanitización estricta e instantánea según el tipo de dato
      if (field === 'dni') {
        sanitizedText = sanitizeDni(rawText);
      } else if (field === 'telefono') {
        sanitizedText = sanitizeTelefono(rawText);
      }

      const updatedValues = {
        ...values,
        [field]: sanitizedText,
      };

      setValues(updatedValues);
      setTouched((prev) => ({ ...prev, [field]: true }));

      // Cancelar timer de debounce previo para este campo
      if (timersRef.current[field]) {
        clearTimeout(timersRef.current[field]);
      }

      // Si el campo es password y ya se tocó confirmPassword, revalidar confirmación también
      if (field === 'password' && touched.confirmPassword) {
        if (timersRef.current.confirmPassword) {
          clearTimeout(timersRef.current.confirmPassword);
        }
        timersRef.current.confirmPassword = setTimeout(() => {
          executeFieldValidation('confirmPassword', updatedValues);
        }, debounceMs);
      }

      // Programar validación con debounce para este campo
      timersRef.current[field] = setTimeout(() => {
        executeFieldValidation(field, updatedValues);
      }, debounceMs);
    },
    [values, touched.confirmPassword, debounceMs, executeFieldValidation],
  );

  // ── Consulta al servidor si el dato ya pertenece a otra cuenta ────────────
  // Si el servidor no responde no se bloquea el registro: solo se pierde el aviso anticipado.
  const consultarDisponibilidad = useCallback(
    async (campos: CampoUnico[], currentValues: RegistrationFormValues): Promise<Partial<Record<CampoUnico, string>>> => {
      if (!verificarDisponibilidad) return {};
      const datos: Partial<Record<CampoUnico, string>> = {};
      campos.forEach((c) => {
        if (!validateField(c, currentValues)) datos[c] = currentValues[c].trim();
      });
      if (Object.keys(datos).length === 0) return {};
      try {
        setVerificando(true);
        const enUso = await verificarDisponibilidad(datos);
        setErrors((prev) => {
          const siguiente = { ...prev };
          (Object.keys(datos) as CampoUnico[]).forEach((c) => {
            if (enUso[c]) siguiente[c] = enUso[c];
          });
          return siguiente;
        });
        return enUso;
      } catch {
        return {};
      } finally {
        setVerificando(false);
      }
    },
    [verificarDisponibilidad, validateField],
  );

  // ── Manejo de Blur (Validación Inmediata al Perder el Foco) ───────────────
  const handleBlur = useCallback(
    (field: RegistrationFormField) => {
      setTouched((prev) => ({ ...prev, [field]: true }));

      if (timersRef.current[field]) {
        clearTimeout(timersRef.current[field]);
      }

      executeFieldValidation(field, values);
      if ((CAMPOS_UNICOS as string[]).includes(field)) {
        consultarDisponibilidad([field as CampoUnico], values);
      }
    },
    [executeFieldValidation, values, consultarDisponibilidad],
  );

  // ── Validación Completa del Formulario (Síncrona) ─────────────────────────
  const validateAll = useCallback((): boolean => {
    const fieldsToValidate: RegistrationFormField[] = [
      'nombre',
      'apellido',
      'email',
      'dni',
      'telefono',
      'fechaNacimiento',
      'password',
      'confirmPassword',
    ];

    const newErrors: FormErrors = {};
    const newTouched: FormTouched = {};
    let allValid = true;

    fieldsToValidate.forEach((f) => {
      newTouched[f] = true;
      const err = validateField(f, values);
      if (err) {
        newErrors[f] = err;
        allValid = false;
      }
    });

    setTouched((prev) => ({ ...prev, ...newTouched }));
    setErrors(newErrors);

    return allValid;
  }, [validateField, values]);

  // ── Cálculo Booleano del Estado Válido del Formulario ───────────────────────
  const isValid = useMemo(() => {
    const requiredFields: RegistrationFormField[] = [
      'nombre',
      'apellido',
      'email',
      'dni',
      'telefono',
      'fechaNacimiento',
      'password',
      'confirmPassword',
    ];

    // Verificar si algún campo requerido está vacío
    for (const f of requiredFields) {
      if (!values[f] || !values[f].trim()) {
        return false;
      }
    }

    // Verificar si hay algún error activo registrado
    for (const f of requiredFields) {
      if (errors[f]) {
        return false;
      }
    }

    // Doble verificación síncrona estricta de las reglas de negocio
    const dniOk = validateDni(values.dni).isValid;
    const telOk = validateTelefono(values.telefono).isValid;
    const dateOk = validateFechaNacimiento(values.fechaNacimiento, minAge).isValid;
    const passOk = validatePassword(values.password).isValid;
    const confOk = validatePasswordConfirm(values.password, values.confirmPassword).isValid;
    const mailOk = validateEmail(values.email).isValid;
    const nomOk = validateNombreApellido(values.nombre, 'El nombre').isValid;
    const apeOk = validateNombreApellido(values.apellido, 'El apellido').isValid;

    return dniOk && telOk && dateOk && passOk && confOk && mailOk && nomOk && apeOk;
  }, [values, errors, minAge]);

  // ── Handler de Envío ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!validateAll()) return;

    setIsSubmitting(true);
    try {
      // Última comprobación de correo, DNI y teléfono antes de crear la cuenta
      const enUso = await consultarDisponibilidad(CAMPOS_UNICOS, values);
      if (Object.values(enUso).some(Boolean)) return;
      if (onSubmit) await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  }, [validateAll, onSubmit, values, consultarDisponibilidad]);

  // ── Reiniciar Formulario ──────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    Object.values(timersRef.current).forEach((timer) => clearTimeout(timer));
    setValues({ ...DEFAULT_INITIAL_VALUES, ...initialValues });
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    isValid,
    isSubmitting,
    verificando,
    passwordRequirements,
    edadCalculada,
    handleChangeText,
    handleBlur,
    handleSubmit,
    validateAll,
    resetForm,
    setValues,
  };
}
