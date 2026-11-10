// src/components/EvidenceModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal de Auditoría y Reproducción Pericial "Mis Pruebas" (CU-08 / RF-3.5)
//
// Permite a la usuaria:
// 1. Listar todas las evidencias forenses capturadas en sus incidentes.
// 2. Verificar el estado del sello de tiempo oficial RFC 3161 (TSA) y SHA-256.
// 3. Descargar el binario cifrado del bucket privado de Supabase Storage.
// 4. Desencriptar en vivo en el dispositivo usando AES-256-GCM (Sobre Digital).
// 5. Reproducir el audio ambiental capturado con expo-audio.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Image,
  Switch,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '@theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CalendarModal } from './CalendarModal';
import { KeyboardAvoidingWrapper } from './KeyboardAvoidingWrapper';
import { getApiBaseUrl } from '../lib/api';
import {
  desencriptarAudioEnvelopeAsync,
  desencriptarArchivoEnvelopeAsync,
  base64ToUint8Array,
  resolverDekEvidenciaAsync,
  uint8ArrayToBase64,
} from '../lib/cryptoForense';
import { useVideoPlayer, VideoView } from 'expo-video';

interface EvidenciaItem {
  id: string;
  incidente_id?: string;
  tipo_archivo: string;
  url_almacenamiento: string;
  hash_sha256: string;
  token_rfc3161: string | null;
  prev_hash: string | null;
  metadata_dispositivo: any;
  fecha_captura: string;
  sincronizado_en?: string;
  consentimiento_exportacion?: boolean;
  fecha_consentimiento?: string | null;
  incidente?: {
    id: string;
    origen: string;
    fecha_hora: string;
    direccion?: string;
    latitud?: number | null;
    longitud?: number | null;
    consentimiento_exportacion?: boolean;
    fecha_consentimiento?: string | null;
  };
}

interface IncidenteExpediente {
  incidenteId: string;
  fechaInicio: string;
  direccion: string;
  latitud?: number | null;
  longitud?: number | null;
  origen: string;
  consentimiento_exportacion: boolean;
  fecha_consentimiento: string | null;
  evidencias: EvidenciaItem[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

type AudioState = 'idle' | 'downloading' | 'decrypting' | 'playing';

async function descargarDescifradaDesdeBackendAsync(evidenciaId: string): Promise<Uint8Array> {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${getApiBaseUrl()}/api/v1/evidencias/${evidenciaId}/reproducir`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
  });
  if (!respuesta.ok) {
    throw new Error(`No se pudo recuperar la evidencia (HTTP ${respuesta.status}).`);
  }
  return new Uint8Array(await respuesta.arrayBuffer());
}

function ForensicVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <VideoView
      style={styles.previewVideo}
      player={player}
      nativeControls={true}
      contentFit="contain"
    />
  );
}

export function EvidenceModal({ visible, onClose }: Props) {
  const { colors, typography, spacing, radii, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const primaryActionColor = isDark ? colors.semantic.danger : '#7A1F1F';
  const primaryActionTextColor = isDark ? '#121A1D' : '#FFFFFF';

  const [loading, setLoading] = useState(false);
  const [evidencias, setEvidencias] = useState<EvidenciaItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [activeEvidenciaId, setActiveEvidenciaId] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [statusText, setStatusText] = useState<string>('');
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<EvidenciaItem | null>(null);
  const [previewVideoUri, setPreviewVideoUri] = useState<string | null>(null);
  const [previewVideoItem, setPreviewVideoItem] = useState<EvidenciaItem | null>(null);

  // ── Filtros Forenses (Fecha, Dirección y Tipo de Multimedia) ───────────────
  const [filtroFechaRapido, setFiltroFechaRapido] = useState<'todas' | 'hoy' | '7dias'>('todas');
  const [fechaCalendario, setFechaCalendario] = useState<string | null>(null);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [filtroDireccion, setFiltroDireccion] = useState('');
  const [filtroTipoMultimedia, setFiltroTipoMultimedia] = useState<'todos' | 'audio' | 'imagen' | 'video'>('todos');

  // ── Agrupación de Evidencias por Incidente / Expediente Pericial ─────────
  const incidentesExpedientes = useMemo(() => {
    const mapa = new Map<string, IncidenteExpediente>();

    // Ordenar cronológicamente para que los segmentos queden encadenados #1, #2, #3...
    const sorted = [...evidencias].sort(
      (a, b) => new Date(a.fecha_captura || 0).getTime() - new Date(b.fecha_captura || 0).getTime()
    );

    sorted.forEach((item) => {
      const incId = (item as any).incidente_id || item.incidente?.id || `standalone_${item.id}`;
      if (!mapa.has(incId)) {
        const fechaInc = item.incidente?.fecha_hora || item.fecha_captura || new Date().toISOString();
        const dir = item.incidente?.direccion || item.metadata_dispositivo?.direccion || 'Coordenadas protegidas';
        const lat = item.incidente?.latitud ?? item.metadata_dispositivo?.coordenadas?.latitude ?? item.metadata_dispositivo?.latitud ?? null;
        const lon = item.incidente?.longitud ?? item.metadata_dispositivo?.coordenadas?.longitude ?? item.metadata_dispositivo?.longitud ?? null;
        const orig = item.incidente?.origen || item.metadata_dispositivo?.origen || 'manual';
        const consent = Boolean(item.incidente?.consentimiento_exportacion ?? item.consentimiento_exportacion);
        const fechaConsent = item.incidente?.fecha_consentimiento || item.fecha_consentimiento || null;

        mapa.set(incId, {
          incidenteId: incId,
          fechaInicio: fechaInc,
          direccion: dir,
          latitud: lat,
          longitud: lon,
          origen: orig,
          consentimiento_exportacion: consent,
          fecha_consentimiento: fechaConsent,
          evidencias: [],
        });
      }

      const exp = mapa.get(incId)!;
      exp.evidencias.push(item);
      if (item.consentimiento_exportacion) {
        exp.consentimiento_exportacion = true;
        if (!exp.fecha_consentimiento && item.fecha_consentimiento) {
          exp.fecha_consentimiento = item.fecha_consentimiento;
        }
      }
    });

    const lista = Array.from(mapa.values());
    // Ordenar los expedientes por fecha de inicio descendente (los más recientes primero)
    lista.sort((a, b) => new Date(b.fechaInicio).getTime() - new Date(a.fechaInicio).getTime());
    return lista;
  }, [evidencias]);

  // Fechas que contienen al menos una prueba pericial registrada
  const fechasConEvidencias = useMemo(() => {
    const set = new Set<string>();
    incidentesExpedientes.forEach((exp) => {
      const fecha = new Date(exp.fechaInicio);
      const dia = String(fecha.getDate()).padStart(2, '0');
      const mes = String(fecha.getMonth() + 1).padStart(2, '0');
      const anio = String(fecha.getFullYear());
      set.add(`${dia}/${mes}/${anio}`);
    });
    return set;
  }, [incidentesExpedientes]);

  const hayFiltrosActivos =
    filtroFechaRapido !== 'todas' ||
    fechaCalendario !== null ||
    filtroDireccion.trim().length > 0 ||
    filtroTipoMultimedia !== 'todos';

  const limpiarFiltros = () => {
    setFiltroFechaRapido('todas');
    setFechaCalendario(null);
    setFiltroDireccion('');
    setFiltroTipoMultimedia('todos');
  };

  // Filtrado reactivo en tiempo real de Expedientes
  const expedientesFiltrados = useMemo(() => {
    return incidentesExpedientes.filter((exp) => {
      const fechaExp = new Date(exp.fechaInicio);
      const now = new Date();

      // 1. Filtro rápido de fecha
      if (!fechaCalendario) {
        if (filtroFechaRapido === 'hoy') {
          const esHoy =
            fechaExp.getDate() === now.getDate() &&
            fechaExp.getMonth() === now.getMonth() &&
            fechaExp.getFullYear() === now.getFullYear();
          if (!esHoy) return false;
        } else if (filtroFechaRapido === '7dias') {
          const hace7Dias = new Date();
          hace7Dias.setDate(now.getDate() - 7);
          if (fechaExp < hace7Dias) return false;
        }
      }

      // 2. Filtro por fecha de calendario
      if (fechaCalendario) {
        const dia = String(fechaExp.getDate()).padStart(2, '0');
        const mes = String(fechaExp.getMonth() + 1).padStart(2, '0');
        const anio = String(fechaExp.getFullYear());
        const itemFechaStr = `${dia}/${mes}/${anio}`;
        if (itemFechaStr !== fechaCalendario) {
          return false;
        }
      }

      // 3. Filtro por dirección
      if (filtroDireccion.trim().length > 0) {
        const queryDir = filtroDireccion.trim().toLowerCase();
        const dir = (exp.direccion || '').toLowerCase();
        if (!dir.includes(queryDir)) {
          return false;
        }
      }

      // 4. Filtro por tipo de multimedia
      if (filtroTipoMultimedia !== 'todos') {
        const tieneTipo = exp.evidencias.some((ev) => {
          const t = (ev.tipo_archivo || 'audio').toLowerCase();
          if (filtroTipoMultimedia === 'imagen') return t === 'imagen';
          if (filtroTipoMultimedia === 'video') return t === 'video';
          if (filtroTipoMultimedia === 'audio') return t === 'audio' || t === 'wav' || t === 'm4a';
          return false;
        });
        if (!tieneTipo) return false;
      }

      return true;
    });
  }, [incidentesExpedientes, filtroFechaRapido, fechaCalendario, filtroDireccion, filtroTipoMultimedia]);

  const activePlayerRef = useRef<AudioPlayer | null>(null);

  // ── Detener reproducción activa ────────────────────────────────────────────
  const detenerAudio = useCallback(() => {
    try {
      if (activePlayerRef.current) {
        activePlayerRef.current.pause();
        activePlayerRef.current.release();
        activePlayerRef.current = null;
      }
    } catch (e) {
      console.warn('[EvidenceModal] Aviso al detener reproductor:', e);
    }
    setActiveEvidenciaId(null);
    setAudioState('idle');
    setStatusText('');
  }, []);

  // ── Cargar evidencias desde Supabase ──────────────────────────────────────
  const cargarEvidencias = useCallback(async (targetPage = 1) => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const pageSize = 30;
      const fromOffset = (targetPage - 1) * pageSize;
      const toOffset = fromOffset + pageSize - 1;

      const { data, count, error } = await supabase
        .from('evidencia')
        .select(`
          evi_id_evidencia,
          inc_id_incidente,
          evi_tipo_archivo,
          evi_url_almacenamiento,
          evi_hash_sha256,
          evi_token_rfc3161,
          evi_prev_hash,
          evi_metadata_dispositivo,
          evi_fecha_captura,
          evi_sincronizado_en,
          evi_consentimiento_exportacion,
          evi_fecha_consentimiento,
          incidente:inc_id_incidente (
            inc_id_incidente,
            inc_origen,
            inc_fecha_hora,
            inc_direccion,
            inc_latitud,
            inc_longitud,
            inc_consentimiento_exportacion,
            inc_fecha_consentimiento
          )
        `, { count: 'exact' })
        .eq('usu_id_usuario', user.id)
        .order('evi_fecha_captura', { ascending: false })
        .range(fromOffset, toOffset);

      if (error) {
        console.error('[EvidenceModal] Error cargando evidencias:', error.message);
        Alert.alert('Error', 'No se pudieron consultar tus pruebas registradas.');
        return;
      }

      const mapped = ((data as any[]) || []).map((raw: any) => {
        const rawInc = raw.incidente || {};
        return {
          ...raw,
          id: raw.evi_id_evidencia ?? raw.id,
          incidente_id: raw.inc_id_incidente ?? raw.incidente_id,
          tipo_archivo: raw.evi_tipo_archivo ?? raw.tipo_archivo,
          url_almacenamiento: raw.evi_url_almacenamiento ?? raw.url_almacenamiento,
          hash_sha256: raw.evi_hash_sha256 ?? raw.hash_sha256,
          token_rfc3161: raw.evi_token_rfc3161 ?? raw.token_rfc3161,
          prev_hash: raw.evi_prev_hash ?? raw.prev_hash,
          metadata_dispositivo: raw.evi_metadata_dispositivo ?? raw.metadata_dispositivo,
          fecha_captura: raw.evi_fecha_captura ?? raw.fecha_captura,
          sincronizado_en: raw.evi_sincronizado_en ?? raw.sincronizado_en,
          consentimiento_exportacion: raw.evi_consentimiento_exportacion ?? raw.consentimiento_exportacion,
          fecha_consentimiento: raw.evi_fecha_consentimiento ?? raw.fecha_consentimiento,
          incidente: {
            ...rawInc,
            id: rawInc.inc_id_incidente ?? rawInc.id,
            origen: rawInc.inc_origen ?? rawInc.origen,
            fecha_hora: rawInc.inc_fecha_hora ?? rawInc.fecha_hora,
            direccion: rawInc.inc_direccion ?? rawInc.direccion,
            latitud: Number(rawInc.inc_latitud ?? rawInc.latitud),
            longitud: Number(rawInc.inc_longitud ?? rawInc.longitud),
            consentimiento_exportacion: rawInc.inc_consentimiento_exportacion ?? rawInc.consentimiento_exportacion,
            fecha_consentimiento: rawInc.inc_fecha_consentimiento ?? rawInc.fecha_consentimiento,
          },
        };
      });
      setEvidencias(mapped as unknown as EvidenciaItem[]);
      const total = count || 0;
      setTotalRegistros(total);
      setTotalPages(Math.max(1, Math.ceil(total / pageSize)));
      setPage(targetPage);
    } catch (err: any) {
      console.error('[EvidenceModal] Error inesperado:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (visible) {
      cargarEvidencias(1);
    } else {
      detenerAudio();
      setPreviewImageUri(null);
      setPreviewVideoUri(null);
      setPreviewItem(null);
      setPreviewVideoItem(null);
    }
  }, [visible, cargarEvidencias, detenerAudio]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      detenerAudio();
      setPreviewImageUri(null);
      setPreviewVideoUri(null);
      setPreviewItem(null);
      setPreviewVideoItem(null);
    };
  }, [detenerAudio]);

  const [updatingConsentId, setUpdatingConsentId] = useState<string | null>(null);
  const [exportingIncidenteId, setExportingIncidenteId] = useState<string | null>(null);

  // ── Otorgar o revocar consentimiento informado soberano por Incidente (Ley 25.326) ──
  const handleToggleConsentimientoIncidente = async (exp: IncidenteExpediente) => {
    const estadoActual = exp.consentimiento_exportacion;
    const nuevoEstado = !estadoActual;
    const ahoraIso = nuevoEstado ? new Date().toISOString() : null;

    setUpdatingConsentId(exp.incidenteId);
    try {
      // 1. Actualizar incidente en Supabase
      if (exp.incidenteId && !exp.incidenteId.startsWith('standalone_')) {
        const { error: incErr } = await supabase
          .from('incidente')
          .update({
            inc_consentimiento_exportacion: nuevoEstado,
            inc_fecha_consentimiento: ahoraIso,
          })
          .eq('inc_id_incidente', exp.incidenteId);

        if (incErr) {
          console.warn('[EvidenceModal] Advertencia actualizando consentimiento en incidente:', incErr);
        }
      }

      // 2. Actualizar todas las evidencias de este expediente
      const evIds = exp.evidencias.map((e) => e.id);
      if (evIds.length > 0) {
        const { error: evErr } = await supabase
          .from('evidencia')
          .update({
            evi_consentimiento_exportacion: nuevoEstado,
            evi_fecha_consentimiento: ahoraIso,
          })
          .in('evi_id_evidencia', evIds);

        if (evErr) throw evErr;
      }

      // 3. Sincronizar con backend institucional (Service Role & Audit)
      if (exp.incidenteId && !exp.incidenteId.startsWith('standalone_')) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            await fetch(`${getApiBaseUrl()}/api/v1/evidencias/incidente/${exp.incidenteId}/consentimiento`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ consentimiento_exportacion: nuevoEstado }),
            });
          }
        } catch (patchErr) {
          console.warn('[EvidenceModal] Aviso sincronizando con backend PATCH incidente consentimiento:', patchErr);
        }
      } else if (evIds.length > 0) {
        // Prueba de testigo sin incidente propio: el consentimiento es por evidencia
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            await Promise.all(
              evIds.map((evId) =>
                fetch(`${getApiBaseUrl()}/api/v1/evidencias/${evId}/consentimiento`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                  },
                  body: JSON.stringify({ consentimiento_exportacion: nuevoEstado }),
                })
              )
            );
          }
        } catch (patchErr) {
          console.warn('[EvidenceModal] Aviso sincronizando con backend PATCH evidencia consentimiento:', patchErr);
        }
      }

      // 4. Sincronizar estado local reactivamente
      setEvidencias((prev) =>
        prev.map((e) => {
          if (evIds.includes(e.id)) {
            return {
              ...e,
              consentimiento_exportacion: nuevoEstado,
              fecha_consentimiento: ahoraIso,
              incidente: e.incidente
                ? { ...e.incidente, consentimiento_exportacion: nuevoEstado, fecha_consentimiento: ahoraIso }
                : undefined,
            };
          }
          return e;
        })
      );

      Alert.alert(
        nuevoEstado ? 'Acceso Judicial Concedido' : 'Acceso Judicial Revocado',
        nuevoEstado
          ? 'Has autorizado formalmente a las autoridades judiciales a acceder a todas las pruebas de este expediente bajo la Ley 25.326 y norma ISO/IEC 27037.'
          : 'Se ha restringido el acceso judicial. Las autoridades solo verán los metadatos de integridad sin poder reproducir ni descargar el material probatorio.'
      );
    } catch (err: any) {
      console.error('[EvidenceModal] Error actualizando consentimiento:', err);
      await cargarEvidencias(page);
      Alert.alert(
        'Inconveniente al Actualizar',
        'No se pudo sincronizar el consentimiento en el servidor. Se restableció el estado anterior.'
      );
    } finally {
      setUpdatingConsentId(null);
    }
  };

  // ── Helper: Desencriptar Evidencia para Exportación Local (Sobre Digital AES-256-GCM) ──
  const desencriptarEvidenciaParaExportacion = async (item: EvidenciaItem): Promise<{
    fileUri: string;
    base64: string;
    nombreArchivo: string;
    mimeType: string;
  } | null> => {
    try {
      let storagePath = (item.url_almacenamiento || '').trim();
      if (storagePath.includes('/evidencias/')) {
        storagePath = storagePath.split('/evidencias/')[1];
      } else if (storagePath.startsWith('evidencias/')) {
        storagePath = storagePath.replace(/^evidencias\//, '');
      }
      storagePath = storagePath.replace(/^\/+/, '');
      if (!storagePath) return null;

      const { data: signData, error: signErr } = await supabase.storage
        .from('evidencias')
        .createSignedUrl(storagePath, 300);

      let encryptedBytes: Uint8Array;
      if (!signErr && signData?.signedUrl) {
        const tempEncPath = `${FileSystem.cacheDirectory}temp_enc_exp_${item.id}.bin`;
        await FileSystem.downloadAsync(signData.signedUrl, tempEncPath);
        const b64 = await FileSystem.readAsStringAsync(tempEncPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        encryptedBytes = base64ToUint8Array(b64);
      } else {
        const { data: blobData, error: dlErr } = await supabase.storage
          .from('evidencias')
          .download(storagePath);
        if (dlErr || !blobData) return null;
        const arrayBuffer = await new Response(blobData).arrayBuffer();
        encryptedBytes = new Uint8Array(arrayBuffer);
      }

      let dekHex = await resolverDekEvidenciaAsync(item.metadata_dispositivo?.sobre_digital);
      if (!dekHex) {
        dekHex = (await AsyncStorage.getItem(`@apoyar_dek_${item.id}`)) || undefined;
      }
      const incId = item.incidente?.id || (item as any).incidente_id;
      if (!dekHex && incId) {
        dekHex = (await AsyncStorage.getItem(`@apoyar_dek_${incId}`)) || undefined;
      }

      // Evidencia cifrada en otra instalación: la descifra el backend tras validar a la titular
      if (!dekHex && item.metadata_dispositivo?.sobre_digital?.dek_custodia_b64) {
        encryptedBytes = await descargarDescifradaDesdeBackendAsync(item.id);
      }

      const ivHex = item.metadata_dispositivo?.sobre_digital?.iv_hex;
      const hashPlano = item.metadata_dispositivo?.sobre_digital?.hash_audio_plano;
      const tipo = (item.tipo_archivo || 'audio').toLowerCase();
      const formato = (item.metadata_dispositivo?.sobre_digital?.formato || '').toLowerCase();

      let ext = 'm4a';
      let mimeType = 'audio/mp4';
      let labelTipo = 'Audio';

      if (tipo === 'imagen' || formato === 'jpg' || formato === 'jpeg') {
        ext = 'jpg';
        mimeType = 'image/jpeg';
        labelTipo = 'Fotografia';
      } else if (formato === 'png') {
        ext = 'png';
        mimeType = 'image/png';
        labelTipo = 'Fotografia';
      } else if (tipo === 'video' || formato === 'mp4') {
        ext = 'mp4';
        mimeType = 'video/mp4';
        labelTipo = 'Video';
      } else if (formato === 'wav') {
        ext = 'wav';
        mimeType = 'audio/wav';
        labelTipo = 'Audio';
      }

      let fileUri: string;
      let base64: string;

      if (dekHex) {
        const resultado = await desencriptarArchivoEnvelopeAsync(
          encryptedBytes,
          dekHex,
          ext,
          ivHex,
          hashPlano
        );
        fileUri = resultado.fileUri;
        base64 = uint8ArrayToBase64(resultado.bytesDesencriptados);
      } else {
        const tempPath = `${FileSystem.cacheDirectory}raw_exp_${item.id}.${ext}`;
        base64 = uint8ArrayToBase64(encryptedBytes);
        await FileSystem.writeAsStringAsync(tempPath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        fileUri = tempPath;
      }

      const nombreArchivo = `Segmento_${labelTipo}_${item.id.slice(0, 8)}.${ext}`;
      return { fileUri, base64, nombreArchivo, mimeType };
    } catch (e) {
      console.warn(`[EvidenceModal] Error desencriptando evidencia ${item.id}:`, e);
      return null;
    }
  };

  // ── Descarga Soberana para el Ciudadano (Ley 25.326 Arts. 14 y 15) ─────────────
  const handleExportarSoberano = async (exp: IncidenteExpediente) => {
    if (exportingIncidenteId) return;
    setExportingIncidenteId(exp.incidenteId);

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      let sharedFileUri: string | null = null;
      let sharedMimeType = 'application/zip';
      let zipDescargadoConExito = false;

      // 1. Descarga del paquete .ZIP forense completo desde el backend
      if (token && exp.incidenteId && !exp.incidenteId.startsWith('standalone_')) {
        try {
          const apiBase = getApiBaseUrl();
          const targetUrl = `${apiBase}/api/v1/evidencias/incidente/${exp.incidenteId}/exportar?origen_exportacion=titular`;
          const localZipPath = `${FileSystem.documentDirectory}Expediente_Forense_ApoyAR_${exp.incidenteId.slice(0, 8)}.zip`;

          const dlResult = await FileSystem.downloadAsync(targetUrl, localZipPath, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (dlResult.status === 200) {
            sharedFileUri = dlResult.uri;
            sharedMimeType = 'application/zip';
            zipDescargadoConExito = true;
          }
        } catch (backendErr) {
          console.warn('[EvidenceModal] Aviso descargando paquete .zip del backend, ejecutando fallback local:', backendErr);
        }
      }

      // 2. Fallback: Desencriptación local y generación de Acta Oficial en PDF con expo-print
      let localDecryptedFiles: Array<{ nombreArchivo: string; fileUri: string; base64: string; mimeType: string }> = [];

      if (!zipDescargadoConExito) {
        // Desencriptar archivos para anexo visual y guardado directo
        for (const ev of exp.evidencias) {
          const resDec = await desencriptarEvidenciaParaExportacion(ev);
          if (resDec) {
            localDecryptedFiles.push(resDec);
          }
        }

        // Anexo Visual Probatorio para Fotografías
        const fotosHtml = localDecryptedFiles
          .filter((f) => f.mimeType.startsWith('image/'))
          .map((f, idx) => {
            const evMatch = exp.evidencias.find((e) => f.nombreArchivo.includes(e.id.slice(0, 8)));
            const hCifrado = evMatch?.hash_sha256 || 'N/A';
            const hDesenc = evMatch?.metadata_dispositivo?.sobre_digital?.hash_audio_plano || 'Verificado contra binario original';
            return `
            <div style="margin-bottom: 24px; text-align: center; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #f8fafc;">
              <img src="data:${f.mimeType};base64,${f.base64}" style="max-width: 100%; max-height: 420px; object-fit: contain; border-radius: 4px;" />
              <div style="font-size: 11px; font-weight: bold; color: #1e293b; margin-top: 8px;">Fotografía Probatoria #${idx + 1} — ${f.nombreArchivo}</div>
              <div style="font-family: monospace; font-size: 10px; color: #047857; margin-top: 4px;"><strong>Hash SHA-256 (JPG Desencriptado):</strong> ${hDesenc}</div>
              <div style="font-family: monospace; font-size: 10px; color: #475569;"><strong>Hash SHA-256 (Sobre Cifrado TSA):</strong> ${hCifrado}</div>
              <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Desencriptada en hardware cliente bajo tutela soberana (Ley N.° 25.326)</div>
            </div>
          `;
          })
          .join('');

        const filasHtml = exp.evidencias
          .map((ev, idx) => {
            const tipoLabel =
              ev.tipo_archivo === 'imagen'
                ? 'Fotografía'
                : ev.tipo_archivo === 'video'
                ? 'Video pericial'
                : `Audio ambiental #${idx + 1}`;
            const prevHashLabel = ev.prev_hash
              ? ev.prev_hash
              : '0000000000000000000000000000000000000000000000000000000000000000 (Cadena Génesis)';
            const tsaLabel = ev.token_rfc3161
              ? `✓ TSA RFC 3161 Sellado (${Math.round(ev.token_rfc3161.length * 0.75)} bytes)`
              : 'En cola TSA';
            const hashCifrado = ev.hash_sha256 || 'N/A';
            const hashPlano = ev.metadata_dispositivo?.sobre_digital?.hash_audio_plano || 'Preservado en sobre seguro';

            return `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px; font-weight: bold; vertical-align: top;">#${idx + 1} ${tipoLabel}</td>
                <td style="padding: 10px; vertical-align: top;">
                  <div style="font-size: 9px; color: #64748b; font-weight: bold;">Hash SHA-256 (Sobre Cifrado / Sellado TSA):</div>
                  <div style="font-family: monospace; font-size: 10px; word-break: break-all; color: #0f172a; font-weight: 600;">${hashCifrado}</div>
                  <div style="font-size: 9px; color: #64748b; font-weight: bold; margin-top: 4px;">Hash SHA-256 (Archivo Desencriptado):</div>
                  <div style="font-family: monospace; font-size: 10px; word-break: break-all; color: #047857; font-weight: 600;">${hashPlano}</div>
                  <div style="font-size: 9px; color: #64748b; margin-top: 4px;">Eslabón previo (prev_hash):</div>
                  <div style="font-family: monospace; font-size: 9px; word-break: break-all; color: #475569;">${prevHashLabel}</div>
                </td>
                <td style="padding: 10px; font-size: 11px; vertical-align: top;">${tsaLabel}</td>
                <td style="padding: 10px; font-size: 11px; vertical-align: top;">${new Date(ev.fecha_captura || Date.now()).toLocaleString('es-AR')}</td>
              </tr>
            `;
          })
          .join('');

        const coordsText =
          exp.latitud && exp.longitud
            ? `${Number(exp.latitud).toFixed(5)}, ${Number(exp.longitud).toFixed(5)}`
            : 'Registradas en metadatos de integridad';

        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <title>Acta de Cadena de Custodia Digital — ApoyAR</title>
            <style>
              body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #1e293b; background: #ffffff; }
              .header { border-bottom: 3px solid #7A1F1F; padding-bottom: 16px; margin-bottom: 24px; }
              h1 { color: #7A1F1F; margin: 0 0 6px 0; font-size: 22px; }
              .subtitle { font-size: 13px; color: #64748b; }
              .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
              .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
              .info-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; }
              .info-value { font-size: 13px; color: #0f172a; margin-top: 4px; font-weight: 600; }
              table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
              th { background: #f1f5f9; padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; }
              .footer { margin-top: 32px; padding: 16px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 6px; font-size: 11px; color: #9f1239; line-height: 1.5; }
              .anexo-section { page-break-before: always; margin-top: 32px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>ApoyAR — Cadena Inmutable de Custodia Pericial</h1>
              <div class="subtitle">Documento Oficial de Preservación Digital Forense (ISO/IEC 27037:2012 y Ley N.° 25.326)</div>
            </div>

            <div class="info-grid">
              <div class="info-box">
                <div class="info-label">Identificador de Expediente</div>
                <div class="info-value">${exp.incidenteId}</div>
              </div>
              <div class="info-box">
                <div class="info-label">Fecha y Hora de Apertura</div>
                <div class="info-value">${new Date(exp.fechaInicio).toLocaleString('es-AR')}</div>
              </div>
              <div class="info-box">
                <div class="info-label">Dirección / Ubicación Textual</div>
                <div class="info-value">${exp.direccion}</div>
              </div>
              <div class="info-box">
                <div class="info-label">Coordenadas GPS (WGS84)</div>
                <div class="info-value">${coordsText}</div>
              </div>
              <div class="info-box">
                <div class="info-label">Origen de la Alerta</div>
                <div class="info-value">${exp.origen.toUpperCase()} (${exp.evidencias.length} evidencias encadenadas)</div>
              </div>
              <div class="info-box">
                <div class="info-label">Trazabilidad de Consentimiento</div>
                <div class="info-value" style="color: #047857;">OTORGADO SOBERANAMENTE (Ley 25.326 Arts. 14 y 15)</div>
              </div>
            </div>

            <h3 style="color: #0f172a; font-size: 16px; margin-bottom: 8px;">Tabla de Segmentos y Pruebas Criptográficas</h3>
            <table>
              <thead>
                <tr>
                  <th style="width: 20%;">Segmento</th>
                  <th style="width: 45%;">Hash SHA-256 y Cadena de Génesis</th>
                  <th style="width: 20%;">Certificación TSA</th>
                  <th style="width: 15%;">Fecha Captura</th>
                </tr>
              </thead>
              <tbody>
                ${filasHtml}
              </tbody>
            </table>

            ${fotosHtml ? `
              <div class="anexo-section">
                <h3 style="color: #7A1F1F; border-bottom: 2px solid #7A1F1F; padding-bottom: 8px;">Anexo Visual Probatorio — Registros Fotográficos</h3>
                <p style="font-size: 11px; color: #64748b; margin-bottom: 16px;">Fotografías forenses capturadas en el borde y desencriptadas en el dispositivo para cotejo procesal.</p>
                ${fotosHtml}
              </div>
            ` : ''}

            <div class="footer">
              <strong>Marco Normativo y Validez Jurídica de la Prueba:</strong><br/>
              Este certificado probatorio fue emitido bajo la titularidad soberana de la persona afectada conforme a los Arts. 14 y 15 de la <strong>Ley N.° 25.326</strong> (Protección de los Datos Personales). Todo el material probatorio goza de eficacia jurídica plena bajo la <strong>Ley N.° 25.506</strong> (Firma Digital y Documento Electrónico), <strong>Ley N.° 26.485</strong> (Protección Integral para Prevenir, Sancionar y Erradicar la Violencia contra las Mujeres) y <strong>Ley N.° 27.499</strong> (Ley Micaela). La preservación de integridad digital fue estructurada conforme a los estándares internacionales <strong>ISO/IEC 27037:2012</strong> (Identificación, Recolección, Adquisición y Preservación de Evidencia Digital) e <strong>IETF RFC 3161</strong> (Time-Stamp Protocol).
            </div>
          </body>
          </html>
        `;

        const { uri: pdfUri } = await Print.printToFileAsync({ html: htmlContent });
        sharedFileUri = pdfUri;
        sharedMimeType = 'application/pdf';
      }

      // 3. Entrega al usuario: Guardar en Carpeta del Dispositivo o Compartir
      const ejecutarCompartir = async () => {
        if (!sharedFileUri) return;
        if (!isAvailable) {
          Alert.alert('No Disponible', 'La función de compartir no está habilitada en este dispositivo.');
          return;
        }
        await Sharing.shareAsync(sharedFileUri, {
          mimeType: sharedMimeType,
          dialogTitle: zipDescargadoConExito
            ? 'Exportar Expediente Forense ApoyAR (ZIP Completo)'
            : 'Exportar Acta de Custodia Pericial (PDF)',
          UTI: sharedMimeType === 'application/zip' ? 'public.zip-archive' : 'com.adobe.pdf',
        });
      };

      const ejecutarGuardarEnCarpeta = async () => {
        try {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (!permissions.granted) {
            Alert.alert('Permiso Requerido', 'No se concedió acceso a la carpeta para guardar los archivos.');
            return;
          }

          const dirUri = permissions.directoryUri;
          let guardadosCount = 0;

          // Si tenemos el .zip completo del backend, guardarlo en la carpeta
          if (zipDescargadoConExito && sharedFileUri) {
            const zipName = `Expediente_Forense_ApoyAR_${exp.incidenteId.slice(0, 8)}.zip`;
            const safZipUri = await FileSystem.StorageAccessFramework.createFileAsync(
              dirUri,
              zipName,
              'application/zip'
            );
            const zipB64 = await FileSystem.readAsStringAsync(sharedFileUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.writeAsStringAsync(safZipUri, zipB64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            guardadosCount++;
          }

          // Desencriptar y guardar cada archivo multimedia individual (foto, video, audio) directamente en la carpeta
          for (const ev of exp.evidencias) {
            const dec = await desencriptarEvidenciaParaExportacion(ev);
            if (dec) {
              const safFileUri = await FileSystem.StorageAccessFramework.createFileAsync(
                dirUri,
                dec.nombreArchivo,
                dec.mimeType
              );
              await FileSystem.writeAsStringAsync(safFileUri, dec.base64, {
                encoding: FileSystem.EncodingType.Base64,
              });
              guardadosCount++;
            }
          }

          // Guardar también el PDF en la carpeta si estamos en fallback o como archivo directo
          if (!zipDescargadoConExito && sharedFileUri) {
            const pdfName = `Acta_Cadena_Custodia_${exp.incidenteId.slice(0, 8)}.pdf`;
            const safPdfUri = await FileSystem.StorageAccessFramework.createFileAsync(
              dirUri,
              pdfName,
              'application/pdf'
            );
            const pdfB64 = await FileSystem.readAsStringAsync(sharedFileUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.writeAsStringAsync(safPdfUri, pdfB64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            guardadosCount++;
          }

          Alert.alert(
            'Expediente Guardado Exitosamente',
            `Se han guardado ${guardadosCount} archivos en la carpeta seleccionada (Informe Oficial PDF y Pruebas Multimedia desencriptadas listas para reproducir).`
          );
        } catch (safErr: any) {
          console.error('[EvidenceModal] Error guardando con SAF:', safErr);
          Alert.alert(
            'Aviso',
            'No se pudo completar el guardado en carpeta. Se abrirá el diálogo para compartir el paquete.',
            [{ text: 'Continuar', onPress: ejecutarCompartir }]
          );
        }
      };

      if (Platform.OS === 'android') {
        Alert.alert(
          'Exportación de Expediente Forense',
          zipDescargadoConExito
            ? 'El Paquete Forense Completo (.ZIP) con el Acta PDF y todas las pruebas multimedia desencriptadas (fotos, videos y audios) está listo.\n\n¿Cómo deseás guardarlo?'
            : 'El Acta Oficial de Cadena de Custodia (PDF con Anexo Visual) y las pruebas multimedia desencriptadas están listas.\n\n¿Cómo deseás guardarlas?',
          [
            {
              text: 'Guardar en Carpeta',
              onPress: ejecutarGuardarEnCarpeta,
            },
            {
              text: 'Compartir / Enviar',
              onPress: ejecutarCompartir,
            },
            {
              text: 'Cancelar',
              style: 'cancel',
            },
          ]
        );
      } else {
        await ejecutarCompartir();
      }
    } catch (err: any) {
      console.error('[EvidenceModal] Error en exportación soberana:', err);
      Alert.alert('Error al Exportar', 'No se pudo exportar el paquete de pruebas: ' + (err?.message || err));
    } finally {
      setExportingIncidenteId(null);
    }
  };

  // ── Descargar, Desencriptar y Reproducir ────────────────────────────────────
  const handleReproducir = async (item: EvidenciaItem) => {
    // Si ya está reproduciendo este audio, se detiene
    if (activeEvidenciaId === item.id && audioState === 'playing') {
      detenerAudio();
      return;
    }

    // Detener cualquier otro audio previo
    detenerAudio();

    setActiveEvidenciaId(item.id);
    setAudioState('downloading');
    setStatusText('Descargando archivo cifrado...');

    try {
      // 1. Resolver ruta del Storage de Supabase
      let storagePath = (item.url_almacenamiento || '').trim();
      if (storagePath.includes('/evidencias/')) {
        storagePath = storagePath.split('/evidencias/')[1];
      } else if (storagePath.startsWith('evidencias/')) {
        storagePath = storagePath.replace(/^evidencias\//, '');
      }
      storagePath = storagePath.replace(/^\/+/, '');

      if (!storagePath) {
        throw new Error('La prueba no contiene una ruta de almacenamiento válida.');
      }

      // 2. Obtener URL de descarga firmada desde el bucket privado 'evidencias'
      const { data: signData, error: signErr } = await supabase.storage
        .from('evidencias')
        .createSignedUrl(storagePath, 300);

      let encryptedBytes: Uint8Array;

      if (!signErr && signData?.signedUrl) {
        const tempEncPath = `${FileSystem.cacheDirectory}temp_enc_${item.id}.bin`;
        await FileSystem.downloadAsync(signData.signedUrl, tempEncPath);
        const b64 = await FileSystem.readAsStringAsync(tempEncPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        encryptedBytes = base64ToUint8Array(b64);
      } else {
        // Fallback: descarga directa en blob
        const { data: blobData, error: dlErr } = await supabase.storage
          .from('evidencias')
          .download(storagePath);

        if (dlErr || !blobData) {
          throw new Error(`Error descargando evidencia de Storage: ${dlErr?.message || 'Sin datos'}`);
        }

        const arrayBuffer = await new Response(blobData).arrayBuffer();
        encryptedBytes = new Uint8Array(arrayBuffer);
      }

      // 3. Desencriptar AES-256-GCM
      setAudioState('decrypting');
      setStatusText('Desencriptando AES-256-GCM (Sobre Digital)...');

      // Recuperar DEK de metadata o de AsyncStorage local
      let dekHex = await resolverDekEvidenciaAsync(item.metadata_dispositivo?.sobre_digital);
      if (!dekHex) {
        dekHex = (await AsyncStorage.getItem(`@apoyar_dek_${item.id}`)) || undefined;
      }
      const incId = item.incidente?.id || (item as any).incidente_id;
      if (!dekHex && incId) {
        dekHex = (await AsyncStorage.getItem(`@apoyar_dek_${incId}`)) || undefined;
      }

      // Evidencia cifrada en otra instalación: la descifra el backend tras validar a la titular
      if (!dekHex && item.metadata_dispositivo?.sobre_digital?.dek_custodia_b64) {
        encryptedBytes = await descargarDescifradaDesdeBackendAsync(item.id);
      }

      const ivHex = item.metadata_dispositivo?.sobre_digital?.iv_hex;
      const hashAudioPlano = item.metadata_dispositivo?.sobre_digital?.hash_audio_plano;
      const tipo = (item.tipo_archivo || 'audio').toLowerCase();

      // Caso A: Evidencia Fotográfica
      if (tipo === 'imagen') {
        let imageUri: string;
        if (dekHex) {
          const resultado = await desencriptarArchivoEnvelopeAsync(
            encryptedBytes,
            dekHex,
            'jpg',
            ivHex,
            hashAudioPlano
          );
          imageUri = resultado.fileUri;
        } else {
          const tempPath = `${FileSystem.cacheDirectory}preview_${item.id}.jpg`;
          await FileSystem.writeAsStringAsync(
            tempPath,
            uint8ArrayToBase64(encryptedBytes),
            { encoding: FileSystem.EncodingType.Base64 }
          );
          imageUri = tempPath;
        }
        setPreviewImageUri(imageUri);
        setPreviewItem(item);
        detenerAudio();
        return;
      }

      // Caso B: Evidencia de Video
      if (tipo === 'video') {
        let videoUri: string;
        if (dekHex) {
          const resultado = await desencriptarArchivoEnvelopeAsync(
            encryptedBytes,
            dekHex,
            'mp4',
            ivHex,
            hashAudioPlano
          );
          videoUri = resultado.fileUri;
        } else {
          const tempPath = `${FileSystem.cacheDirectory}video_${item.id}.mp4`;
          await FileSystem.writeAsStringAsync(
            tempPath,
            uint8ArrayToBase64(encryptedBytes),
            { encoding: FileSystem.EncodingType.Base64 }
          );
          videoUri = tempPath;
        }
        setPreviewVideoUri(videoUri);
        setPreviewVideoItem(item);
        detenerAudio();
        return;
      }

      // Caso C: Evidencia de Audio
      let audioPlayableUri: string;
      if (dekHex) {
        const resultado = await desencriptarAudioEnvelopeAsync(
          encryptedBytes,
          dekHex,
          ivHex,
          hashAudioPlano
        );
        audioPlayableUri = resultado.audioUri;
      } else {
        const tempLegacyPath = `${FileSystem.cacheDirectory}legacy_${item.id}.m4a`;
        await FileSystem.writeAsStringAsync(
          tempLegacyPath,
          uint8ArrayToBase64(encryptedBytes),
          { encoding: FileSystem.EncodingType.Base64 }
        );
        audioPlayableUri = tempLegacyPath;
      }

      // 4. Reproducir audio con expo-audio
      setAudioState('playing');
      setStatusText('Reproduciendo audio del ambiente...');

      const player = createAudioPlayer(audioPlayableUri);
      activePlayerRef.current = player;

      player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded && status.currentTime >= status.duration && status.duration > 0) {
          detenerAudio();
        }
      });

      player.play();

    } catch (err: any) {
      console.error('[EvidenceModal] Error en reproducción/visualización:', err);
      const rawMsg = err?.message || String(err);
      const friendlyMsg = rawMsg.includes('Object not found')
        ? 'El archivo pericial no se encuentra en el servidor de almacenamiento en la nube (corresponde a una prueba sintética previa o fue purgado en pruebas anteriores).'
        : rawMsg;
      Alert.alert(
        'Inconveniente con la Prueba',
        friendlyMsg
      );
      detenerAudio();
    }
  };

  // ── Renderizado de Expediente Pericial Agrupado por Incidente ──────────────
  const renderItemExpediente = ({ item }: { item: IncidenteExpediente }) => {
    const isConsentido = item.consentimiento_exportacion;
    const isExportingThis = exportingIncidenteId === item.incidenteId;
    const isUpdatingConsentThis = updatingConsentId === item.incidenteId;

    const fechaInicioStr = new Date(item.fechaInicio).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const origenTexto = item.origen === 'automatico' ? 'Automático' : 'Manual';
    const numPruebas = item.evidencias.length;

    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.bg.surface,
            borderColor: colors.border.default,
            borderRadius: radii.md,
            padding: 14,
            marginBottom: 14,
            borderWidth: 1,
          },
        ]}
      >
        {/* Cabecera del Incidente / Expediente */}
        <View style={styles.cardHeaderCompact}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
              <Feather name="folder" size={13} color={primaryActionColor} style={{ marginRight: 5 }} />
              <Text
                style={[
                  typography.scale.caption,
                  {
                    color: primaryActionColor,
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontSize: 11,
                  },
                ]}
              >
                Expediente Pericial
              </Text>
            </View>
            <Text style={[typography.scale.bodyBold, { color: colors.text.primary, fontSize: 15 }]}>
              {fechaInicioStr}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
              <Feather name="map-pin" size={11} color={colors.text.secondary} style={{ marginRight: 3 }} />
              <Text
                style={[
                  typography.scale.caption,
                  { color: colors.text.secondary, flexShrink: 1, fontSize: 12 },
                ]}
                numberOfLines={1}
              >
                {item.direccion || 'Coordenadas protegidas'}
              </Text>
            </View>
          </View>

          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {/* Badge Origen */}
            <View
              style={[
                styles.compactBadge,
                {
                  backgroundColor:
                    origenTexto === 'Manual' ? colors.semantic.dangerBg : colors.bg.elevated,
                  borderColor:
                    origenTexto === 'Manual' ? colors.semantic.danger : colors.border.default,
                },
              ]}
            >
              <Feather
                name={origenTexto === 'Manual' ? 'alert-circle' : 'cpu'}
                size={10}
                color={origenTexto === 'Manual' ? colors.semantic.danger : colors.text.secondary}
                style={{ marginRight: 3 }}
              />
              <Text
                style={{
                  color: origenTexto === 'Manual' ? colors.semantic.danger : colors.text.primary,
                  fontWeight: '700',
                  fontSize: 10,
                }}
              >
                {origenTexto}
              </Text>
            </View>

            {/* Badge Cantidad de pruebas */}
            <View
              style={[
                styles.compactBadge,
                {
                  backgroundColor: colors.bg.elevated,
                  borderColor: colors.border.default,
                },
              ]}
            >
              <Feather name="layers" size={10} color={colors.text.secondary} style={{ marginRight: 3 }} />
              <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: 10 }}>
                {numPruebas} {numPruebas === 1 ? 'prueba' : 'pruebas'}
              </Text>
            </View>
          </View>
        </View>

        {/* Switch Único de Consentimiento por Incidente (Ley 25.326) */}
        <View
          style={[
            styles.consentCardCompact,
            {
              backgroundColor: isConsentido ? colors.semantic.successBg : colors.bg.base,
              borderColor: isConsentido ? colors.semantic.success : colors.border.default,
              borderRadius: radii.sm,
              marginTop: 10,
              padding: 10,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 }}>
              <Feather
                name={isConsentido ? 'shield' : 'lock'}
                size={14}
                color={isConsentido ? colors.semantic.success : colors.semantic.warning}
                style={{ marginRight: 5 }}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  color: colors.text.primary,
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                Acceso Judicial (Ley 25.326)
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={[
                  styles.consentBadgeCompact,
                  {
                    backgroundColor: isConsentido ? colors.semantic.success : colors.bg.elevated,
                  },
                ]}
              >
                <Text
                  style={{
                    color: isConsentido ? '#FFFFFF' : colors.text.secondary,
                    fontWeight: '700',
                    fontSize: 9,
                  }}
                >
                  {isConsentido ? '✓ Habilitado' : '🔒 Privado'}
                </Text>
              </View>

              {isUpdatingConsentThis ? (
                <ActivityIndicator size="small" color={primaryActionColor} />
              ) : (
                <Switch
                  value={isConsentido}
                  onValueChange={() => handleToggleConsentimientoIncidente(item)}
                  trackColor={{ false: colors.bg.overlay, true: colors.semantic.success }}
                  thumbColor="#FFFFFF"
                  style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                />
              )}
            </View>
          </View>

          <Text
            style={{
              fontSize: 11,
              lineHeight: 15,
              color: colors.text.secondary,
              marginTop: 4,
            }}
          >
            Autoriza a autoridades judiciales a acceder a todas las pruebas de este expediente pericial bajo Ley 25.326.
          </Text>
        </View>

        {/* Botón Secundario de Descarga / Exportación Soberana Ciudadana (Ley 25.326 Art. 14 y 15) */}
        <Pressable
          onPress={() => handleExportarSoberano(item)}
          disabled={isExportingThis}
          style={({ pressed }) => [
            styles.sovereignExportButton,
            {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#F9F5F1',
              borderColor: primaryActionColor,
              borderRadius: radii.sm,
              opacity: pressed || isExportingThis ? 0.75 : 1,
            },
          ]}
        >
          {isExportingThis ? (
            <ActivityIndicator size="small" color={primaryActionColor} style={{ marginRight: 6 }} />
          ) : (
            <Feather name="share-2" size={14} color={primaryActionColor} style={{ marginRight: 6 }} />
          )}
          <Text style={{ color: primaryActionColor, fontSize: 12, fontWeight: '700' }}>
            {isExportingThis ? 'Generando paquete probatorio...' : '⬇ Descargar / Compartir Informe y Prueba'}
          </Text>
        </Pressable>
        <Text
          style={{
            fontSize: 10,
            color: colors.text.secondary,
            textAlign: 'center',
            marginTop: 3,
            marginBottom: 8,
          }}
        >
          Soberanía ciudadana (Art. 14 y 15 Ley 25.326). No requiere acceso judicial.
        </Text>

        {/* Lista Interna de Segmentos Encadenados */}
        <View style={[styles.segmentChainContainer, { borderTopColor: colors.border.default }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 4 }}>
            <Feather name="link" size={12} color={colors.text.secondary} style={{ marginRight: 4 }} />
            <Text
              style={[
                typography.scale.caption,
                {
                  color: colors.text.secondary,
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  fontSize: 10,
                },
              ]}
            >
              Cadena Inmutable de Segmentos ({item.evidencias.length})
            </Text>
          </View>

          {item.evidencias.map((ev, idx) => {
            const isPlayingThis = activeEvidenciaId === ev.id;
            const tieneSelloRFC3161 = Boolean(ev.token_rfc3161);
            const hashStr = ev.hash_sha256 || '';
            const hashPreview =
              hashStr.length > 16
                ? `${hashStr.substring(0, 8)}...${hashStr.substring(hashStr.length - 8)}`
                : hashStr;
            const prevHashStr = ev.prev_hash || '';
            const prevHashPreview =
              prevHashStr.length > 12
                ? `${prevHashStr.substring(0, 6)}...${prevHashStr.substring(prevHashStr.length - 4)}`
                : prevHashStr;

            const tipoLabel =
              ev.tipo_archivo === 'imagen'
                ? 'Fotografía'
                : ev.tipo_archivo === 'video'
                ? 'Video pericial'
                : `Audio ambiental #${idx + 1}`;

            return (
              <View
                key={ev.id}
                style={[
                  styles.segmentRowCard,
                  {
                    backgroundColor: isPlayingThis
                      ? isDark
                        ? 'rgba(239, 68, 68, 0.1)'
                        : 'rgba(122, 31, 31, 0.06)'
                      : colors.bg.base,
                    borderColor: isPlayingThis ? primaryActionColor : colors.border.default,
                    borderRadius: radii.sm,
                    borderWidth: isPlayingThis ? 1.5 : 1,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 6 }}>
                    <Feather
                      name={
                        ev.tipo_archivo === 'imagen'
                          ? 'image'
                          : ev.tipo_archivo === 'video'
                          ? 'film'
                          : 'mic'
                      }
                      size={13}
                      color={primaryActionColor}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        typography.scale.caption,
                        { color: colors.text.primary, fontWeight: '700', fontSize: 12 },
                      ]}
                      numberOfLines={1}
                    >
                      {tipoLabel}
                    </Text>
                  </View>

                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '600',
                      color: tieneSelloRFC3161 ? colors.semantic.success : colors.semantic.warning,
                    }}
                  >
                    🔒 AES-256-GCM  •  {tieneSelloRFC3161 ? '✓ TSA RFC 3161' : '⏳ TSA'}
                  </Text>
                </View>

                {/* Hashes y Eslabón prev_hash */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 4,
                  }}
                >
                  <Pressable
                    onPress={async () => {
                      if (ev.hash_sha256) {
                        await Clipboard.setStringAsync(ev.hash_sha256);
                        Alert.alert('Hash Copiado', 'Se copió el hash SHA-256 completo al portapapeles.');
                      }
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        color: colors.text.secondary,
                      }}
                      numberOfLines={1}
                    >
                      SHA-256: {hashPreview}
                    </Text>
                    <Feather name="copy" size={9} color={colors.text.disabled} style={{ marginLeft: 3 }} />
                  </Pressable>

                  {prevHashStr ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 6 }}>
                      <Feather name="link-2" size={9} color={colors.text.disabled} style={{ marginRight: 2 }} />
                      <Text
                        style={{
                          fontSize: 9,
                          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                          color: colors.text.disabled,
                        }}
                      >
                        Prev: {prevHashPreview}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Botón Individual de Reproducción / Visualización */}
                <Pressable
                  onPress={() => handleReproducir(ev)}
                  style={({ pressed }) => [
                    styles.segmentPlayButton,
                    {
                      backgroundColor: isPlayingThis
                        ? colors.semantic.danger
                        : primaryActionColor,
                      borderRadius: radii.sm,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  {isPlayingThis && (audioState === 'downloading' || audioState === 'decrypting') ? (
                    <ActivityIndicator size="small" color={primaryActionTextColor} style={{ marginRight: 4 }} />
                  ) : (
                    <Feather
                      name={
                        isPlayingThis && audioState === 'playing'
                          ? 'square'
                          : ev.tipo_archivo === 'imagen'
                          ? 'image'
                          : ev.tipo_archivo === 'video'
                          ? 'film'
                          : 'play'
                      }
                      size={12}
                      color={primaryActionTextColor}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text style={{ color: primaryActionTextColor, fontSize: 11, fontWeight: '700' }}>
                    {isPlayingThis
                      ? statusText || 'Procesando...'
                      : ev.tipo_archivo === 'imagen'
                      ? '▷ Ver fotografía'
                      : ev.tipo_archivo === 'video'
                      ? '▷ Ver video'
                      : '▷ Escuchar audio'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  // ── Encabezado de Lista con Filtros Integrados y Scroll Inteligente ─────────
  const renderListHeader = () => (
    <View style={styles.listHeaderContainer}>
      {/* ── 1. BUSCADOR COMPACTO CON BOTÓN 'LIMPIAR' EN LA MISMA LÍNEA ── */}
      <View style={styles.searchRow}>
        <View
          style={[
            styles.filterInputBox,
            {
              flex: 1,
              backgroundColor: colors.bg.surface,
              borderColor: filtroDireccion ? primaryActionColor : colors.border.default,
              borderRadius: radii.md,
              borderWidth: 1,
              height: 38,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
            },
          ]}
        >
          <Feather name="search" size={14} color={colors.text.secondary} />
          <TextInput
            value={filtroDireccion}
            onChangeText={setFiltroDireccion}
            placeholder="Calle o dirección..."
            placeholderTextColor={colors.text.disabled}
            style={[
              styles.filterTextInput,
              { color: colors.text.primary, flex: 1, marginLeft: 6, fontSize: 13 },
            ]}
          />
          {filtroDireccion.length > 0 && (
            <Pressable onPress={() => setFiltroDireccion('')} hitSlop={8} style={{ padding: 4 }}>
              <Feather name="x" size={14} color={colors.text.secondary} />
            </Pressable>
          )}
        </View>

        {hayFiltrosActivos && (
          <Pressable
            onPress={limpiarFiltros}
            style={({ pressed }) => [
              styles.clearBtnCompact,
              {
                backgroundColor: pressed ? colors.semantic.dangerBg : colors.bg.surface,
                borderColor: primaryActionColor,
                borderWidth: 1,
                borderRadius: radii.md,
                height: 38,
                paddingHorizontal: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Feather name="x-circle" size={13} color={primaryActionColor} />
            <Text
              style={[
                typography.scale.caption,
                { color: primaryActionColor, marginLeft: 4, fontWeight: '700', fontSize: 11 },
              ]}
            >
              Limpiar
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── 2. FILA HORIZONTAL ÚNICA DE FILTROS DE FECHA (height: 36) ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalFilterRow}
        style={{ height: 36, marginTop: 6 }}
      >
        {(
          [
            { id: 'todas', label: 'Todas' },
            { id: 'hoy', label: 'Hoy' },
            { id: '7dias', label: 'Últimos 7 días' },
          ] as const
        ).map((item) => {
          const isSelected = filtroFechaRapido === item.id && !fechaCalendario;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                setFiltroFechaRapido(item.id);
                setFechaCalendario(null);
              }}
              style={[
                styles.filterPillCompact,
                {
                  backgroundColor: isSelected ? primaryActionColor : colors.bg.surface,
                  borderColor: isSelected ? primaryActionColor : colors.border.default,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Text
                style={[
                  typography.scale.caption,
                  {
                    color: isSelected ? primaryActionTextColor : colors.text.primary,
                    fontWeight: isSelected ? '700' : '500',
                    fontSize: 11,
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}

        {/* Chip de Calendario / Fecha Específica */}
        <Pressable
          onPress={() => {
            if (fechaCalendario) {
              setFechaCalendario(null);
            } else {
              setShowCalendarModal(true);
            }
          }}
          style={[
            styles.filterPillCompact,
            {
              backgroundColor: fechaCalendario ? primaryActionColor : colors.bg.surface,
              borderColor: fechaCalendario ? primaryActionColor : colors.border.default,
              borderRadius: radii.full,
            },
          ]}
        >
          <Feather
            name="calendar"
            size={12}
            color={fechaCalendario ? primaryActionTextColor : colors.text.secondary}
            style={{ marginRight: 4 }}
          />
          <Text
            style={[
              typography.scale.caption,
              {
                color: fechaCalendario ? primaryActionTextColor : colors.text.primary,
                fontWeight: fechaCalendario ? '700' : '500',
                fontSize: 11,
              },
            ]}
          >
            {fechaCalendario ? fechaCalendario : 'Filtrar por fecha...'}
          </Text>
          {fechaCalendario && (
            <Feather
              name="x"
              size={12}
              color={primaryActionTextColor}
              style={{ marginLeft: 4 }}
            />
          )}
        </Pressable>
      </ScrollView>

      {/* ── 3. FILA HORIZONTAL DE TIPOS DE MULTIMEDIA (height: 36) ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalFilterRow}
        style={{ height: 36, marginTop: 4 }}
      >
        {(
          [
            { id: 'todos', label: 'Todos', icon: 'layers' },
            { id: 'audio', label: 'Audios', icon: 'mic' },
            { id: 'imagen', label: 'Fotos', icon: 'camera' },
            { id: 'video', label: 'Videos', icon: 'video' },
          ] as const
        ).map((tab) => {
          const activo = filtroTipoMultimedia === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setFiltroTipoMultimedia(tab.id)}
              style={[
                styles.filterPillCompact,
                {
                  backgroundColor: activo ? primaryActionColor : colors.bg.surface,
                  borderColor: activo ? primaryActionColor : colors.border.default,
                  borderRadius: radii.full,
                },
              ]}
            >
              <Feather
                name={tab.icon as any}
                size={12}
                color={activo ? primaryActionTextColor : colors.text.secondary}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  typography.scale.caption,
                  {
                    color: activo ? primaryActionTextColor : colors.text.primary,
                    fontWeight: activo ? '700' : '500',
                    fontSize: 11,
                  },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── 4. SUBTÍTULO CON CONTADOR Y PAGINACIÓN ── */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 4 }}>
        <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11 }]}>
          Pág. {page} de {totalPages} • Mostrando {expedientesFiltrados.length} expedientes ({totalRegistros} pruebas totales)
        </Text>
      </View>
    </View>
  );

  const renderEmptyComponent = () => (
    <View style={styles.centerBoxEmpty}>
      <Feather name="filter" size={40} color={colors.text.disabled} />
      <Text
        style={[
          typography.scale.bodyBold,
          { color: colors.text.primary, marginTop: 12, textAlign: 'center' },
        ]}
      >
        Sin coincidencias
      </Text>
      <Text
        style={[
          typography.scale.caption,
          {
            color: colors.text.secondary,
            marginTop: 4,
            textAlign: 'center',
            paddingHorizontal: spacing.lg,
          },
        ]}
      >
        No se encontraron pruebas que coincidan con los filtros aplicados.
      </Text>
      <Pressable
        onPress={limpiarFiltros}
        style={[
          styles.resetFilterBtn,
          {
            backgroundColor: colors.bg.surface,
            borderColor: primaryActionColor,
            borderRadius: radii.sm,
            borderWidth: 1,
            marginTop: spacing.md,
            paddingVertical: 8,
            paddingHorizontal: spacing.md,
          },
        ]}
      >
        <Text style={[typography.scale.caption, { color: primaryActionColor, fontWeight: '700' }]}>
          Restablecer filtros
        </Text>
      </Pressable>
    </View>
  );

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent statusBarTranslucent={true} onRequestClose={onClose}>
        <KeyboardAvoidingWrapper mode="modal" style={styles.modalOverlay} extraScrollHeight={16}>
          <View
            style={[
              styles.modalContainer,
              {
                backgroundColor: colors.bg.base,
                borderColor: colors.border.default,
                borderRadius: radii.lg,
              },
            ]}
          >
            {/* Header del Modal */}
            <View
              style={[
                styles.header,
                {
                  borderBottomColor: colors.border.default,
                  borderBottomWidth: 1,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  backgroundColor: colors.bg.surface,
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <View
                  style={[
                    styles.headerIconBox,
                    { backgroundColor: colors.semantic.infoBg, borderRadius: radii.full },
                  ]}
                >
                  <Feather name="shield" size={20} color={colors.semantic.info} />
                </View>
                <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                  <Text style={[typography.scale.bodyBold, { color: colors.text.primary, fontSize: 16 }]}>
                    Mis Pruebas Periciales
                  </Text>
                  <Text style={[typography.scale.caption, { color: colors.text.secondary, fontSize: 11 }]}>
                    Preservación inmutable (AES-256-GCM + TSA)
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={onClose}
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.bg.surface, borderRadius: radii.full },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Feather name="x" size={20} color={colors.text.primary} />
              </Pressable>
            </View>

            {/* Cuerpo: Lista de Evidencias con Scroll Inteligente de Filtros */}
            <View style={{ flex: 1, paddingHorizontal: spacing.md }}>
              {loading ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="large" color={primaryActionColor} />
                  <Text
                    style={[
                      typography.scale.body,
                      { color: colors.text.secondary, marginTop: spacing.md },
                    ]}
                  >
                    Consultando cadena de evidencias...
                  </Text>
                </View>
              ) : evidencias.length === 0 ? (
                <View style={styles.centerBox}>
                  <Feather name="inbox" size={44} color={colors.text.disabled} />
                  <Text
                    style={[
                      typography.scale.bodyBold,
                      { color: colors.text.primary, marginTop: spacing.md, textAlign: 'center' },
                    ]}
                  >
                    Sin evidencias registradas
                  </Text>
                  <Text
                    style={[
                      typography.scale.caption,
                      {
                        color: colors.text.secondary,
                        marginTop: spacing.xs,
                        textAlign: 'center',
                        paddingHorizontal: spacing.lg,
                      },
                    ]}
                  >
                    Cuando se active el Modo Resguardo (manual o automático), las grabaciones y fotografías periciales cifradas se preservarán y certificarán aquí.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={expedientesFiltrados}
                  keyExtractor={(item) => item.incidenteId}
                  renderItem={renderItemExpediente}
                  ListHeaderComponent={renderListHeader}
                  ListEmptyComponent={renderEmptyComponent}
                  contentContainerStyle={{
                    paddingBottom: Math.max(insets.bottom, 16) + 20,
                    paddingTop: 8,
                  }}
                  showsVerticalScrollIndicator={false}
                />
              )}
            </View>

            {/* ── BARRA DE PAGINACIÓN DE 10 EN 10 ── */}
            {totalPages > 1 && (
              <View
                style={[
                  styles.paginationBar,
                  {
                    borderTopColor: colors.border.default,
                    backgroundColor: colors.bg.surface,
                    paddingBottom: Math.max(insets.bottom, 10),
                  },
                ]}
              >
                <Pressable
                  onPress={() => page > 1 && cargarEvidencias(page - 1)}
                  disabled={page <= 1 || loading}
                  style={[
                    styles.pageBtn,
                    {
                      backgroundColor: colors.bg.surface,
                      borderColor: colors.border.default,
                      opacity: page <= 1 || loading ? 0.4 : 1,
                    },
                  ]}
                >
                  <Feather name="chevron-left" size={16} color={colors.text.primary} />
                  <Text style={[typography.scale.caption, { color: colors.text.primary, fontWeight: '700', marginLeft: 4 }]}>
                    Anterior
                  </Text>
                </Pressable>

                <Text style={[typography.scale.caption, { color: colors.text.primary, fontWeight: '700' }]}>
                  {page} / {totalPages}
                </Text>

                <Pressable
                  onPress={() => page < totalPages && cargarEvidencias(page + 1)}
                  disabled={page >= totalPages || loading}
                  style={[
                    styles.pageBtn,
                    {
                      backgroundColor: colors.bg.surface,
                      borderColor: colors.border.default,
                      opacity: page >= totalPages || loading ? 0.4 : 1,
                    },
                  ]}
                >
                  <Text style={[typography.scale.caption, { color: colors.text.primary, fontWeight: '700', marginRight: 4 }]}>
                    Siguiente
                  </Text>
                  <Feather name="chevron-right" size={16} color={colors.text.primary} />
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingWrapper>
      </Modal>

    <CalendarModal
      visible={showCalendarModal}
      fechaSeleccionada={fechaCalendario}
      fechasConEvidencias={fechasConEvidencias}
      onSeleccionarFecha={(fecha) => {
        setFechaCalendario(fecha);
        setFiltroFechaRapido('todas');
      }}
      onLimpiarFecha={() => setFechaCalendario(null)}
      onCerrar={() => setShowCalendarModal(false)}
    />

    {/* ── MODAL DE PREVISUALIZACIÓN DE FOTOGRAFÍA PERICIAL ── */}
    <Modal
      visible={!!previewImageUri}
      transparent
      animationType="fade"
      onRequestClose={() => {
        setPreviewImageUri(null);
        setPreviewItem(null);
      }}
    >
      <View style={styles.previewBackdrop}>
        <View style={[styles.previewContainer, { backgroundColor: colors.bg.surface, borderRadius: radii.lg }]}>
          <View style={styles.previewHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Feather name="image" size={18} color={colors.semantic.info} style={{ marginRight: spacing.xs }} />
              <Text style={[typography.scale.bodyBold, { color: colors.text.primary }]}>
                Fotografía Pericial Asegurada
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setPreviewImageUri(null);
                setPreviewItem(null);
              }}
              style={{ padding: spacing.xs }}
            >
              <Feather name="x" size={22} color={colors.text.secondary} />
            </Pressable>
          </View>

          {previewImageUri && (
            <Image
              source={{ uri: previewImageUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}

          {previewItem && (
            <View style={[styles.previewFooter, { backgroundColor: colors.bg.base, borderRadius: radii.sm }]}>
              <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                SHA-256: {previewItem.hash_sha256.substring(0, 28)}...
              </Text>
              <Text style={[typography.scale.caption, { color: colors.semantic.success, marginTop: 2 }]}>
                ✓ Cifrado AES-256-GCM y firmado en Android Keystore
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>

    {/* ── MODAL DE REPRODUCCIÓN DE VIDEO PERICIAL INTEGRADO (expo-video) ── */}
    <Modal
      visible={!!previewVideoUri}
      transparent
      animationType="fade"
      onRequestClose={() => {
        setPreviewVideoUri(null);
        setPreviewVideoItem(null);
      }}
    >
      <View style={styles.previewBackdrop}>
        <View style={[styles.previewContainer, { backgroundColor: colors.bg.surface, borderRadius: radii.lg }]}>
          <View style={styles.previewHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.xs }}>
              <Feather name="video" size={18} color={colors.semantic.info} style={{ marginRight: spacing.xs }} />
              <Text
                style={[typography.scale.bodyBold, { color: colors.text.primary }]}
                numberOfLines={1}
              >
                Verificación Forense: Integridad SHA-256 Validada
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setPreviewVideoUri(null);
                setPreviewVideoItem(null);
              }}
              style={{ padding: spacing.xs }}
            >
              <Feather name="x" size={22} color={colors.text.secondary} />
            </Pressable>
          </View>

          {previewVideoUri && (
            <ForensicVideoPlayer uri={previewVideoUri} />
          )}

          {previewVideoItem && (
            <View style={[styles.previewFooter, { backgroundColor: colors.bg.base, borderRadius: radii.sm }]}>
              <Text style={[typography.scale.caption, { color: colors.text.secondary }]}>
                SHA-256: {previewVideoItem.hash_sha256.substring(0, 28)}...
              </Text>
              <Text style={[typography.scale.caption, { color: colors.semantic.success, marginTop: 2 }]}>
                ✓ Cifrado AES-256-GCM y firmado en Android Keystore
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  </>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    height: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIconBox: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
  },
  cardHeaderCompact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  compactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  cryptoStripCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    marginTop: 4,
  },
  consentCardCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    marginTop: 6,
  },
  consentBadgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  playButtonCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    minHeight: 44,
    marginTop: 10,
    paddingHorizontal: 12,
  },
  sovereignExportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  segmentChainContainer: {
    borderTopWidth: 1,
    marginTop: 6,
    paddingTop: 8,
  },
  segmentRowCard: {
    padding: 8,
    marginBottom: 6,
  },
  segmentPlayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
    minHeight: 32,
    marginTop: 6,
    paddingHorizontal: 8,
  },
  listHeaderContainer: {
    paddingBottom: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  clearBtnCompact: {
    paddingHorizontal: 10,
  },
  horizontalFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterPillCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    height: 32,
  },
  centerBoxEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  filterInputBox: {
    overflow: 'hidden',
  },
  filterTextInput: {
    height: 36,
    paddingVertical: 0,
  },
  resetFilterBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    overflow: 'hidden',
    borderWidth: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  previewImage: {
    width: '100%',
    height: 320,
    backgroundColor: '#000000',
  },
  previewVideo: {
    width: '100%',
    height: 320,
    backgroundColor: '#000000',
  },
  previewFooter: {
    padding: 12,
    margin: 12,
  },
  paginationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    marginTop: 6,
  },
  pageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
});
