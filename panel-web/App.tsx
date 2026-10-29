// panel-web/App.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Panel Web Independiente de Supervisión y Monitoreo en Tiempo Real (CU-06 / CU-08)
// 
// Centro de operaciones para Autoridades Judiciales/Policiales y Administradores:
// 1. Monitoreo cartográfico en vivo de alertas SOS con telemetría continua (MapLibre GL).
// 2. Soporte nativo para Modo Oscuro y Modo Claro con diseño accesible WCAG AAA.
// 3. Sincronización en tiempo real vía Supabase Realtime Channels (PostgreSQL CDC).
// 4. Auditoría probatoria de la cadena de evidencias (AES-256-GCM + TSA RFC 3161).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import {
  Shield,
  Sun,
  Moon,
  LogOut,
  Radio,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  ChevronRight,
  ChevronLeft,
  X,
  Lock,
  Layers,
  FileText,
  Hash,
  ExternalLink,
  Users,
  UserPlus,
  UserCheck,
  UserX,
  Calendar,
  Filter,
  KeyRound,
  Building,
  Briefcase,
  Download,
  ShieldCheck,
  ShieldAlert,
  Info,
  Check,
  CreditCard,
  Mail,
  Phone,
  User,
  Play,
} from 'lucide-react';
import { supabase } from './src/lib/supabase';
import { MapViewComponent, type IncidentMarker } from './src/components/MapViewComponent';
import { palette, spacing, radii } from './src/theme/tokens';
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
} from './src/utils/validations';

const LOGO_SOURCE = require('./assets/logo.png');

export interface IncidenteItem {
  id: string;
  victima_id: string;
  victima_nombre?: string;
  direccion?: string;
  direccion_aprox?: string;
  latitud: number;
  longitud: number;
  origen: 'manual' | 'automatico' | string;
  estado: 'en_curso' | 'cerrado' | string;
  notas?: string;
  fecha_hora: string;
  last_location_at?: string;
  consentimiento_exportacion?: boolean;
  fecha_consentimiento?: string | null;
}

export interface EvidenciaItem {
  id: string;
  incidente_id: string;
  usuario_id: string;
  tipo_archivo: string;
  url_almacenamiento?: string | null;
  hash_sha256: string;
  firma_hardware: string;
  token_rfc3161: string | null;
  prev_hash: string | null;
  fecha_captura: string;
  metadata_dispositivo?: any;
  consentimiento_exportacion?: boolean;
  fecha_consentimiento?: string | null;
  bloqueado_sin_consentimiento?: boolean;
}

// ── Helpers de Formateo y Sincronización Segura de Datos ─────────────────────
export const formatEstado = (estado?: string): string => {
  if (!estado) return 'DESCONOCIDO';
  const clean = estado.replace(/_/g, ' ').toUpperCase();
  return clean === 'EN CURSO' ? 'EN CURSO' : clean;
};

export const formatOrigen = (origen?: string): string => {
  if (!origen) return 'Manual';
  const lower = origen.toLowerCase();
  if (lower === 'manual') return 'Manual';
  if (lower === 'automatico' || lower === 'acustico') return 'Acústico';
  return origen.charAt(0).toUpperCase() + origen.slice(1);
};

export const mergeIncidente = (oldInc: IncidenteItem, rawNew: any): IncidenteItem => {
  const newLat = rawNew.inc_latitud !== undefined ? rawNew.inc_latitud : rawNew.latitud;
  const newLng = rawNew.inc_longitud !== undefined ? rawNew.inc_longitud : rawNew.longitud;
  const newEstado = rawNew.inc_estado || rawNew.estado || oldInc.estado;
  const newOrigen = rawNew.inc_origen || rawNew.origen || oldInc.origen;
  const newDir = rawNew.inc_direccion || rawNew.direccion;
  const newDirAprox = rawNew.inc_direccion_aprox || rawNew.direccion_aprox;
  const newLastLoc = rawNew.inc_ultima_ubicacion_en || rawNew.inc_last_location_at || rawNew.last_location_at || oldInc.last_location_at;
  const newConsent =
    rawNew.inc_consentimiento_exportacion !== undefined
      ? Boolean(rawNew.inc_consentimiento_exportacion)
      : (rawNew.consentimiento_exportacion !== undefined
      ? Boolean(rawNew.consentimiento_exportacion)
      : oldInc.consentimiento_exportacion);
  const newFechaConsent =
    rawNew.inc_fecha_consentimiento !== undefined
      ? rawNew.inc_fecha_consentimiento
      : (rawNew.fecha_consentimiento !== undefined
      ? rawNew.fecha_consentimiento
      : oldInc.fecha_consentimiento);

  return {
    ...oldInc,
    ...rawNew,
    id: rawNew.inc_id_incidente || rawNew.id || oldInc.id,
    victima_id: rawNew.usu_id_victima || rawNew.victima_id || oldInc.victima_id,
    victima_nombre:
      rawNew.inc_victima_nombre && typeof rawNew.inc_victima_nombre === 'string' && rawNew.inc_victima_nombre.trim() !== ''
        ? rawNew.inc_victima_nombre
        : (rawNew.victima_nombre && typeof rawNew.victima_nombre === 'string' && rawNew.victima_nombre.trim() !== ''
        ? rawNew.victima_nombre
        : oldInc.victima_nombre),
    direccion:
      newDir && typeof newDir === 'string' && newDir.trim() !== ''
        ? newDir
        : (newDirAprox || oldInc.direccion),
    direccion_aprox:
      newDirAprox && typeof newDirAprox === 'string' && newDirAprox.trim() !== ''
        ? newDirAprox
        : oldInc.direccion_aprox,
    latitud: typeof newLat === 'number' ? newLat : (Number(newLat) || oldInc.latitud),
    longitud: typeof newLng === 'number' ? newLng : (Number(newLng) || oldInc.longitud),
    estado: newEstado,
    origen: newOrigen,
    last_location_at: newLastLoc,
    consentimiento_exportacion: newConsent,
    fecha_consentimiento: newFechaConsent,
  };
};

export default function App() {
  // ── 1. Tema Claro / Oscuro Persistente ───────────────────────────────────────
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('apoyar_web_theme');
      if (saved) return saved === 'dark';
    }
    return true; // Modo Oscuro por defecto (acorde a centros de monitoreo)
  });

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('apoyar_web_theme', next ? 'dark' : 'light');
      }
      return next;
    });
  }, []);

  const colors = useMemo(() => palette[isDark ? 'dark' : 'light'], [isDark]);

  // ── 2. Sesión y Autenticación ───────────────────────────────────────────────
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('Operador');

  // Estados de Visibilidad de Contraseñas ("Ojito")
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [showRecoveryConfirmPassword, setShowRecoveryConfirmPassword] = useState(false);
  const [showOperatorPassword, setShowOperatorPassword] = useState(false);

  // Estados de Bloqueo Temporal por Intentos Fallidos
  const [lockoutActive, setLockoutActive] = useState(false);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0);

  // Temporizador interactivo de cuenta regresiva para rehabilitación automática
  useEffect(() => {
    if (!lockoutActive || lockoutRemainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemainingSeconds((prev) => {
        if (prev <= 1) {
          setLockoutActive(false);
          setAuthError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutActive, lockoutRemainingSeconds]);

  // ── 3. Estado de Incidentes y Supervisión (Paginación de 10 en 10) ───────────
  const [incidentes, setIncidentes] = useState<IncidenteItem[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'en_curso' | 'cerrado'>('en_curso');
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [filtroFechaInicio, setFiltroFechaInicio] = useState(''); // YYYY-MM-DD
  const [filtroFechaFin, setFiltroFechaFin] = useState(''); // YYYY-MM-DD
  const [filtroCiudad, setFiltroCiudad] = useState(''); // Ciudad / Localidad
  const [filtroCalle, setFiltroCalle] = useState(''); // Calle / Barrio
  const [filtroNumero, setFiltroNumero] = useState(''); // Número / Altura
  const [mostrarFiltrosAvanzados, setMostrarFiltrosAvanzados] = useState(false);
  const [selectedIncidente, setSelectedIncidente] = useState<IncidenteItem | null>(null);

  const cantFiltrosAvanzadosActivos = useMemo(() => {
    let count = 0;
    if (filtroFechaInicio.trim()) count++;
    if (filtroFechaFin.trim()) count++;
    if (filtroCiudad.trim()) count++;
    if (filtroCalle.trim()) count++;
    if (filtroNumero.trim()) count++;
    return count;
  }, [filtroFechaInicio, filtroFechaFin, filtroCiudad, filtroCalle, filtroNumero]);

  const hayFiltrosAvanzadosActivos = cantFiltrosAvanzadosActivos > 0;

  const limpiarFiltrosAvanzados = useCallback(() => {
    setFiltroFechaInicio('');
    setFiltroFechaFin('');
    setFiltroCiudad('');
    setFiltroCalle('');
    setFiltroNumero('');
  }, []);

  const [loadingData, setLoadingData] = useState(false);
  const [incidentesPage, setIncidentesPage] = useState(1);
  const [incidentesTotalPages, setIncidentesTotalPages] = useState(1);
  const [incidentesTotalRegistros, setIncidentesTotalRegistros] = useState(0);

  // ── 4. Modal de Auditoría de Evidencias Forenses (Paginación de 10 en 10) ────
  const [showEvidenceAuditModal, setShowEvidenceAuditModal] = useState(false);
  const [evidenciasAudit, setEvidenciasAudit] = useState<EvidenciaItem[]>([]);
  const [loadingEvidencias, setLoadingEvidencias] = useState(false);
  const [exportingPackage, setExportingPackage] = useState(false);
  const [evidenciasPage, setEvidenciasPage] = useState(1);
  const [evidenciasTotalPages, setEvidenciasTotalPages] = useState(1);
  const [evidenciasTotalRegistros, setEvidenciasTotalRegistros] = useState(0);
  const [incidenteAuditadoConsentimiento, setIncidenteAuditadoConsentimiento] = useState<{
    consentimiento_exportacion: boolean;
    fecha_consentimiento: string | null;
  }>({ consentimiento_exportacion: false, fecha_consentimiento: null });

  // ── Reproducción y Desencriptación Forense en Vivo (CU-08 / Ley 25.326) ─────
  const [activeMediaUrl, setActiveMediaUrl] = useState<string | null>(null);
  const [activeReproduciendoEvidenciaId, setActiveReproduciendoEvidenciaId] = useState<string | null>(null);
  const [loadingMediaEvidenciaId, setLoadingMediaEvidenciaId] = useState<string | null>(null);

  // ── Sincronización Reactiva de selectedIncidente con el arreglo de incidentes ─
  useEffect(() => {
    if (!selectedIncidente?.id) return;
    const fresh = incidentes.find((i) => i.id === selectedIncidente.id);
    if (fresh) {
      if (
        fresh.estado !== selectedIncidente.estado ||
        fresh.latitud !== selectedIncidente.latitud ||
        fresh.longitud !== selectedIncidente.longitud ||
        fresh.direccion !== selectedIncidente.direccion ||
        fresh.direccion_aprox !== selectedIncidente.direccion_aprox ||
        fresh.victima_nombre !== selectedIncidente.victima_nombre ||
        fresh.consentimiento_exportacion !== selectedIncidente.consentimiento_exportacion ||
        fresh.fecha_consentimiento !== selectedIncidente.fecha_consentimiento
      ) {
        setSelectedIncidente(fresh);
        if (fresh.consentimiento_exportacion !== selectedIncidente.consentimiento_exportacion) {
          const nuevoConsent = Boolean(fresh.consentimiento_exportacion);
          setIncidenteAuditadoConsentimiento({
            consentimiento_exportacion: nuevoConsent,
            fecha_consentimiento: fresh.fecha_consentimiento || null,
          });
          if (!nuevoConsent) {
            if (activeMediaUrl) {
              URL.revokeObjectURL(activeMediaUrl);
            }
            setActiveMediaUrl(null);
            setActiveReproduciendoEvidenciaId(null);
            setEvidenciasAudit((prevEvs) =>
              prevEvs.map((e) => ({
                ...e,
                consentimiento_exportacion: false,
                bloqueado_sin_consentimiento: true,
                url_almacenamiento: null,
              }))
            );
          }
        }
      }
    }
  }, [incidentes, selectedIncidente, activeMediaUrl]);

  // ── 5. Modal de Confirmación Estilo SweetAlert2 y Sistema de Toasts ─────────
  interface ConfirmModalConfig {
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string | null;
    type?: 'warning' | 'danger' | 'info' | 'success';
    onConfirm: () => void;
  }
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig>({
    visible: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    type: 'warning',
    onConfirm: () => {},
  });

  const showConfirmDialog = useCallback((opts: Omit<ConfirmModalConfig, 'visible'>) => {
    setConfirmConfig({
      visible: true,
      confirmText: opts.confirmText || 'Confirmar',
      cancelText: opts.cancelText !== undefined ? opts.cancelText : 'Cancelar',
      type: opts.type || 'warning',
      title: opts.title,
      message: opts.message,
      onConfirm: opts.onConfirm,
    });
  }, []);

  // ── Sistema de Toast / HUD Flotante (Reemplazo moderno de alert nativo) ──────
  interface ToastConfig {
    id: string;
    title: string;
    message: string;
    type: 'success' | 'info' | 'warning' | 'error';
    duration?: number;
  }
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const toastTimerRef = useRef<any>(null);

  const showToast = useCallback(
    (
      title: string,
      message: string,
      type: 'success' | 'info' | 'warning' | 'error' = 'info',
      duration = 5000
    ) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      const id = Date.now().toString();
      setToast({ id, title, message, type, duration });
      if (duration > 0) {
        toastTimerRef.current = setTimeout(() => {
          setToast((curr) => (curr?.id === id ? null : curr));
        }, duration);
      }
    },
    []
  );

  const hideToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  // ── 6. Modal de Recuperación Gratuita de Contraseña Institucional ────────────
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [recoveryStep, setRecoveryStep] = useState<1 | 2>(1);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  // ── 7. Modal de Gestión de Operadores Institucionales (Sección 7.3) ────────
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [inactivosList, setInactivosList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [adminTab, setAdminTab] = useState<'activos' | 'inactivos' | 'crear'>('activos');

  // Paginación Operadores Activos e Inactivos (10 por página)
  const [operadoresPage, setOperadoresPage] = useState(1);
  const [operadoresTotalPages, setOperadoresTotalPages] = useState(1);
  const [operadoresTotalRegistros, setOperadoresTotalRegistros] = useState(0);

  const [inactivosPage, setInactivosPage] = useState(1);
  const [inactivosTotalPages, setInactivosTotalPages] = useState(1);
  const [inactivosTotalRegistros, setInactivosTotalRegistros] = useState(0);

  // Catálogos 3FN Formosa
  const [instituciones, setInstituciones] = useState<any[]>([]);
  const [dependencias, setDependencias] = useState<any[]>([]);
  const [sedes, setSedes] = useState<any[]>([]);
  const [cargos, setCargos] = useState<any[]>([]);

  // Selección de adscripción institucional para Autoridad
  const [selectedInstitucionId, setSelectedInstitucionId] = useState<number | null>(1);
  const [selectedDependenciaId, setSelectedDependenciaId] = useState<number | null>(103);
  const [selectedSedeId, setSelectedSedeId] = useState<number | null>(1004);
  const [selectedCargoId, setSelectedCargoId] = useState<number | null>(3);
  const [nuevoLegajo, setNuevoLegajo] = useState('');

  // Formulario nuevo operador / Vinculación
  const [searchCivilQuery, setSearchCivilQuery] = useState('');
  const [searchingCivil, setSearchingCivil] = useState(false);
  const [civilSearchResults, setCivilSearchResults] = useState<any[]>([]);
  const [selectedCivilUser, setSelectedCivilUser] = useState<any | null>(null);
  const [selectedRolesAlta, setSelectedRolesAlta] = useState<('Autoridad' | 'Administrador')[]>(['Autoridad']);

  const [nuevoEmail, setNuevoEmail] = useState('');
  const [nuevoPassword, setNuevoPassword] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoApellido, setNuevoApellido] = useState('');
  const [nuevoDni, setNuevoDni] = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [nuevoDireccion, setNuevoDireccion] = useState('');
  const [nuevoGenero, setNuevoGenero] = useState<'Femenino' | 'Masculino' | 'No binario'>('Femenino');
  const [nuevoFechaNac, setNuevoFechaNac] = useState('');
  const [nuevoNotas, setNuevoNotas] = useState('');
  const [creandoOperador, setCreandoOperador] = useState(false);
  const [mensajeOperador, setMensajeOperador] = useState<string | null>(null);

  // Modal para Agregar Rol Autoridad a Administrador existente
  const [showAddAutoridadModal, setShowAddAutoridadModal] = useState(false);
  const [targetAddRoleUser, setTargetAddRoleUser] = useState<any | null>(null);
  const [addAutoridadInstitucionId, setAddAutoridadInstitucionId] = useState<number | null>(1);
  const [addAutoridadDependenciaId, setAddAutoridadDependenciaId] = useState<number | null>(103);
  const [addAutoridadSedeId, setAddAutoridadSedeId] = useState<number | null>(1004);
  const [addAutoridadCargoId, setAddAutoridadCargoId] = useState<number | null>(3);
  const [addAutoridadLegajo, setAddAutoridadLegajo] = useState('');

  // Estados de Validación en Tiempo Real (Alta de Operador)
  const [operatorErrors, setOperatorErrors] = useState<{
    email?: string;
    password?: string;
    nombre?: string;
    apellido?: string;
    dni?: string;
    telefono?: string;
    fecha_nacimiento?: string;
  }>({});
  const [operatorTouched, setOperatorTouched] = useState<Record<string, boolean>>({});
  const operatorDebounceTimers = useRef<Record<string, any>>({});

  // Requisitos interactivos de contraseña calculados en tiempo real
  const operatorPasswordReqs = useMemo<PasswordRequirements>(() => {
    return validatePassword(nuevoPassword).requirements;
  }, [nuevoPassword]);

  // Edad calculada dinámicamente según la fecha de nacimiento
  const operatorEdadCalculada = useMemo<number | null>(() => {
    if (!nuevoFechaNac) return null;
    const age = calcularEdad(nuevoFechaNac);
    return age >= 0 ? age : null;
  }, [nuevoFechaNac]);

  // Función atómica de validación por campo
  const validateSingleField = useCallback((field: string, val: string) => {
    let err: string | undefined = undefined;
    switch (field) {
      case 'email': {
        const res = validateEmail(val);
        if (!res.isValid) err = res.error;
        break;
      }
      case 'password': {
        const res = validatePassword(val);
        if (!res.isValid) err = res.error;
        break;
      }
      case 'nombre': {
        const res = validateNombreApellido(val, 'El nombre');
        if (!res.isValid) err = res.error;
        break;
      }
      case 'apellido': {
        const res = validateNombreApellido(val, 'El apellido');
        if (!res.isValid) err = res.error;
        break;
      }
      case 'dni': {
        const res = validateDni(val);
        if (!res.isValid) err = res.error;
        break;
      }
      case 'telefono': {
        const res = validateTelefono(val);
        if (!res.isValid) err = res.error;
        break;
      }
      case 'fecha_nacimiento': {
        const res = validateFechaNacimiento(val, 18);
        if (!res.isValid) err = res.error;
        break;
      }
    }

    setOperatorErrors((prev) => {
      const next = { ...prev };
      if (err) {
        next[field as keyof typeof next] = err;
      } else {
        delete next[field as keyof typeof next];
      }
      return next;
    });
  }, []);

  // Manejador en tiempo real con sanitización inmediata y debounce de 300ms
  const handleOperatorChangeText = useCallback((field: string, text: string) => {
    let sanitized = text;
    if (field === 'dni') {
      sanitized = sanitizeDni(text);
      setNuevoDni(sanitized);
    } else if (field === 'telefono') {
      sanitized = sanitizeTelefono(text);
      setNuevoTelefono(sanitized);
    } else if (field === 'email') {
      setNuevoEmail(text);
    } else if (field === 'password') {
      setNuevoPassword(text);
    } else if (field === 'nombre') {
      setNuevoNombre(text);
    } else if (field === 'apellido') {
      setNuevoApellido(text);
    } else if (field === 'fecha_nacimiento') {
      setNuevoFechaNac(text);
    }

    setOperatorTouched((prev) => ({ ...prev, [field]: true }));

    if (operatorDebounceTimers.current[field]) {
      clearTimeout(operatorDebounceTimers.current[field]);
    }

    operatorDebounceTimers.current[field] = setTimeout(() => {
      validateSingleField(field, sanitized);
    }, 300);
  }, [validateSingleField]);

  // Manejador onBlur sin debounce (validación inmediata al salir)
  const handleOperatorBlur = useCallback((field: string, val: string) => {
    setOperatorTouched((prev) => ({ ...prev, [field]: true }));
    if (operatorDebounceTimers.current[field]) {
      clearTimeout(operatorDebounceTimers.current[field]);
    }
    validateSingleField(field, val);
  }, [validateSingleField]);

  // Validador global para habilitación condicional del botón Registrar
  const isOperadorFormValid = useMemo<boolean>(() => {
    if (selectedRolesAlta.length === 0) return false;
    const isPasswordValid = validatePassword(nuevoPassword).isValid;
    if (!isPasswordValid) return false;

    // Si no está vinculado un usuario civil existente, validar datos personales
    if (!selectedCivilUser) {
      const isEmailValid = validateEmail(nuevoEmail).isValid;
      const isNombreValid = validateNombreApellido(nuevoNombre, 'El nombre').isValid;
      const isApellidoValid = validateNombreApellido(nuevoApellido, 'El apellido').isValid;
      const isDniValid = validateDni(nuevoDni).isValid;
      const isTelValid = validateTelefono(nuevoTelefono).isValid;
      const isFechaValid = validateFechaNacimiento(nuevoFechaNac, 18).isValid;

      if (!isEmailValid || !isNombreValid || !isApellidoValid || !isDniValid || !isTelValid || !isFechaValid) {
        return false;
      }
    }

    if (selectedRolesAlta.includes('Autoridad')) {
      if (!selectedSedeId || !nuevoLegajo.trim()) {
        return false;
      }
    }

    return true;
  }, [
    selectedRolesAlta,
    nuevoPassword,
    selectedCivilUser,
    nuevoEmail,
    nuevoNombre,
    nuevoApellido,
    nuevoDni,
    nuevoTelefono,
    nuevoFechaNac,
    selectedSedeId,
    nuevoLegajo,
  ]);



  // ── Título de pestaña y Favicon con Logo Oficial ───────────────────────────
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = 'ApoyAR - Panel Web';
      let favicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
      if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        document.head.appendChild(favicon);
      }
      favicon.type = 'image/png';
      favicon.href = './assets/favicon.png';
    }
  }, []);

  // ── Limpieza e Inyección de Scrollbars Dinámicos en Modo Oscuro (Elimina barras blancas de Windows) ──
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'panel-web-custom-scrollbars';
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    const thumbColor = isDark ? '#334155' : '#cbd5e1';
    const thumbHover = isDark ? '#475569' : '#94a3b8';
    styleTag.innerHTML = `
      * {
        scrollbar-width: thin;
        scrollbar-color: ${thumbColor} transparent;
      }
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background-color: ${thumbColor};
        border-radius: 9999px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background-color: ${thumbHover};
      }
      .custom-dark-scrollbar {
        scrollbar-width: thin;
        scrollbar-color: ${thumbColor} transparent;
      }
    `;
  }, [isDark]);

  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';

  // Cargar Catálogos Institucionales 3FN
  const cargarCatalogosInstitucionales = useCallback(async () => {
    try {
      const [resInst, resDep, resSede, resCargos] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/instituciones`),
        fetch(`${apiBaseUrl}/api/v1/dependencias`),
        fetch(`${apiBaseUrl}/api/v1/sedes`),
        fetch(`${apiBaseUrl}/api/v1/cargos`),
      ]);
      if (resInst.ok) {
        const j = await resInst.json();
        if (j.instituciones) setInstituciones(j.instituciones);
      }
      if (resDep.ok) {
        const j = await resDep.json();
        if (j.dependencias) setDependencias(j.dependencias);
      }
      if (resSede.ok) {
        const j = await resSede.json();
        if (j.sedes) setSedes(j.sedes);
      }
      if (resCargos.ok) {
        const j = await resCargos.json();
        if (j.cargos) setCargos(j.cargos);
      }
    } catch (e) {
      console.warn('[PanelWeb] Error cargando catálogos:', e);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    cargarCatalogosInstitucionales();
  }, [cargarCatalogosInstitucionales]);

  // Consultar Operadores Activos o Inactivos con Paginación de 10 en 10
  const cargarUsuariosAdmin = useCallback(
    async (tab: 'activos' | 'inactivos' = adminTab === 'inactivos' ? 'inactivos' : 'activos', page?: number) => {
      if (!session) return;
      setLoadingUsers(true);
      const targetPage = page !== undefined ? page : (tab === 'activos' ? operadoresPage : inactivosPage);
      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/admin/usuarios?estado=${tab}&page=${targetPage}&limit=10`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (res.ok) {
          const json = await res.json();
          if (tab === 'activos') {
            setUsersList(json.usuarios_perfiles || []);
            setOperadoresPage(json.pagina_actual || 1);
            setOperadoresTotalPages(json.total_paginas || 1);
            setOperadoresTotalRegistros(json.total_registros || 0);
          } else {
            setInactivosList(json.usuarios_perfiles || []);
            setInactivosPage(json.pagina_actual || 1);
            setInactivosTotalPages(json.total_paginas || 1);
            setInactivosTotalRegistros(json.total_registros || 0);
          }
        }
      } catch (e) {
        console.error('[PanelWeb] Error consultando usuarios admin:', e);
      } finally {
        setLoadingUsers(false);
      }
    },
    [session, apiBaseUrl, adminTab, operadoresPage, inactivosPage]
  );

  // Búsqueda en vivo de usuarios civiles para vinculación
  const handleBuscarUsuariosCiviles = async (query: string) => {
    setSearchCivilQuery(query);
    if (!query || query.trim().length < 2) {
      setCivilSearchResults([]);
      return;
    }
    setSearchingCivil(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/admin/buscar-usuarios?q=${encodeURIComponent(query.trim())}`, {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });
      if (res.ok) {
        const j = await res.json();
        setCivilSearchResults(j.resultados || []);
      }
    } catch (e) {
      console.error('Error buscando usuarios:', e);
    } finally {
      setSearchingCivil(false);
    }
  };

  const handleSeleccionarCivil = (item: any) => {
    setSelectedCivilUser(item);
    setNuevoNombre(item.nombre || '');
    setNuevoApellido(item.apellido || '');
    setNuevoDni(item.dni || '');
    setNuevoEmail(item.email || '');
    setNuevoTelefono(item.telefono || '');
    setNuevoDireccion(item.direccion || '');
    setNuevoGenero(item.genero || 'Femenino');
    setNuevoFechaNac(item.fecha_nacimiento || '');
    setCivilSearchResults([]);
    setSearchCivilQuery('');
    setOperatorErrors({});
    setOperatorTouched({});
  };

  const handleDesvincularCivil = () => {
    setSelectedCivilUser(null);
    setNuevoNombre('');
    setNuevoApellido('');
    setNuevoDni('');
    setNuevoEmail('');
    setNuevoTelefono('');
    setNuevoDireccion('');
    setNuevoFechaNac('');
    setOperatorErrors({});
    setOperatorTouched({});
  };

  // Alta de Operador con Modal de Confirmación
  const handleCrearOperador = async () => {
    if (!isOperadorFormValid) {
      showToast('Validación Incompleta', 'Por favor complete todos los campos requeridos respetando las reglas de validación.', 'warning');
      return;
    }

    showConfirmDialog({
      title: 'Confirmar Alta Institucional',
      message: `Se registrará al operador con los roles: ${selectedRolesAlta.join(' y ')}. Recuerde que la asignación de roles es estrictamente auditable e irreversible. ¿Desea proceder?`,
      type: 'info',
      confirmText: 'Confirmar Alta',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        setCreandoOperador(true);
        setMensajeOperador(null);
        try {
          const payload: any = {
            usuario_id_existente: selectedCivilUser?.id || null,
            email: (selectedCivilUser?.email || nuevoEmail).trim().toLowerCase(),
            password: nuevoPassword,
            roles: selectedRolesAlta,
            rol: selectedRolesAlta[0],
            nombre: (selectedCivilUser?.nombre || nuevoNombre).trim(),
            apellido: (selectedCivilUser?.apellido || nuevoApellido).trim(),
            dni: (selectedCivilUser?.dni || nuevoDni).trim(),
            telefono: (selectedCivilUser?.telefono || nuevoTelefono).trim() || null,
            direccion: (selectedCivilUser?.direccion || nuevoDireccion).trim() || null,
            genero: selectedCivilUser?.genero || nuevoGenero,
            fecha_nacimiento: (selectedCivilUser?.fecha_nacimiento || nuevoFechaNac).trim() || null,
            notas: nuevoNotas.trim() || null,
          };

          if (selectedRolesAlta.includes('Autoridad')) {
            payload.id_institucion = selectedInstitucionId;
            payload.id_dependencia = selectedDependenciaId;
            payload.id_sede = selectedSedeId;
            payload.id_cargo = selectedCargoId;
            const cargoObj = cargos.find((c) => c.id_cargo === selectedCargoId);
            payload.nombre_cargo = cargoObj?.nombre_cargo || 'Oficial de Guardia en Comisaría';
            payload.legajo_o_matricula = nuevoLegajo.trim();
            payload.legajo_personal = nuevoLegajo.trim();
          }

          const res = await fetch(`${apiBaseUrl}/api/v1/admin/usuarios`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify(payload),
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.detail || 'Error creando operador institucional');
          }
          setMensajeOperador(`¡Operador registrado exitosamente con roles: ${selectedRolesAlta.join(', ')}!`);
          setNuevoEmail('');
          setNuevoPassword('');
          setNuevoNombre('');
          setNuevoApellido('');
          setNuevoDni('');
          setNuevoTelefono('');
          setNuevoDireccion('');
          setNuevoFechaNac('');
          setNuevoLegajo('');
          setNuevoNotas('');
          setSelectedCivilUser(null);
          setSearchCivilQuery('');
          setCivilSearchResults([]);
          setOperatorErrors({});
          setOperatorTouched({});
          cargarUsuariosAdmin('activos', 1);
          setTimeout(() => setAdminTab('activos'), 1800);
        } catch (err: any) {
          showToast('Error de Registro', err.message || 'Error registrando operador', 'error');
        } finally {
          setCreandoOperador(false);
        }
      },
    });
  };



  // Asignar rol Administrador con confirmación irreversible
  const handleAgregarRolAdmin = (usr: any) => {
    showConfirmDialog({
      title: 'Asignar Rol Administrador',
      message: `Atención: El rol Administrador asignado a ${usr.nombre} ${usr.apellido} no podrá revocarse posteriormente por razones de trazabilidad y auditoría. ¿Desea continuar?`,
      type: 'warning',
      confirmText: 'Sí, Asignar Rol',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/v1/admin/usuarios/${usr.usuario_id}/agregar-rol`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ rol: 'Administrador' }),
          });
          const j = await res.json();
          if (!res.ok) {
            throw new Error(j.detail || 'Error asignando rol Administrador');
          }
          showToast('Rol Asignado', 'Rol Administrador asignado exitosamente.', 'success');
          cargarUsuariosAdmin('activos');
        } catch (err: any) {
          showToast('Error de Asignación', err.message || 'Error asignando rol', 'error');
        }
      },
    });
  };

  // Asignar rol Autoridad desde modal con confirmación
  const handleConfirmarAgregarAutoridad = async () => {
    if (!targetAddRoleUser) return;
    if (!addAutoridadSedeId) {
      showToast('Sede Requerida', 'Debe seleccionar una Sede física para el rol Autoridad.', 'warning');
      return;
    }
    if (!addAutoridadLegajo.trim()) {
      showToast('Legajo Obligatorio', 'El legajo o matrícula es obligatorio y debe ser único.', 'warning');
      return;
    }

    showConfirmDialog({
      title: 'Asignar Rol Autoridad Judicial / Policial',
      message: `Atención: El rol Autoridad asignado a ${targetAddRoleUser.nombre} ${targetAddRoleUser.apellido} no podrá revocarse posteriormente por razones de trazabilidad y auditoría. ¿Desea continuar?`,
      type: 'warning',
      confirmText: 'Sí, Asignar Rol',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/v1/admin/usuarios/${targetAddRoleUser.usuario_id}/agregar-rol`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({
              rol: 'Autoridad',
              id_institucion: addAutoridadInstitucionId,
              id_dependencia: addAutoridadDependenciaId,
              id_sede: addAutoridadSedeId,
              id_cargo: addAutoridadCargoId,
              legajo_o_matricula: addAutoridadLegajo.trim(),
            }),
          });
          const j = await res.json();
          if (!res.ok) {
            throw new Error(j.detail || 'Error asignando rol Autoridad');
          }
          setShowAddAutoridadModal(false);
          setTargetAddRoleUser(null);
          setAddAutoridadLegajo('');
          showToast('Rol Asignado', 'Rol Autoridad asignado exitosamente con adscripción institucional 3FN.', 'success');
          cargarUsuariosAdmin('activos');
        } catch (err: any) {
          showToast('Error de Asignación', err.message || 'Error asignando rol', 'error');
        }
      },
    });
  };

  // Suspender operador con confirmación
  const handleConfirmarSuspension = (usr: any) => {
    showConfirmDialog({
      title: 'Suspender Operador Institucional',
      message: `¿Está seguro de suspender a ${usr.nombre} ${usr.apellido}? Se revocará inmediatamente su acceso al Panel Web sin afectar su cuenta civil en la App Móvil.`,
      type: 'danger',
      confirmText: 'Sí, Suspender',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/v1/admin/usuarios/${usr.usuario_id}/suspender`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ motivo: 'Suspensión preventiva por Administrador' }),
          });
          if (!res.ok) {
            const j = await res.json();
            throw new Error(j.detail || 'Error suspendiendo operador');
          }
          cargarUsuariosAdmin('activos');
        } catch (err: any) {
          showToast('Error de Suspensión', err.message || 'Error suspendiendo operador', 'error');
        }
      },
    });
  };

  // Reactivar operador con confirmación
  const handleConfirmarReactivacion = (usr: any) => {
    showConfirmDialog({
      title: 'Reactivar Operador Institucional',
      message: `¿Desea reactivar a ${usr.nombre} ${usr.apellido}? Recuperará el acceso institucional al Panel Web con sus roles y adscripciones previas.`,
      type: 'info',
      confirmText: 'Sí, Reactivar',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          const res = await fetch(`${apiBaseUrl}/api/v1/admin/usuarios/${usr.usuario_id}/reactivar`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token}`,
            },
          });
          if (!res.ok) {
            const j = await res.json();
            throw new Error(j.detail || 'Error reactivando operador');
          }
          cargarUsuariosAdmin('inactivos');
        } catch (err: any) {
          showToast('Error de Reactivación', err.message || 'Error reactivando operador', 'error');
        }
      },
    });
  };

  // Recuperación de Contraseña Institucional (100% Gratis)
  const recoveryPasswordReqs = useMemo<PasswordRequirements>(() => {
    return validatePassword(recoveryNewPassword).requirements;
  }, [recoveryNewPassword]);

  const handleSolicitarRecuperacion = async () => {
    if (!recoveryEmail.trim()) {
      setRecoveryError('Por favor ingrese su correo electrónico institucional.');
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError(null);
    setRecoverySuccess(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/auth/recuperar-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail.trim(), contexto: 'panel_web' }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j.detail || 'Error solicitando código de recuperación');
      }
      setRecoverySuccess(j.mensaje || 'Si el correo está registrado, recibirás un código de 6 dígitos.');
      setRecoveryStep(2);
    } catch (err: any) {
      setRecoveryError(err.message || 'Error solicitando recuperación');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleConfirmarRecuperacion = async () => {
    const passVal = validatePassword(recoveryNewPassword);
    if (!passVal.isValid) {
      setRecoveryError(passVal.error || 'La contraseña no cumple con los requisitos de seguridad.');
      return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setRecoveryError('Las contraseñas no coinciden.');
      return;
    }
    if (!recoveryCode.trim() || recoveryCode.trim().length < 6) {
      setRecoveryError('El código de verificación debe tener 6 dígitos.');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError(null);
    setRecoverySuccess(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/auth/confirmar-recuperacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: recoveryEmail.trim(),
          codigo: recoveryCode.trim(),
          token_o_codigo: recoveryCode.trim(),
          nueva_password: recoveryNewPassword,
          contexto: 'panel_web',
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j.detail || 'Error confirmando cambio de contraseña');
      }
      setRecoverySuccess('¡Contraseña restablecida con éxito! Ya puede iniciar sesión con su nueva credencial.');
      setTimeout(() => {
        setEmail(recoveryEmail.trim());
        setShowRecoveryModal(false);
        setRecoveryEmail('');
        setRecoveryCode('');
        setRecoveryNewPassword('');
        setRecoveryConfirmPassword('');
        setRecoveryStep(1);
        setRecoverySuccess(null);
      }, 2000);
    } catch (err: any) {
      setRecoveryError(err.message || 'Error al restablecer contraseña');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Consultar perfil/rol autenticado (vía backend con verificación RBAC o fallback)
  const verificarRolUsuario = async (userId: string, token?: string, email?: string) => {
    try {
      // 1. Intentar endpoint seguro del backend
      if (token) {
        try {
          const res = await fetch(`${apiBaseUrl}/api/v1/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const profile = await res.json();
            const roles: string[] = profile.roles || [];
            if (roles.includes('Administrador')) {
              setUserRole('Administrador del Sistema');
              return;
            } else if (roles.includes('Autoridad')) {
              setUserRole('Autoridad Judicial / Policial');
              return;
            }
          }
        } catch (_) { }
      }

      // 2. Consulta directa a tabla usuario_tiene_perfil
      const { data } = await supabase
        .from('usuario_tiene_perfil')
        .select('perfil(prf_nombre, nombre)')
        .eq('usu_id_usuario', userId);

      if (data && data.length > 0) {
        const nombres = data
          .map((d: any) => d.perfil?.prf_nombre || d.perfil?.nombre)
          .filter(Boolean);
        if (nombres.includes('Administrador') || nombres.includes('Administrativo')) {
          setUserRole('Administrador del Sistema');
          return;
        } else if (nombres.includes('Autoridad')) {
          setUserRole('Autoridad Judicial / Policial');
          return;
        }
      }

      // 3. Heurística de fallback por correo de administración
      if (email && email.toLowerCase().includes('admin')) {
        setUserRole('Administrador del Sistema');
        return;
      }

      setUserRole('Operador Autorizado');
    } catch (_) {
      setUserRole('Operador');
    }
  };

  // Escuchar sesión de Supabase Auth
  useEffect(() => {
    // 1. Restaurar sesión institucional de respaldo desde localStorage si existe
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedInstSession = window.localStorage.getItem('apoyar_institutional_session');
      if (savedInstSession) {
        try {
          const parsed = JSON.parse(savedInstSession);
          if (parsed && parsed.access_token) {
            setSession(parsed);
            const savedRole = window.localStorage.getItem('apoyar_user_role');
            if (savedRole) {
              setUserRole(savedRole);
            }
          }
        } catch (_) {}
      }
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (currentSession?.user) {
        setSession((prev: any) => prev || currentSession);
        verificarRolUsuario(currentSession.user.id, currentSession.access_token, currentSession.user.email);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (currentSession?.user) {
        setSession((prev: any) => prev || currentSession);
        verificarRolUsuario(currentSession.user.id, currentSession.access_token, currentSession.user.email);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Cargar incidentes con Paginación Estricta de 10 en 10
  const cargarIncidentes = useCallback(
    async (page: number = incidentesPage) => {
      if (!session) return;
      try {
        // 1. Intentar endpoint seguro de backend con privilegios y paginación
        const res = await fetch(`${apiBaseUrl}/api/v1/autoridad/incidentes?estado=${filtroEstado}&page=${page}&limit=10`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.incidentes)) {
            setIncidentes(json.incidentes as IncidenteItem[]);
            setIncidentesPage(json.pagina_actual || page);
            setIncidentesTotalPages(json.total_paginas || 1);
            setIncidentesTotalRegistros(json.total_registros || 0);
            return;
          }
        }

        // 2. Fallback directo a Supabase con .range(from, to)
        const fromOffset = (page - 1) * 10;
        const toOffset = fromOffset + 9;
        let query = supabase
          .from('incidente')
          .select(
            `
            inc_id_incidente,
            usu_id_victima,
            inc_victima_nombre,
            inc_direccion,
            inc_direccion_aprox,
            inc_latitud,
            inc_longitud,
            inc_origen,
            inc_estado,
            inc_notas,
            inc_fecha_hora,
            inc_ultima_ubicacion_en,
            inc_consentimiento_exportacion,
            inc_fecha_consentimiento
          `,
            { count: 'exact' }
          )
          .order('inc_fecha_hora', { ascending: false })
          .range(fromOffset, toOffset);

        if (filtroEstado !== 'todos') {
          query = query.eq('inc_estado', filtroEstado);
        }

        const { data, count, error } = await query;
        if (error) throw error;
        const mappedData: IncidenteItem[] = ((data as any[]) || []).map((row: any) => ({
          ...row,
          id: row.inc_id_incidente ?? row.id,
          victima_id: row.usu_id_victima ?? row.victima_id,
          victima_nombre: row.inc_victima_nombre ?? row.victima_nombre,
          direccion: row.inc_direccion ?? row.direccion,
          direccion_aprox: row.inc_direccion_aprox ?? row.direccion_aprox,
          latitud: Number(row.inc_latitud ?? row.latitud),
          longitud: Number(row.inc_longitud ?? row.longitud),
          origen: row.inc_origen ?? row.origen,
          estado: row.inc_estado ?? row.estado,
          notas: row.inc_notas ?? row.notas,
          fecha_hora: row.inc_fecha_hora ?? row.fecha_hora,
          last_location_at: row.inc_ultima_ubicacion_en ?? row.inc_last_location_at ?? row.last_location_at,
          consentimiento_exportacion: row.inc_consentimiento_exportacion ?? row.consentimiento_exportacion,
          fecha_consentimiento: row.inc_fecha_consentimiento ?? row.fecha_consentimiento,
        }));
        setIncidentes(mappedData);
        if (count !== null) {
          setIncidentesTotalRegistros(count);
          setIncidentesTotalPages(Math.max(1, Math.ceil(count / 10)));
        }
      } catch (err: any) {
        console.error('[PanelWeb] Error consultando incidentes:', err.message);
      } finally {
        setLoadingData(false);
      }
    },
    [session, filtroEstado, apiBaseUrl, incidentesPage]
  );

  useEffect(() => {
    if (session) {
      setLoadingData(true);
      cargarIncidentes();
    }
  }, [session, cargarIncidentes]);

  // Polling de respaldo periódico (cada 30s) para asegurar sincronía en caso de pérdida de sockets
  useEffect(() => {
    if (!session) return;
    if (incidentesPage !== 1) return;
    const interval = setInterval(() => {
      cargarIncidentes(1);
    }, 30000);

    return () => clearInterval(interval);
  }, [session, incidentesPage, cargarIncidentes]);

  // Sincronización en tiempo real vía Supabase Realtime Channels (PostgreSQL CDC)
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel('incidentes_panel_web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidente' }, (payload) => {
        console.log('[Realtime] Evento detectado en incidente:', payload.eventType);

        // Actualización reactiva inmediata en memoria de coordenadas y estado
        if (payload.eventType === 'UPDATE' && payload.new) {
          const raw = payload.new;
          const rawId = raw.inc_id_incidente || raw.id;
          setIncidentes((prev) =>
            prev.map((inc) => (inc.id === rawId ? mergeIncidente(inc, raw) : inc))
          );
          setSelectedIncidente((prev) =>
            prev && prev.id === rawId ? mergeIncidente(prev, raw) : prev
          );

          // Si el incidente modificado corresponde al actualmente auditado en el modal:
          if (rawId === selectedIncidente?.id) {
            const nuevoConsent = Boolean(raw.inc_consentimiento_exportacion ?? raw.consentimiento_exportacion);
            setIncidenteAuditadoConsentimiento({
              consentimiento_exportacion: nuevoConsent,
              fecha_consentimiento: raw.inc_fecha_consentimiento || raw.fecha_consentimiento || null,
            });
            if (!nuevoConsent) {
              if (activeMediaUrl) {
                URL.revokeObjectURL(activeMediaUrl);
              }
              setActiveMediaUrl(null);
              setActiveReproduciendoEvidenciaId(null);
              setEvidenciasAudit((prevEvs) =>
                prevEvs.map((e) => ({
                  ...e,
                  consentimiento_exportacion: false,
                  bloqueado_sin_consentimiento: true,
                  url_almacenamiento: null,
                }))
              );
            }
          }
        } else if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
          // Solo recargar la primera página si ingresa un nuevo incidente o se elimina
          if (incidentesPage === 1) {
            cargarIncidentes(1);
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'evidencia' }, (payload) => {
        if (payload.eventType === 'UPDATE' && payload.new) {
          const rawEv = payload.new;
          const rawEvId = rawEv.evi_id_evidencia || rawEv.id;
          setEvidenciasAudit((prevEvs) =>
            prevEvs.map((e) => {
              if (e.id === rawEvId) {
                const itemConsent = Boolean(rawEv.evi_consentimiento_exportacion ?? rawEv.consentimiento_exportacion);
                if (!itemConsent && activeReproduciendoEvidenciaId === e.id) {
                  if (activeMediaUrl) {
                    URL.revokeObjectURL(activeMediaUrl);
                  }
                  setActiveMediaUrl(null);
                  setActiveReproduciendoEvidenciaId(null);
                }
                return {
                  ...e,
                  consentimiento_exportacion: itemConsent,
                  bloqueado_sin_consentimiento: !itemConsent,
                  url_almacenamiento: itemConsent ? (rawEv.evi_url_almacenamiento || rawEv.url_almacenamiento || e.url_almacenamiento) : null,
                  fecha_consentimiento: rawEv.evi_fecha_consentimiento || rawEv.fecha_consentimiento || null,
                };
              }
              return e;
            })
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, incidentesPage, cargarIncidentes, selectedIncidente?.id, activeMediaUrl, activeReproduciendoEvidenciaId]);

  // Inicio de Sesión Institucional (Verifica password_institucional_hash con protección contra fuerza bruta)
  const handleLogin = async () => {
    if (authLoading || lockoutActive) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/auth/login-institucional`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 || json.bloqueado) {
          const segs = json.segundos_restantes || 900;
          setLockoutRemainingSeconds(segs);
          setLockoutActive(true);
          const min = Math.floor(segs / 60);
          const s = segs % 60;
          const tiempoStr = min > 0 ? `${min} min ${s} s` : `${s} s`;
          setAuthError(`Demasiados intentos fallidos (3). Cuenta bloqueada temporalmente por 15 minutos. Tiempo restante: ${tiempoStr}.`);
          return;
        }
        throw new Error(json.detail || 'Credenciales inválidas o acceso no autorizado.');
      }

      setLockoutActive(false);
      setLockoutRemainingSeconds(0);

      const localSession = {
        access_token: json.access_token,
        token_type: json.token_type || 'bearer',
        user: json.usuario || json.user,
        roles: json.roles || [],
      };
      setSession(localSession);

      const roles: string[] = json.roles || [];
      const computedRole = roles.includes('Administrador')
        ? 'Administrador del Sistema'
        : roles.includes('Autoridad')
        ? 'Autoridad Judicial / Policial'
        : 'Operador Institucional';
      setUserRole(computedRole);

      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('apoyar_institutional_session', JSON.stringify(localSession));
        window.localStorage.setItem('apoyar_user_role', computedRole);
      }

      try {
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
      } catch (_) {}
    } catch (err: any) {
      setAuthError(err.message || 'Credenciales inválidas o acceso no autorizado.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('apoyar_institutional_session');
      window.localStorage.removeItem('apoyar_user_role');
    }
    await supabase.auth.signOut();
    setSession(null);
    setIncidentes([]);
    setSelectedIncidente(null);
  };

  // Cambiar estado de incidente (ej: Cerrar / Reabrir)
  const handleCambiarEstado = async (incidente: IncidenteItem, nuevoEstado: 'en_curso' | 'cerrado') => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/incidentes/${incidente.id}/estado`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          estado: nuevoEstado,
          notas: `Actualizado a ${nuevoEstado} desde Consola Web por ${userRole}`,
        }),
      });

      if (!res.ok) {
        const { error } = await supabase
          .from('incidente')
          .update({ inc_estado: nuevoEstado })
          .eq('inc_id_incidente', incidente.id);

        if (error) throw error;
      }

      setIncidentes((prev) =>
        prev.map((i) => (i.id === incidente.id ? { ...i, estado: nuevoEstado } : i))
      );
      if (selectedIncidente?.id === incidente.id) {
        setSelectedIncidente({ ...selectedIncidente, estado: nuevoEstado });
      }
    } catch (err: any) {
      showToast('Error al Actualizar Estado', `Error al actualizar estado: ${err.message}`, 'error');
    }
  };

  const handleCerrarReproductor = useCallback(() => {
    if (activeMediaUrl) {
      URL.revokeObjectURL(activeMediaUrl);
    }
    setActiveMediaUrl(null);
    setActiveReproduciendoEvidenciaId(null);
  }, [activeMediaUrl]);

  const handleReproducirEvidenciaForense = async (ev: EvidenciaItem) => {
    const tieneConsent = Boolean(
      incidenteAuditadoConsentimiento.consentimiento_exportacion &&
      (selectedIncidente ? selectedIncidente.consentimiento_exportacion !== false : true) &&
      ev.consentimiento_exportacion !== false &&
      !ev.bloqueado_sin_consentimiento &&
      ev.url_almacenamiento
    );
    if (!tieneConsent) {
      showConfirmDialog({
        title: 'Consentimiento Requerido',
        message: 'Acceso denegado: Se requiere el consentimiento informado expreso de la víctima/testigo para reproducir o previsualizar esta evidencia (Ley 25.326 / ISO 27037).',
        type: 'warning',
        confirmText: 'Entendido',
        cancelText: null,
        onConfirm: () => {},
      });
      return;
    }
    try {
      setLoadingMediaEvidenciaId(ev.id);
      if (activeMediaUrl) {
        URL.revokeObjectURL(activeMediaUrl);
        setActiveMediaUrl(null);
      }
      const sessionData = (await supabase.auth.getSession()).data.session;
      const token = sessionData?.access_token;
      const res = await fetch(`${apiBaseUrl}/api/v1/evidencias/${ev.id}/reproducir`, {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = errorText;
        try {
          const parsed = JSON.parse(errorText);
          errorMsg = parsed.detail || parsed.message || errorText;
        } catch { }
        showToast('Error de Reproducción', `No se pudo reproducir la prueba forense: ${errorMsg}`, 'error');
        return;
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setActiveMediaUrl(objectUrl);
      setActiveReproduciendoEvidenciaId(ev.id);
    } catch (err: any) {
      showToast('Error de Comunicación', `Error de comunicación con el servicio forense: ${err.message}`, 'error');
    } finally {
      setLoadingMediaEvidenciaId(null);
    }
  };

  // Consultar evidencias forenses del incidente seleccionado con Paginación de 10 en 10
  const handleAbrirAuditoria = async (incidente: IncidenteItem, page: number = 1) => {
    handleCerrarReproductor();
    setShowEvidenceAuditModal(true);
    setLoadingEvidencias(true);
    const incConsent = Boolean(incidente.consentimiento_exportacion);
    setIncidenteAuditadoConsentimiento({
      consentimiento_exportacion: incConsent,
      fecha_consentimiento: incidente.fecha_consentimiento || null,
    });
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/evidencias/incidente/${incidente.id}?page=${page}&limit=10`, {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.evidencias)) {
          setEvidenciasAudit(json.evidencias as EvidenciaItem[]);
          setEvidenciasPage(json.pagina_actual || page);
          setEvidenciasTotalPages(json.total_paginas || 1);
          setEvidenciasTotalRegistros(json.total_registros || 0);
          if (json.consentimiento_exportacion !== undefined) {
            setIncidenteAuditadoConsentimiento({
              consentimiento_exportacion: Boolean(json.consentimiento_exportacion),
              fecha_consentimiento: json.fecha_consentimiento || null,
            });
          }
          return;
        }
      }

      const fromOffset = (page - 1) * 10;
      const toOffset = fromOffset + 9;
      const { data, count, error } = await supabase
        .from('evidencia')
        .select('*', { count: 'exact' })
        .eq('inc_id_incidente', incidente.id)
        .order('evi_fecha_captura', { ascending: true })
        .range(fromOffset, toOffset);

      if (error) throw error;
      const safeEvidencias = ((data as any[]) || []).map((rawE: any) => {
        const e: EvidenciaItem = {
          id: rawE.evi_id_evidencia ?? rawE.id,
          incidente_id: rawE.inc_id_incidente ?? rawE.incidente_id,
          usuario_id: rawE.usu_id_usuario ?? rawE.usuario_id,
          tipo_archivo: rawE.evi_tipo_archivo ?? rawE.tipo_archivo,
          url_almacenamiento: rawE.evi_url_almacenamiento ?? rawE.url_almacenamiento,
          hash_sha256: rawE.evi_hash_sha256 ?? rawE.hash_sha256,
          firma_hardware: rawE.evi_firma_hardware ?? rawE.firma_hardware,
          token_rfc3161: rawE.evi_token_rfc3161 ?? rawE.token_rfc3161 ?? null,
          prev_hash: rawE.evi_prev_hash ?? rawE.prev_hash ?? null,
          fecha_captura: rawE.evi_fecha_captura ?? rawE.fecha_captura,
          metadata_dispositivo: rawE.evi_metadata_dispositivo ?? rawE.metadata_dispositivo,
          consentimiento_exportacion: rawE.evi_consentimiento_exportacion ?? rawE.consentimiento_exportacion,
          fecha_consentimiento: rawE.evi_fecha_consentimiento ?? rawE.fecha_consentimiento ?? null,
        };
        const itemConsent = incConsent && Boolean(e.consentimiento_exportacion);
        return {
          ...e,
          consentimiento_exportacion: itemConsent,
          bloqueado_sin_consentimiento: !itemConsent,
          url_almacenamiento: itemConsent ? e.url_almacenamiento : null,
        };
      });
      setEvidenciasAudit(safeEvidencias);
      if (count !== null) {
        setEvidenciasTotalRegistros(count);
        setEvidenciasTotalPages(Math.max(1, Math.ceil(count / 10)));
      }
    } catch (err: any) {
      console.error('[PanelWeb] Error consultando evidencias:', err);
    } finally {
      setLoadingEvidencias(false);
    }
  };

  // Exportar Paquete Probatorio con Modal de Confirmación
  const handleExportarDocumentoPrueba = async (incidente: IncidenteItem) => {
    const tieneConsent = Boolean(
      incidenteAuditadoConsentimiento.consentimiento_exportacion &&
      (selectedIncidente ? selectedIncidente.consentimiento_exportacion !== false : true)
    );

    if (!tieneConsent) {
      showConfirmDialog({
        title: 'Consentimiento Requerido',
        message: 'Acceso denegado: Se requiere el consentimiento informado expreso de la víctima/testigo desde la App ApoyAR para exportar el Documento de Prueba Digital (Ley 25.326 / ISO 27037).',
        type: 'warning',
        confirmText: 'Entendido',
        cancelText: null,
        onConfirm: () => {},
      });
      return;
    }

    showConfirmDialog({
      title: 'Exportar Paquete Probatorio Pericial',
      message: 'Atención: La exportación del paquete forense (ISO/IEC 27037:2012 / Ley 25.326) generará un registro inmutable en el libro de Reporte Judicial. ¿Desea continuar?',
      type: 'info',
      confirmText: 'Exportar Paquete',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        setExportingPackage(true);
        try {
          const downloadUrl = `${apiBaseUrl}/api/v1/evidencias/incidente/${incidente.id}/exportar?token=${encodeURIComponent(session?.access_token || '')}&origen_exportacion=autoridad`;
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.setAttribute('download', `Expediente_Forense_ApoyAR_${incidente.id.slice(0, 8)}.zip`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          showToast(
            'Descarga de Expediente Forense',
            'Iniciando descarga directa del archivo ZIP con su Acta Oficial de Cadena de Custodia. El acceso ha quedado registrado en auditoría judicial.',
            'success',
            6000
          );
        } catch (err: any) {
          console.error('[PanelWeb] Error exportando paquete:', err);
          showToast(
            'Error al Exportar Expediente',
            `No se pudo exportar el paquete: ${err.message}`,
            'error',
            7000
          );
        } finally {
          setExportingPackage(false);
        }
      },
    });
  };

  // Filtrado reactivo en sidebar por persona, rango de fechas y desglose de ubicación
  const incidentesFiltrados = useMemo(() => {
    const normalizar = (s: string | undefined | null) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    return incidentes.filter((inc) => {
      const dirTotal = normalizar(`${inc.direccion || ''} ${inc.direccion_aprox || ''}`);

      // 1. Búsqueda libre: persona involucrada, calle, barrio o ciudad
      if (busquedaTexto.trim()) {
        const query = normalizar(busquedaTexto);
        const personaMatch = normalizar(inc.victima_nombre).includes(query);
        const dirMatch = dirTotal.includes(query);
        if (!personaMatch && !dirMatch) return false;
      }

      // 2. Filtro por Rango de Fechas (Desde 00:00:00 hasta 23:59:59)
      if (filtroFechaInicio.trim() || filtroFechaFin.trim()) {
        const tInc = new Date(inc.fecha_hora).getTime();
        if (filtroFechaInicio.trim()) {
          const tInicio = new Date(`${filtroFechaInicio.trim()}T00:00:00`).getTime();
          if (!isNaN(tInicio) && tInc < tInicio) return false;
        }
        if (filtroFechaFin.trim()) {
          const tFin = new Date(`${filtroFechaFin.trim()}T23:59:59.999`).getTime();
          if (!isNaN(tFin) && tInc > tFin) return false;
        }
      }

      // 3. Filtro por Ciudad / Localidad
      if (filtroCiudad.trim()) {
        const qCiudad = normalizar(filtroCiudad);
        if (!dirTotal.includes(qCiudad)) return false;
      }

      // 4. Filtro por Calle / Barrio
      if (filtroCalle.trim()) {
        const qCalle = normalizar(filtroCalle);
        if (!dirTotal.includes(qCalle)) return false;
      }

      // 5. Filtro por Número / Altura
      if (filtroNumero.trim()) {
        const qNumero = normalizar(filtroNumero);
        if (!dirTotal.includes(qNumero)) return false;
      }

      return true;
    });
  }, [incidentes, busquedaTexto, filtroFechaInicio, filtroFechaFin, filtroCiudad, filtroCalle, filtroNumero]);

  // Marcadores interactivos para MapViewComponent (sincronizados con los filtros activos)
  const mapMarkers: IncidentMarker[] = useMemo(() => {
    return incidentesFiltrados
      .filter((inc) => inc.latitud && inc.longitud)
      .map((inc) => ({
        id: inc.id,
        lat: Number(inc.latitud),
        lng: Number(inc.longitud),
        title: `${inc.origen === 'manual' ? 'SOS Manual' : 'Detección Acústica'} • ${inc.victima_nombre || 'Persona'}`,
        estado: inc.estado,
        direccion: inc.direccion || inc.direccion_aprox,
        origen: inc.origen,
        victimaNombre: inc.victima_nombre,
      }));
  }, [incidentesFiltrados]);

  const totalActivos = useMemo(
    () => incidentes.filter((i) => i.estado === 'en_curso').length,
    [incidentes]
  );

  // ── Modal de Confirmación SweetAlert2 (Acciones Sensibles) ─────────────────
  const renderConfirmModal = () => (
    <Modal
      visible={confirmConfig.visible}
      transparent
      animationType="fade"
      onRequestClose={() => setConfirmConfig((prev) => ({ ...prev, visible: false }))}
    >
      <View style={styles.confirmModalOverlay}>
        <View
          style={[
            styles.confirmModalCard,
            {
              backgroundColor: colors.bg.surface,
              borderColor:
                confirmConfig.type === 'danger'
                  ? colors.semantic.danger
                  : confirmConfig.type === 'warning'
                  ? '#F59E0B'
                  : confirmConfig.type === 'success'
                  ? '#10B981'
                  : colors.semantic.info,
            },
          ]}
        >
          <View
            style={[
              styles.confirmIconContainer,
              {
                backgroundColor:
                  confirmConfig.type === 'danger'
                    ? colors.semantic.dangerBg
                    : confirmConfig.type === 'warning'
                    ? '#331B0A'
                    : confirmConfig.type === 'success'
                    ? (isDark ? 'rgba(16, 185, 129, 0.2)' : '#D1FAE5')
                    : colors.semantic.infoBg,
              },
            ]}
          >
            {confirmConfig.type === 'danger' ? (
              <ShieldAlert size={36} color={colors.semantic.danger} />
            ) : confirmConfig.type === 'warning' ? (
              <AlertTriangle size={36} color="#F59E0B" />
            ) : confirmConfig.type === 'success' ? (
              <CheckCircle2 size={36} color="#10B981" />
            ) : (
              <ShieldCheck size={36} color={colors.semantic.info} />
            )}
          </View>

          <Text style={[styles.confirmModalTitle, { color: colors.text.primary }]}>
            {confirmConfig.title}
          </Text>

          <Text style={[styles.confirmModalMessage, { color: colors.text.secondary }]}>
            {confirmConfig.message}
          </Text>

          <View style={styles.confirmActionsRow}>
            {confirmConfig.cancelText !== null && (
              <TouchableOpacity
                style={[styles.confirmCancelBtn, { borderColor: colors.border.default }]}
                onPress={() => setConfirmConfig((prev) => ({ ...prev, visible: false }))}
              >
                <Text style={[styles.confirmCancelText, { color: colors.text.secondary }]}>
                  {confirmConfig.cancelText || 'Cancelar'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.confirmAcceptBtn,
                {
                  backgroundColor:
                    confirmConfig.type === 'danger'
                      ? colors.semantic.danger
                      : confirmConfig.type === 'warning'
                      ? '#D97706'
                      : confirmConfig.type === 'success'
                      ? '#059669'
                      : colors.semantic.info,
                },
              ]}
              onPress={() => {
                const fn = confirmConfig.onConfirm;
                setConfirmConfig((prev) => ({ ...prev, visible: false }));
                if (fn) fn();
              }}
            >
              <Text style={styles.confirmAcceptText}>
                {confirmConfig.confirmText || 'Confirmar'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // ── Toast Notification Flotante de Alta Fidelidad ────────────────────────────
  const renderToastNotification = () => {
    if (!toast) return null;

    const isSuccess = toast.type === 'success';
    const isWarning = toast.type === 'warning';
    const isError = toast.type === 'error';

    const accentColor = isSuccess
      ? '#10B981'
      : isWarning
      ? '#F59E0B'
      : isError
      ? '#EF4444'
      : '#3B82F6';

    const bgColor = isDark
      ? isSuccess
        ? '#06261C'
        : isWarning
        ? '#261605'
        : isError
        ? '#2A0B0E'
        : '#081B2E'
      : isSuccess
      ? '#ECFDF5'
      : isWarning
      ? '#FFFBEB'
      : isError
      ? '#FEF2F2'
      : '#EFF6FF';

    const iconBg = isDark
      ? isSuccess
        ? 'rgba(16, 185, 129, 0.2)'
        : isWarning
        ? 'rgba(245, 158, 11, 0.2)'
        : isError
        ? 'rgba(239, 68, 68, 0.2)'
        : 'rgba(59, 130, 246, 0.2)'
      : isSuccess
      ? '#D1FAE5'
      : isWarning
      ? '#FEF3C7'
      : isError
      ? '#FEE2E2'
      : '#DBEAFE';

    return (
      <View
        style={[
          styles.toastContainer,
          {
            backgroundColor: bgColor,
            borderColor: accentColor,
            boxShadow: `0 20px 40px -8px rgba(0,0,0,0.5), 0 0 20px ${accentColor}44`,
          } as any,
        ]}
      >
        <View style={[styles.toastIconWrapper, { backgroundColor: iconBg }]}>
          {isSuccess ? (
            <CheckCircle2 size={22} color={accentColor} />
          ) : isWarning ? (
            <AlertTriangle size={22} color={accentColor} />
          ) : isError ? (
            <ShieldAlert size={22} color={accentColor} />
          ) : (
            <ShieldCheck size={22} color={accentColor} />
          )}
        </View>

        <View style={styles.toastContentWrapper}>
          <Text style={[styles.toastTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
            {toast.title}
          </Text>
          <Text style={[styles.toastMessage, { color: isDark ? '#CBD5E1' : '#334155' }]}>
            {toast.message}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.toastCloseBtn}
          onPress={hideToast}
          activeOpacity={0.7}
        >
          <X size={16} color={isDark ? '#94A3B8' : '#64748B'} />
        </TouchableOpacity>
      </View>
    );
  };

  // ── Modal de Recuperación Gratuita de Contraseña Institucional ───────────────
  const renderRecoveryModal = () => (
    <Modal
      visible={showRecoveryModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowRecoveryModal(false)}
    >
      <View style={styles.passwordModalOverlay}>
        <View style={[styles.recoveryModalBox, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
          <View style={[styles.adminModalHeader, { borderBottomColor: colors.border.default }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.semantic.infoBg, alignItems: 'center', justifyContent: 'center' }}>
                <KeyRound size={20} color={colors.semantic.info} />
              </View>
              <View>
                <Text style={[styles.auditTitle, { color: colors.text.primary }]}>
                  Recuperar Contraseña
                </Text>
                <Text style={[styles.auditSubtitle, { color: colors.text.secondary }]}>
                  {recoveryStep === 1
                    ? 'Paso 1: Solicitar código temporal a su email'
                    : 'Paso 2: Validar código y definir nueva clave'}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setShowRecoveryModal(false)} style={styles.closeBtn}>
              <X size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={{ padding: spacing.lg }}>
            {recoverySuccess && (
              <View style={[styles.alertSuccessBox, { backgroundColor: '#143823', borderColor: '#22C55E', marginBottom: 12 }]}>
                <CheckCircle2 size={16} color="#22C55E" style={{ marginRight: 8 }} />
                <Text style={{ color: '#86EFAC', fontWeight: '600', fontSize: 13 }}>{recoverySuccess}</Text>
              </View>
            )}

            {recoveryError && (
              <View style={[styles.alertSuccessBox, { backgroundColor: '#451A1A', borderColor: '#EF4444', marginBottom: 12 }]}>
                <AlertTriangle size={16} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={{ color: '#FCA5A5', fontWeight: '600', fontSize: 13 }}>{recoveryError}</Text>
              </View>
            )}

            {recoveryStep === 1 ? (
              <View>
                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>
                    Correo Electrónico Registrado *
                  </Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, color: colors.text.primary }]}
                    placeholder="usuario@ejemplo.com"
                    placeholderTextColor={colors.text.disabled}
                    value={recoveryEmail}
                    onChangeText={setRecoveryEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <Text style={{ fontSize: 12, color: colors.text.disabled, marginTop: 4 }}>
                    Se enviará un código temporal OTP de 6 dígitos a su casilla de correo.
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.secondaryModalBtn, { borderColor: colors.border.default }]}
                    onPress={() => setShowRecoveryModal(false)}
                  >
                    <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 13 }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryModalBtn, { backgroundColor: colors.semantic.info }, (!recoveryEmail.trim() || recoveryLoading) && { opacity: 0.5 }]}
                    disabled={!recoveryEmail.trim() || recoveryLoading}
                    onPress={handleSolicitarRecuperacion}
                  >
                    {recoveryLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>Enviar Código</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>
                    Código de Verificación (6 dígitos) *
                  </Text>
                  <TextInput
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: colors.bg.elevated,
                        borderColor: colors.border.default,
                        color: colors.text.primary,
                        textAlign: 'center',
                        fontSize: 20,
                        fontWeight: '700',
                        letterSpacing: 4,
                      },
                    ]}
                    placeholder="123456"
                    placeholderTextColor={colors.text.disabled}
                    value={recoveryCode}
                    onChangeText={setRecoveryCode}
                    keyboardType="numeric"
                    maxLength={6}
                  />
                </View>

                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>
                    Nueva Contraseña *
                  </Text>
                  <View
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: colors.bg.elevated,
                        borderColor: colors.border.default,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: spacing.md,
                      },
                    ]}
                  >
                    <TextInput
                      style={{
                        flex: 1,
                        height: '100%',
                        color: colors.text.primary,
                        fontSize: 13,
                        outlineWidth: 0 as any,
                      }}
                      placeholder="••••••••••••"
                      placeholderTextColor={colors.text.disabled}
                      value={recoveryNewPassword}
                      onChangeText={setRecoveryNewPassword}
                      secureTextEntry={!showRecoveryPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setShowRecoveryPassword((prev) => !prev)}
                      style={{ padding: 4 }}
                      accessibilityLabel={showRecoveryPassword ? "Ocultar contraseña" : "Ver contraseña"}
                    >
                      {showRecoveryPassword ? (
                        <EyeOff size={16} color={colors.text.secondary} />
                      ) : (
                        <Eye size={16} color={colors.text.secondary} />
                      )}
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.passwordChecklistContainer, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text.primary, marginBottom: 4 }}>
                      Requisitos de Seguridad Estricta:
                    </Text>
                    <View style={{ gap: 4 }}>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={recoveryPasswordReqs.hasMinLength ? colors.semantic.success : colors.text.disabled} />
                        <Text style={[styles.passwordChecklistText, { color: recoveryPasswordReqs.hasMinLength ? colors.semantic.success : colors.text.secondary }]}>
                          Mínimo 8 caracteres ({recoveryNewPassword.length}/8)
                        </Text>
                      </View>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={recoveryPasswordReqs.hasUppercase ? colors.semantic.success : colors.text.disabled} />
                        <Text style={[styles.passwordChecklistText, { color: recoveryPasswordReqs.hasUppercase ? colors.semantic.success : colors.text.secondary }]}>
                          Al menos una letra mayúscula (A-Z)
                        </Text>
                      </View>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={recoveryPasswordReqs.hasNumber ? colors.semantic.success : colors.text.disabled} />
                        <Text style={[styles.passwordChecklistText, { color: recoveryPasswordReqs.hasNumber ? colors.semantic.success : colors.text.secondary }]}>
                          Al menos un número (0-9)
                        </Text>
                      </View>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={recoveryPasswordReqs.hasSpecialChar ? colors.semantic.success : colors.text.disabled} />
                        <Text style={[styles.passwordChecklistText, { color: recoveryPasswordReqs.hasSpecialChar ? colors.semantic.success : colors.text.secondary }]}>
                          Al menos un carácter especial (!@#$%^&*)
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Confirmar Nueva Contraseña *</Text>
                  <View
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: colors.bg.elevated,
                        borderColor: colors.border.default,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: spacing.md,
                      },
                    ]}
                  >
                    <TextInput
                      style={{
                        flex: 1,
                        height: '100%',
                        color: colors.text.primary,
                        fontSize: 13,
                        outlineWidth: 0 as any,
                      }}
                      placeholder="••••••••••••"
                      placeholderTextColor={colors.text.disabled}
                      value={recoveryConfirmPassword}
                      onChangeText={setRecoveryConfirmPassword}
                      secureTextEntry={!showRecoveryConfirmPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setShowRecoveryConfirmPassword((prev) => !prev)}
                      style={{ padding: 4 }}
                      accessibilityLabel={showRecoveryConfirmPassword ? "Ocultar contraseña" : "Ver contraseña"}
                    >
                      {showRecoveryConfirmPassword ? (
                        <EyeOff size={16} color={colors.text.secondary} />
                      ) : (
                        <Eye size={16} color={colors.text.secondary} />
                      )}
                    </TouchableOpacity>
                  </View>
                  {recoveryConfirmPassword.length > 0 && recoveryNewPassword !== recoveryConfirmPassword && (
                    <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>
                      Las contraseñas no coinciden.
                    </Text>
                  )}
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.secondaryModalBtn, { borderColor: colors.border.default }]}
                    onPress={() => setRecoveryStep(1)}
                  >
                    <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 13 }}>Volver</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryModalBtn, { backgroundColor: colors.semantic.info }, (!recoveryCode.trim() || !validatePassword(recoveryNewPassword).isValid || recoveryNewPassword !== recoveryConfirmPassword || recoveryLoading) && { opacity: 0.5 }]}
                    disabled={!recoveryCode.trim() || !validatePassword(recoveryNewPassword).isValid || recoveryNewPassword !== recoveryConfirmPassword || recoveryLoading}
                    onPress={handleConfirmarRecuperacion}
                  >
                    {recoveryLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>Restablecer Contraseña</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );

  // ── PANTALLA DE INICIO DE SESIÓN ─────────────────────────────────────────────
  if (!session) {
    return (
      <View style={[styles.authContainer, { backgroundColor: colors.bg.base }]}>
        <View style={[styles.authCard, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
          {/* Botón de alternar tema en esquina superior */}
          <TouchableOpacity
            style={[styles.themeToggleCardBtn, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}
            onPress={toggleTheme}
            accessibilityLabel="Alternar Modo Oscuro / Claro"
          >
            {isDark ? <Sun size={18} color={colors.semantic.warning} /> : <Moon size={18} color={colors.text.primary} />}
          </TouchableOpacity>

          {/* Logo Oficial ApoyAR */}
          <View style={styles.authLogoBox}>
            <Image source={LOGO_SOURCE} style={styles.authLogo} resizeMode="contain" />
          </View>

          <Text style={[styles.authTitle, { color: colors.text.primary }]}>ApoyAR</Text>
          <Text style={[styles.authRoleTag, { color: colors.semantic.info, backgroundColor: colors.semantic.infoBg }]}>
            Centro de Monitoreo y Supervisión Judicial
          </Text>
          <Text style={[styles.authSubtitle, { color: colors.text.secondary }]}>
            Acceso restringido para Autoridades de Seguridad y Administradores
          </Text>

          {authError && (
            <View style={[styles.errorBox, { backgroundColor: colors.semantic.dangerBg, borderColor: colors.semantic.danger }]}>
              <AlertTriangle size={16} color={colors.semantic.danger} style={{ marginRight: 6 }} />
              <Text style={[styles.errorText, { color: colors.semantic.danger }]}>{authError}</Text>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Correo Institucional</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
              <TextInput
                style={[styles.textInput, { color: colors.text.primary }]}
                placeholder="operador@apoyar.gob.ar"
                placeholderTextColor={colors.text.disabled}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Contraseña de Acceso Seguro</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.bg.base, borderColor: colors.border.default, flexDirection: 'row', alignItems: 'center' }]}>
              <TextInput
                style={[styles.textInput, { color: colors.text.primary, flex: 1, outlineWidth: 0 as any }]}
                placeholder="••••••••••••"
                placeholderTextColor={colors.text.disabled}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showLoginPassword}
              />
              <TouchableOpacity
                onPress={() => setShowLoginPassword((prev) => !prev)}
                style={{ padding: 4 }}
                accessibilityLabel={showLoginPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showLoginPassword ? (
                  <EyeOff size={18} color={colors.text.secondary} />
                ) : (
                  <Eye size={18} color={colors.text.secondary} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: lockoutActive ? colors.semantic.danger : colors.semantic.info },
              (authLoading || lockoutActive) && { opacity: 0.75 },
            ]}
            onPress={handleLogin}
            disabled={authLoading || lockoutActive}
          >
            {authLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : lockoutActive ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Clock size={16} color="#FFFFFF" />
                <Text style={styles.buttonText}>
                  Reintentar en {Math.floor(lockoutRemainingSeconds / 60)}:{(lockoutRemainingSeconds % 60).toString().padStart(2, '0')}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Lock size={16} color="#FFFFFF" />
                <Text style={styles.buttonText}>Acceder al Sistema</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Enlace Recuperar Contraseña Institucional */}
          <TouchableOpacity
            style={styles.forgotPasswordBtn}
            onPress={() => {
              setShowRecoveryModal(true);
              setRecoveryStep(1);
              setRecoveryEmail(email || '');
              setRecoveryError(null);
              setRecoverySuccess(null);
            }}
          >
            <Text style={[styles.forgotPasswordText, { color: colors.semantic.info }]}>
              ¿Olvidaste tu contraseña? Recuperar acceso
            </Text>
          </TouchableOpacity>

          <Text style={[styles.securityNotice, { color: colors.text.disabled }]}>
            Comunicaciones cifradas bajo TLS 1.3 con validación estricta de credenciales JWT y RBAC.
          </Text>
        </View>

        {renderRecoveryModal()}
      </View>
    );
  }

  // ── PANTALLA PRINCIPAL DE SUPERVISIÓN ───────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.bg.base }]}>
      {/* ── BARRA SUPERIOR DE NAVEGACIÓN (HEADER) ── */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.bg.surface,
            borderBottomColor: colors.border.default,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <Image source={LOGO_SOURCE} style={styles.headerLogo} resizeMode="contain" />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.headerTitle, { color: colors.text.primary }]}>ApoyAR</Text>
              <View style={[styles.headerBadge, { backgroundColor: colors.semantic.infoBg, borderColor: colors.semantic.info }]}>
                <Shield size={12} color={colors.semantic.info} style={{ marginRight: 4 }} />
                <Text style={[styles.headerBadgeText, { color: colors.semantic.info }]}>Supervisión Central</Text>
              </View>
            </View>
            <Text style={[styles.headerSubtitle, { color: colors.text.secondary }]}>
              {userRole} • {session.user?.email}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {totalActivos > 0 && (
            <View style={[styles.alertIndicatorPill, { backgroundColor: colors.semantic.dangerBg, borderColor: colors.semantic.danger }]}>
              <View style={[styles.pulseDot, { backgroundColor: colors.semantic.danger }]} />
              <Text style={[styles.alertIndicatorText, { color: colors.semantic.danger }]}>
                {totalActivos} {totalActivos === 1 ? 'Alerta Activa' : 'Alertas Activas'}
              </Text>
            </View>
          )}

          {/* Botones de Gestión y Creación de Operarios (Para Administradores) */}
          {(userRole.includes('Administrador') || (session as any)?.roles?.includes('Administrador') || session?.user?.email?.toLowerCase().includes('admin') || session?.user?.email === 'mdarioc1998@gmail.com') && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Botón Gestión de Operadores */}
              <TouchableOpacity
                style={[styles.headerAdminBtn, { backgroundColor: colors.semantic.infoBg, borderColor: colors.semantic.info }]}
                onPress={() => {
                  setShowUsersModal(true);
                  setAdminTab('activos');
                  cargarUsuariosAdmin('activos', 1);
                }}
                accessibilityLabel="Gestión de Operadores y Autoridades"
              >
                <Users size={16} color={colors.semantic.info} style={{ marginRight: 6 }} />
                <Text style={[styles.headerAdminBtnText, { color: colors.semantic.info }]}>Operadores</Text>
              </TouchableOpacity>

              {/* Botón Destacado: Dar de Alta Nuevo Operario */}
              <TouchableOpacity
                style={[
                  styles.headerAdminBtn,
                  {
                    backgroundColor: isDark ? '#1C2E3D' : '#E0F2FE',
                    borderColor: colors.semantic.info,
                  },
                ]}
                onPress={() => {
                  setShowUsersModal(true);
                  setAdminTab('crear');
                }}
                accessibilityLabel="Dar de Alta Nuevo Operario"
              >
                <UserPlus size={16} color={colors.semantic.info} style={{ marginRight: 6 }} />
                <Text style={[styles.headerAdminBtnText, { color: colors.semantic.info, fontWeight: '700' }]}>
                  + Alta de Operario
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Botón de Alternar Modo Claro / Oscuro */}
          <TouchableOpacity
            style={[styles.headerIconBtn, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}
            onPress={toggleTheme}
            accessibilityLabel={isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
          >
            {isDark ? <Sun size={18} color={colors.semantic.warning} /> : <Moon size={18} color={colors.text.primary} />}
          </TouchableOpacity>

          {/* Botón de Refrescar */}
          <TouchableOpacity
            style={[styles.headerIconBtn, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}
            onPress={() => cargarIncidentes()}
            accessibilityLabel="Actualizar datos"
          >
            <RefreshCw size={18} color={colors.text.primary} />
          </TouchableOpacity>



          {/* Botón Cerrar Sesión */}
          <TouchableOpacity
            style={[styles.logoutButton, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}
            onPress={handleLogout}
          >
            <LogOut size={16} color={colors.semantic.danger} style={{ marginRight: 6 }} />
            <Text style={[styles.logoutText, { color: colors.semantic.danger }]}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── CUERPO DIVIDIDO: BANDEJA LATERAL + MAPA INTERACTIVO ── */}
      <View style={styles.mainLayout}>
        {/* PANEL IZQUIERDO: Listado de Alertas y Filtros */}
        <View style={[styles.sidebar, { backgroundColor: colors.bg.surface, borderRightColor: colors.border.default }]}>
          {/* Barra de Búsqueda y Filtros por Persona, Calle y Fecha */}
          <View style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.sm }}>
            <View style={[styles.searchBox, { backgroundColor: colors.bg.base, borderColor: colors.border.default, margin: 0 }]}>
              <Search size={16} color={colors.text.secondary} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { color: colors.text.primary }]}
                placeholder="Buscar por persona, calle o ciudad..."
                placeholderTextColor={colors.text.disabled}
                value={busquedaTexto}
                onChangeText={setBusquedaTexto}
              />
              {busquedaTexto.length > 0 && (
                <TouchableOpacity onPress={() => setBusquedaTexto('')} style={{ marginRight: 6 }}>
                  <X size={16} color={colors.text.secondary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => setMostrarFiltrosAvanzados(!mostrarFiltrosAvanzados)}
                style={[
                  styles.filterToggleBtn,
                  {
                    backgroundColor: (mostrarFiltrosAvanzados || hayFiltrosAvanzadosActivos) ? colors.semantic.infoBg : 'transparent',
                    position: 'relative',
                  },
                ]}
                accessibilityLabel="Filtros avanzados por fecha y ubicación"
              >
                <Filter size={15} color={(mostrarFiltrosAvanzados || hayFiltrosAvanzadosActivos) ? colors.semantic.info : colors.text.secondary} />
                {hayFiltrosAvanzadosActivos && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: colors.semantic.danger,
                      justifyContent: 'center',
                      alignItems: 'center',
                      paddingHorizontal: 3,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', lineHeight: 12 }}>
                      {cantFiltrosAvanzadosActivos}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Panel Desplegable de Filtros Específicos por Rango de Fecha y Ubicación */}
            {mostrarFiltrosAvanzados && (
              <View style={[styles.advancedFiltersPanel, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}>
                {/* 1. Filtro por Rango de Fechas (Desde y Hasta) */}
                <View style={styles.filterFieldRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Calendar size={14} color={colors.semantic.info} />
                    <Text style={[styles.filterFieldLabel, { color: colors.text.secondary }]}>Rango de Fechas</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    {/* Input Desde */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: colors.text.secondary, marginBottom: 2 }}>Desde</Text>
                      {Platform.OS === 'web' ? (
                        <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="date"
                            value={filtroFechaInicio}
                            onChange={(e: any) => setFiltroFechaInicio(e.target.value)}
                            onClick={(e: any) => e.currentTarget.showPicker?.()}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              backgroundColor: colors.bg.base,
                              color: colors.text.primary,
                              colorScheme: isDark ? 'dark' : 'light',
                              borderColor: colors.border.default,
                              borderWidth: 1,
                              borderRadius: 6,
                              padding: '6px 8px',
                              fontSize: 11,
                              outline: 'none',
                              cursor: 'pointer',
                            }}
                          />
                          {filtroFechaInicio.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setFiltroFechaInicio('')}
                              style={{
                                position: 'absolute',
                                right: 28,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 2,
                                color: colors.semantic.danger,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <TextInput
                          style={[styles.filterInput, { backgroundColor: colors.bg.base, borderColor: colors.border.default, color: colors.text.primary }]}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={colors.text.disabled}
                          value={filtroFechaInicio}
                          onChangeText={setFiltroFechaInicio}
                        />
                      )}
                    </View>

                    {/* Input Hasta */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: colors.text.secondary, marginBottom: 2 }}>Hasta</Text>
                      {Platform.OS === 'web' ? (
                        <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="date"
                            value={filtroFechaFin}
                            onChange={(e: any) => setFiltroFechaFin(e.target.value)}
                            onClick={(e: any) => e.currentTarget.showPicker?.()}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              backgroundColor: colors.bg.base,
                              color: colors.text.primary,
                              colorScheme: isDark ? 'dark' : 'light',
                              borderColor: colors.border.default,
                              borderWidth: 1,
                              borderRadius: 6,
                              padding: '6px 8px',
                              fontSize: 11,
                              outline: 'none',
                              cursor: 'pointer',
                            }}
                          />
                          {filtroFechaFin.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setFiltroFechaFin('')}
                              style={{
                                position: 'absolute',
                                right: 28,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 2,
                                color: colors.semantic.danger,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <TextInput
                          style={[styles.filterInput, { backgroundColor: colors.bg.base, borderColor: colors.border.default, color: colors.text.primary }]}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={colors.text.disabled}
                          value={filtroFechaFin}
                          onChangeText={setFiltroFechaFin}
                        />
                      )}
                    </View>
                  </View>
                </View>

                {/* 2. Filtro por Ubicación Desglosado (Ciudad, Calle y Número) */}
                <View style={[styles.filterFieldRow, { marginTop: 10 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <MapPin size={14} color={colors.semantic.info} />
                    <Text style={[styles.filterFieldLabel, { color: colors.text.secondary }]}>Filtrar por Ubicación Desglosada</Text>
                  </View>

                  {/* Ciudad / Localidad */}
                  <View style={{ position: 'relative', marginBottom: 6 }}>
                    <TextInput
                      style={[styles.filterInput, { backgroundColor: colors.bg.base, borderColor: colors.border.default, color: colors.text.primary, paddingRight: filtroCiudad ? 28 : 8 }]}
                      placeholder="Ciudad / Localidad (ej: Formosa)"
                      placeholderTextColor={colors.text.disabled}
                      value={filtroCiudad}
                      onChangeText={setFiltroCiudad}
                    />
                    {filtroCiudad.length > 0 && (
                      <TouchableOpacity
                        onPress={() => setFiltroCiudad('')}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: [{ translateY: -7 }] }}
                      >
                        <X size={14} color={colors.semantic.danger} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Calle / Barrio y Número / Altura */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 2, position: 'relative' }}>
                      <TextInput
                        style={[styles.filterInput, { backgroundColor: colors.bg.base, borderColor: colors.border.default, color: colors.text.primary, paddingRight: filtroCalle ? 28 : 8 }]}
                        placeholder="Calle o Barrio (ej: Pauzier)"
                        placeholderTextColor={colors.text.disabled}
                        value={filtroCalle}
                        onChangeText={setFiltroCalle}
                      />
                      {filtroCalle.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setFiltroCalle('')}
                          style={{ position: 'absolute', right: 8, top: '50%', transform: [{ translateY: -7 }] }}
                        >
                          <X size={14} color={colors.semantic.danger} />
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={{ flex: 1, position: 'relative' }}>
                      <TextInput
                        style={[styles.filterInput, { backgroundColor: colors.bg.base, borderColor: colors.border.default, color: colors.text.primary, paddingRight: filtroNumero ? 28 : 8 }]}
                        placeholder="N° / Altura"
                        placeholderTextColor={colors.text.disabled}
                        value={filtroNumero}
                        onChangeText={setFiltroNumero}
                      />
                      {filtroNumero.length > 0 && (
                        <TouchableOpacity
                          onPress={() => setFiltroNumero('')}
                          style={{ position: 'absolute', right: 8, top: '50%', transform: [{ translateY: -7 }] }}
                        >
                          <X size={14} color={colors.semantic.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>

                {/* 3. Botón de limpiar filtros activos */}
                {hayFiltrosAvanzadosActivos && (
                  <TouchableOpacity
                    onPress={limpiarFiltrosAvanzados}
                    style={[styles.clearAllFiltersBtn, { marginTop: 10, flexDirection: 'row', alignItems: 'center' }]}
                  >
                    <X size={12} color={colors.semantic.danger} style={{ marginRight: 4 }} />
                    <Text style={{ color: colors.semantic.danger, fontSize: 11, fontWeight: '700' }}>
                      Limpiar filtros ({cantFiltrosAvanzadosActivos} activos)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Pestañas de Filtro de Estado */}
          <View style={[styles.filterBar, { borderBottomColor: colors.border.default }]}>
            <TouchableOpacity
              style={[
                styles.filterTab,
                filtroEstado === 'en_curso' && [styles.filterTabActive, { borderBottomColor: colors.semantic.danger }],
              ]}
              onPress={() => setFiltroEstado('en_curso')}
            >
              <Text
                style={[
                  styles.filterTabText,
                  { color: filtroEstado === 'en_curso' ? colors.semantic.danger : colors.text.secondary },
                ]}
              >
                Activos ({incidentes.filter((i) => i.estado === 'en_curso').length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterTab,
                filtroEstado === 'cerrado' && [styles.filterTabActive, { borderBottomColor: colors.semantic.success }],
              ]}
              onPress={() => setFiltroEstado('cerrado')}
            >
              <Text
                style={[
                  styles.filterTabText,
                  { color: filtroEstado === 'cerrado' ? colors.semantic.success : colors.text.secondary },
                ]}
              >
                Cerrados
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterTab,
                filtroEstado === 'todos' && [styles.filterTabActive, { borderBottomColor: colors.border.focus }],
              ]}
              onPress={() => setFiltroEstado('todos')}
            >
              <Text
                style={[
                  styles.filterTabText,
                  { color: filtroEstado === 'todos' ? colors.border.focus : colors.text.secondary },
                ]}
              >
                Todos ({incidentes.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Listado de Incidentes */}
          {loadingData ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.border.focus} />
              <Text style={[styles.loadingText, { color: colors.text.secondary }]}>
                Actualizando telemetría...
              </Text>
            </View>
          ) : incidentesFiltrados.length === 0 ? (
            <View style={styles.centerBox}>
              <CheckCircle2 size={36} color={colors.semantic.success} style={{ marginBottom: 8 }} />
              <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>Sin registros para los filtros</Text>
              <Text style={[styles.emptySubtitle, { color: colors.text.secondary }]}>
                {filtroEstado === 'en_curso'
                  ? 'No hay incidentes activos en este momento.'
                  : 'No se encontraron alertas para la fecha o ubicación seleccionada.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={incidentesFiltrados}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: spacing.sm }}
              renderItem={({ item }) => {
                const isSelected = selectedIncidente?.id === item.id;
                const isEnCurso = item.estado === 'en_curso';

                return (
                  <TouchableOpacity
                    style={[
                      styles.incidentCard,
                      {
                        backgroundColor: isSelected ? colors.bg.elevated : colors.bg.base,
                        borderColor: isSelected ? colors.border.focus : colors.border.default,
                        borderLeftColor: isEnCurso ? colors.semantic.danger : colors.semantic.success,
                      },
                    ]}
                    onPress={() => setSelectedIncidente(item)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1, paddingRight: 6 }}>
                        <Text style={[styles.victimName, { color: colors.text.primary }]} numberOfLines={1}>
                          {item.victima_nombre || 'Persona registrada'}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                          <MapPin size={12} color={colors.text.secondary} style={{ marginRight: 4 }} />
                          <Text style={[styles.addressText, { color: colors.text.secondary }]} numberOfLines={1}>
                            {item.direccion || item.direccion_aprox || `${item.latitud.toFixed(4)}, ${item.longitud.toFixed(4)}`}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                          <Clock size={11} color={colors.text.disabled} style={{ marginRight: 4 }} />
                          <Text style={{ fontSize: 11, color: colors.text.disabled }}>
                            {item.fecha_hora ? `${new Date(item.fecha_hora).toLocaleDateString()} • ${new Date(item.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hs` : ''}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.stateBadge,
                          {
                            backgroundColor: isEnCurso ? colors.semantic.dangerBg : colors.semantic.successBg,
                            borderColor: isEnCurso ? colors.semantic.danger : colors.semantic.success,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.stateBadgeText,
                            { color: isEnCurso ? colors.semantic.danger : colors.semantic.success },
                          ]}
                        >
                          {isEnCurso ? 'EN CURSO' : 'CERRADO'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardFooter}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Clock size={12} color={colors.text.disabled} style={{ marginRight: 4 }} />
                        <Text style={[styles.timeText, { color: colors.text.disabled }]}>
                          {new Date(item.fecha_hora).toLocaleTimeString('es-AR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.originTag,
                          {
                            backgroundColor: colors.bg.overlay,
                          },
                        ]}
                      >
                        <Text style={[styles.originTagText, { color: colors.text.secondary }]}>
                          {item.origen === 'manual' ? 'SOS Manual' : 'Detección Acústica'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {/* Barra de Paginación de 10 en 10 */}
          <View style={[styles.paginationBar, { borderTopColor: colors.border.default, backgroundColor: colors.bg.surface }]}>
            <TouchableOpacity
              style={[styles.pageBtn, incidentesPage <= 1 && { opacity: 0.3 }]}
              disabled={incidentesPage <= 1}
              onPress={() => {
                const prev = incidentesPage - 1;
                setIncidentesPage(prev);
                cargarIncidentes(prev);
              }}
            >
              <ChevronLeft size={16} color={incidentesPage <= 1 ? colors.text.disabled : colors.semantic.info} />
              <Text style={[styles.pageBtnText, { color: incidentesPage <= 1 ? colors.text.disabled : colors.semantic.info }]}>
                Anterior
              </Text>
            </TouchableOpacity>

            <Text style={[styles.pageIndicatorText, { color: colors.text.secondary }]}>
              {incidentesPage} / {incidentesTotalPages} ({incidentesTotalRegistros})
            </Text>

            <TouchableOpacity
              style={[styles.pageBtn, incidentesPage >= incidentesTotalPages && { opacity: 0.3 }]}
              disabled={incidentesPage >= incidentesTotalPages}
              onPress={() => {
                const next = incidentesPage + 1;
                setIncidentesPage(next);
                cargarIncidentes(next);
              }}
            >
              <Text style={[styles.pageBtnText, { color: incidentesPage >= incidentesTotalPages ? colors.text.disabled : colors.semantic.info }]}>
                Siguiente
              </Text>
              <ChevronRight size={16} color={incidentesPage >= incidentesTotalPages ? colors.text.disabled : colors.semantic.info} />
            </TouchableOpacity>
          </View>
        </View>

        {/* PANEL DERECHO: Mapa y Drawer de Inspección Detallada */}
        <View style={styles.mapArea}>
          <MapViewComponent
            markers={mapMarkers}
            selectedId={selectedIncidente?.id}
            onSelectIncident={(id) => {
              const found = incidentes.find((i) => i.id === id);
              if (found) setSelectedIncidente(found);
            }}
            isDark={isDark}
          />

          {/* Tarjeta Flotante de Inspección de Incidente */}
          {selectedIncidente && (
            <View
              style={[
                styles.inspectionDrawer,
                {
                  backgroundColor: colors.bg.surface,
                  borderColor: colors.border.default,
                  shadowColor: '#000',
                },
              ]}
            >
              <View style={styles.drawerHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.drawerTitle, { color: colors.text.primary }]}>
                      {selectedIncidente.victima_nombre || 'Víctima Protegida'}
                    </Text>
                    <View
                      style={[
                        styles.stateBadge,
                        {
                          backgroundColor:
                            selectedIncidente.estado === 'en_curso'
                              ? colors.semantic.dangerBg
                              : colors.semantic.successBg,
                          borderColor:
                            selectedIncidente.estado === 'en_curso'
                              ? colors.semantic.danger
                              : colors.semantic.success,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stateBadgeText,
                          {
                            color:
                              selectedIncidente.estado === 'en_curso'
                                ? colors.semantic.danger
                                : colors.semantic.success,
                          },
                        ]}
                      >
                        {formatEstado(selectedIncidente.estado)}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.drawerIdText, { color: colors.text.disabled }]}>
                    ID: {selectedIncidente.id}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.drawerCloseBtn, { backgroundColor: colors.bg.elevated }]}
                  onPress={() => setSelectedIncidente(null)}
                >
                  <X size={18} color={colors.text.secondary} />
                </TouchableOpacity>
              </View>

              {/* Información de Ubicación y Telemetría */}
              <View style={[styles.drawerInfoBlock, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                <View style={styles.infoRow}>
                  <MapPin size={15} color={colors.semantic.info} style={{ marginRight: 6 }} />
                  <Text style={[styles.infoLabel, { color: colors.text.secondary }]}>Ubicación:</Text>
                  <Text style={[styles.infoValue, { color: colors.text.primary }]} numberOfLines={2}>
                    {selectedIncidente.direccion || selectedIncidente.direccion_aprox || 'Coordenadas en vivo'}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Radio size={15} color={colors.semantic.warning} style={{ marginRight: 6 }} />
                  <Text style={[styles.infoLabel, { color: colors.text.secondary }]}>Coordenadas:</Text>
                  <Text style={[styles.infoValue, { color: colors.text.primary }]}>
                    {Number(selectedIncidente.latitud).toFixed(5)}, {Number(selectedIncidente.longitud).toFixed(5)}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Clock size={15} color={colors.text.secondary} style={{ marginRight: 6 }} />
                  <Text style={[styles.infoLabel, { color: colors.text.secondary }]}>Inicio:</Text>
                  <Text style={[styles.infoValue, { color: colors.text.primary }]}>
                    {new Date(selectedIncidente.fecha_hora).toLocaleString('es-AR')}
                  </Text>
                </View>
              </View>

              {/* Botones Operativos de Acción */}
              <View style={styles.drawerActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.semantic.info }]}
                  onPress={() => handleAbrirAuditoria(selectedIncidente)}
                >
                  <FileText size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.actionBtnText}>Auditar Evidencias Forenses</Text>
                </TouchableOpacity>

                {selectedIncidente.estado === 'en_curso' ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.semantic.success }]}
                    onPress={() => handleCambiarEstado(selectedIncidente, 'cerrado')}
                  >
                    <CheckCircle2 size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.actionBtnText}>Finalizar y Marcar Cerrado</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.bg.overlay }]}
                    onPress={() => handleCambiarEstado(selectedIncidente, 'en_curso')}
                  >
                    <RefreshCw size={15} color={colors.text.primary} style={{ marginRight: 6 }} />
                    <Text style={[styles.actionBtnText, { color: colors.text.primary }]}>Reabrir Caso</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      </View>

      {/* ── MODAL DE AUDITORÍA FORENSE DE EVIDENCIAS (CU-08 / RF-3.5) ── */}
      <Modal
        visible={showEvidenceAuditModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          handleCerrarReproductor();
          setShowEvidenceAuditModal(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.auditCard, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
            <View style={[styles.auditHeader, { borderBottomColor: colors.border.default }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.auditIconBox, { backgroundColor: colors.semantic.infoBg }]}>
                  <Shield size={22} color={colors.semantic.info} />
                </View>
                <View>
                  <Text style={[styles.auditTitle, { color: colors.text.primary }]}>
                    Cadena Inmutable de Custodia Pericial
                  </Text>
                  <Text style={[styles.auditSubtitle, { color: colors.text.secondary }]}>
                    Sellado Forense Multicapa (Capa 1: StrongBox TEE • Capa 2: TSA RFC 3161 • Capa 3: Log Relacional)
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.drawerCloseBtn, { backgroundColor: colors.bg.elevated }]}
                onPress={() => {
                  handleCerrarReproductor();
                  setShowEvidenceAuditModal(false);
                }}
              >
                <X size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            {/* Banner de Control Soberano y Gobernanza de Datos (Ley 25.326 / ISO 27037) */}
            {(() => {
              const tieneConsentimiento = Boolean(
                incidenteAuditadoConsentimiento.consentimiento_exportacion &&
                (selectedIncidente ? selectedIncidente.consentimiento_exportacion !== false : true)
              );
              const fechaConsent =
                incidenteAuditadoConsentimiento.fecha_consentimiento ||
                selectedIncidente?.fecha_consentimiento ||
                evidenciasAudit.find((e) => e.fecha_consentimiento)?.fecha_consentimiento;
              const fechaStr = fechaConsent ? new Date(fechaConsent).toLocaleString('es-AR') : null;

              return (
                <View
                  style={{
                    margin: spacing.md,
                    marginBottom: 0,
                    padding: spacing.md,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    backgroundColor: tieneConsentimiento ? colors.semantic.successBg : colors.bg.elevated,
                    borderColor: tieneConsentimiento ? colors.semantic.success : colors.semantic.warning,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
                      {tieneConsentimiento ? (
                        <ShieldCheck size={22} color={colors.semantic.success} />
                      ) : (
                        <ShieldAlert size={22} color={colors.semantic.warning} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontWeight: '700',
                            fontSize: 13,
                            color: tieneConsentimiento ? colors.semantic.success : colors.semantic.warning,
                          }}
                        >
                          {tieneConsentimiento
                            ? 'Consentimiento Informado Otorgado por el Titular (Ley 25.326)'
                            : 'Contenido Multimedia Cifrado y Protegido (Soberanía Ciudadana)'}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            color: colors.text.secondary,
                            marginTop: 2,
                            lineHeight: 15,
                          }}
                        >
                          {tieneConsentimiento
                            ? `La víctima o testigo titular autorizó formalmente el acceso probatorio y la exportación judicial de este incidente${fechaStr ? ` el ${fechaStr}` : ''}. Reproducción y paquete de exportación habilitados.`
                            : 'Requiere consentimiento expreso de la víctima/testigo desde la App ApoyAR (Ley 25.326 e ISO/IEC 27037). Solo se exhiben los metadatos de integridad forense (SHA-256 y sellado RFC 3161) para certificar la inmutabilidad de la prueba sin invadir la privacidad.'}
                        </Text>
                      </View>
                    </View>

                    {/* Botón de Exportación del Documento de Prueba */}
                    <TouchableOpacity
                      disabled={!tieneConsentimiento || exportingPackage}
                      onPress={() => selectedIncidente && handleExportarDocumentoPrueba(selectedIncidente)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 9,
                        borderRadius: radii.sm,
                        backgroundColor: tieneConsentimiento ? colors.semantic.success : colors.bg.overlay,
                        opacity: tieneConsentimiento ? (exportingPackage ? 0.7 : 1) : 0.5,
                      }}
                    >
                      {exportingPackage ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Download size={15} color={tieneConsentimiento ? '#FFFFFF' : colors.text.disabled} />
                      )}
                      <Text
                        style={{
                          color: tieneConsentimiento ? '#FFFFFF' : colors.text.disabled,
                          fontWeight: '700',
                          fontSize: 12,
                        }}
                      >
                        {exportingPackage ? 'Generando Paquete...' : 'Exportar Documento de Prueba'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })()}

            {loadingEvidencias ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.border.focus} />
                <Text style={[styles.loadingText, { color: colors.text.secondary }]}>
                  Verificando eslabones criptográficos...
                </Text>
              </View>
            ) : evidenciasAudit.length === 0 ? (
              <View style={styles.centerBox}>
                <AlertTriangle size={36} color={colors.semantic.warning} style={{ marginBottom: 8 }} />
                <Text style={[styles.emptyTitle, { color: colors.text.primary }]}>Sin evidencias registradas</Text>
                <Text style={[styles.emptySubtitle, { color: colors.text.secondary }]}>
                  Este incidente no posee segmentos periciales sellados en el bucket privado.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 480, padding: spacing.md }}>
                {evidenciasAudit.map((ev, index) => {
                  const tieneConsentimientoIncidente = Boolean(
                    incidenteAuditadoConsentimiento.consentimiento_exportacion &&
                    (selectedIncidente ? selectedIncidente.consentimiento_exportacion !== false : true)
                  );
                  const itemDesbloqueado = Boolean(
                    tieneConsentimientoIncidente &&
                    ev.consentimiento_exportacion !== false &&
                    !ev.bloqueado_sin_consentimiento &&
                    ev.url_almacenamiento
                  );

                  return (
                    <View
                      key={ev.id}
                      style={[
                        styles.evidenceRowCard,
                        {
                          backgroundColor: colors.bg.base,
                          borderColor: colors.border.default,
                        },
                      ]}
                    >
                      <View style={styles.evidenceRowHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.evidenceBadgeNum, { backgroundColor: colors.semantic.info, color: '#FFF' }]}>
                            #{index + 1}
                          </Text>
                          <Text style={[styles.evidenceTipo, { color: colors.text.primary }]}>
                            Segmento de {ev.tipo_archivo.toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[styles.evidenceTime, { color: colors.text.secondary }]}>
                          {new Date(ev.fecha_captura).toLocaleString('es-AR')}
                        </Text>
                      </View>

                      {/* Hash SHA-256 Pericial */}
                      <View style={styles.evidenceDetailLine}>
                        <Text style={[styles.evidenceLabel, { color: colors.text.secondary }]}>SHA-256:</Text>
                        <Text style={[styles.evidenceHash, { color: colors.semantic.info }]}>
                          {ev.hash_sha256}
                        </Text>
                      </View>

                      {/* Eslabón prev_hash de la cadena */}
                      <View style={styles.evidenceDetailLine}>
                        <Text style={[styles.evidenceLabel, { color: colors.text.secondary }]}>prev_hash:</Text>
                        <Text style={[styles.evidenceHash, { color: colors.text.disabled }]}>
                          {ev.prev_hash || '0000000000000000000000000000000000000000000000000000000000000000 (Génesis)'}
                        </Text>
                      </View>

                      {/* Estado del Sello RFC 3161 */}
                      <View style={styles.evidenceDetailLine}>
                        <Text style={[styles.evidenceLabel, { color: colors.text.secondary }]}>Sello RFC 3161:</Text>
                        <Text
                          style={[
                            styles.evidenceTsaStatus,
                            { color: ev.token_rfc3161 ? colors.semantic.success : colors.semantic.warning },
                          ]}
                        >
                          {ev.token_rfc3161
                            ? `Certificado oficial emitido por Autoridad de Sellado de Tiempo (${ev.token_rfc3161.length} bytes B64)`
                            : 'Pendiente de sellado TSA'}
                        </Text>
                      </View>

                      {/* Badge de seguridad según estado de consentimiento */}
                      {!itemDesbloqueado ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            marginTop: 8,
                            padding: 8,
                            borderRadius: radii.sm,
                            backgroundColor: colors.bg.elevated,
                            borderWidth: 1,
                            borderColor: colors.border.default,
                          }}
                        >
                          <Lock size={14} color={colors.semantic.warning} />
                          <Text style={{ fontSize: 11, color: colors.semantic.warning, fontWeight: '600' }}>
                            Contenido multimedia cifrado y protegido. Requiere consentimiento expreso de la víctima/testigo desde la App ApoyAR (Ley 25.326).
                          </Text>
                        </View>
                      ) : (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: 8,
                            padding: 8,
                            borderRadius: radii.sm,
                            backgroundColor: colors.semantic.successBg,
                            borderWidth: 1,
                            borderColor: colors.semantic.success,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 8 }}>
                            <CheckCircle2 size={14} color={colors.semantic.success} />
                            <Text style={{ fontSize: 11, color: colors.semantic.success, fontWeight: '600' }}>
                              Prueba probatoria multimedia habilitada para visualización forense
                            </Text>
                          </View>
                          {ev.url_almacenamiento && (
                            <TouchableOpacity
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: radii.sm,
                                backgroundColor: activeReproduciendoEvidenciaId === ev.id ? colors.semantic.danger : colors.semantic.info,
                              }}
                              onPress={() => {
                                if (activeReproduciendoEvidenciaId === ev.id) {
                                  handleCerrarReproductor();
                                } else {
                                  handleReproducirEvidenciaForense(ev);
                                }
                              }}
                            >
                              {loadingMediaEvidenciaId === ev.id ? (
                                <ActivityIndicator size="small" color="#ffffff" />
                              ) : activeReproduciendoEvidenciaId === ev.id ? (
                                <>
                                  <X size={13} color="#ffffff" />
                                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>
                                    Cerrar Reproductor
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <Play size={13} color="#ffffff" />
                                  <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>
                                    {ev.tipo_archivo === 'video'
                                      ? 'Ver Video Desencriptado'
                                      : ev.tipo_archivo === 'imagen'
                                      ? 'Ver Fotografía'
                                      : 'Escuchar Audio'}
                                  </Text>
                                </>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {/* Reproductor Forense HTML5 Integrado */}
                      {itemDesbloqueado && activeReproduciendoEvidenciaId === ev.id && activeMediaUrl && (
                      <View
                        style={{
                          marginTop: 10,
                          padding: 12,
                          backgroundColor: '#000000',
                          borderRadius: radii.md,
                          borderWidth: 1,
                          borderColor: colors.border.default,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <Text style={{ color: colors.semantic.success, fontSize: 11, fontWeight: '700' }}>
                            ✓ Verificación Forense: Integridad SHA-256 Validada
                          </Text>
                          <TouchableOpacity
                            onPress={handleCerrarReproductor}
                            style={{ padding: 4 }}
                          >
                            <X size={16} color="#94A3B8" />
                          </TouchableOpacity>
                        </View>

                        {ev.tipo_archivo === 'video' ? (
                          <video
                            src={activeMediaUrl}
                            controls
                            autoPlay
                            style={{
                              width: '100%',
                              maxHeight: 380,
                              borderRadius: 6,
                              backgroundColor: '#000',
                            }}
                          />
                        ) : ev.tipo_archivo === 'audio' ? (
                          <audio
                            src={activeMediaUrl}
                            controls
                            autoPlay
                            style={{
                              width: '100%',
                              marginTop: 4,
                            }}
                          />
                        ) : (
                          <img
                            src={activeMediaUrl}
                            alt="Evidencia Forense Desencriptada"
                            style={{
                              maxWidth: '100%',
                              maxHeight: 400,
                              borderRadius: 6,
                              objectFit: 'contain',
                              display: 'block',
                              margin: '0 auto',
                            }}
                          />
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
              </ScrollView>
            )}

            {/* Barra de Paginación de Evidencias (10 por página) */}
            <View style={[styles.paginationBar, { borderTopColor: colors.border.default, backgroundColor: colors.bg.surface }]}>
              <TouchableOpacity
                style={[styles.pageBtn, evidenciasPage <= 1 && { opacity: 0.3 }]}
                disabled={evidenciasPage <= 1}
                onPress={() => {
                  if (selectedIncidente) {
                    const prev = evidenciasPage - 1;
                    setEvidenciasPage(prev);
                    handleAbrirAuditoria(selectedIncidente, prev);
                  }
                }}
              >
                <ChevronLeft size={16} color={evidenciasPage <= 1 ? colors.text.disabled : colors.semantic.info} />
                <Text style={[styles.pageBtnText, { color: evidenciasPage <= 1 ? colors.text.disabled : colors.semantic.info }]}>
                  Anterior
                </Text>
              </TouchableOpacity>

              <Text style={[styles.pageIndicatorText, { color: colors.text.secondary }]}>
                Página {evidenciasPage} de {evidenciasTotalPages} ({evidenciasTotalRegistros} pruebas)
              </Text>

              <TouchableOpacity
                style={[styles.pageBtn, evidenciasPage >= evidenciasTotalPages && { opacity: 0.3 }]}
                disabled={evidenciasPage >= evidenciasTotalPages}
                onPress={() => {
                  if (selectedIncidente) {
                    const next = evidenciasPage + 1;
                    setEvidenciasPage(next);
                    handleAbrirAuditoria(selectedIncidente, next);
                  }
                }}
              >
                <Text style={[styles.pageBtnText, { color: evidenciasPage >= evidenciasTotalPages ? colors.text.disabled : colors.semantic.info }]}>
                  Siguiente
                </Text>
                <ChevronRight size={16} color={evidenciasPage >= evidenciasTotalPages ? colors.text.disabled : colors.semantic.info} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL DE GESTIÓN DE OPERADORES Y AUTORIDADES (CU-09 / RBAC) ── */}
      <Modal visible={showUsersModal} transparent animationType="fade" onRequestClose={() => setShowUsersModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.adminModalCard, { backgroundColor: colors.bg.surface, borderColor: colors.border.default }]}>
            {/* Header del Modal */}
            <View style={[styles.adminModalHeader, { borderBottomColor: colors.border.default }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.auditIconBox, { backgroundColor: colors.semantic.infoBg }]}>
                  <Users size={22} color={colors.semantic.info} />
                </View>
                <View>
                  <Text style={[styles.auditTitle, { color: colors.text.primary }]}>
                    Gestión Institucional de Operadores
                  </Text>
                  <Text style={[styles.auditSubtitle, { color: colors.text.secondary }]}>
                    Control de cuentas y perfiles Autoridad / Administrador
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowUsersModal(false)} style={styles.closeBtn}>
                <X size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            {/* Pestañas de Navegación del Modal */}
            <View style={[styles.adminTabsContainer, { borderBottomColor: colors.border.default }]}>
              <TouchableOpacity
                style={[
                  styles.adminTabBtn,
                  adminTab === 'activos' && { borderBottomColor: colors.semantic.info, borderBottomWidth: 3 },
                ]}
                onPress={() => {
                  setAdminTab('activos');
                  cargarUsuariosAdmin('activos', 1);
                }}
              >
                <Users size={16} color={adminTab === 'activos' ? colors.semantic.info : colors.text.secondary} style={{ marginRight: 6 }} />
                <Text
                  style={[
                    styles.adminTabBtnText,
                    { color: adminTab === 'activos' ? colors.semantic.info : colors.text.secondary, fontWeight: adminTab === 'activos' ? '700' : '500' },
                  ]}
                >
                  Operadores Activos ({operadoresTotalRegistros})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.adminTabBtn,
                  adminTab === 'inactivos' && { borderBottomColor: colors.semantic.info, borderBottomWidth: 3 },
                ]}
                onPress={() => {
                  setAdminTab('inactivos');
                  cargarUsuariosAdmin('inactivos', 1);
                }}
              >
                <UserX size={16} color={adminTab === 'inactivos' ? colors.semantic.info : colors.text.secondary} style={{ marginRight: 6 }} />
                <Text
                  style={[
                    styles.adminTabBtnText,
                    { color: adminTab === 'inactivos' ? colors.semantic.info : colors.text.secondary, fontWeight: adminTab === 'inactivos' ? '700' : '500' },
                  ]}
                >
                  Operadores Inactivos ({inactivosTotalRegistros})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.adminTabBtn,
                  adminTab === 'crear' && { borderBottomColor: colors.semantic.info, borderBottomWidth: 3 },
                ]}
                onPress={() => setAdminTab('crear')}
              >
                <UserPlus size={16} color={adminTab === 'crear' ? colors.semantic.info : colors.text.secondary} style={{ marginRight: 6 }} />
                <Text
                  style={[
                    styles.adminTabBtnText,
                    { color: adminTab === 'crear' ? colors.semantic.info : colors.text.secondary, fontWeight: adminTab === 'crear' ? '700' : '500' },
                  ]}
                >
                  Dar de Alta Nuevo Operario
                </Text>
              </TouchableOpacity>
            </View>

            {/* Contenido de la Pestaña */}
            {adminTab === 'activos' ? (
              <ScrollView style={styles.adminModalBody}>
                {loadingUsers ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="large" color={colors.semantic.info} />
                    <Text style={{ marginTop: 12, color: colors.text.secondary }}>Cargando operadores activos...</Text>
                  </View>
                ) : usersList.length === 0 ? (
                  <View style={styles.emptyUsersBox}>
                    <Text style={{ color: colors.text.secondary }}>No hay operadores activos registrados.</Text>
                  </View>
                ) : (
                  <>
                    {usersList
                      .filter((usr) => {
                        const roles = usr.roles && usr.roles.length > 0 ? usr.roles : [usr.rol || 'Operador'];
                        return roles.some((r: string) => r === 'Autoridad' || r === 'Administrador');
                      })
                      .map((usr) => {
                      const userRoles: string[] = usr.roles && usr.roles.length > 0 ? usr.roles : [usr.rol || 'Operador'];
                      const isCurrentUser = usr.usuario_id === session?.user?.id;
                      const hasAutoridad = userRoles.includes('Autoridad');
                      const hasAdmin = userRoles.includes('Administrador');

                      return (
                        <View
                          key={usr.usuario_id}
                          style={[
                            styles.userRowCard,
                            {
                              backgroundColor: colors.bg.elevated,
                              borderColor: colors.border.default,
                            },
                          ]}
                        >
                          {/* ── COLUMNA IZQUIERDA: INFORMACIÓN ── */}
                          <View style={{ flex: 1, minWidth: 0 }}>
                            {/* Fila 1 (Header): Nombre del operador + Badges (Autoridad / Admin + Activo) siempre en la misma línea */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'nowrap', marginBottom: 8 }}>
                              <Text
                                style={[styles.userNameText, { color: colors.text.primary }]}
                                numberOfLines={1}
                              >
                                {usr.nombre} {usr.apellido}
                              </Text>

                              {/* Badges de Roles Institucionales y Civiles */}
                              {userRoles.map((r: string) => {
                                const isCivil = r === 'Víctima' || r === 'Civil';
                                const roleLabel = isCivil ? 'Civil' : r;
                                const isAdm = r === 'Administrador';
                                const isAut = r === 'Autoridad';
                                return (
                                  <View
                                    key={r}
                                    style={[
                                      styles.userRoleTag,
                                      {
                                        backgroundColor: isAdm ? '#3B1D4A' : isAut ? '#1E3A5F' : '#1E293B',
                                        borderColor: isAdm ? '#A855F7' : isAut ? '#3B82F6' : '#64748B',
                                        flexShrink: 0,
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 11,
                                        fontWeight: '700',
                                        color: isAdm ? '#E9D5FF' : isAut ? '#BFDBFE' : '#94A3B8',
                                      }}
                                    >
                                      {roleLabel}
                                    </Text>
                                  </View>
                                );
                              })}

                              {/* Insignia Limpia de Estado (Activo) */}
                              <View
                                style={[
                                  styles.userStatusTag,
                                  {
                                    backgroundColor: '#143823',
                                    borderColor: '#22C55E',
                                    flexShrink: 0,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: '700',
                                    color: '#86EFAC',
                                  }}
                                >
                                  Activo
                                </Text>
                              </View>
                            </View>

                            {/* Fila 2 (Datos personales): Grilla ordenada de chips con íconos claros */}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                              <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                <CreditCard size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                  DNI: <Text style={{ color: colors.text.primary, fontWeight: '600' }}>{usr.dni || 'Sin DNI'}</Text>
                                </Text>
                              </View>

                              <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                <Mail size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                  {usr.email}
                                </Text>
                              </View>

                              {usr.telefono ? (
                                <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                  <Phone size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                  <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                    {usr.telefono}
                                  </Text>
                                </View>
                              ) : null}

                              {usr.fecha_nacimiento ? (
                                <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                  <Calendar size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                  <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                    Nac: {usr.fecha_nacimiento}
                                  </Text>
                                </View>
                              ) : null}

                              {usr.genero && usr.genero !== 'No especificado' ? (
                                <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                  <User size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                  <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                    {usr.genero}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            {/* Fila 3 (Caja Institucional): Ícono a la izquierda, título y subtítulo apilados a la derecha */}
                            {hasAutoridad ? (
                              <View
                                style={[
                                  styles.institutionalBoxClean,
                                  {
                                    backgroundColor: colors.bg.base,
                                    borderColor: colors.border.default,
                                  },
                                ]}
                              >
                                <View style={[styles.institutionalIconContainer, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : '#EFF6FF' }]}>
                                  <Building size={16} color="#3B82F6" />
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text.primary }} numberOfLines={1}>
                                    {usr.institucion || 'Policía de la Provincia de Formosa'}
                                    {usr.dependencia ? ` • ${usr.dependencia}` : ''}
                                  </Text>
                                  <Text style={{ fontSize: 11, color: colors.text.secondary, marginTop: 1 }} numberOfLines={1}>
                                    {usr.cargo || 'Oficial Operativo'}
                                    {usr.legajo ? ` (Legajo: ${usr.legajo})` : ''}
                                    {usr.sede ? ` • Sede: ${usr.sede}` : ''}
                                  </Text>
                                </View>
                              </View>
                            ) : (
                              <View
                                style={[
                                  styles.institutionalBoxClean,
                                  {
                                    backgroundColor: isDark ? '#261233' : '#FAF5FF',
                                    borderColor: isDark ? '#A855F7' : '#E9D5FF',
                                  },
                                ]}
                              >
                                <View style={[styles.institutionalIconContainer, { backgroundColor: isDark ? '#3B1D4A' : '#F3E8FF' }]}>
                                  <Shield size={16} color="#A855F7" />
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? '#E9D5FF' : '#6B21A8' }} numberOfLines={1}>
                                    Administrador Global del Sistema
                                  </Text>
                                  <Text style={{ fontSize: 11, color: isDark ? '#C084FC' : '#9333EA', marginTop: 1 }} numberOfLines={1}>
                                    Gestión institucional y configuración centralizada
                                  </Text>
                                </View>
                              </View>
                            )}

                            {usr.notas ? (
                              <Text style={[styles.userDescText, { color: colors.semantic.info, marginTop: 4 }]}>
                                {usr.notas}
                              </Text>
                            ) : null}
                          </View>

                          {/* ── COLUMNA DERECHA: ACCIONES COMPACTAS ── */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, alignSelf: 'flex-start' }}>

                            {/* Agregar rol Administrador si solo es Autoridad */}
                            {!hasAdmin && (
                              <TouchableOpacity
                                style={[
                                  styles.userActionBtnClean,
                                  {
                                    backgroundColor: isDark ? '#261233' : '#FAF5FF',
                                    borderColor: isDark ? '#A855F7' : '#D8B4FE',
                                  },
                                ]}
                                onPress={() => handleAgregarRolAdmin(usr)}
                                accessibilityLabel="Agregar rol Administrador"
                              >
                                <Shield size={13} color={isDark ? '#C084FC' : '#9333EA'} style={{ marginRight: 4 }} />
                                <Text style={{ fontSize: 12, fontWeight: '600', color: isDark ? '#E9D5FF' : '#7E22CE' }}>
                                  + Rol Admin
                                </Text>
                              </TouchableOpacity>
                            )}

                            {/* Agregar rol Autoridad si solo es Administrador */}
                            {!hasAutoridad && (
                              <TouchableOpacity
                                style={[
                                  styles.userActionBtnClean,
                                  {
                                    backgroundColor: isDark ? '#102A45' : '#EFF6FF',
                                    borderColor: isDark ? '#3B82F6' : '#93C5FD',
                                  },
                                ]}
                                onPress={() => {
                                  setTargetAddRoleUser(usr);
                                  setAddAutoridadLegajo('');
                                  setShowAddAutoridadModal(true);
                                }}
                                accessibilityLabel="Agregar rol Autoridad"
                              >
                                <Building size={13} color={isDark ? '#60A5FA' : '#2563EB'} style={{ marginRight: 4 }} />
                                <Text style={{ fontSize: 12, fontWeight: '600', color: isDark ? '#BFDBFE' : '#1D4ED8' }}>
                                  + Rol Autoridad
                                </Text>
                              </TouchableOpacity>
                            )}

                            {/* Único botón de acción de estado: Suspender Operador */}
                            {!isCurrentUser && (
                              <TouchableOpacity
                                style={[
                                  styles.userActionBtnClean,
                                  {
                                    backgroundColor: colors.semantic.dangerBg,
                                    borderColor: colors.semantic.danger,
                                  },
                                ]}
                                onPress={() => handleConfirmarSuspension(usr)}
                                accessibilityLabel="Suspender Operador Institucional"
                              >
                                <UserX size={13} color={colors.semantic.danger} style={{ marginRight: 4 }} />
                                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.semantic.danger }}>
                                  Suspender
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}

                    {/* Barra de Paginación de 10 en 10 */}
                    <View style={styles.paginationBar}>
                      <TouchableOpacity
                        style={[styles.pageBtn, { borderColor: colors.border.default }, operadoresPage <= 1 && styles.pageBtnDisabled]}
                        disabled={operadoresPage <= 1 || loadingUsers}
                        onPress={() => cargarUsuariosAdmin('activos', operadoresPage - 1)}
                      >
                        <ChevronLeft size={16} color={operadoresPage <= 1 ? colors.text.disabled : colors.text.primary} />
                        <Text style={[styles.pageBtnText, { color: operadoresPage <= 1 ? colors.text.disabled : colors.text.primary }]}>
                          Anterior
                        </Text>
                      </TouchableOpacity>

                      <Text style={[styles.pageIndicatorText, { color: colors.text.secondary }]}>
                        Página {operadoresPage} de {operadoresTotalPages} ({operadoresTotalRegistros} operadores)
                      </Text>

                      <TouchableOpacity
                        style={[styles.pageBtn, { borderColor: colors.border.default }, operadoresPage >= operadoresTotalPages && styles.pageBtnDisabled]}
                        disabled={operadoresPage >= operadoresTotalPages || loadingUsers}
                        onPress={() => cargarUsuariosAdmin('activos', operadoresPage + 1)}
                      >
                        <Text style={[styles.pageBtnText, { color: operadoresPage >= operadoresTotalPages ? colors.text.disabled : colors.text.primary }]}>
                          Siguiente
                        </Text>
                        <ChevronRight size={16} color={operadoresPage >= operadoresTotalPages ? colors.text.disabled : colors.text.primary} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </ScrollView>
            ) : adminTab === 'inactivos' ? (
              <ScrollView style={styles.adminModalBody}>
                {loadingUsers ? (
                  <View style={styles.loadingBox}>
                    <ActivityIndicator size="large" color={colors.semantic.info} />
                    <Text style={{ marginTop: 12, color: colors.text.secondary }}>Cargando operadores inactivos...</Text>
                  </View>
                ) : inactivosList.length === 0 ? (
                  <View style={styles.emptyUsersBox}>
                    <Text style={{ color: colors.text.secondary }}>No hay operadores suspendidos o inactivos.</Text>
                  </View>
                ) : (
                  <>
                    {inactivosList
                      .filter((usr) => {
                        const roles = usr.roles && usr.roles.length > 0 ? usr.roles : [usr.rol || 'Operador'];
                        return roles.some((r: string) => r === 'Autoridad' || r === 'Administrador');
                      })
                      .map((usr) => {
                      const userRoles: string[] = usr.roles && usr.roles.length > 0 ? usr.roles : [usr.rol || 'Operador'];

                      return (
                        <View
                          key={usr.usuario_id}
                          style={[
                            styles.userRowCard,
                            {
                              backgroundColor: colors.bg.elevated,
                              borderColor: colors.border.default,
                            },
                          ]}
                        >
                          {/* ── COLUMNA IZQUIERDA: INFORMACIÓN ── */}
                          <View style={{ flex: 1, minWidth: 0 }}>
                            {/* Fila 1 (Header): Nombre del operador + Badges (Autoridad / Admin + Suspendido) en la misma línea */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'nowrap', marginBottom: 8 }}>
                              <Text
                                style={[styles.userNameText, { color: colors.text.primary }]}
                                numberOfLines={1}
                              >
                                {usr.nombre} {usr.apellido}
                              </Text>

                              {userRoles.map((r: string) => {
                                const isCivil = r === 'Víctima' || r === 'Civil';
                                const roleLabel = isCivil ? 'Civil' : r;
                                const isAdm = r === 'Administrador';
                                const isAut = r === 'Autoridad';
                                return (
                                  <View
                                    key={r}
                                    style={[
                                      styles.userRoleTag,
                                      {
                                        backgroundColor: isAdm ? '#3B1D4A' : isAut ? '#1E3A5F' : '#1E293B',
                                        borderColor: isAdm ? '#A855F7' : isAut ? '#3B82F6' : '#64748B',
                                        flexShrink: 0,
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={{
                                        fontSize: 11,
                                        fontWeight: '700',
                                        color: isAdm ? '#E9D5FF' : isAut ? '#BFDBFE' : '#94A3B8',
                                      }}
                                    >
                                      {roleLabel}
                                    </Text>
                                  </View>
                                );
                              })}

                              {/* Insignia Limpia de Estado (Suspendido) */}
                              <View
                                style={[
                                  styles.userStatusTag,
                                  {
                                    backgroundColor: '#451A1A',
                                    borderColor: '#EF4444',
                                    flexShrink: 0,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: '700',
                                    color: '#FCA5A5',
                                  }}
                                >
                                  Suspendido
                                </Text>
                              </View>
                            </View>

                            {/* Fila 2 (Datos personales): Grilla ordenada de chips */}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                              <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                <CreditCard size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                  DNI: <Text style={{ color: colors.text.primary, fontWeight: '600' }}>{usr.dni || 'Sin DNI'}</Text>
                                </Text>
                              </View>

                              <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                <Mail size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                  {usr.email}
                                </Text>
                              </View>

                              {usr.telefono ? (
                                <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                  <Phone size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                  <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                    {usr.telefono}
                                  </Text>
                                </View>
                              ) : null}

                              {usr.fecha_nacimiento ? (
                                <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                  <Calendar size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                  <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                    Nac: {usr.fecha_nacimiento}
                                  </Text>
                                </View>
                              ) : null}

                              {usr.genero && usr.genero !== 'No especificado' ? (
                                <View style={[styles.personalDataChip, { backgroundColor: colors.bg.base, borderColor: colors.border.default }]}>
                                  <User size={12} color={colors.semantic.info} style={{ marginRight: 5 }} />
                                  <Text style={{ fontSize: 11, color: colors.text.secondary }}>
                                    {usr.genero}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            {/* Fila 3 (Caja Institucional) */}
                            {(usr.institucion || usr.dependencia || usr.cargo) ? (
                              <View
                                style={[
                                  styles.institutionalBoxClean,
                                  {
                                    backgroundColor: colors.bg.base,
                                    borderColor: colors.border.default,
                                  },
                                ]}
                              >
                                <View style={[styles.institutionalIconContainer, { backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : '#EFF6FF' }]}>
                                  <Building size={16} color="#3B82F6" />
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text.primary }} numberOfLines={1}>
                                    {usr.institucion || 'Policía de la Provincia de Formosa'}
                                    {usr.dependencia ? ` • ${usr.dependencia}` : ''}
                                  </Text>
                                  <Text style={{ fontSize: 11, color: colors.text.secondary, marginTop: 1 }} numberOfLines={1}>
                                    {usr.cargo || 'Oficial'}
                                    {usr.legajo ? ` (Legajo: ${usr.legajo})` : ''}
                                    {usr.sede ? ` • Sede: ${usr.sede}` : ''}
                                  </Text>
                                </View>
                              </View>
                            ) : null}
                          </View>

                          {/* ── COLUMNA DERECHA: ACCIONES COMPACTAS ── */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, alignSelf: 'flex-start' }}>


                            {/* Reactivar Operador */}
                            <TouchableOpacity
                              style={[
                                styles.userActionBtnClean,
                                {
                                  backgroundColor: colors.semantic.infoBg,
                                  borderColor: colors.semantic.info,
                                },
                              ]}
                              onPress={() => handleConfirmarReactivacion(usr)}
                              accessibilityLabel="Reactivar Operador Institucional"
                            >
                              <UserCheck size={13} color={colors.semantic.info} style={{ marginRight: 4 }} />
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: '600',
                                  color: colors.semantic.info,
                                }}
                              >
                                Reactivar
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}

                    {/* Barra de Paginación Inactivos */}
                    <View style={styles.paginationBar}>
                      <TouchableOpacity
                        style={[styles.pageBtn, { borderColor: colors.border.default }, inactivosPage <= 1 && styles.pageBtnDisabled]}
                        disabled={inactivosPage <= 1 || loadingUsers}
                        onPress={() => cargarUsuariosAdmin('inactivos', inactivosPage - 1)}
                      >
                        <ChevronLeft size={16} color={inactivosPage <= 1 ? colors.text.disabled : colors.text.primary} />
                        <Text style={[styles.pageBtnText, { color: inactivosPage <= 1 ? colors.text.disabled : colors.text.primary }]}>
                          Anterior
                        </Text>
                      </TouchableOpacity>

                      <Text style={[styles.pageIndicatorText, { color: colors.text.secondary }]}>
                        Página {inactivosPage} de {inactivosTotalPages} ({inactivosTotalRegistros} operadores)
                      </Text>

                      <TouchableOpacity
                        style={[styles.pageBtn, { borderColor: colors.border.default }, inactivosPage >= inactivosTotalPages && styles.pageBtnDisabled]}
                        disabled={inactivosPage >= inactivosTotalPages || loadingUsers}
                        onPress={() => cargarUsuariosAdmin('inactivos', inactivosPage + 1)}
                      >
                        <Text style={[styles.pageBtnText, { color: inactivosPage >= inactivosTotalPages ? colors.text.disabled : colors.text.primary }]}>
                          Siguiente
                        </Text>
                        <ChevronRight size={16} color={inactivosPage >= inactivosTotalPages ? colors.text.disabled : colors.text.primary} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </ScrollView>
            ) : (
              /* TAB 3: ALTA DE OPERADOR */
              <ScrollView style={styles.adminModalBody}>
                {mensajeOperador && (
                  <View style={[styles.alertSuccessBox, { backgroundColor: '#143823', borderColor: '#22C55E' }]}>
                    <CheckCircle2 size={16} color="#22C55E" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#86EFAC', fontWeight: '600', fontSize: 13 }}>{mensajeOperador}</Text>
                  </View>
                )}

                {/* 1. SELECCIÓN DE CAMINO: VINCULAR USUARIO EXISTENTE O CREAR DESDE CERO */}
                <View style={[styles.formRow, { backgroundColor: colors.bg.base, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border.default }]}>
                  <Text style={[styles.inputLabel, { color: colors.text.primary, fontWeight: '700', marginBottom: 6 }]}>
                    Camino 1: Vincular Usuario Civil Existente (Recomendado si ya está registrado en App ApoyAR)
                  </Text>
                  
                  {selectedCivilUser ? (
                    <View style={[styles.linkedCivilBanner, { backgroundColor: '#143823', borderColor: '#22C55E' }]}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <CheckCircle2 size={16} color="#22C55E" />
                          <Text style={{ color: '#86EFAC', fontWeight: '700', fontSize: 13 }}>
                            Usuario Civil Vinculado
                          </Text>
                        </View>
                        <Text style={{ color: '#F8FAFC', fontSize: 13, marginTop: 4, fontWeight: '600' }}>
                          {selectedCivilUser.nombre} {selectedCivilUser.apellido} (DNI: {selectedCivilUser.dni || 'Sin DNI'})
                        </Text>
                        <Text style={{ color: '#94A3B8', fontSize: 12 }}>
                          {selectedCivilUser.email} • Tel: {selectedCivilUser.telefono || 'Sin tel.'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.unlinkBtn, { borderColor: '#EF4444' }]}
                        onPress={handleDesvincularCivil}
                      >
                        <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600' }}>
                          Desvincular / Alta Desde Cero
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TextInput
                          style={[
                            styles.modalInput,
                            {
                              flex: 1,
                              backgroundColor: colors.bg.elevated,
                              borderColor: colors.border.default,
                              color: colors.text.primary,
                              marginTop: 0,
                            },
                          ]}
                          placeholder="Buscar por DNI, Nombre, Apellido o Email..."
                          placeholderTextColor={colors.text.disabled}
                          value={searchCivilQuery}
                          onChangeText={handleBuscarUsuariosCiviles}
                        />
                        {searchingCivil && <ActivityIndicator size="small" color={colors.semantic.info} />}
                      </View>

                      {civilSearchResults.length > 0 && (
                        <View style={[styles.searchCivilBox, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}>
                          <Text style={{ fontSize: 11, color: colors.text.secondary, marginBottom: 6, fontWeight: '600' }}>
                            Resultados encontrados ({civilSearchResults.length}): Seleccione uno para autocompletar
                          </Text>
                          {civilSearchResults.map((item) => (
                            <TouchableOpacity
                              key={item.id || item.usuario_id || item.dni}
                              style={[styles.searchResultCard, { borderColor: colors.border.default }]}
                              onPress={() => handleSeleccionarCivil(item)}
                            >
                              <View>
                                <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 13 }}>
                                  {item.nombre} {item.apellido} (DNI: {item.dni || 'Sin DNI'})
                                </Text>
                                <Text style={{ color: colors.text.secondary, fontSize: 11 }}>
                                  {item.email} {item.telefono ? `• ${item.telefono}` : ''}
                                </Text>
                              </View>
                              <View style={[styles.userRoleTag, { backgroundColor: '#143823', borderColor: '#22C55E' }]}>
                                <Text style={{ fontSize: 10, color: '#86EFAC', fontWeight: '700' }}>Vincular</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* 2. SELECCIÓN DE ROLES INSTITUCIONALES (MULTI-ROL) */}
                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Roles Institucionales Asignados * (Multi-Rol)</Text>
                  <Text style={{ fontSize: 11, color: colors.text.disabled, marginBottom: 6 }}>
                    Puede asignar un rol o ambos simultáneamente según las funciones del operador.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity
                      style={[
                        styles.roleSelectCard,
                        {
                          flex: 1,
                          backgroundColor: selectedRolesAlta.includes('Autoridad') ? colors.semantic.infoBg : colors.bg.elevated,
                          borderColor: selectedRolesAlta.includes('Autoridad') ? colors.semantic.info : colors.border.default,
                        },
                      ]}
                      onPress={() => {
                        setSelectedRolesAlta((prev) =>
                          prev.includes('Autoridad')
                            ? prev.length > 1 ? prev.filter((r) => r !== 'Autoridad') : prev
                            : [...prev, 'Autoridad']
                        );
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Shield size={20} color={selectedRolesAlta.includes('Autoridad') ? colors.semantic.info : colors.text.secondary} />
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            borderWidth: 1.5,
                            borderColor: selectedRolesAlta.includes('Autoridad') ? colors.semantic.info : colors.text.disabled,
                            backgroundColor: selectedRolesAlta.includes('Autoridad') ? colors.semantic.info : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {selectedRolesAlta.includes('Autoridad') && <Check size={12} color="#FFFFFF" />}
                        </View>
                      </View>
                      <Text style={[styles.roleSelectTitle, { color: selectedRolesAlta.includes('Autoridad') ? colors.semantic.info : colors.text.primary }]}>
                        Autoridad
                      </Text>
                      <Text style={[styles.roleSelectDesc, { color: colors.text.disabled }]}>
                        Personal policial / judicial. Monitoreo cartográfico en vivo y peritaje de evidencias.
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.roleSelectCard,
                        {
                          flex: 1,
                          backgroundColor: selectedRolesAlta.includes('Administrador') ? '#3B1D4A' : colors.bg.elevated,
                          borderColor: selectedRolesAlta.includes('Administrador') ? '#A855F7' : colors.border.default,
                        },
                      ]}
                      onPress={() => {
                        setSelectedRolesAlta((prev) =>
                          prev.includes('Administrador')
                            ? prev.length > 1 ? prev.filter((r) => r !== 'Administrador') : prev
                            : [...prev, 'Administrador']
                        );
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Lock size={20} color={selectedRolesAlta.includes('Administrador') ? '#C084FC' : colors.text.secondary} />
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            borderWidth: 1.5,
                            borderColor: selectedRolesAlta.includes('Administrador') ? '#A855F7' : colors.text.disabled,
                            backgroundColor: selectedRolesAlta.includes('Administrador') ? '#A855F7' : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {selectedRolesAlta.includes('Administrador') && <Check size={12} color="#FFFFFF" />}
                        </View>
                      </View>
                      <Text style={[styles.roleSelectTitle, { color: selectedRolesAlta.includes('Administrador') ? '#E9D5FF' : colors.text.primary }]}>
                        Administrador
                      </Text>
                      <Text style={[styles.roleSelectDesc, { color: colors.text.disabled }]}>
                        Gestión técnica global, administración de operadores y auditoría institucional.
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 3. ADSCRIPCIÓN INSTITUCIONAL (Si incluye Autoridad) */}
                {selectedRolesAlta.includes('Autoridad') && (
                  <View style={{ gap: spacing.md, marginVertical: 4 }}>
                    <View style={styles.formRow}>
                      <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Institución de Pertenencia *</Text>
                      {Platform.OS === 'web' ? (
                        <select
                          value={selectedInstitucionId ?? ''}
                          onChange={(e: any) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            setSelectedInstitucionId(val);
                            const primerDep = dependencias.find((d) => d.id_institucion === val);
                            setSelectedDependenciaId(primerDep ? primerDep.id_dependencia : null);
                            const primerSede = primerDep ? sedes.find((s) => s.id_dependencia === primerDep.id_dependencia) : null;
                            setSelectedSedeId(primerSede ? primerSede.id_sede : null);
                            const primerCargo = cargos[0];
                            if (primerCargo) {
                              setSelectedCargoId(primerCargo.id_cargo);
                            }
                          }}
                          style={{
                            height: 42,
                            borderRadius: radii.sm,
                            borderWidth: 1,
                            borderStyle: 'solid',
                            borderColor: colors.border.default,
                            backgroundColor: colors.bg.elevated,
                            color: colors.text.primary,
                            paddingLeft: 12,
                            paddingRight: 12,
                            fontSize: 13,
                            outline: 'none',
                            marginTop: 4,
                            fontFamily: 'inherit',
                            width: '100%',
                          }}
                        >
                          {instituciones.map((inst) => (
                            <option key={inst.id_institucion} value={inst.id_institucion} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                              {inst.nombre} ({inst.tipo_organismo})
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Dependencia / Unidad Operativa *</Text>
                        {Platform.OS === 'web' ? (
                          <select
                            value={selectedDependenciaId ?? ''}
                            onChange={(e: any) => {
                              const val = e.target.value ? Number(e.target.value) : null;
                              setSelectedDependenciaId(val);
                              const primerSede = sedes.find((s) => s.id_dependencia === val);
                              setSelectedSedeId(primerSede ? primerSede.id_sede : null);
                            }}
                            style={{
                              height: 42,
                              borderRadius: radii.sm,
                              borderWidth: 1,
                              borderStyle: 'solid',
                              borderColor: colors.border.default,
                              backgroundColor: colors.bg.elevated,
                              color: colors.text.primary,
                              paddingLeft: 12,
                              paddingRight: 12,
                              fontSize: 13,
                              outline: 'none',
                              marginTop: 4,
                              fontFamily: 'inherit',
                              width: '100%',
                            }}
                          >
                            {dependencias
                              .filter((d) => !selectedInstitucionId || d.id_institucion === selectedInstitucionId)
                              .map((dep) => (
                                <option key={dep.id_dependencia} value={dep.id_dependencia} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                                  {dep.nombre} ({dep.tipo_unidad})
                                </option>
                              ))}
                          </select>
                        ) : null}
                      </View>

                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Sede Física / Edificio *</Text>
                        {Platform.OS === 'web' ? (
                          <select
                            value={selectedSedeId ?? ''}
                            onChange={(e: any) => setSelectedSedeId(e.target.value ? Number(e.target.value) : null)}
                            style={{
                              height: 42,
                              borderRadius: radii.sm,
                              borderWidth: 1,
                              borderStyle: 'solid',
                              borderColor: colors.border.default,
                              backgroundColor: colors.bg.elevated,
                              color: colors.text.primary,
                              paddingLeft: 12,
                              paddingRight: 12,
                              fontSize: 13,
                              outline: 'none',
                              marginTop: 4,
                              fontFamily: 'inherit',
                              width: '100%',
                            }}
                          >
                            {sedes
                              .filter((s) => !selectedDependenciaId || s.id_dependencia === selectedDependenciaId)
                              .map((sede) => (
                                <option key={sede.id_sede} value={sede.id_sede} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                                  {sede.nombre_sede} ({sede.direccion})
                                </option>
                              ))}
                          </select>
                        ) : null}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Cargo Institucional * (Catálogo Formosa)</Text>
                        {Platform.OS === 'web' ? (
                          <select
                            value={selectedCargoId ?? ''}
                            onChange={(e: any) => {
                              const val = e.target.value ? Number(e.target.value) : null;
                              setSelectedCargoId(val);
                            }}
                            style={{
                              height: 42,
                              borderRadius: radii.sm,
                              borderWidth: 1,
                              borderStyle: 'solid',
                              borderColor: colors.border.default,
                              backgroundColor: colors.bg.elevated,
                              color: colors.text.primary,
                              paddingLeft: 12,
                              paddingRight: 12,
                              fontSize: 13,
                              outline: 'none',
                              marginTop: 4,
                              fontFamily: 'inherit',
                              width: '100%',
                            }}
                          >
                            {cargos.map((c) => (
                              <option key={c.id_cargo} value={c.id_cargo} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                                {c.nombre_cargo}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </View>

                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Legajo / Matrícula Personal * (Único)</Text>
                        <TextInput
                          style={[styles.modalInput, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, color: colors.text.primary }]}
                          placeholder="ej: LP-POL-10823 (obligatorio)"
                          placeholderTextColor={colors.text.disabled}
                          value={nuevoLegajo}
                          onChangeText={setNuevoLegajo}
                        />
                      </View>
                    </View>
                  </View>
                )}

                {/* 4. CONTRASEÑA INSTITUCIONAL (Exclusiva para Panel Web) */}
                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Contraseña Institucional para Panel Web *</Text>
                  <View
                    style={[
                      styles.modalInput,
                      {
                        backgroundColor: colors.bg.elevated,
                        borderColor: operatorTouched.password && operatorErrors.password ? colors.semantic.danger : colors.border.default,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: spacing.md,
                      },
                    ]}
                  >
                    <TextInput
                      style={{
                        flex: 1,
                        height: '100%',
                        color: colors.text.primary,
                        fontSize: 13,
                        outlineWidth: 0 as any,
                      }}
                      placeholder="Mínimo 8 carac., 1 mayús., 1 núm., 1 símbolo"
                      placeholderTextColor={colors.text.disabled}
                      value={nuevoPassword}
                      onChangeText={(text) => handleOperatorChangeText('password', text)}
                      onBlur={() => handleOperatorBlur('password', nuevoPassword)}
                      secureTextEntry={!showOperatorPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setShowOperatorPassword((prev) => !prev)}
                      style={{ padding: 4 }}
                      accessibilityLabel={showOperatorPassword ? "Ocultar contraseña" : "Ver contraseña"}
                    >
                      {showOperatorPassword ? (
                        <EyeOff size={16} color={colors.text.secondary} />
                      ) : (
                        <Eye size={16} color={colors.text.secondary} />
                      )}
                    </TouchableOpacity>
                  </View>
                  {operatorTouched.password && operatorErrors.password && (
                    <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>{operatorErrors.password}</Text>
                  )}
                  <View style={[styles.passwordChecklistContainer, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default }]}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.text.primary, marginBottom: 4 }}>
                      Requisitos de Seguridad Estricta:
                    </Text>
                    <View style={{ gap: 4 }}>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={operatorPasswordReqs.hasMinLength ? colors.semantic.success : colors.text.disabled} />
                        <Text
                          style={[
                            styles.passwordChecklistText,
                            {
                              color: operatorPasswordReqs.hasMinLength ? colors.semantic.success : colors.text.secondary,
                              fontWeight: operatorPasswordReqs.hasMinLength ? '600' : '400',
                            },
                          ]}
                        >
                          Mínimo 8 caracteres ({nuevoPassword.length}/8)
                        </Text>
                      </View>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={operatorPasswordReqs.hasUppercase ? colors.semantic.success : colors.text.disabled} />
                        <Text
                          style={[
                            styles.passwordChecklistText,
                            {
                              color: operatorPasswordReqs.hasUppercase ? colors.semantic.success : colors.text.secondary,
                              fontWeight: operatorPasswordReqs.hasUppercase ? '600' : '400',
                            },
                          ]}
                        >
                          Al menos una letra mayúscula (A-Z)
                        </Text>
                      </View>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={operatorPasswordReqs.hasNumber ? colors.semantic.success : colors.text.disabled} />
                        <Text
                          style={[
                            styles.passwordChecklistText,
                            {
                              color: operatorPasswordReqs.hasNumber ? colors.semantic.success : colors.text.secondary,
                              fontWeight: operatorPasswordReqs.hasNumber ? '600' : '400',
                            },
                          ]}
                        >
                          Al menos un número (0-9)
                        </Text>
                      </View>
                      <View style={styles.passwordChecklistItem}>
                        <CheckCircle2 size={13} color={operatorPasswordReqs.hasSpecialChar ? colors.semantic.success : colors.text.disabled} />
                        <Text
                          style={[
                            styles.passwordChecklistText,
                            {
                              color: operatorPasswordReqs.hasSpecialChar ? colors.semantic.success : colors.text.secondary,
                              fontWeight: operatorPasswordReqs.hasSpecialChar ? '600' : '400',
                            },
                          ]}
                        >
                          Al menos un carácter especial (!@#$%^&*)
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* 5. DATOS DE PERSONA (Solo si no se vincula un civil existente) */}
                {!selectedCivilUser && (
                  <>
                    <View style={styles.formRow}>
                      <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Correo Electrónico Institucional *</Text>
                      <TextInput
                        style={[
                          styles.modalInput,
                          {
                            backgroundColor: colors.bg.elevated,
                            borderColor: operatorTouched.email && operatorErrors.email ? colors.semantic.danger : colors.border.default,
                            color: colors.text.primary,
                          },
                        ]}
                        placeholder="ej: oficial.guardia@policia.gob.ar"
                        placeholderTextColor={colors.text.disabled}
                        value={nuevoEmail}
                        onChangeText={(text) => handleOperatorChangeText('email', text)}
                        onBlur={() => handleOperatorBlur('email', nuevoEmail)}
                        autoCapitalize="none"
                        keyboardType="email-address"
                      />
                      {operatorTouched.email && operatorErrors.email && (
                        <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>{operatorErrors.email}</Text>
                      )}
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Nombre *</Text>
                        <TextInput
                          style={[
                            styles.modalInput,
                            {
                              backgroundColor: colors.bg.elevated,
                              borderColor: operatorTouched.nombre && operatorErrors.nombre ? colors.semantic.danger : colors.border.default,
                              color: colors.text.primary,
                            },
                          ]}
                          placeholder="ej: María Laura"
                          placeholderTextColor={colors.text.disabled}
                          value={nuevoNombre}
                          onChangeText={(text) => handleOperatorChangeText('nombre', text)}
                          onBlur={() => handleOperatorBlur('nombre', nuevoNombre)}
                        />
                        {operatorTouched.nombre && operatorErrors.nombre && (
                          <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>{operatorErrors.nombre}</Text>
                        )}
                      </View>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Apellido *</Text>
                        <TextInput
                          style={[
                            styles.modalInput,
                            {
                              backgroundColor: colors.bg.elevated,
                              borderColor: operatorTouched.apellido && operatorErrors.apellido ? colors.semantic.danger : colors.border.default,
                              color: colors.text.primary,
                            },
                          ]}
                          placeholder="ej: Rossi"
                          placeholderTextColor={colors.text.disabled}
                          value={nuevoApellido}
                          onChangeText={(text) => handleOperatorChangeText('apellido', text)}
                          onBlur={() => handleOperatorBlur('apellido', nuevoApellido)}
                        />
                        {operatorTouched.apellido && operatorErrors.apellido && (
                          <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>{operatorErrors.apellido}</Text>
                        )}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <View style={styles.fieldHeaderRow}>
                          <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>DNI *</Text>
                          <Text style={[styles.fieldCounterText, { color: nuevoDni.length === 7 || nuevoDni.length === 8 ? '#22C55E' : colors.text.disabled }]}>
                            {nuevoDni.length}/8 números
                          </Text>
                        </View>
                        <TextInput
                          style={[
                            styles.modalInput,
                            {
                              backgroundColor: colors.bg.elevated,
                              borderColor: operatorTouched.dni && operatorErrors.dni ? colors.semantic.danger : colors.border.default,
                              color: colors.text.primary,
                            },
                          ]}
                          placeholder="ej: 38123456 (7 u 8 núm)"
                          placeholderTextColor={colors.text.disabled}
                          value={nuevoDni}
                          onChangeText={(text) => handleOperatorChangeText('dni', text)}
                          onBlur={() => handleOperatorBlur('dni', nuevoDni)}
                          keyboardType="numeric"
                          maxLength={8}
                        />
                        {operatorTouched.dni && operatorErrors.dni && (
                          <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>{operatorErrors.dni}</Text>
                        )}
                      </View>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <View style={styles.fieldHeaderRow}>
                          <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Teléfono (10 dígitos) *</Text>
                          <Text style={[styles.fieldCounterText, { color: nuevoTelefono.length === 10 ? '#22C55E' : colors.text.disabled }]}>
                            {nuevoTelefono.length}/10 dígitos
                          </Text>
                        </View>
                        <TextInput
                          style={[
                            styles.modalInput,
                            {
                              backgroundColor: colors.bg.elevated,
                              borderColor: operatorTouched.telefono && operatorErrors.telefono ? colors.semantic.danger : colors.border.default,
                              color: colors.text.primary,
                            },
                          ]}
                          placeholder="ej: 3704123456"
                          placeholderTextColor={colors.text.disabled}
                          value={nuevoTelefono}
                          onChangeText={(text) => handleOperatorChangeText('telefono', text)}
                          onBlur={() => handleOperatorBlur('telefono', nuevoTelefono)}
                          keyboardType="numeric"
                          maxLength={10}
                        />
                        {operatorTouched.telefono && operatorErrors.telefono && (
                          <Text style={[styles.fieldErrorText, { color: colors.semantic.danger }]}>{operatorErrors.telefono}</Text>
                        )}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Género</Text>
                        <View style={styles.genderChipsContainer}>
                          {[
                            { label: 'Mujer', val: 'Femenino' as const },
                            { label: 'Hombre', val: 'Masculino' as const },
                            { label: 'No Binario', val: 'No binario' as const },
                          ].map((item) => {
                            const isSelected = nuevoGenero === item.val;
                            return (
                              <TouchableOpacity
                                key={item.val}
                                style={[
                                  styles.genderChip,
                                  {
                                    backgroundColor: isSelected ? colors.semantic.infoBg : colors.bg.elevated,
                                    borderColor: isSelected ? colors.semantic.info : colors.border.default,
                                  },
                                ]}
                                onPress={() => setNuevoGenero(item.val)}
                              >
                                <Text
                                  style={[
                                    styles.genderChipText,
                                    {
                                      color: isSelected ? colors.semantic.info : colors.text.secondary,
                                      fontWeight: isSelected ? '700' : '500',
                                    },
                                  ]}
                                >
                                  {item.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </View>
                      <View style={[styles.formRow, { flex: 1 }]}>
                        <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Fecha de Nacimiento *</Text>
                        {Platform.OS === 'web' ? (
                          <input
                            type="date"
                            value={nuevoFechaNac}
                            onChange={(e: any) => handleOperatorChangeText('fecha_nacimiento', e.target.value)}
                            onBlur={(e: any) => handleOperatorBlur('fecha_nacimiento', e.target.value)}
                            style={{
                              height: 42,
                              borderRadius: 6,
                              borderWidth: 1,
                              borderStyle: 'solid',
                              borderColor: operatorTouched.fecha_nacimiento && operatorErrors.fecha_nacimiento ? colors.semantic.danger : colors.border.default,
                              backgroundColor: colors.bg.elevated,
                              color: colors.text.primary,
                              paddingLeft: 12,
                              paddingRight: 12,
                              fontSize: 13,
                              outline: 'none',
                              marginTop: 4,
                              fontFamily: 'inherit',
                            }}
                          />
                        ) : (
                          <TextInput
                            style={[
                              styles.modalInput,
                              {
                                backgroundColor: colors.bg.elevated,
                                borderColor: operatorTouched.fecha_nacimiento && operatorErrors.fecha_nacimiento ? colors.semantic.danger : colors.border.default,
                                color: colors.text.primary,
                              },
                            ]}
                            placeholder="AAAA-MM-DD"
                            placeholderTextColor={colors.text.disabled}
                            value={nuevoFechaNac}
                            onChangeText={(val) => handleOperatorChangeText('fecha_nacimiento', val)}
                            onBlur={() => handleOperatorBlur('fecha_nacimiento', nuevoFechaNac)}
                          />
                        )}
                        {operatorTouched.fecha_nacimiento && operatorErrors.fecha_nacimiento ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <AlertTriangle size={12} color={colors.semantic.danger} />
                            <Text style={[styles.fieldErrorText, { color: colors.semantic.danger, marginTop: 0 }]}>
                              {operatorErrors.fecha_nacimiento}
                            </Text>
                          </View>
                        ) : operatorTouched.fecha_nacimiento && !operatorErrors.fecha_nacimiento && nuevoFechaNac ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <CheckCircle2 size={12} color={colors.semantic.success} />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.semantic.success }}>
                              Mayor de 18 años verificado ({calcularEdad(nuevoFechaNac)} años)
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </>
                )}

                <View style={styles.formRow}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Observaciones / Justificación de Alta</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, color: colors.text.primary }]}
                    placeholder="ej: Asignación por disposición interna N° 402/2026"
                    placeholderTextColor={colors.text.disabled}
                    value={nuevoNotas}
                    onChangeText={setNuevoNotas}
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.submitOperatorBtn,
                    {
                      backgroundColor: colors.semantic.info,
                      opacity: !isOperadorFormValid || creandoOperador ? 0.45 : 1,
                      cursor: !isOperadorFormValid || creandoOperador ? 'not-allowed' : 'pointer',
                    } as any,
                  ]}
                  onPress={handleCrearOperador}
                  disabled={!isOperadorFormValid || creandoOperador}
                >
                  {creandoOperador ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <UserPlus size={18} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
                        Dar de Alta y Activar Operario
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                {!isOperadorFormValid && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -8, marginBottom: spacing.lg }}>
                    <Lock size={13} color={colors.text.disabled} />
                    <Text style={{ fontSize: 11, color: colors.text.disabled, textAlign: 'center' }}>
                      Complete todos los campos con datos válidos para habilitar el registro.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>



      {/* ── MODAL: AGREGAR ROL AUTORIDAD (IRREVERSIBLE AUDITABLE) ── */}
      <Modal visible={showAddAutoridadModal} transparent animationType="fade" onRequestClose={() => setShowAddAutoridadModal(false)}>
        <View style={styles.passwordModalOverlay}>
          <View style={[styles.passwordModalBox, { backgroundColor: colors.bg.surface, borderColor: colors.border.default, maxWidth: 540 }]}>
            {/* Header del Modal */}
            <View style={[styles.adminModalHeader, { borderBottomColor: colors.border.default }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: radii.full, backgroundColor: colors.semantic.infoBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Building size={20} color={colors.semantic.info} />
                </View>
                <View>
                  <Text style={[styles.auditTitle, { color: colors.text.primary }]}>
                    Asignar Rol Autoridad (Policía / Judicial)
                  </Text>
                  <Text style={[styles.auditSubtitle, { color: colors.text.secondary }]}>
                    Operador: <Text style={{ color: colors.semantic.info, fontWeight: '600' }}>{targetAddRoleUser?.nombre} {targetAddRoleUser?.apellido}</Text>
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowAddAutoridadModal(false)} style={styles.closeBtn}>
                <X size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            {/* Contenido: Adscripción Institucional 3FN Formosa */}
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <View style={[styles.alertSuccessBox, { backgroundColor: '#331B0A', borderColor: '#F59E0B', marginBottom: 4 }]}>
                <AlertTriangle size={16} color="#F59E0B" style={{ marginRight: 8 }} />
                <Text style={{ color: '#FCD34D', fontSize: 12, lineHeight: 16 }}>
                  Atención: La asignación del rol Autoridad es estrictamente irreversible por razones de auditoría y trazabilidad institucional.
                </Text>
              </View>

              <View style={styles.formRow}>
                <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Institución de Pertenencia *</Text>
                {Platform.OS === 'web' ? (
                  <select
                    value={addAutoridadInstitucionId ?? ''}
                    onChange={(e: any) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      setAddAutoridadInstitucionId(val);
                      const primerDep = dependencias.find((d) => d.id_institucion === val);
                      setAddAutoridadDependenciaId(primerDep ? primerDep.id_dependencia : null);
                      const primerSede = primerDep ? sedes.find((s) => s.id_dependencia === primerDep.id_dependencia) : null;
                      setAddAutoridadSedeId(primerSede ? primerSede.id_sede : null);
                    }}
                    style={{
                      height: 42,
                      borderRadius: radii.sm,
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor: colors.border.default,
                      backgroundColor: colors.bg.elevated,
                      color: colors.text.primary,
                      paddingLeft: 12,
                      paddingRight: 12,
                      fontSize: 13,
                      outline: 'none',
                      marginTop: 4,
                      fontFamily: 'inherit',
                      width: '100%',
                    }}
                  >
                    {instituciones.map((inst) => (
                      <option key={inst.id_institucion} value={inst.id_institucion} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                        {inst.nombre} ({inst.tipo_organismo})
                      </option>
                    ))}
                  </select>
                ) : null}
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[styles.formRow, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Dependencia / Unidad *</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={addAutoridadDependenciaId ?? ''}
                      onChange={(e: any) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setAddAutoridadDependenciaId(val);
                        const primerSede = sedes.find((s) => s.id_dependencia === val);
                        setAddAutoridadSedeId(primerSede ? primerSede.id_sede : null);
                      }}
                      style={{
                        height: 42,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: colors.border.default,
                        backgroundColor: colors.bg.elevated,
                        color: colors.text.primary,
                        paddingLeft: 12,
                        paddingRight: 12,
                        fontSize: 13,
                        outline: 'none',
                        marginTop: 4,
                        fontFamily: 'inherit',
                        width: '100%',
                      }}
                    >
                      {dependencias
                        .filter((d) => !addAutoridadInstitucionId || d.id_institucion === addAutoridadInstitucionId)
                        .map((dep) => (
                          <option key={dep.id_dependencia} value={dep.id_dependencia} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                            {dep.nombre}
                          </option>
                        ))}
                    </select>
                  ) : null}
                </View>

                <View style={[styles.formRow, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Sede Física *</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={addAutoridadSedeId ?? ''}
                      onChange={(e: any) => setAddAutoridadSedeId(e.target.value ? Number(e.target.value) : null)}
                      style={{
                        height: 42,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: colors.border.default,
                        backgroundColor: colors.bg.elevated,
                        color: colors.text.primary,
                        paddingLeft: 12,
                        paddingRight: 12,
                        fontSize: 13,
                        outline: 'none',
                        marginTop: 4,
                        fontFamily: 'inherit',
                        width: '100%',
                      }}
                    >
                      {sedes
                        .filter((s) => !addAutoridadDependenciaId || s.id_dependencia === addAutoridadDependenciaId)
                        .map((sede) => (
                          <option key={sede.id_sede} value={sede.id_sede} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                            {sede.nombre_sede} ({sede.direccion})
                          </option>
                        ))}
                    </select>
                  ) : null}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[styles.formRow, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Cargo Institucional *</Text>
                  {Platform.OS === 'web' ? (
                    <select
                      value={addAutoridadCargoId ?? ''}
                      onChange={(e: any) => setAddAutoridadCargoId(e.target.value ? Number(e.target.value) : null)}
                      style={{
                        height: 42,
                        borderRadius: radii.sm,
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: colors.border.default,
                        backgroundColor: colors.bg.elevated,
                        color: colors.text.primary,
                        paddingLeft: 12,
                        paddingRight: 12,
                        fontSize: 13,
                        outline: 'none',
                        marginTop: 4,
                        fontFamily: 'inherit',
                        width: '100%',
                      }}
                    >
                      {cargos.map((c) => (
                        <option key={c.id_cargo} value={c.id_cargo} style={{ backgroundColor: '#1E293B', color: '#F8FAFC' }}>
                          {c.nombre_cargo}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </View>

                <View style={[styles.formRow, { flex: 1 }]}>
                  <Text style={[styles.inputLabel, { color: colors.text.secondary }]}>Legajo / Matrícula Personal *</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: colors.bg.elevated, borderColor: colors.border.default, color: colors.text.primary }]}
                    placeholder="ej: LP-POL-10823"
                    placeholderTextColor={colors.text.disabled}
                    value={addAutoridadLegajo}
                    onChangeText={setAddAutoridadLegajo}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <TouchableOpacity
                  style={[styles.secondaryModalBtn, { borderColor: colors.border.default }]}
                  onPress={() => setShowAddAutoridadModal(false)}
                >
                  <Text style={{ color: colors.text.primary, fontWeight: '600', fontSize: 13 }}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.primaryModalBtn,
                    {
                      backgroundColor: colors.semantic.info,
                      opacity: !addAutoridadSedeId || !addAutoridadLegajo.trim() ? 0.45 : 1,
                      cursor: !addAutoridadSedeId || !addAutoridadLegajo.trim() ? 'not-allowed' : 'pointer',
                    } as any,
                  ]}
                  onPress={handleConfirmarAgregarAutoridad}
                  disabled={!addAutoridadSedeId || !addAutoridadLegajo.trim()}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>Asignar Rol Autoridad</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modales y HUD de Notificaciones */}
      {renderConfirmModal()}
      {renderToastNotification()}
      {renderRecoveryModal()}
    </View>
  );
}

// ── ESTILOS DEL PANEL WEB DE CONTROL ──────────────────────────────────────────
const styles = StyleSheet.create({
  // Contenedor principal de la aplicación
  container: {
    flex: 1,
    height: '100vh' as any,
    width: '100vw' as any,
    overflow: 'hidden',
  },
  // Pantalla de Login
  authContainer: {
    flex: 1,
    height: '100vh' as any,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  authCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    position: 'relative',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)' as any,
  },
  themeToggleCardBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 36,
    height: 36,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  authLogoBox: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  authLogo: {
    width: 84,
    height: 84,
  },
  authTitle: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: 4,
  },
  authRoleTag: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radii.full,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  authSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputWrapper: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  textInput: {
    fontSize: 14,
    outlineWidth: 0 as any,
  },
  primaryButton: {
    paddingVertical: 12,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  securityNotice: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 15,
  },

  // Header del Panel Principal
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    zIndex: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerLogo: {
    width: 38,
    height: 38,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  headerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  alertIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    marginRight: 6,
  },
  alertIndicatorText: {
    fontSize: 12,
    fontWeight: '700',
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  headerAdminBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Layout Dividido
  mainLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 380,
    borderRightWidth: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    outlineWidth: 0 as any,
  },
  filterBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  filterTabActive: {
    borderBottomWidth: 2,
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    fontSize: 13,
    marginTop: spacing.sm,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },

  // Tarjetas de Incidente
  incidentCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  victimName: {
    fontSize: 14,
    fontWeight: '700',
  },
  addressText: {
    fontSize: 12,
    flexShrink: 1,
  },
  stateBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  stateBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(150, 150, 150, 0.1)',
  },
  timeText: {
    fontSize: 11,
  },
  originTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  originTagText: {
    fontSize: 10,
    fontWeight: '600',
  },

  // Área del Mapa
  mapArea: {
    flex: 1,
    position: 'relative',
  },

  // Drawer Flotante de Inspección
  inspectionDrawer: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 380,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
    zIndex: 30,
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.35)' as any,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  drawerIdText: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  drawerCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerInfoBlock: {
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 8,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    width: 85,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  drawerActions: {
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Modal de Auditoría
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auditCard: {
    width: '100%',
    maxWidth: 720,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' as any,
  },
  auditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  auditIconBox: {
    width: 42,
    height: 42,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  auditTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  auditSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  evidenceRowCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  evidenceRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  evidenceBadgeNum: {
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  evidenceTipo: {
    fontSize: 13,
    fontWeight: '700',
  },
  evidenceTime: {
    fontSize: 11,
  },
  evidenceDetailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  evidenceLabel: {
    fontSize: 11,
    fontWeight: '600',
    width: 85,
  },
  evidenceHash: {
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
  },
  evidenceTsaStatus: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Modal de Administración de Operadores
  adminModalCard: {
    width: '100%',
    maxWidth: 820,
    maxHeight: '85vh' as any,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' as any,
  },
  adminModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
  },
  adminTabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  adminTabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminTabBtnText: {
    fontSize: 13,
  },
  adminModalBody: {
    padding: spacing.lg,
    maxHeight: '65vh' as any,
  },
  loadingBox: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyUsersBox: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRowCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    gap: 16,
  },
  userNameText: {
    fontSize: 15,
    fontWeight: '700',
  },
  userRoleTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  userStatusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  personalDataChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  institutionalBoxClean: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    width: '100%',
    marginTop: 4,
  },
  institutionalIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  userActionBtnClean: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    cursor: 'pointer' as any,
  },
  userEmailText: {
    fontSize: 12,
    marginTop: 2,
  },
  userDescText: {
    fontSize: 11,
    marginTop: 2,
    fontStyle: 'italic',
  },
  userActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  alertSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  formRow: {
    marginBottom: spacing.md,
  },
  modalInput: {
    height: 42,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontSize: 13,
    marginTop: 4,
  },
  roleSelectCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'flex-start',
    gap: 4,
  },
  roleSelectTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  roleSelectDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  submitOperatorBtn: {
    height: 44,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  filterToggleBtn: {
    padding: 6,
    borderRadius: radii.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  advancedFiltersPanel: {
    marginTop: 8,
    padding: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 8,
  },
  filterFieldRow: {
    gap: 4,
  },
  filterFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  filterInput: {
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    fontSize: 12,
  },
  clearFilterChip: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearAllFiltersBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 2,
  },
  genderChipsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  genderChip: {
    flex: 1,
    height: 40,
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  genderChipText: {
    fontSize: 13,
  },
  institutionalBadgeBox: {
    padding: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginTop: 4,
    gap: 2,
  },
  passwordModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  passwordModalBox: {
    width: '100%',
    maxWidth: 440,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' as any,
  },
  primaryModalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryModalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldErrorText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    marginLeft: 2,
  },
  passwordChecklistContainer: {
    marginTop: 6,
    padding: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 4,
  },
  passwordChecklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passwordChecklistText: {
    fontSize: 11,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  fieldCounterText: {
    fontSize: 11,
    fontWeight: '600',
  },
  ageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    marginTop: 4,
    gap: 4,
  },
  // Modal de confirmación SweetAlert2
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    zIndex: 9999,
  },
  confirmModalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1.5,
    alignItems: 'center',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' as any,
  },
  confirmIconContainer: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  confirmModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  confirmModalMessage: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
    justifyContent: 'center',
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  confirmAcceptBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmAcceptText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  // Modal de Recuperación
  recoveryModalBox: {
    width: '100%',
    maxWidth: 460,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' as any,
  },
  forgotPasswordBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  // Barras de Paginación Estricta (10 en 10)
  paginationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  pageBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed' as any,
  },
  pageBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pageIndicatorText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Vinculación de Civil
  searchCivilBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: 6,
    maxHeight: 160,
  },
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  linkedCivilBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  unlinkBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
  },
  // Toast Notification Flotante (Reemplazo de alert nativo)
  toastContainer: {
    position: 'fixed' as any,
    top: 24,
    right: 24,
    zIndex: 99999,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 440,
    minWidth: 320,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radii.md,
    borderWidth: 1.5,
    gap: 12,
  },
  toastIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toastContentWrapper: {
    flex: 1,
    paddingRight: 6,
  },
  toastTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 3,
  },
  toastMessage: {
    fontSize: 12,
    lineHeight: 17,
  },
  toastCloseBtn: {
    padding: 6,
    borderRadius: radii.sm,
    cursor: 'pointer' as any,
  },
});
