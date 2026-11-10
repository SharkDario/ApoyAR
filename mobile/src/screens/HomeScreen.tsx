// src/screens/HomeScreen.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CU-05 / RF-2.4 — Activación deliberada de emergencia (Home - Modo Resguardo)
// CU-04 / RF-2.1 — Escucha en vivo (Edge AI: Vosk palabra clave + YAMNet violencia ambiental)
// CU-03 / RF-1.3 — Modo Invisible (Calculadora señuelo y privacidad)
//
// Diseño: docs/12-plan-iteracion-2.md §2.1 & §2.2
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  ScrollView,
  Modal,
  FlatList,
  Switch,
  Alert,
  TextInput,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
  KeyboardAvoidingView,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioModule,
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { useTheme } from '@theme';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useSos } from '../contexts/SosContext';
import { acousticMonitoringService, TriggerOrigin, normalizarPalabraClave, STORAGE_KEY_KEYWORD } from '../services/acousticMonitoring';
import { resguardoService } from '../services/resguardoService';
import { STORAGE_KEY_CAMOUFLAGE_PIN, DEFAULT_CAMOUFLAGE_PIN, isCamouflageVisible } from './FakeCalculatorScreen';
import { EvidenceModal } from '../components/EvidenceModal';
import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import { emitirNotificacionLocal, descartarNotificacionesUsuario } from '../lib/pushNotifications';
import { resolverDireccionAsync, esSoloCoordenadas } from '../lib/geoUtils';
import { BatteryOptimizationModal } from '../components/BatteryOptimizationModal';
import { BackgroundPermissionsModal } from '../components/BackgroundPermissionsModal';
import { AvisoUbicacionModal } from '../components/AvisoUbicacionModal';
import { debeMostrarAvisoBateriaAsync } from '../services/batteryOptimizationService';
import { getMfaStatusAsync, desactivarMfaAsync } from '../services/mfaService';
import { InfoRow, DateFilterBar, CalendarModal, KeyboardAvoidingWrapper, MfaSecurityModal, type FiltroFechaRapido } from '../components';
import { CameraCaptureModal } from '../components/CameraCaptureModal';
import { PrivacyInfoModal } from '../components/PrivacyInfoModal';
import { verificarIdentidadLocalAsync } from '../lib/verificacionLocal';
import {
  botonesFisicosDisponibles,
  cargarPreferenciaBotonesAsync,
  guardarPreferenciaBotonesAsync,
  registrarManejadorPantalla,
} from '../services/botonesFisicos';

type Props = NativeStackScreenProps<any, 'Home'>;

export interface AlertaItem {
  id: string; // incidente_id
  victimaId: string;
  victimaNombre: string;
  direccion: string;
  latitud: number;
  longitud: number;
  origen: string;
  estado: string;
  fechaHora: string;
  lastLocationAt?: string | null;
  esPropia: boolean;
}

export const HEARTBEAT_TIMEOUT_SECONDS = 90;

export function evaluarEstadoAlerta(
  estadoBase: string,
  lastLocationAt?: string | null,
  fechaHora?: string
): 'en_curso' | 'sin_senal' | 'finalizada' {
  if (estadoBase !== 'en_curso') {
    return 'finalizada';
  }
  const refTime = lastLocationAt || fechaHora;
  if (!refTime) return 'en_curso';
  const diffSec = (Date.now() - new Date(refTime).getTime()) / 1000;
  if (diffSec > HEARTBEAT_TIMEOUT_SECONDS) {
    return 'sin_senal';
  }
  return 'en_curso';
}

const MULTI_TAP_TARGET = 3;
const MULTI_TAP_WINDOW_MS = 1500;
const STORAGE_KEY_AUTO_CAMOUFLAGE = '@apoyar_camuflaje_activo';

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors, typography, spacing, radii, isDark, toggleTheme } = useTheme();
  const { signOut, user, persona, actualizarPersona, refreshPersona } = useAuth();
  const {
    enModoResguardo,
    agregarAlertaPendiente,
    alertasPendientes,
    limpiarAlertasPendientes,
    setModoResguardo,
  } = useSos();

  const enModoResguardoRef = useRef(enModoResguardo);
  useEffect(() => {
    enModoResguardoRef.current = enModoResguardo;
  }, [enModoResguardo]);

  // ── Estados Principales ────────────────────────────────────────────────────
  const [tapCount, setTapCount] = useState(0);
  const [networkCount, setNetworkCount] = useState(0);
  const [firstContactName, setFirstContactName] = useState<string | null>(null);
  const [showPendingAlerts, setShowPendingAlerts] = useState(false);

  // Menú Hamburguesa, Perfil y Mis Pruebas
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editNombre, setEditNombre] = useState('');
  const [editApellido, setEditApellido] = useState('');
  const [editDni, setEditDni] = useState('');
  const [editTelefono, setEditTelefono] = useState('');
  const [editDireccion, setEditDireccion] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Derecho de Supresión y Olvido (Ley 25.326 Art. 16)
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Centro de Alertas y Notificaciones Nativas
  const [showAlertsCenter, setShowAlertsCenter] = useState(false);
  const [alertas, setAlertas] = useState<AlertaItem[]>([]);
  const [loadingAlertas, setLoadingAlertas] = useState(false);
  const [unreadAlertsCount, setUnreadAlertsCount] = useState(0);

  // Descarte lógico y filtros de Centro de Alertas (Punto 4)
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());
  const [permanentlyHiddenAlertIds, setPermanentlyHiddenAlertIds] = useState<Set<string>>(new Set());
  const [filtroAlertasRapido, setFiltroAlertasRapido] = useState<FiltroFechaRapido>('todas');
  const [fechaCalendarioAlertas, setFechaCalendarioAlertas] = useState<string | null>(null);
  const [busquedaTextoAlertas, setBusquedaTextoAlertas] = useState<string>('');
  const [verDescartadasAlertas, setVerDescartadasAlertas] = useState<boolean>(false);
  const [showCalendarAlertasModal, setShowCalendarAlertasModal] = useState<boolean>(false);
  const [alertSnackbarMessage, setAlertSnackbarMessage] = useState<string | null>(null);
  const [undoAlertId, setUndoAlertId] = useState<string | null>(null);
  const alertSnackbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alertaActiva = useMemo(() => {
    return (
      alertas.find(
        (a) =>
          a.estado === 'en_curso' &&
          !dismissedAlertIds.has(a.id) &&
          !permanentlyHiddenAlertIds.has(a.id)
      ) || null
    );
  }, [alertas, dismissedAlertIds, permanentlyHiddenAlertIds]);

  // Escucha en vivo
  const [isAcousticActive, setIsAcousticActive] = useState(false);
  const [keywordText, setKeywordText] = useState('pizza');

  // Modal de Configuración de Palabra Clave por Voz
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'processing' | 'done'>('idle');
  const [recognizedKeyword, setRecognizedKeyword] = useState('pizza');
  const voiceAudioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micPulseAnim = useRef(new Animated.Value(1)).current;

  // Modo Invisible
  const [isAutoCamouflage, setIsAutoCamouflage] = useState(false);
  const [isBotonesFisicos, setIsBotonesFisicos] = useState(false);
  const [camouflagePin, setCamouflagePin] = useState(DEFAULT_CAMOUFLAGE_PIN);
  const [pinInput, setPinInput] = useState(DEFAULT_CAMOUFLAGE_PIN);
  const [isEditingPin, setIsEditingPin] = useState(false);

  // Seguridad MFA y Segundo Plano
  const [showBatteryModal, setShowBatteryModal] = useState(false);
  const [showBackgroundModal, setShowBackgroundModal] = useState(false);
  const [showMfaEnrollModal, setShowMfaEnrollModal] = useState(false);
  const [isMfaActive, setIsMfaActive] = useState(false);
  const [checkingMfa, setCheckingMfa] = useState(false);

  // Animación del botón SOS
  const idlePulse = useRef(new Animated.Value(0)).current;

  // ── Función auxiliar de permisos de micrófono ──────────────────────────────
  const solicitarPermisoMicrofono = useCallback(async (): Promise<boolean> => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Permiso de Micrófono para ApoyAR',
            message: 'ApoyAR necesita acceso al micrófono para la Escucha en vivo y la captura de tu palabra clave de auxilio.',
            buttonPositive: 'Permitir',
            buttonNegative: 'Cancelar',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permiso Denegado', 'No se concedió acceso al micrófono para el monitoreo acústico.');
          return false;
        }
      }

      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permiso Denegado', 'Se requiere acceso al micrófono para continuar.');
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[Audio] Error solicitando permisos de micrófono:', err);
      return false;
    }
  }, []);

  // ── Función auxiliar de permisos de ubicación preventiva (Foreground + Background) ───
  const solicitarPermisosUbicacion = useCallback(async (): Promise<boolean> => {
    try {
      let { status: fgStatus } = await Location.getForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        const fgReq = await Location.requestForegroundPermissionsAsync();
        fgStatus = fgReq.status;
      }

      if (fgStatus !== 'granted') {
        console.warn('[HomeScreen] Permiso de ubicación en primer plano no concedido.');
        return false;
      }

      // Android 11+: después de conceder Foreground, solicitar "Permitir todo el tiempo" (ACCESS_BACKGROUND_LOCATION)
      let { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        const bgReq = await Location.requestBackgroundPermissionsAsync();
        bgStatus = bgReq.status;
      }

      return fgStatus === 'granted';
    } catch (err) {
      console.warn('[HomeScreen] Error solicitando permisos de ubicación inicial:', err);
      return false;
    }
  }, []);

  // ── Inicialización ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Inicializar servicio acústico
    acousticMonitoringService
      .initAsync((origen: TriggerOrigin) => {
        // Si la app está en primer plano y NO está activa la pantalla de la Calculadora, navega a Countdown.
        // Si está en segundo plano o dentro del Modo Invisible, acousticMonitoringService ya activó el resguardo de forma 100% autónoma y silenciosa.
        if (AppState.currentState === 'active' && !isCamouflageVisible()) {
          navigation.navigate('Countdown', { origen });
        }
      })
      .then((active) => {
        setIsAcousticActive(active);
        const kw = acousticMonitoringService.getKeyword();
        setKeywordText(kw);
        setRecognizedKeyword(kw);
      });

    // Sincronizar estado cuando la app vuelve a primer plano
    const subAppState = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        setIsAcousticActive(acousticMonitoringService.isActive());
        if (resguardoService.isResguardoActive()) {
          setModoResguardo(true);
        }
      }
    });

    // Cargar preferencia de inicio en Modo Invisible
    AsyncStorage.getItem(STORAGE_KEY_AUTO_CAMOUFLAGE).then((val) => {
      setIsAutoCamouflage(val === 'true');
    });

    // Cargar preferencia de activación con botones de volumen (RF-2.4)
    cargarPreferenciaBotonesAsync().then(setIsBotonesFisicos);

    // Cargar PIN configurado
    AsyncStorage.getItem(STORAGE_KEY_CAMOUFLAGE_PIN).then((val) => {
      if (val && /^\d{4}$/.test(val.trim())) {
        setCamouflagePin(val.trim());
        setPinInput(val.trim());
      } else {
        setCamouflagePin(DEFAULT_CAMOUFLAGE_PIN);
        setPinInput(DEFAULT_CAMOUFLAGE_PIN);
      }
    });

    return () => {
      subAppState.remove();
    };
  }, [navigation, setModoResguardo]);

  // ── Activación con 3 pulsaciones de Volumen abajo (RF-2.4) ────────────────
  // Con la app a la vista se muestra la cuenta regresiva. El resto de los casos
  // (Modo Invisible, segundo plano, pantalla apagada) los resuelve botonesFisicos.ts.
  useEffect(() => {
    return registrarManejadorPantalla(() => {
      navigation.navigate('Countdown', { origen: 'botones_fisicos' });
    });
  }, [navigation]);

  // ── Sincronizar palabra clave guardada en el perfil de persona ─────────────
  useEffect(() => {
    if (persona?.palabraClave_encriptada && persona.palabraClave_encriptada.trim()) {
      const kw = normalizarPalabraClave(persona.palabraClave_encriptada);
      acousticMonitoringService.setKeywordAsync(kw);
      setKeywordText(kw);
      setRecognizedKeyword(kw);
    }
  }, [persona?.palabraClave_encriptada]);

  // ── Cargar Centro de Alertas (Alertas recibidas de la Red de Apoyo) ─────────
  const cargarCentroAlertas = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoadingAlertas(true);

      // Alertas recibidas como contacto de emergencia
      // (Excluimos las propias para no alertarse a sí mismo - Problema 4)
      const { data: alertasRecibidas } = await supabase
        .from('alerta_temprana')
        .select(`
          aletem_id_alerta,
          aletem_enviada_en,
          aletem_leida_en,
          incidente:inc_id_incidente (
            inc_id_incidente,
            usu_id_victima,
            inc_victima_nombre,
            inc_direccion,
            inc_latitud,
            inc_longitud,
            inc_origen,
            inc_estado,
            inc_fecha_hora,
            inc_ultima_ubicacion_en
          )
        `)
        .eq('usu_id_contacto', user.id)
        .order('aletem_enviada_en', { ascending: false })
        .limit(25);

      const items: AlertaItem[] = [];
      const idsVistos = new Set<string>();

      if (alertasRecibidas) {
        for (const a of alertasRecibidas) {
          const rawInc = (a as any).incidente;
          const incId = rawInc?.inc_id_incidente || rawInc?.id;
          const vicId = rawInc?.usu_id_victima || rawInc?.victima_id;
          // Validar que el incidente exista y no sea propio
          if (rawInc && incId && !idsVistos.has(incId) && vicId !== user.id) {
            idsVistos.add(incId);
            items.push({
              id: incId,
              victimaId: vicId,
              victimaNombre: rawInc.inc_victima_nombre || rawInc.victima_nombre || 'Contacto de mi Red',
              direccion: rawInc.inc_direccion || rawInc.direccion || 'Ubicación de emergencia',
              latitud: Number(rawInc.inc_latitud ?? rawInc.latitud ?? -34.603722),
              longitud: Number(rawInc.inc_longitud ?? rawInc.longitud ?? -58.381592),
              origen: rawInc.inc_origen || rawInc.origen || 'automatico',
              estado: rawInc.inc_estado || rawInc.estado || 'finalizado',
              fechaHora: rawInc.inc_fecha_hora || rawInc.fecha_hora || (a as any).aletem_enviada_en || (a as any).enviada_en || new Date().toISOString(),
              lastLocationAt: rawInc.inc_ultima_ubicacion_en || rawInc.inc_last_location_at || rawInc.last_location_at || rawInc.inc_fecha_hora || rawInc.fecha_hora,
              esPropia: false,
            });
          }
        }
      }

      // Orden cronológico descendente (más recientes primero)
      items.sort((a, b) => new Date(b.fechaHora).getTime() - new Date(a.fechaHora).getTime());

      // REGLA CLAVE (Problema 3): Solo la ÚLTIMA alerta de cada persona cuenta como "En curso"
      // Además, se evalúa el heartbeat (last_location_at <= 90s)
      const victimasConAlertaActiva = new Set<string>();
      const itemsNormalizados = items.map((item) => {
        const estadoEvaluado = evaluarEstadoAlerta(item.estado, item.lastLocationAt, item.fechaHora);
        if (estadoEvaluado === 'en_curso') {
          if (victimasConAlertaActiva.has(item.victimaId)) {
            // Ya hay una alerta más reciente de este emisor activa
            return { ...item, estado: 'finalizada' };
          } else {
            victimasConAlertaActiva.add(item.victimaId);
            return { ...item, estado: 'en_curso' };
          }
        }
        return { ...item, estado: estadoEvaluado };
      });

      setAlertas(itemsNormalizados);

      const activas = itemsNormalizados.filter(
        (x) =>
          x.estado === 'en_curso' &&
          !dismissedAlertIds.has(x.id) &&
          !permanentlyHiddenAlertIds.has(x.id)
      );
      setUnreadAlertsCount(activas.length);

      // Enriquecer en segundo plano cualquier alerta que tenga coordenadas o dirección genérica
      const itemsConCoordenadas = itemsNormalizados.filter(
        (it) => esSoloCoordenadas(it.direccion) && typeof it.latitud === 'number' && typeof it.longitud === 'number'
      );
      if (itemsConCoordenadas.length > 0) {
        Promise.all(
          itemsConCoordenadas.map(async (it) => {
            try {
              const dir = await resolverDireccionAsync(it.latitud, it.longitud);
              return { id: it.id, dir };
            } catch {
              return { id: it.id, dir: it.direccion };
            }
          })
        ).then((resueltas) => {
          setAlertas((prev) =>
            prev.map((item) => {
              const match = resueltas.find((r) => r.id === item.id);
              if (match && !esSoloCoordenadas(match.dir)) {
                return { ...item, direccion: match.dir };
              }
              return item;
            })
          );
        });
      }
    } catch (e) {
      console.warn('[Alertas] Error cargando centro de alertas:', e);
    } finally {
      setLoadingAlertas(false);
    }
  }, [user?.id, dismissedAlertIds, permanentlyHiddenAlertIds]);

  // ── Sincronización y Persistencia de Descarte Lógico de Alertas (Punto 4) ─
  useEffect(() => {
    if (!user?.id) return;
    const storageKey = `@apoyar:dismissed_alerts_${user.id}`;
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setDismissedAlertIds((prev) => new Set([...prev, ...parsed]));
          }
        } catch { }
      }
    });

    // Cargar bajas lógicas definitivas (alertas eliminadas permanentemente de la papelera)
    const hiddenStorageKey = `@apoyar:permanently_hidden_${user.id}`;
    AsyncStorage.getItem(hiddenStorageKey).then((saved) => {
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setPermanentlyHiddenAlertIds(new Set(parsed));
          }
        } catch { }
      }
    });

    // Sincronización secundaria con Supabase (no bloqueante, tolera si la tabla aún no se migró)
    supabase
      .from('descarte_alerta')
      .select('inc_id_incidente')
      .eq('usu_id_usuario', user.id)
      .then(
        ({ data, error }) => {
          if (!error && data && data.length > 0) {
            setDismissedAlertIds((prev) => {
              const next = new Set(prev);
              data.forEach((r: any) => next.add(r.inc_id_incidente || r.alert_id));
              AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
              return next;
            });
          }
        },
        () => { }
      );
  }, [user?.id]);

  // Actualizar contador no leídas ignorando descartadas y bajas lógicas
  useEffect(() => {
    const activas = alertas.filter(
      (x) =>
        x.estado === 'en_curso' &&
        !dismissedAlertIds.has(x.id) &&
        !permanentlyHiddenAlertIds.has(x.id)
    );
    setUnreadAlertsCount(activas.length);
  }, [alertas, dismissedAlertIds, permanentlyHiddenAlertIds]);

  const descartadasCount = useMemo(() => {
    return alertas.filter(
      (a) => dismissedAlertIds.has(a.id) && !permanentlyHiddenAlertIds.has(a.id)
    ).length;
  }, [alertas, dismissedAlertIds, permanentlyHiddenAlertIds]);

  const fechasConAlertas = useMemo(() => {
    const dates = new Set<string>();
    for (const a of alertas) {
      if (!dismissedAlertIds.has(a.id) && !permanentlyHiddenAlertIds.has(a.id)) {
        const d = new Date(a.fechaHora);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        dates.add(`${dd}/${mm}/${yyyy}`);
      }
    }
    return dates;
  }, [alertas, dismissedAlertIds, permanentlyHiddenAlertIds]);

  const alertasFiltradas = useMemo(() => {
    return alertas.filter((a) => {
      // Si la alerta tiene baja lógica definitiva, NUNCA se muestra (ni en activas ni en papelera)
      if (permanentlyHiddenAlertIds.has(a.id)) return false;

      const isDismissed = dismissedAlertIds.has(a.id);
      if (verDescartadasAlertas) {
        if (!isDismissed) return false;
      } else {
        if (isDismissed) return false;
      }

      // Filtro de texto
      if (busquedaTextoAlertas.trim()) {
        const q = busquedaTextoAlertas.toLowerCase().trim();
        const vNom = (a.victimaNombre || '').toLowerCase();
        const vDir = (a.direccion || '').toLowerCase();
        if (!vNom.includes(q) && !vDir.includes(q)) {
          return false;
        }
      }

      // Filtro de fecha
      if (fechaCalendarioAlertas) {
        const parts = fechaCalendarioAlertas.split('/');
        if (parts.length === 3) {
          const d = new Date(a.fechaHora);
          const dia = parseInt(parts[0], 10);
          const mes = parseInt(parts[1], 10) - 1;
          const anio = parseInt(parts[2], 10);
          return (
            d.getDate() === dia &&
            d.getMonth() === mes &&
            d.getFullYear() === anio
          );
        }
      }

      if (filtroAlertasRapido === 'hoy') {
        const d = new Date(a.fechaHora);
        const hoy = new Date();
        return (
          d.getDate() === hoy.getDate() &&
          d.getMonth() === hoy.getMonth() &&
          d.getFullYear() === hoy.getFullYear()
        );
      }

      if (filtroAlertasRapido === '7dias') {
        const d = new Date(a.fechaHora);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffDias = diffMs / (1000 * 60 * 60 * 24);
        return diffDias >= 0 && diffDias <= 7;
      }

      return true;
    });
  }, [
    alertas,
    dismissedAlertIds,
    permanentlyHiddenAlertIds,
    verDescartadasAlertas,
    busquedaTextoAlertas,
    fechaCalendarioAlertas,
    filtroAlertasRapido,
  ]);

  const handleDescartarAlerta = useCallback((alertId: string) => {
    if (!user?.id) return;
    const storageKey = `@apoyar:dismissed_alerts_${user.id}`;
    setDismissedAlertIds((prev) => {
      const next = new Set(prev);
      next.add(alertId);
      AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });

    supabase
      .from('descarte_alerta')
      .upsert({
        usu_id_usuario: user.id,
        inc_id_incidente: alertId,
        desale_descartado_en: new Date().toISOString(),
      })
      .then(() => { }, () => { });

    setUndoAlertId(alertId);
    setAlertSnackbarMessage('Alerta descartada');

    if (alertSnackbarTimerRef.current) {
      clearTimeout(alertSnackbarTimerRef.current);
    }
    alertSnackbarTimerRef.current = setTimeout(() => {
      setAlertSnackbarMessage(null);
      setUndoAlertId(null);
    }, 4000);
  }, [user?.id]);

  const handleDeshacerDescarte = useCallback(() => {
    if (!undoAlertId || !user?.id) return;
    const alertIdToRestore = undoAlertId;
    const storageKey = `@apoyar:dismissed_alerts_${user.id}`;

    setDismissedAlertIds((prev) => {
      const next = new Set(prev);
      next.delete(alertIdToRestore);
      AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });

    supabase
      .from('descarte_alerta')
      .delete()
      .match({ usu_id_usuario: user.id, inc_id_incidente: alertIdToRestore })
      .then(() => { }, () => { });

    setAlertSnackbarMessage(null);
    setUndoAlertId(null);
  }, [undoAlertId, user?.id]);

  const handleRestaurarAlerta = useCallback((alertId: string) => {
    if (!user?.id) return;
    const storageKey = `@apoyar:dismissed_alerts_${user.id}`;

    setDismissedAlertIds((prev) => {
      const next = new Set(prev);
      next.delete(alertId);
      AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });

    supabase
      .from('descarte_alerta')
      .delete()
      .match({ usu_id_usuario: user.id, inc_id_incidente: alertId })
      .then(() => { }, () => { });
  }, [user?.id]);

  const handleBajaLogicaAlerta = useCallback((alertId: string) => {
    if (!user?.id) return;
    Alert.alert(
      'Eliminar de Papelera',
      '¿Deseas eliminar definitivamente esta alerta de tu vista? Esta baja lógica la ocultará de forma permanente sin alterar los registros periciales ni forenses.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            const storageKey = `@apoyar:permanently_hidden_${user.id}`;
            setPermanentlyHiddenAlertIds((prev) => {
              const next = new Set(prev);
              next.add(alertId);
              AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
              return next;
            });
            setAlertSnackbarMessage('Alerta eliminada definitivamente');
            if (alertSnackbarTimerRef.current) clearTimeout(alertSnackbarTimerRef.current);
            alertSnackbarTimerRef.current = setTimeout(() => {
              setAlertSnackbarMessage(null);
            }, 3000);
          },
        },
      ]
    );
  }, [user?.id]);

  const handleLimpiarTodoAlertas = useCallback(() => {
    if (alertasFiltradas.length === 0 || !user?.id) return;
    const cantidad = alertasFiltradas.length;

    if (verDescartadasAlertas) {
      // ── MODO PAPELERA: Baja lógica definitiva ──
      Alert.alert(
        'Vaciar Papelera',
        `¿Deseas eliminar definitivamente ${cantidad === 1 ? 'la alerta' : `las ${cantidad} alertas`} de la papelera? Esta baja lógica las ocultará permanentemente sin alterar las auditorías forenses.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Vaciar papelera',
            style: 'destructive',
            onPress: () => {
              const storageKey = `@apoyar:permanently_hidden_${user.id}`;
              setPermanentlyHiddenAlertIds((prev) => {
                const next = new Set(prev);
                alertasFiltradas.forEach((a) => next.add(a.id));
                AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
                return next;
              });

              setAlertSnackbarMessage(
                `${cantidad} alerta${cantidad > 1 ? 's' : ''} eliminada${cantidad > 1 ? 's' : ''} definitivamente`
              );
              setUndoAlertId(null);
              if (alertSnackbarTimerRef.current) clearTimeout(alertSnackbarTimerRef.current);
              alertSnackbarTimerRef.current = setTimeout(() => {
                setAlertSnackbarMessage(null);
              }, 3000);
            },
          },
        ]
      );
    } else {
      // ── MODO ACTIVAS: Mover a la papelera (descarte local) ──
      Alert.alert(
        'Limpiar Alertas',
        `¿Deseas enviar ${cantidad === 1 ? 'la alerta' : `las ${cantidad} alertas`} visible${cantidad > 1 ? 's' : ''} a la papelera? Podrás consultarlas o restaurarlas en cualquier momento.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Mandar a papelera',
            style: 'destructive',
            onPress: () => {
              const storageKey = `@apoyar:dismissed_alerts_${user.id}`;
              setDismissedAlertIds((prev) => {
                const next = new Set(prev);
                alertasFiltradas.forEach((a) => next.add(a.id));
                AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
                return next;
              });

              const rows = alertasFiltradas.map((a) => ({
                usu_id_usuario: user.id,
                inc_id_incidente: a.id,
                desale_descartado_en: new Date().toISOString(),
              }));
              supabase
                .from('descarte_alerta')
                .upsert(rows)
                .then(() => { }, () => { });

              setAlertSnackbarMessage(
                `${cantidad} alerta${cantidad > 1 ? 's' : ''} enviada${cantidad > 1 ? 's' : ''} a la papelera`
              );
              setUndoAlertId(null);
              if (alertSnackbarTimerRef.current) clearTimeout(alertSnackbarTimerRef.current);
              alertSnackbarTimerRef.current = setTimeout(() => {
                setAlertSnackbarMessage(null);
              }, 3000);
            },
          },
        ]
      );
    }
  }, [alertasFiltradas, user?.id, verDescartadasAlertas]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      // Sincronizar si Modo Resguardo se activó silenciosamente durante el Modo Invisible o en segundo plano
      if (resguardoService.isResguardoActive()) {
        setModoResguardo(true);
      }
      setIsAcousticActive(acousticMonitoringService.isActive());

      const fetchNet = async () => {
        try {
          const {
            data: { user: currentUser },
          } = await supabase.auth.getUser();
          if (!currentUser) return;
          const { data, error } = await supabase.rpc('obtener_red', {
            p_victima_id: currentUser.id,
          });
          if (!error && data && active) {
            setNetworkCount(data.length);
            if (data.length > 0) {
              setFirstContactName(`${data[0].nombre} ${data[0].apellido}`);
            } else {
              setFirstContactName(null);
            }
          }
        } catch (e) {
          // Errores de red transitorios
        }
      };
      fetchNet();
      cargarCentroAlertas();
      return () => {
        active = false;
      };
    }, [cargarCentroAlertas])
  );

  const cargarCentroAlertasRef = useRef(cargarCentroAlertas);
  cargarCentroAlertasRef.current = cargarCentroAlertas;

  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  // ── Listener Unificado de Notificaciones Nativas y Supabase Realtime ───────
  useEffect(() => {
    if (!user?.id) return;

    cargarCentroAlertasRef.current();

    // 1. Manejador Cold Start: Si la app se abrió desde una notificación del sistema
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          const data = response.notification.request.content.data;
          if (data && data.incidenteId) {
            navigation.navigate('AlertReceived', {
              incidenteId: data.incidenteId,
              victimName: data.victimName || 'Tu contacto',
              victimPhone: data.victimPhone || 'Emergencia',
              address: data.address || 'Ubicación de emergencia',
              latitude: data.latitude,
              longitude: data.longitude,
              origen: data.origen,
            });
          }
        }
      })
      .catch(() => { });

    // 2. Manejador de tap en la notificación nativa (App en background o foreground)
    const notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data && data.incidenteId) {
        navigation.navigate('AlertReceived', {
          incidenteId: data.incidenteId,
          victimName: data.victimName || 'Tu contacto',
          victimPhone: data.victimPhone || 'Emergencia',
          address: data.address || 'Ubicación de emergencia',
          latitude: data.latitude,
          longitude: data.longitude,
          origen: data.origen,
        });
      }
    });

    // 3. Canal Realtime Seguro: Único canal por usuario con registro ordenado
    const channelName = `home_realtime_${user.id}`;
    const canales = supabase.getChannels();
    for (const c of canales) {
      if (c.topic === `realtime:${channelName}`) {
        supabase.removeChannel(c);
      }
    }

    const channel = supabase.channel(channelName);

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidente' },
        async (payload) => {
          cargarCentroAlertasRef.current();

          const currentUid = userIdRef.current;
          if (payload.eventType === 'INSERT') {
            const inc = payload.new as any;
            const incId = inc.inc_id_incidente || inc.id;
            const vicId = inc.usu_id_victima || inc.victima_id;
            const incEstado = inc.inc_estado || inc.estado;
            // Solo notificar si es una alerta nueva en curso de OTRA persona (Problema 4)
            if (inc && incEstado === 'en_curso' && vicId && vicId !== currentUid) {
              await emitirNotificacionLocal({
                incidenteId: incId,
                victimaId: vicId,
                victimaNombre: inc.inc_victima_nombre || inc.victima_nombre || 'Un contacto de tu red',
                direccion: inc.inc_direccion || inc.direccion || 'Ubicación de emergencia',
                latitud: Number(inc.inc_latitud ?? inc.latitud),
                longitud: Number(inc.inc_longitud ?? inc.longitud),
                origen: inc.inc_origen || inc.origen,
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const inc = payload.new as any;
            const incId = inc.inc_id_incidente || inc.id;
            const vicId = inc.usu_id_victima || inc.victima_id;
            const incEstado = inc.inc_estado || inc.estado;
            const incDir = inc.inc_direccion || inc.direccion;
            // Si el incidente ya finalizó, descartar la notificación de la barra
            if (inc && incEstado !== 'en_curso' && vicId) {
              await descartarNotificacionesUsuario(vicId);
            }
            if (inc && incDir && !esSoloCoordenadas(incDir)) {
              setAlertas((prev) =>
                prev.map((item) =>
                  item.id === incId ? { ...item, direccion: incDir } : item
                )
              );
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerta_temprana', filter: `usu_id_contacto=eq.${user.id}` },
        async (payload) => {
          cargarCentroAlertasRef.current();
          const alertaData = payload.new as any;
          const currentUid = userIdRef.current;
          const targetIncId = alertaData?.inc_id_incidente || alertaData?.incidente_id;

          if (targetIncId) {
            const { data: inc } = await supabase
              .from('incidente')
              .select('inc_id_incidente, usu_id_victima, inc_victima_nombre, inc_direccion, inc_latitud, inc_longitud, inc_origen, inc_estado')
              .eq('inc_id_incidente', targetIncId)
              .single();

            const rawInc = inc as any;
            const incId = rawInc?.inc_id_incidente || rawInc?.id || targetIncId;
            const vicId = rawInc?.usu_id_victima || rawInc?.victima_id;
            const incEstado = rawInc?.inc_estado || rawInc?.estado;
            if (rawInc && incEstado === 'en_curso' && vicId !== currentUid) {
              await emitirNotificacionLocal({
                incidenteId: incId,
                victimaId: vicId,
                victimaNombre: rawInc.inc_victima_nombre || rawInc.victima_nombre || 'Contacto de tu red',
                direccion: rawInc.inc_direccion || rawInc.direccion || 'Ubicación de emergencia',
                latitud: Number(rawInc.inc_latitud ?? rawInc.latitud),
                longitud: Number(rawInc.inc_longitud ?? rawInc.longitud),
                origen: rawInc.inc_origen || rawInc.origen,
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      notifSub.remove();
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ── Animación del halo SOS ─────────────────────────────────────────────────
  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(idlePulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(idlePulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnimation.start();
    return () => pulseAnimation.stop();
  }, [idlePulse]);

  // ── Animación del pulso de micrófono en grabación ──────────────────────────
  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    if (recordingState === 'recording') {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(micPulseAnim, {
            toValue: 1.35,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(micPulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      anim.start();
    } else {
      micPulseAnim.setValue(1);
    }
    return () => {
      if (anim) anim.stop();
    };
  }, [recordingState, micPulseAnim]);

  // ── Handlers de Alerta y Toques ────────────────────────────────────────────
  const firstTapTimeRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSOS = useCallback(() => {
    setTapCount(3);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    navigation.navigate('Countdown', { origen: 'manual' });
    setTimeout(() => setTapCount(0), 500);
  }, [navigation]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (tapCount === 0) {
      firstTapTimeRef.current = now;
      setTapCount(1);
      timeoutRef.current = setTimeout(() => {
        setTapCount(0);
      }, MULTI_TAP_WINDOW_MS);
    } else {
      if (now - firstTapTimeRef.current <= MULTI_TAP_WINDOW_MS) {
        const newCount = tapCount + 1;
        setTapCount(newCount);
        if (newCount >= MULTI_TAP_TARGET) {
          triggerSOS();
        }
      } else {
        firstTapTimeRef.current = now;
        setTapCount(1);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setTapCount(0);
        }, MULTI_TAP_WINDOW_MS);
      }
    }
  }, [tapCount, triggerSOS]);

  const handleCancelActiveSOS = async () => {
    // 8.10.3.5: terminar el Modo Resguardo exige el bloqueo del teléfono (PIN, patrón o biometría)
    const verificacion = await verificarIdentidadLocalAsync('Confirmá tu identidad para terminar el Modo Resguardo');
    if (verificacion === 'rechazado') {
      Alert.alert('Modo Resguardo sigue activo', 'No se pudo verificar tu identidad. El resguardo continúa.');
      return;
    }
    Location.stopLocationUpdatesAsync('background-location-task').catch(() => { });
    await resguardoService.desactivarModoResguardoAsync();
    setModoResguardo(false);
    if (alertasPendientes.length > 0) {
      setShowPendingAlerts(true);
    }
  };

  const handleToggleAcoustic = async () => {
    if (isAcousticActive) {
      await acousticMonitoringService.stopAsync();
      setIsAcousticActive(false);
    } else {
      const permisoOk = await solicitarPermisoMicrofono();
      if (!permisoOk) return;

      // Garantizar que la ubicación (incluyendo "Permitir todo el tiempo" en background) esté concedida
      await solicitarPermisosUbicacion();

      // Verificar y sugerir exclusión de ahorro de batería para supervivencia con pantalla bloqueada
      const debePedirBateria = await debeMostrarAvisoBateriaAsync();
      if (debePedirBateria) {
        setShowBatteryModal(true);
      }

      const started = await acousticMonitoringService.startAsync(keywordText);
      if (started) {
        setIsAcousticActive(true);
      } else {
        Alert.alert('Atención', 'No se pudo iniciar el servicio de Escucha en vivo.');
      }
    }
  };

  const handleToggleBotonesFisicos = async (val: boolean) => {
    setIsBotonesFisicos(val);
    await guardarPreferenciaBotonesAsync(val);
  };

  const handleToggleAutoCamouflage = async (val: boolean) => {
    setIsAutoCamouflage(val);
    await AsyncStorage.setItem(STORAGE_KEY_AUTO_CAMOUFLAGE, val ? 'true' : 'false');
  };

  // ── Grabación y Configuración de Palabra Clave por Voz ─────────────────────
  const wasAcousticActiveBeforeModal = useRef(false);

  const handleOpenVoiceConfig = async () => {
    const permisoOk = await solicitarPermisoMicrofono();
    if (!permisoOk) return;

    // Si la Escucha en vivo está activa, pausarla para no competir por el micrófono de Android
    if (acousticMonitoringService.isActive()) {
      wasAcousticActiveBeforeModal.current = true;
      await acousticMonitoringService.stopAsync();
      // Pequeña espera para que el driver de audio de Android libere el hardware
      await new Promise((r) => setTimeout(r, 200));
    } else {
      wasAcousticActiveBeforeModal.current = false;
    }

    setRecordingState('idle');
    setRecognizedKeyword(keywordText);
    setShowVoiceModal(true);
  };

  const handleCloseVoiceModal = async () => {
    setShowVoiceModal(false);
    // Si la Escucha en vivo estaba activa antes de abrir el modal, reanudarla limpiamente
    if (wasAcousticActiveBeforeModal.current) {
      await new Promise((r) => setTimeout(r, 300));
      await acousticMonitoringService.startAsync(keywordText);
    }
  };

  const handleStartVoiceRecording = async () => {
    try {
      setRecordingState('recording');
      console.log('[VoiceModal] Iniciando grabación de voz de 3.5s...');

      // Crear grabador fresco directamente desde AudioModule para evitar problemas de reuso.
      // El constructor nativo no lee `android` anidado: sin esto Android graba en AMR a 8 kHz
      const { android, ios, web, ...opciones } = RecordingPresets.HIGH_QUALITY;
      const recorder = new (AudioModule as any).AudioRecorder({ ...opciones, ...android });
      await recorder.prepareToRecordAsync();
      recorder.record();

      // Grabar durante 3.5 segundos para capturar la palabra clave
      setTimeout(async () => {
        try {
          if (recorder.isRecording) {
            await recorder.stop();
          }
          setRecordingState('processing');

          let audioUri: string | null = null;

          // Esperar activamente a que el archivo esté confirmado en disco con tamaño > 0
          for (let intento = 0; intento < 10; intento++) {
            if (recorder.uri) {
              const info = await FileSystem.getInfoAsync(recorder.uri);
              if (info.exists && (info as any).size > 0) {
                audioUri = recorder.uri;
                console.log(`[VoiceModal] Archivo de voz capturado (${(info as any).size} bytes): ${audioUri}`);
                break;
              }
            }
            await new Promise((r) => setTimeout(r, 150));
          }

          if (audioUri) {
            const normalizedUri = audioUri.startsWith('file://')
              ? audioUri
              : (audioUri.startsWith('file:') ? `file://${audioUri.slice(5)}` : `file://${audioUri}`);

            const secret = getApiSecretKey();
            const headers: Record<string, string> = {
              Accept: 'application/json',
            };
            if (secret) {
              headers['X-Api-Secret'] = secret;
            }

            try {
              let textoObtenido = '';
              try {
                console.log(`[VoiceModal] Subiendo audio a ${getApiBaseUrl()}/api/v1/acustico/transcribir-voz...`);
                const uploadResult = await FileSystem.uploadAsync(
                  `${getApiBaseUrl()}/api/v1/acustico/transcribir-voz`,
                  normalizedUri,
                  {
                    httpMethod: 'POST',
                    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                    fieldName: 'audio_file',
                    mimeType: 'audio/m4a',
                    headers,
                  }
                );
                console.log(`[VoiceModal] Respuesta HTTP: ${uploadResult.status}`);
                if (uploadResult.status >= 200 && uploadResult.status < 300) {
                  const data = JSON.parse(uploadResult.body);
                  textoObtenido = data.texto || '';
                }
              } catch (fsErr) {
                console.warn('[VoiceModal] Fallback a Blob para transcribir:', fsErr);
                const fileBlob = await (await fetch(normalizedUri)).blob();
                const formData = new FormData();
                formData.append('audio_file', fileBlob, 'voz.m4a');
                const resp = await fetch(`${getApiBaseUrl()}/api/v1/acustico/transcribir-voz`, {
                  method: 'POST',
                  headers,
                  body: formData,
                });
                if (resp.ok) {
                  const data = await resp.json();
                  textoObtenido = data.texto || '';
                }
              }

              console.log(`[VoiceModal] Texto transcrito recibido: "${textoObtenido}"`);

              if (textoObtenido.trim().length > 0) {
                const recognized = normalizarPalabraClave(textoObtenido);
                console.log(`[VoiceModal / Vosk] Palabra reconocida con éxito: "${recognized}"`);
                setRecognizedKeyword(recognized);
              } else {
                Alert.alert(
                  'Audio no reconocido',
                  'No se logró distinguir una palabra clara con Vosk. Podés escribirla manualmente en el campo o reintentar hablando más cerca del micrófono.'
                );
              }
            } catch (fetchErr) {
              console.warn('[VoiceModal] Error conectando con backend:', fetchErr);
            } finally {
              FileSystem.deleteAsync(audioUri, { idempotent: true }).catch(() => { });
            }
          } else {
            console.warn('[VoiceModal] No se generó el archivo de audio tras 3.5s.');
            Alert.alert('Aviso', 'No se capturó sonido. Verificá que el permiso de micrófono esté concedido.');
          }

          setRecordingState('done');
        } catch (stopErr) {
          console.warn('[VoiceModal] Error deteniendo grabador:', stopErr);
          setRecordingState('done');
        }
      }, 3500);
    } catch (recErr) {
      console.warn('[VoiceModal] Error iniciando grabación:', recErr);
      setRecordingState('idle');
      Alert.alert('Error', 'No se pudo activar el micrófono.');
    }
  };

  const handleConfirmKeyword = async () => {
    const clean = normalizarPalabraClave(recognizedKeyword);
    if (!clean) {
      Alert.alert('Atención', 'La palabra clave no puede estar vacía.');
      return;
    }

    await acousticMonitoringService.setKeywordAsync(clean);
    await AsyncStorage.setItem(STORAGE_KEY_KEYWORD, clean);
    setKeywordText(clean);
    await handleCloseVoiceModal();

    // Persistir en backend con privilegios administrativos y en contexto de usuario
    try {
      await actualizarPersona({ palabraClave_encriptada: clean });
    } catch (err) {
      console.warn('[Home] Aviso sincronizando palabra clave con backend:', err);
    }

    Alert.alert(
      'Palabra Clave Guardada',
      `El motor Vosk ahora responderá cuando pronuncies "${clean}" para activar el Modo Resguardo.`
    );
  };

  const handleSavePin = async () => {
    const cleaned = pinInput.trim();
    if (!/^\d{4}$/.test(cleaned)) {
      Alert.alert(
        'Código PIN inválido',
        'El código de desbloqueo debe contener exactamente 4 números (ej. 1973).'
      );
      return;
    }

    await AsyncStorage.setItem(STORAGE_KEY_CAMOUFLAGE_PIN, cleaned);
    setCamouflagePin(cleaned);
    setIsEditingPin(false);
    Alert.alert(
      'Código de Desbloqueo Actualizado',
      `Para salir del Modo Invisible y acceder a ApoyAR, ingresá ${cleaned} seguido de la tecla igual (=).`
    );
  };

  // ── Gestión de Seguridad MFA (Google Authenticator) ───────────────────────
  const verificarEstadoMfa = useCallback(async () => {
    try {
      setCheckingMfa(true);
      const status = await getMfaStatusAsync();
      setIsMfaActive(status.hasMfa);
    } catch (e) {
      console.warn('[Home] Error verificando estado MFA:', e);
    } finally {
      setCheckingMfa(false);
    }
  }, []);

  const handleDesactivarMfa = () => {
    Alert.alert(
      'Desactivar Autenticador',
      '¿Estás segura de que querés desvincular Google Authenticator de tu cuenta?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desactivar',
          style: 'destructive',
          onPress: async () => {
            try {
              await desactivarMfaAsync();
              await verificarEstadoMfa();
              Alert.alert('Éxito', 'Se desactivó el doble factor de autenticación.');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'No se pudo desactivar el MFA.');
            }
          },
        },
      ]
    );
  };

  // ── Gestión y Edición de Perfil ───────────────────────────────────────────
  const handleOpenProfile = () => {
    verificarEstadoMfa();
    if (persona) {
      setEditNombre(persona.nombre || '');
      setEditApellido(persona.apellido || '');
      setEditDni(persona.dni || '');
      setEditTelefono(persona.telefono || '');
      setEditDireccion(persona.direccion || '');
    } else {
      setEditNombre(user?.email?.split('@')[0] || '');
      setEditApellido('');
      setEditDni('');
      setEditTelefono('');
      setEditDireccion('');
    }
    setIsEditingProfile(false);
    setShowProfileModal(true);
  };

  const handleSaveProfile = async () => {
    if (!editNombre.trim()) {
      Alert.alert('Atención', 'El nombre es obligatorio.');
      return;
    }
    setIsSavingProfile(true);
    const ok = await actualizarPersona({
      nombre: editNombre.trim(),
      apellido: editApellido.trim(),
      dni: editDni.trim() || undefined,
      telefono: editTelefono.trim() || undefined,
      direccion: editDireccion.trim() || undefined,
    });
    setIsSavingProfile(false);
    if (ok) {
      setIsEditingProfile(false);
      Alert.alert('Perfil Guardado', 'Los datos de tu perfil se actualizaron correctamente.');
    } else {
      Alert.alert('Error', 'No se pudieron guardar los cambios en el perfil.');
    }
  };

  // ── Derecho de Supresión y Eliminación Soberana de Cuenta (Ley 25.326 Art. 16) ──
  const handleEliminarCuenta = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR') {
      Alert.alert(
        'Confirmación Requerida',
        'Debes escribir exactamente la palabra ELIMINAR para proceder con la supresión definitiva e irreversible.'
      );
      return;
    }

    setIsDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        throw new Error('No se encontró una sesión activa para autorizar la supresión.');
      }

      const apiBase = getApiBaseUrl();
      const response = await fetch(`${apiBase}/api/v1/usuarios/me`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData?.detail || `Error del servidor (${response.status})`);
      }

      // 2. Limpiar almacenamiento local seguro
      await AsyncStorage.clear();

      // 3. Limpiar archivos temporales y caché
      try {
        const cacheDir = FileSystem.cacheDirectory;
        if (cacheDir) {
          const files = await FileSystem.readDirectoryAsync(cacheDir);
          for (const f of files) {
            if (
              f.startsWith('temp_') ||
              f.startsWith('preview_') ||
              f.startsWith('video_') ||
              f.startsWith('legacy_') ||
              f.includes('apoyar')
            ) {
              await FileSystem.deleteAsync(`${cacheDir}${f}`, { idempotent: true }).catch(() => { });
            }
          }
        }
      } catch (fsErr) {
        console.warn('[HomeScreen] Aviso limpiando caché:', fsErr);
      }

      // 4. Cerrar modal y cerrar sesión
      setShowDeleteAccountModal(false);
      setDeleteConfirmText('');
      await signOut();

      Alert.alert(
        'Cuenta Eliminada y Anonimizada',
        'Tu cuenta y todos tus datos personales han sido suprimidos permanentemente, disociando los registros transaccionales para estadísticas y auditorías conforme al Art. 16 de la Ley N.° 25.326.'
      );
    } catch (err: any) {
      console.error('[HomeScreen] Error suprimiendo cuenta:', err);
      Alert.alert(
        'Error al Eliminar Cuenta',
        err?.message || 'No se pudo completar la eliminación de tu cuenta. Por favor, reintenta.'
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };


  // ── Interpolaciones ────────────────────────────────────────────────────────
  const pulseScale = idlePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });

  const pulseOpacity = idlePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  });

  const isActive = tapCount > 0;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.base }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 32 },
        ]}
        bounces={false}
      >
        {/* ── ENCABEZADO SUPERIOR: Marca y Acciones Rápidas ──────────────── */}
        <View
          style={[
            styles.headerBlock,
            { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
          ]}
        >
          <View style={styles.headerTopRow}>
            <Text style={[typography.scale.display, { color: colors.text.primary }]} allowFontScaling>
              ApoyAR
            </Text>

            <View style={styles.headerIcons}>
              {/* Acceso directo al Modo Invisible (Calculadora) */}
              <Pressable
                style={styles.iconButton}
                accessibilityLabel="Abrir Modo Invisible"
                onPress={() => navigation.navigate('FakeCalculator')}
              >
                <Feather name="eye-off" size={22} color={colors.text.secondary} />
              </Pressable>

              {/* Acceso rápido / Switch de Escucha en vivo */}
              <Pressable
                style={[
                  styles.iconButton,
                  isAcousticActive && {
                    backgroundColor: colors.semantic.successBg,
                    borderRadius: radii.full,
                  },
                ]}
                accessibilityLabel="Alternar Escucha en vivo"
                onPress={handleToggleAcoustic}
              >
                <Feather
                  name={isAcousticActive ? 'mic' : 'mic-off'}
                  size={22}
                  color={isAcousticActive ? colors.semantic.success : colors.text.secondary}
                />
              </Pressable>

              {/* Centro de Alertas (Campana inmediatamente a la izquierda de hamburguesa) */}
              <Pressable
                style={[
                  styles.iconButton,
                  { position: 'relative' },
                  Boolean(alertaActiva) && {
                    backgroundColor: colors.semantic.dangerBg,
                    borderRadius: radii.full,
                  },
                ]}
                accessibilityLabel="Abrir Centro de Alertas"
                onPress={() => setShowAlertsCenter(true)}
              >
                <Feather
                  name="bell"
                  size={22}
                  color={alertaActiva ? colors.semantic.danger : colors.text.secondary}
                />
                {(Boolean(alertaActiva) || unreadAlertsCount > 0) && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: colors.semantic.danger,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 3,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>
                      {alertaActiva ? '!' : unreadAlertsCount}
                    </Text>
                  </View>
                )}
              </Pressable>

              {/* Menú de Tres Rayitas (Hamburguesa) */}
              <Pressable
                style={[
                  styles.hamburgerButton,
                  {
                    backgroundColor: colors.bg.surface,
                    borderColor: colors.border.default,
                    borderRadius: radii.sm,
                  },
                ]}
                accessibilityLabel="Abrir opciones de menú"
                onPress={() => setShowHamburgerMenu(true)}
              >
                <Feather name="menu" size={22} color={colors.text.primary} />
              </Pressable>
            </View>
          </View>

          {/* Badge de Estado del Dispositivo (Diseñado sin desborde de texto) */}
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: colors.bg.elevated,
                borderRadius: radii.md,
                padding: spacing.sm,
                marginTop: spacing.md,
                borderWidth: 1,
                borderColor: colors.border.default,
              },
            ]}
          >
            <View style={styles.statusBadgeHeader}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isAcousticActive ? colors.semantic.success : colors.semantic.warning },
                ]}
              />
              <Text
                style={[
                  typography.scale.caption,
                  {
                    color: colors.text.primary,
                    fontWeight: '700',
                    marginLeft: spacing.xs,
                    flexShrink: 1,
                    fontSize: 12,
                  },
                ]}
                numberOfLines={1}
              >
                {isAcousticActive ? 'ESCUCHA EN VIVO ACTIVA' : 'SISTEMA EN ESPERA'}
              </Text>
            </View>
            <View style={styles.statusBadgeDetails}>
              <View style={[styles.statusPill, { backgroundColor: colors.bg.surface }]}>
                <Feather name="check" size={11} color={colors.semantic.success} />
                <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11, marginLeft: 3 }]}>
                  GPS Listo
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: colors.bg.surface }]}>
                <Feather name="shield" size={11} color={colors.semantic.info} />
                <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11, marginLeft: 3 }]}>
                  Keystore TEE
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: colors.bg.surface }]}>
                <Feather name="clock" size={11} color={colors.semantic.warning} />
                <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11, marginLeft: 3 }]}>
                  RFC 3161
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── SECCIÓN CENTRAL: Botón SOS Original (Escudo + 3 Toques) ─────── */}
        <View
          style={[
            styles.surfaceBlock,
            {
              backgroundColor: colors.bg.surface,
              borderTopLeftRadius: 36,
              borderTopRightRadius: 36,
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.xl,
              paddingBottom: spacing['3xl'],
              alignItems: 'center',
            },
          ]}
        >
          {enModoResguardo && (
            <View
              style={{
                backgroundColor: colors.semantic.warningBg,
                padding: spacing.md,
                borderRadius: radii.md,
                marginBottom: spacing.lg,
                flexDirection: 'row',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <Feather name="bell-off" size={20} color={colors.semantic.warning} />
              <Text
                style={[
                  typography.scale.body,
                  { color: colors.semantic.warning, marginLeft: spacing.sm, flex: 1, flexWrap: 'wrap' },
                ]}
              >
                Modo Resguardo activo: Alertas locales silenciadas por seguridad.
              </Text>
            </View>
          )}

          {/* Botón SOS con Icono de Escudo Original */}
          <View style={[styles.sosContainer, { marginBottom: spacing.xl }]}>
            {enModoResguardo ? (
              <Pressable
                onPress={handleCancelActiveSOS}
                style={[
                  styles.sosButton,
                  {
                    backgroundColor: colors.semantic.danger,
                    borderWidth: 4,
                    borderColor: colors.text.primary,
                  },
                ]}
              >
                <Feather name="shield" size={48} color="#FFFFFF" />
                <Text
                  style={[
                    typography.scale.bodyBold,
                    { color: '#FFFFFF', marginTop: 4, textAlign: 'center', fontSize: 12 },
                  ]}
                >
                  MODO{'\n'}RESGUARDO
                </Text>
              </Pressable>
            ) : (
              <>
                <Animated.View
                  style={[
                    styles.pulseHalo,
                    {
                      backgroundColor: colors.semantic.danger,
                      borderRadius: 9999,
                      transform: [{ scale: pulseScale }],
                      opacity: pulseOpacity,
                    },
                  ]}
                />
                <Pressable
                  onPress={handleTap}
                  accessibilityRole="button"
                  accessibilityLabel="Botón SOS de emergencia. Presioná tres veces seguidas para activar."
                  style={({ pressed }) => [
                    styles.sosButton,
                    {
                      backgroundColor: colors.semantic.danger,
                      transform: [{ scale: pressed ? 0.95 : 1 }],
                    },
                  ]}
                >
                  <Feather name="shield" size={52} color="#FFFFFF" style={{ marginBottom: 2 }} />
                  <Text
                    style={[
                      typography.scale.h2,
                      { color: '#FFFFFF', fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
                    ]}
                    allowFontScaling={false}
                  >
                    SOS
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Indicador de 3 pulsaciones */}
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            {enModoResguardo ? (
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.semantic.warning, textAlign: 'center' },
                ]}
              >
                Tocá el escudo para finalizar el resguardo y restaurar alertas.
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                {Array.from({ length: MULTI_TAP_TARGET }).map((_, index) => (
                  <View
                    key={index}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      backgroundColor: index < tapCount ? colors.semantic.danger : colors.bg.overlay,
                    }}
                  />
                ))}
              </View>
            )}
            <Text
              style={[
                typography.scale.body,
                { color: colors.text.secondary, textAlign: 'center', maxWidth: 290, flexWrap: 'wrap' },
              ]}
              allowFontScaling
            >
              {enModoResguardo
                ? 'Transmitiendo geolocalización continua a tu red.'
                : isActive
                  ? `Pulsación ${tapCount} de ${MULTI_TAP_TARGET}. ¡Seguí presionando!`
                  : `Presioná el botón ${MULTI_TAP_TARGET} veces seguidas para disparar la alerta.`}
            </Text>

            {/* Accesos Rápidos Complementarios: Captura Visual y Privacidad */}
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <TouchableOpacity
                onPress={() => setShowCameraModal(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.md,
                  paddingVertical: 8,
                  borderRadius: radii.full,
                  backgroundColor: colors.bg.base,
                  borderWidth: 1,
                  borderColor: colors.border.default,
                  gap: 6,
                }}
              >
                <Feather name="camera" size={15} color={colors.text.secondary} />
                <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                  Foto/Video
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowPrivacyModal(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: spacing.md,
                  paddingVertical: 8,
                  borderRadius: radii.full,
                  backgroundColor: colors.bg.base,
                  borderWidth: 1,
                  borderColor: colors.border.default,
                  gap: 6,
                }}
              >
                <Feather name="shield" size={15} color={colors.text.secondary} />
                <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                  Privacidad
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── CARD 1: Red de Contactos ─────────────────────────────────── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.bg.base,
                borderColor: colors.border.default,
                borderRadius: radii.md,
                padding: spacing.md,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                <Feather name="users" size={18} color={colors.text.secondary} />
                <Text
                  style={[
                    typography.scale.bodyBold,
                    { color: colors.text.primary, marginLeft: spacing.xs, flexShrink: 1 },
                  ]}
                  numberOfLines={1}
                >
                  Red de apoyo: {networkCount}
                </Text>
              </View>
            </View>
            <View style={styles.cardContentRow}>
              <View style={{ flexShrink: 1, marginRight: spacing.sm }}>
                <Text
                  style={[typography.scale.bodyBold, { color: colors.text.primary, flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {firstContactName ? firstContactName : 'Sin contactos asignados'}
                </Text>
                {firstContactName && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <View style={[styles.statusDotSmall, { backgroundColor: colors.semantic.success }]} />
                    <Text
                      style={[
                        typography.scale.caption,
                        { color: colors.text.secondary, marginLeft: 4 },
                      ]}
                    >
                      Vinculado
                    </Text>
                  </View>
                )}
              </View>
              <Pressable
                style={styles.iconButton}
                onPress={() => navigation.navigate('Contacts')}
                accessibilityLabel="Ver red de contactos"
              >
                <Feather name="chevron-right" size={24} color={colors.text.secondary} />
              </Pressable>
            </View>
          </View>

          {/* ── CARD 2: Escucha en vivo (RF-2.1 / Vosk + YAMNet) ─────────── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.bg.base,
                borderColor: colors.border.default,
                borderRadius: radii.md,
                padding: spacing.md,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                <Feather
                  name="mic"
                  size={18}
                  color={isAcousticActive ? colors.semantic.success : colors.text.secondary}
                />
                <Text
                  style={[
                    typography.scale.bodyBold,
                    { color: colors.text.primary, marginLeft: spacing.xs, flexShrink: 1 },
                  ]}
                  numberOfLines={1}
                >
                  Escucha en vivo
                </Text>
              </View>
              <Switch
                value={isAcousticActive}
                onValueChange={handleToggleAcoustic}
                trackColor={{ false: colors.bg.overlay, true: colors.semantic.success }}
              />
            </View>

            <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 4, flexWrap: 'wrap' }]}>
              {isAcousticActive
                ? 'Monitoreo activo en segundo plano con pantalla bloqueada (Vosk y YAMNet).'
                : 'Monitoreo apagado. Activá la escucha en vivo para protección continua.'}
            </Text>

            {/* Configuración de Palabra Clave por Voz */}
            <View
              style={[
                styles.configBox,
                {
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                  borderRadius: radii.sm,
                  marginTop: spacing.sm,
                  padding: spacing.sm,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                  <Feather name="key" size={13} color={colors.semantic.info} />
                  <Text
                    style={[
                      typography.scale.caption,
                      { color: colors.text.primary, fontWeight: '700', marginLeft: spacing['2xs'], flexShrink: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    Palabra clave
                  </Text>
                </View>
                <Pressable
                  onPress={handleOpenVoiceConfig}
                  style={[
                    styles.voiceRecordBadge,
                    { backgroundColor: colors.border.focus, borderRadius: radii.sm },
                  ]}
                >
                  <Feather name="mic" size={12} color="#FFFFFF" style={{ marginRight: 3 }} />
                  <Text style={[typography.scale.caption, { color: '#FFFFFF', fontWeight: '700', fontSize: 11 }]}>
                    Grabar voz
                  </Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                <Text style={[typography.scale.bodyBold, { color: colors.semantic.info, fontSize: 15 }]}>
                  Pronuncia "{keywordText}" para activar la alerta
                </Text>
                <Text
                  style={[
                    typography.scale.caption,
                    { color: colors.text.secondary, marginLeft: spacing.xs, flexShrink: 1 },
                  ]}
                >
                </Text>
              </View>
            </View>

          </View>

          {/* ── CARD: Activación con botones de volumen (RF-2.4) ──────────── */}
          {botonesFisicosDisponibles() && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.bg.base,
                  borderColor: colors.border.default,
                  borderRadius: radii.md,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                },
              ]}
            >
              <View style={styles.cardHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                  <Feather
                    name="smartphone"
                    size={18}
                    color={isBotonesFisicos ? colors.semantic.success : colors.text.secondary}
                  />
                  <Text
                    style={[
                      typography.scale.bodyBold,
                      { color: colors.text.primary, marginLeft: spacing.xs, flexShrink: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    Activar con botones
                  </Text>
                </View>
                <Switch
                  value={isBotonesFisicos}
                  onValueChange={handleToggleBotonesFisicos}
                  trackColor={{ false: colors.bg.overlay, true: colors.semantic.success }}
                />
              </View>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 4, lineHeight: 18, flexWrap: 'wrap' }]}>
                Apretá 3 veces "Volumen abajo" en menos de 2 segundos para activar el Modo Resguardo.
              </Text>
            </View>
          )}

          {/* ── CARD 3: Modo Invisible (Calculadora señuelo - RF-1.3) ─────── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.bg.base,
                borderColor: colors.border.default,
                borderRadius: radii.md,
                padding: spacing.md,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                <Feather name="eye-off" size={18} color={colors.text.secondary} />
                <Text
                  style={[
                    typography.scale.bodyBold,
                    { color: colors.text.primary, marginLeft: spacing.xs, flexShrink: 1 },
                  ]}
                  numberOfLines={1}
                >
                  Modo Invisible
                </Text>
              </View>
              <Pressable
                onPress={() => navigation.navigate('FakeCalculator')}
                accessibilityLabel="Activar Modo Invisible"
                accessibilityRole="button"
                style={({ pressed }) => [
                  {
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: radii.sm,
                    backgroundColor: colors.bg.overlay,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="toggle-right" size={24} color={colors.semantic.info} />
              </Pressable>

            </View>

            <Text
              style={[
                typography.scale.caption,
                { color: colors.text.secondary, marginTop: 4, lineHeight: 18, flexWrap: 'wrap' },
              ]}
            >
              Oculta la app como una calculadora. Para salir y acceder, escribe tu PIN seguido de la tecla igual (=) (ej: {camouflagePin}=).
            </Text>

            {/* Switch de Arranque en Modo Invisible */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: spacing.sm,
              }}
            >
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.text.primary, flex: 1, marginRight: spacing.sm, flexWrap: 'wrap' },
                ]}
              >

                Iniciar en Modo Invisible
              </Text>
              <Switch
                value={isAutoCamouflage}
                onValueChange={handleToggleAutoCamouflage}
                trackColor={{ false: colors.bg.overlay, true: colors.semantic.success }}
              />
            </View>

            {/* Configuración de PIN de Desbloqueo */}
            <View
              style={[
                styles.configBox,
                {
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                  borderRadius: radii.sm,
                  marginTop: spacing.sm,
                  padding: spacing.sm,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                  <Feather name="lock" size={13} color={colors.text.secondary} />
                  <Text
                    style={[
                      typography.scale.caption,
                      { color: colors.text.primary, fontWeight: '700', marginLeft: spacing['2xs'], flexShrink: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    Código de desbloqueo:
                  </Text>
                </View>
                {!isEditingPin && (
                  <Pressable onPress={() => setIsEditingPin(true)} style={{ paddingHorizontal: spacing.xs }}>
                    <Text style={[typography.scale.caption, { color: colors.border.focus, fontWeight: '700' }]}>
                      <Feather name="edit" size={22} color={colors.text.secondary} />
                    </Text>
                  </Pressable>
                )}
              </View>

              {isEditingPin ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
                  <TextInput
                    value={pinInput}
                    onChangeText={setPinInput}
                    placeholder="4 dígitos (ej: 1973)"
                    placeholderTextColor={colors.text.disabled}
                    keyboardType="numeric"
                    maxLength={4}
                    style={[
                      styles.inlineTextInput,
                      {
                        backgroundColor: colors.bg.surface,
                        borderColor: colors.border.focus,
                        color: colors.text.primary,
                        borderRadius: radii.sm,
                        flex: 1,
                        paddingHorizontal: spacing.sm,
                        height: 38,
                        letterSpacing: 4,
                        fontWeight: 'bold',
                      },
                    ]}
                  />
                  <Pressable
                    onPress={handleSavePin}
                    style={[
                      styles.smallActionButton,
                      {
                        backgroundColor: colors.semantic.success,
                        borderRadius: radii.sm,
                        marginLeft: spacing.xs,
                      },
                    ]}
                  >
                    <Feather name="check" size={16} color="#FFF" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setPinInput(camouflagePin);
                      setIsEditingPin(false);
                    }}
                    style={[
                      styles.smallActionButton,
                      {
                        backgroundColor: colors.bg.overlay,
                        borderRadius: radii.sm,
                        marginLeft: spacing['2xs'],
                      },
                    ]}
                  >
                    <Feather name="x" size={16} color={colors.text.primary} />
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  <Text
                    style={[
                      typography.scale.bodyBold,
                      { color: colors.text.primary, fontSize: 16, letterSpacing: 2 },
                    ]}
                  >
                    {camouflagePin} =
                  </Text>
                  <Text
                    style={[
                      typography.scale.caption,
                      { color: colors.text.secondary, marginLeft: spacing.sm, flexShrink: 1 },
                    ]}
                  >
                    (4 dígitos + tecla =)
                  </Text>
                </View>
              )}
            </View>
          </View>


        </View>
      </ScrollView>

      {/* ── MODAL DE CONFIGURACIÓN DE PALABRA CLAVE POR VOZ ──────────────── */}
      <Modal
        visible={showVoiceModal}
        animationType="slide"
        transparent
        statusBarTranslucent={true}
        onRequestClose={handleCloseVoiceModal}
      >
        <KeyboardAvoidingWrapper mode="modal" style={styles.modalOverlay} extraScrollHeight={16}>
          <View style={[styles.voiceModalCard, { backgroundColor: colors.bg.surface, borderRadius: radii.lg }]}>
            <View style={styles.voiceModalHeader}>
              <Text style={[typography.scale.h3, { color: colors.text.primary, flex: 1 }]}>
                Grabar Palabra Clave
              </Text>
              <Pressable
                onPress={handleCloseVoiceModal}
                style={styles.closeModalBtn}
                accessibilityLabel="Cerrar modal"
              >
                <Feather name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            <Text style={[typography.scale.body, { color: colors.text.secondary, marginTop: spacing.xs, flexWrap: 'wrap' }]}>
              Pronunciá con voz clara tu palabra clave de auxilio (ej. "basta", "llaves", "ayuda").
            </Text>

            {/* Área central con animación de micrófono */}
            <View style={styles.voiceCenterArea}>
              <Animated.View
                style={[
                  styles.voicePulseHalo,
                  {
                    backgroundColor: recordingState === 'recording' ? colors.semantic.danger : colors.border.focus,
                    transform: [{ scale: micPulseAnim }],
                    opacity: recordingState === 'recording' ? 0.35 : 0.15,
                  },
                ]}
              />
              <Pressable
                onPress={recordingState === 'idle' || recordingState === 'done' ? handleStartVoiceRecording : undefined}
                style={[
                  styles.voiceMicButton,
                  {
                    backgroundColor:
                      recordingState === 'recording'
                        ? colors.semantic.danger
                        : recordingState === 'processing'
                          ? colors.semantic.warning
                          : colors.border.focus,
                  },
                ]}
              >
                <Feather
                  name={recordingState === 'processing' ? 'loader' : 'mic'}
                  size={36}
                  color="#FFFFFF"
                />
              </Pressable>

              <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginTop: spacing.md }]}>
                {recordingState === 'idle'
                  ? 'Tocá el micrófono y hablá'
                  : recordingState === 'recording'
                    ? 'Escuchando tu voz...'
                    : recordingState === 'processing'
                      ? 'Analizando y registrando patrón...'
                      : '¡Palabra clave capturada!'}
              </Text>
            </View>

            {/* Input para verificar / ajustar palabra reconocida */}
            {recordingState !== 'recording' && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[typography.scale.caption, { color: colors.text.secondary, marginBottom: 4 }]}>
                  Palabra clave de auxilio:
                </Text>
                <TextInput
                  value={recognizedKeyword}
                  onChangeText={setRecognizedKeyword}
                  placeholder="Ej: pizza, socorro, ayuda"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.inlineTextInput,
                    {
                      backgroundColor: colors.bg.base,
                      borderColor: colors.border.focus,
                      color: colors.text.primary,
                      borderRadius: radii.sm,
                      paddingHorizontal: spacing.md,
                      height: 44,
                      fontSize: 16,
                      fontWeight: 'bold',
                    },
                  ]}
                />
              </View>
            )}

            {/* Botones de acción */}
            <View style={styles.voiceModalActions}>
              <Pressable
                onPress={handleCloseVoiceModal}
                style={[
                  styles.voiceActionBtn,
                  { backgroundColor: colors.bg.overlay, borderRadius: radii.sm, marginRight: spacing.sm },
                ]}
              >
                <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmKeyword}
                disabled={recordingState === 'recording'}
                style={[
                  styles.voiceActionBtn,
                  {
                    backgroundColor: colors.semantic.success,
                    borderRadius: radii.sm,
                    opacity: recordingState === 'recording' ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={[typography.scale.bodyBold, { color: '#FFFFFF' }]}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingWrapper>
      </Modal>

      {/* ── MENÚ HAMBURGUESA DESPLEGABLE (POPOVER) ───────────────────────── */}
      <Modal
        visible={showHamburgerMenu}
        animationType="fade"
        transparent
        statusBarTranslucent={true}
        onRequestClose={() => setShowHamburgerMenu(false)}
      >
        <Pressable style={styles.popoverBackdrop} onPress={() => setShowHamburgerMenu(false)}>
          <Pressable
            style={[
              styles.hamburgerDropdownCard,
              {
                backgroundColor: colors.bg.surface,
                borderColor: colors.border.default,
                borderRadius: radii.md,
              },
            ]}
          >
            {/* Opción Perfil */}
            <Pressable
              style={({ pressed }) => [
                styles.dropdownItem,
                {
                  backgroundColor: pressed ? colors.bg.elevated : 'transparent',
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
              onPress={() => {
                setShowHamburgerMenu(false);
                handleOpenProfile();
              }}
            >
              <Feather name="user" size={18} color={colors.text.primary} />
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.text.primary, marginLeft: spacing.sm },
                ]}
              >
                Perfil
              </Text>
            </Pressable>

            {/* Divisor sutil */}
            <View style={{ height: 1, backgroundColor: colors.border.default, marginVertical: 4 }} />

            {/* Opción Mis Pruebas (CU-08 / RF-3.5) */}
            <Pressable
              style={({ pressed }) => [
                styles.dropdownItem,
                {
                  backgroundColor: pressed ? colors.bg.elevated : 'transparent',
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
              onPress={() => {
                setShowHamburgerMenu(false);
                setShowEvidenceModal(true);
              }}
            >
              <Feather name="shield" size={18} color={colors.text.primary} />
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.text.primary, marginLeft: spacing.sm },
                ]}
              >
                Mis Pruebas
              </Text>
            </Pressable>

            {/* Divisor sutil */}
            <View style={{ height: 1, backgroundColor: colors.border.default, marginVertical: 4 }} />

            {/* Opción Alternar Tema (Claro / Oscuro) */}
            <Pressable
              style={({ pressed }) => [
                styles.dropdownItem,
                {
                  backgroundColor: pressed ? colors.bg.elevated : 'transparent',
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
              onPress={() => {
                setShowHamburgerMenu(false);
                toggleTheme();
              }}
            >
              <Feather
                name={isDark ? 'sun' : 'moon'}
                size={18}
                color={isDark ? colors.semantic.warning : colors.text.primary}
              />
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.text.primary, marginLeft: spacing.sm },
                ]}
              >
                {isDark ? 'Modo Claro' : 'Modo Oscuro'}
              </Text>
            </Pressable>

            {/* Divisor sutil */}
            <View style={{ height: 1, backgroundColor: colors.border.default, marginVertical: 4 }} />

            {/* Opción Segundo plano */}
            <Pressable
              style={({ pressed }) => [
                styles.dropdownItem,
                {
                  backgroundColor: pressed ? colors.bg.elevated : 'transparent',
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
              onPress={() => {
                setShowHamburgerMenu(false);
                setShowBackgroundModal(true);
              }}
            >
              <Feather name="cpu" size={18} color={colors.text.primary} />
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.text.primary, marginLeft: spacing.sm },
                ]}
              >
                Segundo plano
              </Text>
            </Pressable>

            {/* Divisor sutil */}
            <View style={{ height: 1, backgroundColor: colors.border.default, marginVertical: 4 }} />

            {/* Opción Cerrar Sesión */}
            <Pressable
              style={({ pressed }) => [
                styles.dropdownItem,
                {
                  backgroundColor: pressed ? colors.semantic.dangerBg : 'transparent',
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
              onPress={() => {
                setShowHamburgerMenu(false);
                signOut();
              }}
            >
              <Feather name="log-out" size={18} color={colors.semantic.danger} />
              <Text
                style={[
                  typography.scale.bodyBold,
                  { color: colors.semantic.danger, marginLeft: spacing.sm },
                ]}
              >
                Cerrar sesión
              </Text>
            </Pressable>

            {/* Divisor sutil */}
            <View style={{ height: 1, backgroundColor: colors.border.default, marginVertical: 4 }} />

            {/* Opción Eliminar Cuenta y Datos Personales (Ley 25.326 Art. 16) */}
            <Pressable
              style={({ pressed }) => [
                styles.dropdownItem,
                {
                  backgroundColor: pressed
                    ? isDark
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(122, 31, 31, 0.08)'
                    : 'transparent',
                  borderRadius: radii.sm,
                  padding: spacing.md,
                },
              ]}
              onPress={() => {
                setShowHamburgerMenu(false);
                setDeleteConfirmText('');
                setShowDeleteAccountModal(true);
              }}
            >
              <Feather name="trash-2" size={18} color={colors.semantic.danger} />
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text
                  style={[
                    typography.scale.bodyBold,
                    { color: colors.semantic.danger },
                  ]}
                >
                  Eliminar cuenta y anonimizar datos
                </Text>
                <Text
                  style={[
                    typography.scale.caption,
                    { color: colors.text.secondary, fontSize: 11, marginTop: 1 },
                  ]}
                >
                  Derecho de supresión y disociación
                </Text>
              </View>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── MODAL DE ELIMINAR CUENTA Y DATOS (Art. 16 Ley 25.326) ─────────── */}
      <Modal
        visible={showDeleteAccountModal}
        animationType="fade"
        transparent
        statusBarTranslucent={true}
        onRequestClose={() => {
          if (!isDeletingAccount) {
            setShowDeleteAccountModal(false);
            setDeleteConfirmText('');
          }
        }}
      >
        <KeyboardAvoidingWrapper mode="modal" style={styles.modalOverlay} extraScrollHeight={24}>
          <View
            style={[
              styles.deleteAccountCard,
              {
                backgroundColor: colors.bg.surface,
                borderColor: colors.semantic.danger,
                borderRadius: radii.lg,
                borderWidth: 1.5,
              },
            ]}
          >
            {/* Cabecera */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: radii.full,
                  backgroundColor: colors.semantic.dangerBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.sm,
                }}
              >
                <Feather name="trash-2" size={20} color={colors.semantic.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typography.scale.bodyBold, { color: colors.semantic.danger, fontSize: 16 }]}>
                  Eliminar Cuenta y Anonimizar Datos
                </Text>
                <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11 }]}>
                  Derecho de Supresión y Disociación (Art. 16 Ley N.° 25.326)
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  if (!isDeletingAccount) {
                    setShowDeleteAccountModal(false);
                    setDeleteConfirmText('');
                  }
                }}
                disabled={isDeletingAccount}
                style={{ padding: 4 }}
              >
                <Feather name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* Advertencia Legal y Técnica */}
            <View
              style={{
                backgroundColor: colors.semantic.dangerBg,
                borderColor: colors.semantic.danger,
                borderWidth: 1,
                borderRadius: radii.sm,
                padding: spacing.md,
                marginBottom: spacing.md,
              }}
            >
              <Text
                style={[
                  typography.scale.caption,
                  { color: colors.text.primary, fontWeight: '700', marginBottom: 4 },
                ]}
              >
                ⚠️ ACCIÓN PERMANENTE E IRREVERSIBLE
              </Text>
              <Text style={[typography.scale.caption, { color: colors.text.secondary, lineHeight: 17 }]}>
                Conforme al principio de conservación de datos disociados:
                {'\n'}• Se suprimen de forma definitiva todos tus identificadores personales (nombre, DNI, email, teléfono, dirección y credenciales de acceso).
                {'\n'}• Tus pruebas (audios, fotos y videos) se borran de forma definitiva.
                  {'\n'}• Tus contactos de red de apoyo y dispositivos quedan desvinculados por completo.
                {'\n'}• Los registros transaccionales de eventos se conservan exclusivamente disociados para estadísticas criminales y auditoría pública, sin posibilidad de reidentificación.
              </Text>
            </View>

            {/* Confirmación explícita con palabra ELIMINAR */}
            <Text
              style={[
                typography.scale.caption,
                { color: colors.text.primary, fontWeight: '600', marginBottom: 6 },
              ]}
            >
              Para confirmar, escribí la palabra <Text style={{ color: colors.semantic.danger, fontWeight: '800' }}>ELIMINAR</Text> en mayúsculas:
            </Text>

            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="Escribí ELIMINAR"
              placeholderTextColor={colors.text.disabled}
              autoCapitalize="characters"
              editable={!isDeletingAccount}
              style={[
                styles.deleteInput,
                {
                  backgroundColor: colors.bg.base,
                  borderColor:
                    deleteConfirmText.trim().toUpperCase() === 'ELIMINAR'
                      ? colors.semantic.danger
                      : colors.border.default,
                  color: colors.text.primary,
                  borderRadius: radii.sm,
                },
              ]}
            />

            {/* Botones de Acción */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.md }}>
              <Pressable
                onPress={() => {
                  setShowDeleteAccountModal(false);
                  setDeleteConfirmText('');
                }}
                disabled={isDeletingAccount}
                style={[
                  styles.deleteModalBtn,
                  {
                    backgroundColor: colors.bg.elevated,
                    borderColor: colors.border.default,
                    borderWidth: 1,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text style={{ color: colors.text.primary, fontWeight: '700', fontSize: 13 }}>
                  Cancelar
                </Text>
              </Pressable>

              <Pressable
                onPress={handleEliminarCuenta}
                disabled={
                  deleteConfirmText.trim().toUpperCase() !== 'ELIMINAR' || isDeletingAccount
                }
                style={[
                  styles.deleteModalBtn,
                  {
                    backgroundColor:
                      deleteConfirmText.trim().toUpperCase() === 'ELIMINAR' && !isDeletingAccount
                        ? colors.semantic.danger
                        : colors.bg.overlay,
                    borderRadius: radii.sm,
                    opacity:
                      deleteConfirmText.trim().toUpperCase() === 'ELIMINAR' && !isDeletingAccount
                        ? 1
                        : 0.5,
                  },
                ]}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                ) : (
                  <Feather name="trash-2" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                )}
                <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 13 }}>
                  {isDeletingAccount ? 'Eliminando...' : 'Eliminar Todo'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingWrapper>
      </Modal>

      {/* ── MODAL DE PERFIL (Con visualización completa y edición segura) ───── */}
      <Modal
        visible={showProfileModal}
        animationType="slide"
        transparent
        statusBarTranslucent={true}
        onRequestClose={() => {
          setIsEditingProfile(false);
          setShowProfileModal(false);
        }}
      >
        <KeyboardAvoidingWrapper
          mode="modal"
          style={styles.modalOverlay}
          extraScrollHeight={24}
        >
          <View
            style={[
              styles.profileModalCard,
              {
                backgroundColor: colors.bg.surface,
                borderRadius: radii.lg,
                borderColor: colors.border.default,
                maxHeight: '90%',
              },
            ]}
          >
            {/* Cabecera del Modal de Perfil */}
            <View style={styles.profileModalHeader}>
              <Text style={[typography.scale.h2, { color: colors.text.primary, flex: 1 }]}>
                {isEditingProfile ? 'Editar Perfil' : 'Datos del Perfil'}
              </Text>
              {!isEditingProfile && (
                <Pressable
                  onPress={() => setIsEditingProfile(true)}
                  style={{ padding: 6, marginRight: spacing.xs }}
                  accessibilityLabel="Editar datos de mi perfil"
                >
                  <Feather name="edit-2" size={18} color={colors.semantic.info} />
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  setIsEditingProfile(false);
                  setShowProfileModal(false);
                }}
                style={styles.closeModalBtn}
                accessibilityLabel="Cerrar modal de perfil"
              >
                <Feather name="x" size={22} color={colors.text.secondary} />
              </Pressable>
            </View>

            {isEditingProfile ? (
              /* MODO EDICIÓN */
              <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary, marginBottom: 4 }]}>
                    Nombre:
                  </Text>
                  <TextInput
                    value={editNombre}
                    onChangeText={setEditNombre}
                    placeholder="Tu nombre"
                    style={[
                      styles.inlineTextInput,
                      {
                        backgroundColor: colors.bg.base,
                        borderColor: colors.border.focus,
                        color: colors.text.primary,
                        borderRadius: radii.sm,
                        paddingHorizontal: spacing.sm,
                        height: 40,
                      },
                    ]}
                  />

                  <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: spacing.sm, marginBottom: 4 }]}>
                    Apellido:
                  </Text>
                  <TextInput
                    value={editApellido}
                    onChangeText={setEditApellido}
                    placeholder="Tu apellido"
                    style={[
                      styles.inlineTextInput,
                      {
                        backgroundColor: colors.bg.base,
                        borderColor: colors.border.focus,
                        color: colors.text.primary,
                        borderRadius: radii.sm,
                        paddingHorizontal: spacing.sm,
                        height: 40,
                      },
                    ]}
                  />

                  <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: spacing.sm, marginBottom: 4 }]}>
                    DNI / Documento:
                  </Text>
                  <TextInput
                    value={editDni}
                    onChangeText={setEditDni}
                    placeholder="Número de documento"
                    keyboardType="numeric"
                    style={[
                      styles.inlineTextInput,
                      {
                        backgroundColor: colors.bg.base,
                        borderColor: colors.border.focus,
                        color: colors.text.primary,
                        borderRadius: radii.sm,
                        paddingHorizontal: spacing.sm,
                        height: 40,
                      },
                    ]}
                  />

                  <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: spacing.sm, marginBottom: 4 }]}>
                    Teléfono de contacto:
                  </Text>
                  <TextInput
                    value={editTelefono}
                    onChangeText={setEditTelefono}
                    placeholder="+549..."
                    keyboardType="phone-pad"
                    style={[
                      styles.inlineTextInput,
                      {
                        backgroundColor: colors.bg.base,
                        borderColor: colors.border.focus,
                        color: colors.text.primary,
                        borderRadius: radii.sm,
                        paddingHorizontal: spacing.sm,
                        height: 40,
                      },
                    ]}
                  />

                  <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: spacing.sm, marginBottom: 4 }]}>
                    Dirección:
                  </Text>
                  <TextInput
                    value={editDireccion}
                    onChangeText={setEditDireccion}
                    placeholder="Calle, número, ciudad"
                    style={[
                      styles.inlineTextInput,
                      {
                        backgroundColor: colors.bg.base,
                        borderColor: colors.border.focus,
                        color: colors.text.primary,
                        borderRadius: radii.sm,
                        paddingHorizontal: spacing.sm,
                        height: 40,
                      },
                    ]}
                  />

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <Pressable
                      onPress={() => setIsEditingProfile(false)}
                      style={[
                        styles.voiceActionBtn,
                        { backgroundColor: colors.bg.overlay, borderRadius: radii.sm, flex: 1 },
                      ]}
                    >
                      <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>Cancelar</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveProfile}
                      disabled={isSavingProfile}
                      style={[
                        styles.voiceActionBtn,
                        { backgroundColor: colors.semantic.success, borderRadius: radii.sm, flex: 1 },
                      ]}
                    >
                      <Text style={[typography.scale.bodyBold, { color: '#FFFFFF' }]}>
                        {isSavingProfile ? 'Guardando...' : 'Guardar'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            ) : (
              /* MODO VISUALIZACIÓN */
              <>
                {/* Avatar e Identidad de la Usuaria */}
                <View style={styles.profileUserHeader}>
                  <View
                    style={[
                      styles.avatarCircle,
                      { backgroundColor: colors.bg.elevated, borderColor: colors.border.focus },
                    ]}
                  >
                    <Feather name="user" size={32} color={colors.border.focus} />
                  </View>
                  <View style={{ marginLeft: spacing.md, flex: 1 }}>
                    <Text
                      style={[typography.scale.h3, { color: colors.text.primary }]}
                      numberOfLines={1}
                    >
                      {persona?.nombre
                        ? `${persona.nombre} ${persona.apellido || ''}`.trim()
                        : user?.email?.split('@')[0] || 'Usuaria'}
                    </Text>
                    <Text
                      style={[typography.scale.caption, { color: colors.text.secondary, marginTop: 2 }]}
                      numberOfLines={1}
                    >
                      {user?.email || 'Sin correo asociado'}
                    </Text>
                  </View>
                </View>

                {/* Filas de Información de Perfil */}
                <View
                  style={[
                    styles.profileInfoList,
                    {
                      borderTopColor: colors.border.default,
                      borderTopWidth: 1,
                      marginTop: spacing.md,
                      paddingTop: spacing.sm,
                    },
                  ]}
                >
                  <InfoRow
                    icon="credit-card"
                    label="DNI"
                    value={persona?.dni || 'No registrado'}
                  />

                  <InfoRow
                    icon="phone"
                    label="Teléfono"
                    value={persona?.telefono || 'No registrado'}
                  />

                  <InfoRow
                    icon="map-pin"
                    label="Dirección"
                    value={persona?.direccion || 'No registrada'}
                    numberOfLines={2}
                  />

                  <InfoRow
                    icon="users"
                    label="Red de Apoyo"
                    value={`${networkCount} contactos vinculados`}
                    valueColor={colors.semantic.info}
                  />

                  <View
                    style={{
                      borderTopColor: colors.border.default,
                      borderTopWidth: 1,
                      marginTop: spacing.sm,
                      paddingTop: spacing.xs,
                    }}
                  />

                  {/* Seguridad de Cuenta / Doble Factor (MFA) con InfoRow seguro ante wrap y anchos chicos */}
                  <InfoRow
                    icon="shield"
                    label="Autenticador"
                    value={
                      checkingMfa ? (
                        <ActivityIndicator size="small" color={colors.semantic.info} />
                      ) : (
                        isMfaActive ? (
                          <Feather name="check-circle" size={24} color="#22C55E" /> // Verde para el tick
                        ) : (
                          <Feather name="x-circle" size={24} color="#EF4444" />     // Rojo para la X
                        )
                      )
                    }
                    valueColor={isMfaActive ? colors.semantic.success : colors.text.secondary}
                    action={
                      isMfaActive ? (
                        <Pressable
                          onPress={handleDesactivarMfa}
                          style={({ pressed }) => [
                            {
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 5,
                              borderRadius: radii.sm,
                              backgroundColor: pressed ? colors.semantic.dangerBg : colors.bg.overlay,
                              borderWidth: 1,
                              borderColor: colors.semantic.danger,
                            },
                          ]}
                          accessibilityLabel="Desactivar Google Authenticator"
                        >
                          <Text style={[typography.scale.caption, { color: colors.semantic.danger, fontWeight: '700' }]}>
                            Desactivar
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => setShowMfaEnrollModal(true)}
                          style={({ pressed }) => [
                            {
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 5,
                              borderRadius: radii.sm,
                              backgroundColor: pressed ? colors.semantic.infoBg : colors.bg.overlay,
                              borderWidth: 1,
                              borderColor: colors.border.focus,
                            },
                          ]}
                          accessibilityLabel="Activar Google Authenticator"
                        >
                          <Text style={[typography.scale.caption, { color: colors.border.focus, fontWeight: '700' }]}>
                            Activar
                          </Text>
                        </Pressable>
                      )
                    }
                  />
                </View>

                {/* Botón Cerrar */}
                <Pressable
                  onPress={() => setShowProfileModal(false)}
                  style={[
                    styles.closeProfileBtn,
                    { backgroundColor: colors.bg.overlay, borderRadius: radii.md, marginTop: spacing.xl },
                  ]}
                >
                  <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>Cerrar</Text>
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingWrapper>
      </Modal>

      {/* Modal de Alertas Pendientes en Modo Resguardo */}
      <Modal visible={showPendingAlerts} animationType="slide" transparent={true} statusBarTranslucent={true}>
        <View style={styles.modalOverlay}>
          <View
            style={{
              backgroundColor: colors.bg.surface,
              borderRadius: radii.lg,
              padding: spacing.xl,
              maxHeight: '80%',
              width: '90%',
            }}
          >
            <Text
              style={[
                typography.scale.h3,
                { color: colors.text.primary, marginBottom: spacing.md },
              ]}
            >
              Alertas Recibidas en Resguardo
            </Text>
            <Text
              style={[
                typography.scale.body,
                { color: colors.text.secondary, marginBottom: spacing.lg },
              ]}
            >
              Durante el Modo Resguardo se mantuvieron en silencio las siguientes alertas recibidas:
            </Text>

            <FlatList
              data={alertasPendientes}
              keyExtractor={(item) => item.incidenteId}
              renderItem={({ item }) => (
                <Pressable
                  style={{
                    padding: spacing.md,
                    borderWidth: 1,
                    borderColor: colors.border.default,
                    borderRadius: radii.md,
                    marginBottom: spacing.sm,
                    backgroundColor: colors.bg.base,
                  }}
                  onPress={() => {
                    setShowPendingAlerts(false);
                    limpiarAlertasPendientes();
                    navigation.navigate('AlertReceived', item);
                  }}
                >
                  <Text
                    style={[typography.scale.bodyBold, { color: colors.semantic.danger }]}
                  >
                    {item.victimName}
                  </Text>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                    {item.address}
                  </Text>
                </Pressable>
              )}
            />

            <Pressable
              style={{ padding: spacing.md, alignItems: 'center', marginTop: spacing.md }}
              onPress={() => {
                setShowPendingAlerts(false);
                limpiarAlertasPendientes();
              }}
            >
              <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── MODAL DEL CENTRO DE ALERTAS Y BANDEJA DE INCIDENTES ───────────── */}
      <Modal
        visible={showAlertsCenter}
        animationType="slide"
        transparent
        statusBarTranslucent={true}
        onRequestClose={() => setShowAlertsCenter(false)}
      >
        <KeyboardAvoidingWrapper mode="modal" style={styles.modalOverlay} extraScrollHeight={16}>
          <View
            style={[
              styles.profileModalCard,
              {
                backgroundColor: colors.bg.surface,
                borderRadius: radii.lg,
                borderColor: colors.border.default,
                maxHeight: '88%',
                width: '92%',
                padding: spacing.lg,
              },
            ]}
          >
            {/* Header del Centro de Alertas */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: alertaActiva ? colors.semantic.dangerBg : colors.bg.elevated,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: spacing.sm,
                  }}
                >
                  <Feather
                    name="bell"
                    size={20}
                    color={alertaActiva ? colors.semantic.danger : colors.text.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.scale.h3, { color: colors.text.primary }]}>
                    Centro de Alertas
                  </Text>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                    {alertaActiva ? '¡Hay una alerta activa en curso!' : 'Bandeja de notificaciones y seguimiento'}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => setShowAlertsCenter(false)}
                style={styles.closeModalBtn}
                accessibilityLabel="Cerrar Centro de Alertas"
              >
                <Feather name="x" size={20} color={colors.text.primary} />
              </Pressable>
            </View>

            {/* Barra de Filtros por Fecha y Búsqueda Reutilizable (Look idéntico a Mis Pruebas) */}
            <DateFilterBar
              filtroRapido={filtroAlertasRapido}
              onSelectFiltroRapido={(modo) => {
                setFiltroAlertasRapido(modo);
                setFechaCalendarioAlertas(null);
              }}
              fechaCalendario={fechaCalendarioAlertas}
              onOpenCalendar={() => setShowCalendarAlertasModal(true)}
              onClearCalendar={() => setFechaCalendarioAlertas(null)}
              textoBusqueda={busquedaTextoAlertas}
              onChangeTextoBusqueda={setBusquedaTextoAlertas}
              placeholderBusqueda="Buscar por contacto o dirección..."
              onLimpiarTodo={alertasFiltradas.length > 0 ? handleLimpiarTodoAlertas : undefined}
              limpiarTodoLabel={verDescartadasAlertas ? 'Vaciar papelera' : 'Limpiar alertas'}
              mostrarToggleDescartadas={true}
              verDescartadas={verDescartadasAlertas}
              onToggleVerDescartadas={setVerDescartadasAlertas}
              descartadasCount={descartadasCount}
            />

            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%', marginTop: spacing.xs }}>
              {/* ── ALERTA EN CURSO (DESTACADA ARRIBA) ── */}
              {alertaActiva && !verDescartadasAlertas ? (
                <View
                  style={{
                    backgroundColor: colors.semantic.dangerBg,
                    borderColor: colors.semantic.danger,
                    borderWidth: 2,
                    borderRadius: radii.md,
                    padding: spacing.md,
                    marginBottom: spacing.md,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: colors.semantic.danger,
                          marginRight: 6,
                        }}
                      />
                      <Text style={[typography.scale.caption, { color: colors.semantic.danger, fontWeight: '800', letterSpacing: 1 }]}>
                        ALERTA ACTIVA EN CURSO
                      </Text>
                    </View>
                    <Text style={[typography.scale.caption, { color: colors.semantic.danger, fontWeight: '700' }]}>
                      {alertaActiva.origen === 'automatico' ? '🤖 Automático' : '✋ Manual'}
                    </Text>
                  </View>

                  <Text style={[typography.scale.h3, { color: colors.text.primary, marginTop: spacing.xs }]}>
                    {alertaActiva.esPropia ? 'Tu Alerta de Resguardo' : alertaActiva.victimaNombre}
                  </Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Feather name="map-pin" size={13} color={colors.text.secondary} />
                    <Text
                      style={[typography.scale.caption, { color: colors.text.secondary, marginLeft: 4, flexShrink: 1 }]}
                      numberOfLines={1}
                    >
                      {alertaActiva.direccion}
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <Feather name="clock" size={13} color={colors.text.secondary} />
                    <Text style={[typography.scale.caption, { color: colors.text.secondary, marginLeft: 4 }]}>
                      Iniciada:{' '}
                      {new Date(alertaActiva.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Text>
                  </View>

                  {/* Botón Destacado: Ingresar a la alerta en vivo */}
                  <Pressable
                    onPress={() => {
                      setShowAlertsCenter(false);
                      navigation.navigate('AlertReceived', {
                        incidenteId: alertaActiva.id,
                        victimName: alertaActiva.victimaNombre,
                        victimPhone: 'Emergencia',
                        address: alertaActiva.direccion,
                        latitude: alertaActiva.latitud,
                        longitude: alertaActiva.longitud,
                        timestamp: new Date(alertaActiva.fechaHora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        origen: alertaActiva.origen,
                      });
                    }}
                    style={{
                      backgroundColor: colors.semantic.danger,
                      borderRadius: radii.sm,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.md,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: spacing.md,
                    }}
                  >
                    <Feather name="activity" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={[typography.scale.bodyBold, { color: '#FFFFFF', fontSize: 14 }]}>
                      Ingresar a la alerta en vivo
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {/* ── BANDEJA DE ALERTAS FILTRADAS ── */}
              <View style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                  <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>
                    {verDescartadasAlertas ? 'Alertas Descartadas' : 'Historial de Alertas'}
                  </Text>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                    {alertasFiltradas.length} {alertasFiltradas.length === 1 ? 'alerta' : 'alertas'}
                  </Text>
                </View>

                {loadingAlertas ? (
                  <View style={{ padding: spacing.lg, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.border.focus} />
                    <Text style={[typography.scale.caption, { color: colors.text.secondary, marginTop: spacing.xs }]}>
                      Actualizando bandeja...
                    </Text>
                  </View>
                ) : alertasFiltradas.length === 0 ? (
                  <View
                    style={{
                      backgroundColor: colors.bg.base,
                      borderRadius: radii.md,
                      padding: spacing.lg,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: colors.border.default,
                    }}
                  >
                    <Feather name="bell-off" size={32} color={colors.text.disabled} />
                    <Text style={[typography.scale.bodyBold, { color: colors.text.primary, marginTop: spacing.sm }]}>
                      {verDescartadasAlertas ? 'No hay alertas descartadas' : 'No se encontraron alertas'}
                    </Text>
                    <Text style={[typography.scale.caption, { color: colors.text.secondary, textAlign: 'center', marginTop: 2 }]}>
                      {verDescartadasAlertas
                        ? 'Las alertas que descartes de tu vista aparecerán aquí.'
                        : busquedaTextoAlertas || fechaCalendarioAlertas || filtroAlertasRapido !== 'todas'
                          ? 'Probá cambiando o limpiando los filtros seleccionados.'
                          : 'Las alertas recibidas de tus contactos de red aparecerán aquí.'}
                    </Text>
                  </View>
                ) : (
                  alertasFiltradas.map((alerta) => {
                    const esEnCurso = alerta.estado === 'en_curso';
                    const fechaTexto = new Date(alerta.fechaHora).toLocaleString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const estaDescartada = dismissedAlertIds.has(alerta.id);

                    return (
                      <View
                        key={alerta.id}
                        style={{
                          backgroundColor: colors.bg.base,
                          borderColor: esEnCurso ? colors.semantic.danger : colors.border.default,
                          borderWidth: 1,
                          borderRadius: radii.md,
                          padding: spacing.md,
                          marginBottom: spacing.sm,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Pressable
                            onPress={() => {
                              setShowAlertsCenter(false);
                              navigation.navigate('AlertReceived', {
                                incidenteId: alerta.id,
                                victimName: alerta.victimaNombre,
                                victimPhone: 'Emergencia',
                                address: alerta.direccion,
                                latitude: alerta.latitud,
                                longitude: alerta.longitud,
                                timestamp: fechaTexto,
                                origen: alerta.origen,
                                estado: alerta.estado,
                              });
                            }}
                            style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.xs }}
                          >
                            <Text style={[typography.scale.bodyBold, { color: colors.text.primary, fontSize: 14 }]} numberOfLines={1}>
                              {alerta.esPropia ? 'Tu Alerta' : alerta.victimaNombre}
                            </Text>
                            {alerta.esPropia && (
                              <View
                                style={{
                                  backgroundColor: colors.bg.elevated,
                                  borderRadius: radii.full,
                                  paddingHorizontal: 6,
                                  paddingVertical: 1,
                                  marginLeft: 6,
                                }}
                              >
                                <Text style={[typography.scale.caption, { color: colors.semantic.info, fontSize: 10, fontWeight: '700' }]}>
                                  Propia
                                </Text>
                              </View>
                            )}
                          </Pressable>

                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View
                              style={{
                                backgroundColor:
                                  alerta.estado === 'en_curso'
                                    ? colors.semantic.dangerBg
                                    : colors.bg.elevated,
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: radii.full,
                                flexDirection: 'row',
                                alignItems: 'center',
                              }}
                            >
                              <View
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 3,
                                  backgroundColor:
                                    alerta.estado === 'en_curso'
                                      ? colors.semantic.danger
                                      : alerta.estado === 'sin_senal'
                                        ? '#FB8C00'
                                        : colors.text.disabled,
                                  marginRight: 4,
                                }}
                              />
                              <Text
                                style={[
                                  typography.scale.caption,
                                  {
                                    color:
                                      alerta.estado === 'en_curso'
                                        ? colors.semantic.danger
                                        : alerta.estado === 'sin_senal'
                                          ? '#FB8C00'
                                          : colors.text.secondary,
                                    fontWeight: '700',
                                    fontSize: 10,
                                  },
                                ]}
                              >
                                {alerta.estado === 'en_curso'
                                  ? 'En curso'
                                  : alerta.estado === 'sin_senal'
                                    ? 'Sin señal'
                                    : 'Finalizada'}
                              </Text>
                            </View>

                            {/* Descarte Lógico (X) o Restaurar/Eliminar Definitivo */}
                            {estaDescartada ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Pressable
                                  onPress={() => handleRestaurarAlerta(alerta.id)}
                                  style={{
                                    paddingHorizontal: 8,
                                    paddingVertical: 3,
                                    borderRadius: radii.sm,
                                    backgroundColor: colors.bg.elevated,
                                    borderWidth: 1,
                                    borderColor: colors.border.default,
                                  }}
                                  accessibilityLabel="Restaurar alerta a la bandeja principal"
                                >
                                  <Text style={[typography.scale.caption, { color: colors.semantic.info, fontSize: 10, fontWeight: '700' }]}>
                                    Restaurar
                                  </Text>
                                </Pressable>

                                <Pressable
                                  onPress={() => handleBajaLogicaAlerta(alerta.id)}
                                  style={{
                                    paddingHorizontal: 8,
                                    paddingVertical: 3,
                                    borderRadius: radii.sm,
                                    backgroundColor: colors.semantic.dangerBg,
                                    borderWidth: 1,
                                    borderColor: colors.semantic.danger,
                                  }}
                                  accessibilityLabel="Eliminar alerta definitivamente (baja lógica)"
                                >
                                  <Text style={[typography.scale.caption, { color: colors.semantic.danger, fontSize: 10, fontWeight: '700' }]}>
                                    Eliminar
                                  </Text>
                                </Pressable>
                              </View>
                            ) : (
                              <Pressable
                                onPress={() => handleDescartarAlerta(alerta.id)}
                                hitSlop={8}
                                style={{
                                  padding: 4,
                                  borderRadius: radii.full,
                                  backgroundColor: colors.bg.elevated,
                                }}
                                accessibilityLabel="Mandar alerta a la papelera"
                              >
                                <Feather name="x" size={14} color={colors.text.secondary} />
                              </Pressable>
                            )}
                          </View>
                        </View>

                        <Pressable
                          onPress={() => {
                            setShowAlertsCenter(false);
                            navigation.navigate('AlertReceived', {
                              incidenteId: alerta.id,
                              victimName: alerta.victimaNombre,
                              victimPhone: 'Emergencia',
                              address: alerta.direccion,
                              latitude: alerta.latitud,
                              longitude: alerta.longitud,
                              timestamp: fechaTexto,
                              origen: alerta.origen,
                              estado: alerta.estado,
                            });
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                            <Feather name="map-pin" size={12} color={colors.text.secondary} />
                            <Text
                              style={[typography.scale.caption, { color: colors.text.secondary, marginLeft: 4, flexShrink: 1, fontSize: 11 }]}
                              numberOfLines={1}
                            >
                              {alerta.direccion}
                            </Text>
                          </View>

                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                            <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 10 }]}>
                              {fechaTexto}
                            </Text>
                            <Text style={[typography.scale.caption, { color: colors.semantic.info, fontSize: 10, fontWeight: '600' }]}>
                              {alerta.origen === 'automatico' ? '🤖 Automático' : '✋ Manual'}
                            </Text>
                          </View>
                        </Pressable>
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>

            {/* Snackbar flotante de descarte con opción Deshacer */}
            {alertSnackbarMessage && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 60,
                  left: spacing.lg,
                  right: spacing.lg,
                  backgroundColor: '#0F172A',
                  borderRadius: radii.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.35,
                  shadowRadius: 8,
                  elevation: 8,
                  borderWidth: 1,
                  borderColor: '#334155',
                }}
              >
                <Text style={[typography.scale.body, { color: '#F8FAFC', flex: 1, fontSize: 13 }]}>
                  {alertSnackbarMessage}
                </Text>
                {undoAlertId && (
                  <Pressable
                    onPress={handleDeshacerDescarte}
                    style={{
                      paddingVertical: 5,
                      paddingHorizontal: spacing.sm,
                      borderRadius: radii.sm,
                      backgroundColor: colors.border.focus,
                      marginLeft: spacing.sm,
                    }}
                  >
                    <Text style={[typography.scale.bodyBold, { color: '#FFFFFF', fontSize: 12 }]}>
                      Deshacer
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Selector de Calendario para Filtro de Alertas */}
            <CalendarModal
              visible={showCalendarAlertasModal}
              fechaSeleccionada={fechaCalendarioAlertas}
              fechasConEvidencias={fechasConAlertas}
              onSeleccionarFecha={(fecha) => {
                setFechaCalendarioAlertas(fecha);
                setShowCalendarAlertasModal(false);
              }}
              onLimpiarFecha={() => {
                setFechaCalendarioAlertas(null);
                setShowCalendarAlertasModal(false);
              }}
              onCerrar={() => setShowCalendarAlertasModal(false)}
            />

            <Pressable
              onPress={() => setShowAlertsCenter(false)}
              style={{
                backgroundColor: colors.bg.elevated,
                borderRadius: radii.sm,
                paddingVertical: spacing.sm,
                alignItems: 'center',
                marginTop: spacing.sm,
              }}
            >
              <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingWrapper>
      </Modal>

      {/* ── MODAL DE MIS PRUEBAS (Auditoría Forense y Reproducción en Vivo) ── */}
      <EvidenceModal
        visible={showEvidenceModal}
        onClose={() => setShowEvidenceModal(false)}
      />

      {/* ── MODAL DE EXCLUSIÓN DE BATERÍA (Doze Mode) ── */}
      <BatteryOptimizationModal
        visible={showBatteryModal}
        onDismiss={() => setShowBatteryModal(false)}
      />

      {/* ── MODAL DE GESTIÓN DE SEGUNDO PLANO Y PERMISOS ── */}
      <BackgroundPermissionsModal
        visible={showBackgroundModal}
        onClose={() => setShowBackgroundModal(false)}
      />

      {/* ── AVISO DE UBICACIÓN AL ABRIR LA APP ── */}
      <AvisoUbicacionModal />

      {/* ── MODAL DE VINCULACIÓN MFA (Google Authenticator) ── */}
      <MfaSecurityModal
        visible={showMfaEnrollModal}
        mode="enroll"
        onSuccess={() => {
          setShowMfaEnrollModal(false);
          verificarEstadoMfa();
        }}
        onCancel={() => setShowMfaEnrollModal(false)}
      />

      {/* ── MODALES FASE 3 Y 7 (Captura Visual Voluntaria y Privacidad No Bloqueante) ── */}
      <CameraCaptureModal
        visible={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapturaFinalizada={async () => {
          Location.stopLocationUpdatesAsync('background-location-task').catch(() => { });
          if (resguardoService.isResguardoActive()) {
            await resguardoService.desactivarModoResguardoAsync();
          }
          setModoResguardo(false);
        }}
      />

      <PrivacyInfoModal
        visible={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
      />
    </SafeAreaView>
  );
}

const SOS_SIZE = 145;

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  headerBlock: { width: '100%' },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusBadge: { width: '100%' },
  statusBadgeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  statusDot: { width: 9, height: 9, borderRadius: 4.5 },
  statusBadgeDetails: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  surfaceBlock: { flex: 1, width: '100%' },
  sosContainer: {
    position: 'relative',
    width: SOS_SIZE,
    height: SOS_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  pulseHalo: { position: 'absolute', width: SOS_SIZE, height: SOS_SIZE },
  sosButton: {
    width: SOS_SIZE,
    height: SOS_SIZE,
    borderRadius: SOS_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  card: { width: '100%', borderWidth: 1 },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  cardContentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  statusDotSmall: { width: 8, height: 8, borderRadius: 4 },
  actionBadge: { paddingHorizontal: 10, paddingVertical: 4 },
  voiceRecordBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  configBox: { borderWidth: 1 },
  inlineTextInput: { borderWidth: 1, fontSize: 14 },
  smallActionButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  devButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    width: '100%',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  popoverBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 65,
    paddingRight: 16,
  },
  hamburgerDropdownCard: {
    width: 190,
    borderWidth: 1,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  profileModalCard: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  profileModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  closeModalBtn: { padding: 4 },
  profileUserHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatarCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfoList: { width: '100%' },
  profileInfoRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  closeProfileBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  voiceModalCard: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  voiceModalHeader: { flexDirection: 'row', alignItems: 'center' },
  voiceCenterArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
    position: 'relative',
  },
  voicePulseHalo: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  voiceMicButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  voiceModalActions: { flexDirection: 'row', marginTop: 20 },
  voiceActionBtn: {
    flex: 1,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceActionBtnFull: {
    width: '100%',
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteAccountCard: {
    width: '90%',
    maxWidth: 420,
    padding: 20,
    alignSelf: 'center',
  },
  deleteInput: {
    height: 44,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  deleteModalBtn: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
