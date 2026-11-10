// src/services/resguardoService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Servicio Autónomo Centralizado de Modo Resguardo (Background-First)
//
// Desacoplado de la UI: ejecuta el pipeline probatorio forense y telemetría GPS
// continua tanto en primer plano como en segundo plano (app minimizada / pantalla bloqueada).
//
// Arquitectura de Telemetría GPS en Background:
// Utiliza polling continuo con Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
// dentro del hilo JS mantenido activo por el FGS de micrófono. Evita iniciar un nuevo
// Foreground Service de ubicación en segundo plano, previniendo SecurityException en Android 14+.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform, AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import {
  cifrarAudioEnvelopeAsync,
} from '../lib/cryptoForense';
import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import { construirMetadataEvidenciaAsync } from '../lib/metadatosEvidencia';
import { programar } from '../lib/temporizadorAudio';
import {
  DIRECCION_SIN_GPS,
  LATITUD_SIN_GPS,
  LONGITUD_SIN_GPS,
  obtenerUbicacionAsync,
  type UbicacionEvidencia,
} from '../lib/ubicacionEvidencia';
import { colaEvidencias } from './colaEvidencias';
import { acousticMonitoringService } from './acousticMonitoring';

export const STORAGE_KEY_RESGUARDO_ACTIVO = '@apoyar_modo_resguardo_activo';
export const STORAGE_KEY_RESGUARDO_INCIDENTE = '@apoyar_modo_resguardo_incidente';

// ── Grabación pericial continua ──────────────────────────────────────────────────────────
// Durante el Modo Resguardo se graba en segmentos consecutivos, sin huecos entre ellos.
// Cada segmento se cifra, se sube y se sella como una evidencia independiente encadenada.
export const DURACION_SEGMENTO_MS = 10000;
// Límite de segmentos por incidente. 0 = sin límite (graba hasta que se desactive el resguardo).
// En desarrollo se acota para no saturar Storage/BD; en producción poner 0.
export const MAX_SEGMENTOS_EVIDENCIA = 6;

interface ContextoEvidencia {
  userId: string;
  incidenteId: string;
  origin: ResguardoOrigin;
  dbOrigen: 'manual' | 'automatico';
}

export type ResguardoOrigin =
  | 'manual'
  | 'automatico'
  | 'palabra_clave'
  | 'violencia_ambiental'
  | 'amenaza_verbal_vosk'
  | 'botones_fisicos';

export interface ResguardoState {
  isActive: boolean;
  incidenteId: string | null;
  statusMessage: string;
  isRecording: boolean;
  origin: ResguardoOrigin | null;
}

type ResguardoListener = (state: ResguardoState) => void;

class ResguardoService {
  private isActive: boolean = false;
  private incidenteId: string | null = null;
  private statusMessage: string = '';
  private isRecording: boolean = false;
  private currentOrigin: ResguardoOrigin | null = null;
  private authToken: string | null = null;
  private listeners: Set<ResguardoListener> = new Set();
  private telemetryTimer: (() => void) | null = null;
  private isPollingGps: boolean = false;
  private executionPromise: Promise<string> | null = null;
  private colaProcesamientoEvidencia: Promise<void> = Promise.resolve();
  private ultimaUbicacion: UbicacionEvidencia | null = null;

  /**
   * Suscribe un listener para cambios de estado en tiempo real.
   */
  subscribe(listener: ResguardoListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.warn('[ResguardoService] Error notificando listener:', err);
      }
    });
  }

  getState(): ResguardoState {
    return {
      isActive: this.isActive,
      incidenteId: this.incidenteId,
      statusMessage: this.statusMessage,
      isRecording: this.isRecording,
      origin: this.currentOrigin,
    };
  }

  isResguardoActive(): boolean {
    return this.isActive;
  }

  getCurrentIncidenteId(): string | null {
    return this.incidenteId;
  }

  /**
   * Valida y solicita de forma segura los permisos de ubicación (Foreground + ACCESS_BACKGROUND_LOCATION).
   * REGLA ESTRICTA ANDROID: Sólo se puede mostrar el diálogo de permisos si la app está en primer plano (AppState === 'active').
   * Si la app está en background, NUNCA debe invocar request*PermissionsAsync() porque suspende el hilo JS
   * esperando una ventana del sistema que Android no puede mostrar fuera de primer plano.
   */
  async asegurarPermisosUbicacionAsync(solicitarSiFalta: boolean = true): Promise<boolean> {
    try {
      const isForeground = AppState.currentState === 'active';
      let { status: fgStatus } = await Location.getForegroundPermissionsAsync();

      if (fgStatus !== 'granted') {
        if (isForeground && solicitarSiFalta) {
          const fgReq = await Location.requestForegroundPermissionsAsync();
          fgStatus = fgReq.status;
        } else {
          console.warn('[ResguardoService] Permiso de ubicación en primer plano no concedido previamente (en background se omite diálogo para no suspender proceso).');
          return false;
        }
      }

      if (fgStatus !== 'granted') {
        return false;
      }

      let { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
      if (bgStatus !== 'granted' && isForeground && solicitarSiFalta) {
        const bgReq = await Location.requestBackgroundPermissionsAsync();
        bgStatus = bgReq.status;
      }

      if (bgStatus !== 'granted') {
        console.warn(
          '[ResguardoService] Permiso ACCESS_BACKGROUND_LOCATION (Permitir todo el tiempo) no concedido. Podría restringir lecturas continuas satelitales en segundo plano.'
        );
      }

      return fgStatus === 'granted';
    } catch (err) {
      console.warn('[ResguardoService] Error validando permisos de ubicación:', err);
      return false;
    }
  }

  /**
   * Inicializa el servicio comprobando si había una sesión previa activa en AsyncStorage o Supabase.
   */
  async initAsync(): Promise<boolean> {
    try {
      const storedActive = await AsyncStorage.getItem(STORAGE_KEY_RESGUARDO_ACTIVO);
      const storedIncidente = await AsyncStorage.getItem(STORAGE_KEY_RESGUARDO_INCIDENTE);

      if (storedActive === 'true' && storedIncidente) {
        // Sólo un cierre confirmado apaga el resguardo. Sin red, sin sesión o con el incidente
        // todavía en la cola no se sabe, y perder este estado dejaría la emergencia abierta.
        const { data: inc, error } = await supabase
          .from('incidente')
          .select('inc_estado')
          .eq('inc_id_incidente', storedIncidente)
          .maybeSingle();

        if (error || !inc || (inc as any).inc_estado === 'en_curso') {
          console.log(`[ResguardoService] Sesión activa recuperada de incidente: ${storedIncidente}`);
          this.isActive = true;
          this.incidenteId = storedIncidente;
          this.statusMessage = 'Modo Resguardo activo (transmitiendo telemetría)';
          this.iniciarBucleTelemetriaGps(storedIncidente);
          this.notifyListeners();
          return true;
        } else {
          // Incidente ya cerrado
          await AsyncStorage.setItem(STORAGE_KEY_RESGUARDO_ACTIVO, 'false');
          await AsyncStorage.removeItem(STORAGE_KEY_RESGUARDO_INCIDENTE);
        }
      }
    } catch (err) {
      console.warn('[ResguardoService] Error en initAsync:', err);
    }

    return false;
  }

  /**
   * Dispara el flujo completo del Modo Resguardo de forma autónoma.
   * Si ya está en ejecución, retorna la promesa en curso para evitar doble activación.
   */
  async activarModoResguardoAsync(
    origin: ResguardoOrigin,
    options?: { silentBackground?: boolean }
  ): Promise<string> {
    if (this.isActive && this.incidenteId) {
      console.log(`[ResguardoService] Modo Resguardo ya activo con incidente ${this.incidenteId}.`);
      return this.incidenteId;
    }

    if (this.executionPromise) {
      return this.executionPromise;
    }

    this.executionPromise = this.ejecutarPipelineResguardo(origin, options);
    try {
      return await this.executionPromise;
    } finally {
      this.executionPromise = null;
    }
  }

  private async ejecutarPipelineResguardo(
    origin: ResguardoOrigin,
    options?: { silentBackground?: boolean }
  ): Promise<string> {
    const isBackground = options?.silentBackground || AppState.currentState !== 'active';
    console.log(
      `[ResguardoService] Iniciando Modo Resguardo (origen: ${origin}, segundo plano: ${isBackground})`
    );

    this.isActive = true;
    this.currentOrigin = origin;
    this.statusMessage = 'Obteniendo ubicación satelital...';
    await AsyncStorage.setItem(STORAGE_KEY_RESGUARDO_ACTIVO, 'true');
    this.notifyListeners();

    const session = (await supabase.auth.getSession()).data.session;
    this.authToken = session?.access_token || null;

    try {
      // 1. Usuario de la sesión guardada: debe funcionar sin conexión
      const user = session?.user;
      if (!user) {
        throw new Error('No hay sesión de usuario activa para registrar el incidente.');
      }

      // 2. Validación de permisos y captura GPS. Sin señal no se inventa una posición:
      // se registra (0, 0) y la telemetría la reemplaza con el primer dato real.
      await this.asegurarPermisosUbicacionAsync(AppState.currentState === 'active');

      this.ultimaUbicacion = await obtenerUbicacionAsync();
      const latitud = this.ultimaUbicacion?.latitud ?? LATITUD_SIN_GPS;
      const longitud = this.ultimaUbicacion?.longitud ?? LONGITUD_SIN_GPS;

      // 3. Resolución de dirección inicial y nombre de víctima
      // En la víctima (especialmente en background), la prioridad absoluta es el despacho inmediato (<500ms).
      // Los contactos de la red de apoyo visualizan el mapa en tiempo real en primer plano.
      let direccion = this.ultimaUbicacion ? `${latitud.toFixed(5)}, ${longitud.toFixed(5)}` : DIRECCION_SIN_GPS;
      let victimaNombre = 'Tu contacto';

      if (this.ultimaUbicacion && AppState.currentState === 'active') {
        try {
          const places = await Promise.race([
            Location.reverseGeocodeAsync({ latitude: latitud, longitude: longitud }),
            new Promise<null>((r) => setTimeout(() => r(null), 1200)),
          ]);
          if (places && places.length > 0) {
            const p = places[0];
            const parsed = `${p.street || ''} ${p.streetNumber || ''}, ${p.city || ''}`
              .trim()
              .replace(/^,|,$/g, '')
              .trim();
            if (parsed && parsed.length > 5) direccion = parsed;
          }
        } catch (_) {}
      }

      try {
        const { data: persona } = await supabase.rpc('obtener_mi_nombre');
        if (persona && persona.length > 0) {
          victimaNombre = `${persona[0].nombre} ${persona[0].apellido}`.trim();
        } else {
          const { data: fallback } = await supabase
            .from('usuario')
            .select('persona:per_id_persona(per_nombre, per_apellido)')
            .eq('usu_id_usuario', user.id)
            .single();
          if (fallback && (fallback as any).persona) {
            const rawFb = (fallback as any).persona;
            victimaNombre = `${rawFb.per_nombre || ''} ${rawFb.per_apellido || ''}`.trim();
          }
        }
      } catch (nomErr) {
        console.warn('[ResguardoService] No se pudo resolver nombre de víctima:', nomErr);
      }

      // 4. Crear incidente en Supabase (Check constraint: origen IN ('manual', 'automatico'))
      // Los botones físicos son una activación deliberada, igual que el SOS manual
      const dbOrigen: 'manual' | 'automatico' =
        origin === 'manual' || origin === 'botones_fisicos' ? 'manual' : 'automatico';

      this.statusMessage = 'Registrando incidente protegido...';
      this.notifyListeners();

      // El identificador se genera aquí para poder trabajar sin conexión
      const incidenteId = Crypto.randomUUID();
      this.incidenteId = incidenteId;
      await AsyncStorage.setItem(STORAGE_KEY_RESGUARDO_INCIDENTE, incidenteId);
      this.notifyListeners();

      await colaEvidencias.encolarAsync({
        tipo: 'incidente',
        datos: {
          inc_id_incidente: incidenteId,
          usu_id_victima: user.id,
          inc_fecha_hora: new Date().toISOString(), // Hora real aunque se sincronice más tarde
          inc_latitud: latitud,
          inc_longitud: longitud,
          inc_direccion: direccion,
          inc_victima_nombre: victimaNombre,
          inc_origen: dbOrigen,
          inc_estado: 'en_curso',
        },
      });

      // 5. POST /api/v1/incidentes/activar (Despacho push de alta prioridad < 500ms)
      this.statusMessage = 'Alertando a tu red de apoyo...';
      this.notifyListeners();

      await colaEvidencias.encolarAsync({
        tipo: 'activar',
        cuerpo: {
          incidente_id: incidenteId,
          victima_id: user.id,
          latitud,
          longitud,
          origen: dbOrigen,
        },
      });

      // 6. Iniciar telemetría continua de geolocalización por polling (sin FGS de ubicación)
      this.iniciarBucleTelemetriaGps(incidenteId);

      // 7. Grabación pericial continua en segmentos de 10 s mientras dure el resguardo.
      // Se lanza desacoplada: el pipeline retorna enseguida y la grabación sigue en segundo plano.
      this.iniciarGrabacionContinuaAsync({
        userId: user.id,
        incidenteId,
        origin,
        dbOrigen,
      }).catch((err) => {
        console.error('[ResguardoService] Error en grabación continua:', err);
      });

      this.statusMessage = '✓ Emergencia activada · grabando evidencia';
      this.notifyListeners();
      console.log(`[ResguardoService] Pipeline de resguardo activo para incidente ${incidenteId}.`);
      return incidenteId;

    } catch (err: any) {
      console.error('[ResguardoService] Error general en el pipeline de resguardo:', err);
      this.statusMessage = 'Error en activación';
      this.notifyListeners();
      throw err;
    }
  }

  /**
   * Graba evidencia en segmentos consecutivos de DURACION_SEGMENTO_MS mientras el incidente siga activo.
   * - Captura: secuencial y sin huecos (el stream sigue acumulando PCM mientras se procesa el segmento anterior).
   * - Procesamiento (cifrado → Storage → sellado TSA): cola secuencial para respetar el orden de prev_hash.
   */
  private async iniciarGrabacionContinuaAsync(ctx: ContextoEvidencia): Promise<void> {
    const sigueActivo = () => this.isActive && this.incidenteId === ctx.incidenteId;
    let indice = 0;

    this.isRecording = true;
    this.notifyListeners();

    try {
      while (sigueActivo()) {
        if (MAX_SEGMENTOS_EVIDENCIA > 0 && indice >= MAX_SEGMENTOS_EVIDENCIA) {
          console.log(
            `[ResguardoService] Límite de ${MAX_SEGMENTOS_EVIDENCIA} segmentos alcanzado. Se detiene la grabación pericial (el resguardo y el GPS siguen activos).`
          );
          break;
        }

        const fechaCaptura = new Date().toISOString();
        const audioUri = await this.capturarSegmentoAsync(sigueActivo);
        if (!audioUri) {
          // Sin audio disponible (stream detenido o fallo de grabador): no insistir en bucle cerrado
          if (!acousticMonitoringService.isActive()) break;
          continue;
        }

        indice++;
        const numero = indice;
        console.log(`[ResguardoService] Segmento #${numero} capturado. Encolando cifrado y sellado...`);

        this.colaProcesamientoEvidencia = this.colaProcesamientoEvidencia
          .then(() => this.procesarSegmentoEvidenciaAsync(audioUri, ctx, numero, fechaCaptura))
          .catch((err) => console.error(`[ResguardoService] Error procesando segmento #${numero}:`, err));
      }
    } finally {
      this.isRecording = false;
      this.notifyListeners();
      console.log(`[ResguardoService] Grabación pericial finalizada (${indice} segmentos).`);
    }
  }

  /**
   * Captura un segmento de audio. Reutiliza el stream de la Escucha en vivo si está activo
   * (no abre otro FGS); si no, usa expo-audio (sólo viable con la app en primer plano).
   */
  private async capturarSegmentoAsync(sigueActivo: () => boolean): Promise<string | null> {
    if (acousticMonitoringService.isActive()) {
      return acousticMonitoringService.capturarEvidenciaForenseWavAsync(DURACION_SEGMENTO_MS, sigueActivo);
    }

    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return null;

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        shouldPlayInBackground: true,
        allowsBackgroundRecording: true,
        interruptionMode: 'mixWithOthers',
      } as any).catch(() => {});

      // El constructor nativo no lee `android` anidado: sin esto Android graba en AMR a 8 kHz
      const { android, ios, web, ...opciones } = RecordingPresets.HIGH_QUALITY;
      const recorder = new (AudioModule as any).AudioRecorder({ ...opciones, ...android });
      await recorder.prepareToRecordAsync();
      recorder.record();

      const fin = Date.now() + DURACION_SEGMENTO_MS;
      while (Date.now() < fin && sigueActivo()) {
        await new Promise<void>((r) => setTimeout(r, 250));
      }
      if (recorder.isRecording) await recorder.stop();

      for (let i = 0; i < 15; i++) {
        if (recorder.uri) {
          const info = await FileSystem.getInfoAsync(recorder.uri);
          if (info.exists && (info as any).size > 0) return recorder.uri as string;
        }
        await new Promise<void>((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.warn('[ResguardoService] No se pudo grabar segmento con expo-audio:', err);
    }
    return null;
  }

  /**
   * Cifra (AES-256-GCM) un segmento y lo deja en la cola local, que lo sube a Storage y lo
   * sella (RFC 3161 + prev_hash) en cuanto haya conexión. El audio en claro se borra al encolarlo.
   */
  private async procesarSegmentoEvidenciaAsync(
    audioUri: string,
    ctx: ContextoEvidencia,
    numeroSegmento: number,
    fechaCaptura: string
  ): Promise<void> {
    const envelope = await cifrarAudioEnvelopeAsync(audioUri);
    const formato = envelope.sobreDigital.formato; // 'wav' (stream) o 'm4a' (expo-audio)
    const storagePath = `${ctx.userId}/${ctx.incidenteId}/audio_${Date.now()}_seg${numeroSegmento}.${formato}`;

    const metadata = await construirMetadataEvidenciaAsync(
      {
        origen: ctx.dbOrigen,
        origen_especifico: ctx.origin,
        trigger: ctx.origin,
        canal_disparo:
          ctx.origin === 'palabra_clave'
            ? 'Vosk Keyword Spotting'
            : ctx.origin === 'violencia_ambiental'
            ? 'YAMNet Environmental Violence'
            : ctx.origin === 'amenaza_verbal_vosk'
            ? 'Vosk + YAMNet Verbal Threat Fusion'
            : ctx.origin === 'automatico'
            ? 'Autonomous Background'
            : ctx.origin === 'botones_fisicos'
            ? 'Hardware Volume Keys'
            : 'Manual SOS',
        segmento: numeroSegmento,
        duracion_segmento_ms: DURACION_SEGMENTO_MS,
        timestamp: Date.now(),
      },
      envelope,
      this.ultimaUbicacion
    );

    await colaEvidencias.encolarEvidenciaAsync(envelope.paqueteCifradoBytes, storagePath, 'sellar-forense', {
      incidente_id: ctx.incidenteId,
      usuario_id: ctx.userId,
      tipo_archivo: 'audio',
      url_almacenamiento: storagePath,
      hash_sha256: envelope.hashSha256Paquete,
      firma_hardware: envelope.firmaHardwareBase64,
      fecha_captura: fechaCaptura,
      metadata_dispositivo: metadata,
    });
    console.log(`[ResguardoService] Segmento #${numeroSegmento} cifrado y en cola de sincronización.`);

    FileSystem.deleteAsync(audioUri, { idempotent: true }).catch(() => {});
  }

  /**
   * Inicia el seguimiento continuo de ubicación mediante Polling (getCurrentPositionAsync).
   * Funciona universalmente en primer plano y segundo plano gracias a que el Foreground Service
   * de micrófono mantiene el hilo JS activo, evitando crear un nuevo FGS de ubicación (Android 14+).
   */
  private iniciarBucleTelemetriaGps(incidenteId: string): void {
    if (this.telemetryTimer) {
      this.telemetryTimer();
      this.telemetryTimer = null;
    }

    const baseUrl = getApiBaseUrl();
    const secretKey = getApiSecretKey();

    const ejecutarCicloPolling = async () => {
      if (!this.isActive || !this.incidenteId || this.incidenteId !== incidenteId) {
        if (this.telemetryTimer) {
          this.telemetryTimer();
          this.telemetryTimer = null;
        }
        return;
      }

      if (this.isPollingGps) return;
      this.isPollingGps = true;

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (loc?.coords) {
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;
          this.ultimaUbicacion = {
            latitud: lat,
            longitud: lng,
            precision_m: loc.coords.accuracy ?? null,
            ubicacion_fecha: new Date(loc.timestamp).toISOString(),
            ubicacion_origen: 'gps',
          };

          // 1. Actualización directa en la tabla incidente de Supabase
          await supabase
            .from('incidente')
            .update({ inc_latitud: lat, inc_longitud: lng, inc_ultima_ubicacion_en: new Date().toISOString() })
            .eq('inc_id_incidente', incidenteId);

          // 2. Notificación al backend para retransmisión por SSE/WebSockets/Push
          fetch(`${baseUrl}/api/v1/incidentes/${incidenteId}/posicion`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-Api-Secret': secretKey,
              ...(this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {}),
            },
            body: JSON.stringify({
              latitud: lat,
              longitud: lng,
            }),
          }).catch(() => {});
        }
      } catch (err) {
        // En segundo plano o túneles/interiores puede haber microcortes de fix; no interrumpir el bucle
        console.warn('[ResguardoService] Aviso en polling GPS continuo:', err);
      } finally {
        this.isPollingGps = false;
      }
    };

    // Polling recurrente cada 5 segundos
    const programarCiclo = () => {
      this.telemetryTimer = programar(() => {
        programarCiclo();
        ejecutarCicloPolling();
      }, 5000);
    };
    programarCiclo();
  }

  /**
   * Detiene el bucle de polling y cancela el Modo Resguardo.
   */
  async stopResguardo(): Promise<void> {
    return this.desactivarModoResguardoAsync();
  }

  /**
   * Desactiva el Modo Resguardo, limpia el intervalo de polling y finaliza el incidente.
   */
  async desactivarModoResguardoAsync(): Promise<void> {
    if (!this.isActive && !this.incidenteId && !this.telemetryTimer) {
      return;
    }
    console.log('[ResguardoService] Desactivando Modo Resguardo y liberando telemetría...');
    this.isActive = false;

    if (this.telemetryTimer) {
      this.telemetryTimer();
      this.telemetryTimer = null;
    }
    this.isPollingGps = false;

    // Restablecer el estado de emergencia en el servicio acústico
    acousticMonitoringService.setEmergencyActive(false);

    const storedIncidente = await AsyncStorage.getItem(STORAGE_KEY_RESGUARDO_INCIDENTE).catch(() => null);
    const idToClose = this.incidenteId || storedIncidente;
    this.incidenteId = null;

    if (idToClose) {
      // El cierre va por la cola: llega aunque ahora no haya conexión
      await colaEvidencias.encolarAsync({
        tipo: 'estado_incidente',
        incidenteId: idToClose,
        estado: 'cerrado',
        notas: 'Modo Resguardo desactivado por la usuaria',
      });
    }

    await AsyncStorage.setItem(STORAGE_KEY_RESGUARDO_ACTIVO, 'false');
    await AsyncStorage.removeItem(STORAGE_KEY_RESGUARDO_INCIDENTE);

    this.statusMessage = '';
    this.currentOrigin = null;
    this.notifyListeners();
  }
}

export const resguardoService = new ResguardoService();
