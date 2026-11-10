// src/services/acousticMonitoring.ts
// ─────────────────────────────────────────────────────────────────────────────
// Servicio de "Escucha en vivo" en Segundo Plano (CU-04 / RF-2.1 / RNF-04).
//
// Pipeline de Streaming Continuo en Memoria (evita reinicios de FGS en Android 14+):
// 1. Streaming continuo PCM 16-bit 16kHz mediante @siteed/audio-studio.
// 2. FGS nativo con foregroundServiceType="microphone" y notificación persistente.
// 3. Encendido del micrófono EXCLUSIVAMENTE cuando AppState === 'active'.
// 4. Acumulación en memoria de ventanas de ~2.6s (83,200 bytes) y empaquetado WAV.
// 5. Inferencia doble en el dispositivo: Vosk ASR (palabra clave) + YAMNet (violencia).
//    El backend sólo se usa como respaldo si los modelos locales fallan.
// 6. Si el FGS cae en background, se captura y notifica sin reintentar en bucle.
// ─────────────────────────────────────────────────────────────────────────────

import { Platform, AppState, AppStateStatus } from 'react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { AudioStudioModule, writeWavHeader, type RecordingConfig } from '@siteed/audio-studio';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import { apoyarNativo } from '../../modules/apoyar-nativo';
import { analizarVentanaLocalAsync, PRIORIDAD_ANALISIS, prepararModelosLocalesAsync } from '../lib/analisisAcustico';
import { esperarAsync, pulsoDeAudio } from '../lib/temporizadorAudio';
import { resguardoService } from './resguardoService';
import { isCamouflageVisible, STORAGE_KEY_CAMOUFLAGE_VISIBLE } from '../screens/FakeCalculatorScreen';

export const STORAGE_KEY_MONITORING_ACTIVE = '@apoyar_monitoreo_acustico_activo';
export const STORAGE_KEY_KEYWORD = '@apoyar_palabra_clave_sos';
export const DEFAULT_KEYWORD = 'pizza';

export const NOTIFICATION_CHANNEL_ESCUCHA = 'apoyar_audio_stream_channel';
export const NOTIFICATION_ID_ESCUCHA = 'apoyar_escucha_activa_service';

export type TriggerOrigin = 'palabra_clave' | 'violencia_ambiental' | 'amenaza_verbal_vosk' | 'automatico' | 'manual';
type TriggerCallback = (origen: TriggerOrigin) => void;

/**
 * Normaliza palabras clave removiendo espacios, tildes y diacríticos.
 */
export function normalizarPalabraClave(palabra: string): string {
  return (palabra || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Decodifica una cadena Base64 a Uint8Array de forma nativa en JS.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Codifica un ArrayBuffer a Base64 por fragmentos para evitar desbordamiento de pila.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

class AcousticMonitoringService {
  private isRunning: boolean = false;
  private isStreamRecording: boolean = false;
  private pendingStartOnActive: boolean = false;
  private isProcessingChunk: boolean = false;
  private onTriggerCallback: TriggerCallback | null = null;
  private currentKeyword: string = DEFAULT_KEYWORD;
  private appStateSubscription: any = null;
  private audioDataSubscription: { remove: () => void } | null = null;
  private interruptionSubscription: { remove: () => void } | null = null;
  private consecutiveErrors: number = 0;

  // Buffer en memoria para streaming continuo PCM 16-bit 16kHz
  // 16000 muestras/s * 1 canal * 2 bytes/muestra = 32,000 bytes/segundo
  // Ventana objetivo: ~2.6s = 83,200 bytes
  private pcmChunks: Uint8Array[] = [];
  private totalBufferedBytes: number = 0;
  private readonly targetChunkBytes: number = 83200;
  private readonly maxBufferBytes: number = 416000; // ~13s de salvaguarda ante fallos de red
  private isEmergencyModeActive: boolean = false;

  setEmergencyActive(active: boolean): void {
    this.isEmergencyModeActive = active;
  }

  isEmergencyActive(): boolean {
    return this.isEmergencyModeActive;
  }

  /**
   * Asegura que el canal de notificación para el FGS esté registrado con importancia mínima,
   * sin sonido, sin vibración, sin badge y oculto en la pantalla de bloqueo (visibilidad SECRET).
   */
  private async asegurarCanalNotificacionSigiloso(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ESCUCHA, {
          name: 'Sincronización en segundo plano',
          description: 'Mantiene la sincronización de datos y conectividad con el servidor.',
          importance: Notifications.AndroidImportance.MIN,
          sound: null,
          enableVibrate: false,
          showBadge: false,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
          bypassDnd: false,
        });
      } catch (e) {
        console.warn('[Escucha en vivo] No se pudo configurar canal de notificación sigiloso:', e);
      }
    }
  }

  /**
   * Inicializa el servicio de Escucha en vivo y recupera la palabra clave configurada.
   */
  async initAsync(onTrigger: TriggerCallback): Promise<boolean> {
    this.onTriggerCallback = onTrigger;
    await this.asegurarCanalNotificacionSigiloso();
    prepararModelosLocalesAsync();

    const storedKeyword = await AsyncStorage.getItem(STORAGE_KEY_KEYWORD);
    if (storedKeyword && storedKeyword.trim().length > 0) {
      this.currentKeyword = normalizarPalabraClave(storedKeyword);
    } else {
      this.currentKeyword = DEFAULT_KEYWORD;
      await AsyncStorage.setItem(STORAGE_KEY_KEYWORD, DEFAULT_KEYWORD);
    }

    const wasActive = await AsyncStorage.getItem(STORAGE_KEY_MONITORING_ACTIVE);
    if (wasActive === 'true') {
      return await this.startAsync();
    }

    return false;
  }

  /**
   * Inicia el servicio de Escucha en vivo en primer y segundo plano.
   */
  async startAsync(keyword?: string): Promise<boolean> {
    if (keyword && keyword.trim().length > 0) {
      this.currentKeyword = normalizarPalabraClave(keyword);
      await AsyncStorage.setItem(STORAGE_KEY_KEYWORD, this.currentKeyword);
    } else {
      const stored = await AsyncStorage.getItem(STORAGE_KEY_KEYWORD);
      if (stored && stored.trim().length > 0) {
        this.currentKeyword = normalizarPalabraClave(stored);
      }
    }

    console.log(`[Escucha en vivo] Palabra clave activa: "${this.currentKeyword}"`);

    if (this.isRunning && this.isStreamRecording) return true;

    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      console.warn('[Escucha en vivo] Permiso de micrófono no concedido.');
      return false;
    }

    this.isRunning = true;
    this.consecutiveErrors = 0;
    await AsyncStorage.setItem(STORAGE_KEY_MONITORING_ACTIVE, 'true');
    apoyarNativo?.marcarEscuchaActiva(true);

    prepararModelosLocalesAsync();

    if (!this.appStateSubscription) {
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }

    // Regla estricta Android 14+: el FGS de micrófono sólo puede iniciarse si AppState === 'active'
    if (AppState.currentState !== 'active') {
      console.warn(
        `[Escucha en vivo] startAsync invocado fuera de primer plano (AppState: ${AppState.currentState}). Encendido de micrófono diferido hasta que la app esté activa para cumplir con restricción FGS Android 14+.`
      );
      this.pendingStartOnActive = true;
      return true;
    }

    return await this.iniciarStreamingNativo();
  }

  /**
   * Enciende el hardware de grabación iniciando el streaming continuo bajo FGS.
   * EXCLUSIVO cuando AppState === 'active'.
   */
  private async iniciarStreamingNativo(): Promise<boolean> {
    if (AppState.currentState !== 'active') {
      console.warn('[Escucha en vivo] Cancelando encendido de micrófono: AppState no está active.');
      this.pendingStartOnActive = true;
      return false;
    }

    try {
      this.limpiarBuffer();

      if (!this.audioDataSubscription) {
        this.audioDataSubscription = AudioStudioModule.addListener('AudioData', this.handleAudioData);
      }
      if (!this.interruptionSubscription) {
        this.interruptionSubscription = AudioStudioModule.addListener('onRecordingInterrupted', this.handleInterruption);
      }

      await this.asegurarCanalNotificacionSigiloso();

      const config: RecordingConfig = {
        sampleRate: 16000,
        channels: 1,
        encoding: 'pcm_16bit',
        interval: 100, // emite eventos cada 100ms
        keepAwake: true,
        showNotification: true,
        notification: {
          title: 'Servicio de sincronización',
          text: 'Sincronización de datos activa.',
          android: {
            channelId: NOTIFICATION_CHANNEL_ESCUCHA,
            channelName: 'Sincronización en segundo plano',
            channelDescription: 'Mantiene la sincronización de datos y conectividad con el servidor.',
            priority: 'min',
            accentColor: '#64748B',
            showPauseResumeActions: false,
          },
        },
        android: {
          audioFocusStrategy: 'background',
        },
      };

      await AudioStudioModule.startRecording(config);
      this.isStreamRecording = true;
      this.pendingStartOnActive = false;
      console.log('[Escucha en vivo] Streaming PCM continuo y FGS iniciados con éxito en AppState active.');
      return true;
    } catch (err: any) {
      console.error('[Escucha en vivo] Error iniciando stream continuo de audio:', err);
      this.isStreamRecording = false;
      return false;
    }
  }

  /**
   * Listener que recibe los fragmentos de PCM emitidos por el motor nativo cada ~100ms.
   */
  private handleAudioData = (event: any) => {
    pulsoDeAudio();
    if (!this.isRunning) return;
    if (!event || !event.encoded) return;

    try {
      const bytes = base64ToUint8Array(event.encoded);
      if (bytes.length === 0) return;

      this.pcmChunks.push(bytes);
      this.totalBufferedBytes += bytes.length;

      // Salvaguarda de memoria: descarta muestras antiguas si se acumula demasiado por caídas de red
      while (this.totalBufferedBytes > this.maxBufferBytes && this.pcmChunks.length > 0) {
        const discarded = this.pcmChunks.shift();
        if (discarded) {
          this.totalBufferedBytes -= discarded.length;
        }
      }

      // Durante la emergencia activa, el stream continúa vivo para el FGS y telemetría,
      // pero no saturamos la red enviando ventanas a Vosk/YAMNet
      if (this.isEmergencyModeActive) {
        return;
      }

      // Si se acumuló la ventana objetivo de ~2.6s (83,200 bytes) y no hay una subida en curso
      if (this.totalBufferedBytes >= this.targetChunkBytes && !this.isProcessingChunk) {
        const chunk = this.extraerVentanaPCM(this.targetChunkBytes);
        if (chunk) {
          this.procesarVentanaPCMAsync(chunk);
        }
      }
    } catch (err) {
      console.warn('[Escucha en vivo] Error acumulando buffer PCM en memoria:', err);
    }
  };

  /**
   * Extrae exactamente una ventana de bytes del acumulador en memoria sin interrumpir la grabación base.
   */
  private extraerVentanaPCM(targetBytes: number): Uint8Array | null {
    if (this.totalBufferedBytes < targetBytes) return null;

    const chunk = new Uint8Array(targetBytes);
    let offset = 0;

    while (this.pcmChunks.length > 0 && offset < targetBytes) {
      const head = this.pcmChunks[0];
      const needed = targetBytes - offset;

      if (head.length <= needed) {
        chunk.set(head, offset);
        offset += head.length;
        this.pcmChunks.shift();
      } else {
        chunk.set(head.subarray(0, needed), offset);
        offset += needed;
        this.pcmChunks[0] = head.subarray(needed);
      }
    }

    this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - offset);
    return chunk;
  }

  /**
   * Analiza el fragmento PCM y dispara el Modo Resguardo si corresponde.
   */
  private async procesarVentanaPCMAsync(pcmBytes: Uint8Array): Promise<void> {
    if (!this.isRunning) return;
    this.isProcessingChunk = true;

    try {
      const result = await this.analizarVentanaAsync(pcmBytes);
      this.consecutiveErrors = 0;

      const transcripcion = result.transcripcion || result.transcripcion_vosk || '';
      if (transcripcion && transcripcion.trim().length > 0) {
        console.log(`[Vosk] Transcripción: "${transcripcion.trim()}"`);
      }
      if (result.yamnet_top_class) {
        console.log(
          `[YAMNet] Evento dominante: "${result.yamnet_top_class}" (confianza: ${(
            (result.yamnet_top_score || 0) * 100
          ).toFixed(1)}%)`
        );
      }

      // Verificación de disparo por Palabra Clave de Vosk
      if (result.palabra_clave_detectada) {
        console.warn(
          `[Escucha en vivo / Vosk] ¡Palabra clave "${this.currentKeyword}" reconocida en vivo! Disparando Modo Resguardo.`
        );
        await this.dispararModoResguardo('palabra_clave');
        return;
      }

      // Verificación de disparo por Amenaza Verbal / Fusión Semántica (Vosk + YAMNet)
      if (result.amenaza_verbal_detectada || result.origen_disparo === 'amenaza_verbal_vosk') {
        console.warn(
          `[Escucha en vivo / Fusión IA] ¡Amenaza verbal detectada en habla ("${result.frase_amenaza_detectada || result.transcripcion}")! Disparando Modo Resguardo.`
        );
        await this.dispararModoResguardo('amenaza_verbal_vosk');
        return;
      }

      // Verificación de disparo por Violencia Ambiental de YAMNet
      if (result.violencia_detectada) {
        console.warn(
          `[Escucha en vivo / YAMNet] ¡Patrón de violencia ambiental detectado acústicamente (${result.yamnet_violence_class || result.evento_violencia}, ${(
            (result.yamnet_violence_score || result.confianza_violencia || 0) * 100
          ).toFixed(1)}%)! Disparando Modo Resguardo.`
        );
        await this.dispararModoResguardo('violencia_ambiental');
        return;
      }
    } catch (netErr: any) {
      if (this.isRunning) {
        this.consecutiveErrors++;
        const backoffMs = Math.min(1000 * Math.pow(1.5, Math.min(this.consecutiveErrors, 8)), 10000);
        console.warn(
          `[Escucha en vivo] Error analizando ventana (${this.consecutiveErrors}): ${netErr?.message || netErr}. Reintentando en ${(
            backoffMs / 1000
          ).toFixed(1)}s...`
        );
      }
    } finally {
      this.isProcessingChunk = false;

      // Si se acumularon suficientes bytes mientras se ejecutaba la inferencia, procesar la siguiente ventana
      if (this.isRunning && this.totalBufferedBytes >= this.targetChunkBytes) {
        const nextChunk = this.extraerVentanaPCM(this.targetChunkBytes);
        if (nextChunk) {
          this.procesarVentanaPCMAsync(nextChunk);
        }
      }
    }
  }

  /**
   * Elige dónde se analiza la ventana según PRIORIDAD_ANALISIS, con el otro camino de respaldo.
   */
  private async analizarVentanaAsync(pcmBytes: Uint8Array): Promise<any> {
    if (PRIORIDAD_ANALISIS === 'servidor') {
      try {
        return await this.analizarEnServidorAsync(pcmBytes);
      } catch (err) {
        console.warn('[Escucha en vivo] Backend no disponible, análisis local:', err);
        return analizarVentanaLocalAsync(pcmBytes, this.currentKeyword);
      }
    }

    try {
      return await analizarVentanaLocalAsync(pcmBytes, this.currentKeyword);
    } catch (err) {
      console.warn('[Escucha en vivo] Análisis local no disponible, se usa el backend:', err);
      return this.analizarEnServidorAsync(pcmBytes);
    }
  }

  /**
   * Empaqueta la ventana como WAV temporal y la envía al backend.
   */
  private async analizarEnServidorAsync(pcmBytes: Uint8Array): Promise<any> {
    const exactPcm = new ArrayBuffer(pcmBytes.byteLength);
    new Uint8Array(exactPcm).set(pcmBytes);
    const wavBuffer = writeWavHeader({
      buffer: exactPcm,
      sampleRate: 16000,
      numChannels: 1,
      bitDepth: 16,
    });

    const tempWavUri = `${FileSystem.cacheDirectory}stream_chunk_${Date.now()}.wav`;
    try {
      await FileSystem.writeAsStringAsync(tempWavUri, arrayBufferToBase64(wavBuffer), {
        encoding: FileSystem.EncodingType.Base64,
      });
      return await this.uploadAudioChunkAsync(tempWavUri, this.currentKeyword);
    } finally {
      FileSystem.deleteAsync(tempWavUri, { idempotent: true }).catch(() => {});
    }
  }

  /**
   * Envía un fragmento de audio al backend utilizando FileSystem.uploadAsync (nativo OkHttp)
   * para prevenir el error "Unsupported FormDataPart implementation" en React Native New Architecture.
   */
  private async uploadAudioChunkAsync(chunkUri: string, palabraClave: string): Promise<any> {
    const normalizedUri = chunkUri.startsWith('file://')
      ? chunkUri
      : chunkUri.startsWith('file:')
        ? `file://${chunkUri.slice(5)}`
        : `file://${chunkUri}`;

    const secret = getApiSecretKey();
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (secret) {
      headers['X-Api-Secret'] = secret;
    }

    try {
      const uploadResult = await FileSystem.uploadAsync(
        `${getApiBaseUrl()}/api/v1/acustico/analizar`,
        normalizedUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'audio_file',
          mimeType: 'audio/wav',
          parameters: {
            palabra_clave: palabraClave,
          },
          headers,
        }
      );

      if (uploadResult.status >= 200 && uploadResult.status < 300) {
        return JSON.parse(uploadResult.body);
      } else {
        throw new Error(`HTTP ${uploadResult.status}: ${uploadResult.body}`);
      }
    } catch (fsErr) {
      const fileBlob = await (await fetch(normalizedUri)).blob();
      const formData = new FormData();
      formData.append('audio_file', fileBlob, 'chunk.wav');
      formData.append('palabra_clave', palabraClave);

      const resp = await fetch(`${getApiBaseUrl()}/api/v1/acustico/analizar`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (resp.ok) {
        return await resp.json();
      }
      throw new Error(`HTTP ${resp.status}`);
    }
  }

  /**
   * Captura interrupciones del stream o caída del FGS por el sistema operativo.
   */
  private handleInterruption = async (event: any) => {
    console.warn('[Escucha en vivo] Interrupción de grabación recibida:', event);
    this.isStreamRecording = false;

    // Regla estricta: Si el FGS es destruido mientras la app está en background,
    // PROHIBIDO intentar reiniciarlo en bucle (provoca SecurityException en Android 14+).
    if (this.isRunning && AppState.currentState !== 'active') {
      console.warn('[Escucha en vivo] FGS interrumpido en segundo plano. Emitiendo notificación para solicitar reapertura.');
      this.pendingStartOnActive = true;
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: 'apoyar_interruption_notice',
          content: {
            title: 'Sincronización pausada',
            body: 'Tocá para reanudar la sincronización del servicio.',
            priority: Notifications.AndroidNotificationPriority.LOW,
            autoDismiss: true,
            color: '#64748B',
          },
          trigger: null,
        });
      } catch (e) {
        console.error('[Escucha en vivo] Error notificando interrupción:', e);
      }
    }
  };

  /**
   * Manejador de cambios de ciclo de vida de la aplicación.
   */
  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      console.log('[Escucha en vivo] App en primer plano.');
      if (this.isRunning && (!this.isStreamRecording || this.pendingStartOnActive)) {
        console.log('[Escucha en vivo] Reanudando streaming continuo bajo FGS en primer plano.');
        this.pendingStartOnActive = false;
        await this.iniciarStreamingNativo();
      }
    } else if (nextAppState === 'background' || nextAppState === 'inactive') {
      console.log(`[Escucha en vivo] App pasó a ${nextAppState}: stream continuo y FGS se mantienen activos ininterrumpidamente.`);
    }
  };

  /**
   * Ejecuta el disparo de Modo Resguardo distinguiendo si la app está en segundo o primer plano.
   * REGLA ARQUITECTÓNICA FUNDAMENTAL:
   * NO detenemos AudioStudioModule (NO llamar a this.stopAsync()).
   * El Foreground Service de micrófono DEBE mantenerse activo ininterrumpidamente para:
   * 1. Impedir que Android suspenda o mate el proceso JS en segundo plano.
   * 2. Permitir que el bucle de polling de GPS (Location.getCurrentPositionAsync) funcione.
   * 3. Extraer los 5 segundos de audio pericial directamente del stream sin reiniciar el hardware.
   */
  private async dispararModoResguardo(origen: TriggerOrigin): Promise<void> {
    this.isEmergencyModeActive = true;

    // Verificar si la pantalla de la Calculadora (Modo Invisible) está activa
    const storedCamouflage = (await AsyncStorage.getItem(STORAGE_KEY_CAMOUFLAGE_VISIBLE)) === 'true';
    const isCamouflaged = isCamouflageVisible() || storedCamouflage;
    const isBackground = AppState.currentState !== 'active';

    if (isBackground || isCamouflaged) {
      console.log(
        `[Escucha en vivo] ¡Disparo detectado (${origen}) en modo silencioso (Background: ${isBackground}, Calculadora Camuflaje: ${isCamouflaged})! Activando Modo Resguardo 100% autónomo manteniendo FGS activo.`
      );
      // Ejecución real y silenciosa sin UI: crea incidente, despacha alerta push, extrae audio pericial del stream, cifra, sella RFC 3161 y telemetría continua
      resguardoService.activarModoResguardoAsync(origen, { silentBackground: true }).catch((err) => {
        console.error('[Escucha en vivo] Error activando resguardo silencioso:', err);
        this.isEmergencyModeActive = false; // Si falló, la escucha debe poder volver a dispararlo
      });
      // CRÍTICO: Si la usuaria está dentro de la Calculadora, PROHIBIDO llamar a onTriggerCallback para no navegar a CountdownScreen ni cerrar la calculadora
      if (!isCamouflaged && this.onTriggerCallback) {
        this.onTriggerCallback(origen);
      }
    } else {
      console.log(
        `[Escucha en vivo] Disparo detectado en PRIMER PLANO (${origen}). Notificando para flujo visual.`
      );
      if (this.onTriggerCallback) {
        this.onTriggerCallback(origen);
      } else {
        resguardoService.activarModoResguardoAsync(origen).catch((err) => {
          console.error('[Escucha en vivo] Error activando resguardo en primer plano:', err);
        });
      }
    }
  }

  /**
   * Extrae una grabación pericial WAV de 'duracionMs' directamente del stream
   * continuo activo, sin reiniciar el hardware ni interrumpir el Foreground Service.
   * Soporta predicado sigueActivo para interrumpir la espera si el resguardo se desactiva.
   */
  async capturarEvidenciaForenseWavAsync(
    duracionMs: number = 10000,
    sigueActivo?: () => boolean
  ): Promise<string> {
    const bytesPorSegundo = 16000 * 2; // 16kHz * 16-bit mono = 32,000 bytes/s
    const bytesRequeridos = Math.round((bytesPorSegundo * duracionMs) / 1000); // 320,000 bytes para 10s

    const chunksParaEvidencia: Uint8Array[] = [];
    let bytesAcumulados = 0;

    // Primero tomamos lo que ya esté en el buffer en memoria (contexto inmediato)
    while (this.pcmChunks.length > 0 && bytesAcumulados < bytesRequeridos) {
      const chunk = this.pcmChunks.shift();
      if (chunk) {
        chunksParaEvidencia.push(chunk);
        bytesAcumulados += chunk.length;
      }
    }
    this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - bytesAcumulados);

    // Si faltan bytes para completar la duración, esperamos que lleguen del stream en vivo
    const timeoutMaximo = Date.now() + duracionMs + 4000;
    while (
      bytesAcumulados < bytesRequeridos &&
      Date.now() < timeoutMaximo &&
      (sigueActivo ? sigueActivo() : true)
    ) {
      await esperarAsync(100);
      while (this.pcmChunks.length > 0 && bytesAcumulados < bytesRequeridos) {
        const chunk = this.pcmChunks.shift();
        if (chunk) {
          chunksParaEvidencia.push(chunk);
          bytesAcumulados += chunk.length;
          this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - chunk.length);
        }
      }
    }

    // Si por alguna razón no se capturaron bytes (ej. cancelación inmediata), crear buffer mínimo de 1s
    if (bytesAcumulados === 0) {
      const silencio = new Uint8Array(32000);
      chunksParaEvidencia.push(silencio);
      bytesAcumulados = 32000;
    }

    // Consolidar todos los bytes PCM
    const bufferPcm = new Uint8Array(bytesAcumulados);
    let offset = 0;
    for (const chunk of chunksParaEvidencia) {
      bufferPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const exactPcm = new ArrayBuffer(bufferPcm.byteLength);
    new Uint8Array(exactPcm).set(bufferPcm);

    const wavBuffer = writeWavHeader({
      buffer: exactPcm,
      sampleRate: 16000,
      numChannels: 1,
      bitDepth: 16,
    });

    const tempWavUri = `${FileSystem.cacheDirectory}evidencia_forense_${Date.now()}.wav`;
    const wavBase64 = arrayBufferToBase64(wavBuffer);
    await FileSystem.writeAsStringAsync(tempWavUri, wavBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    console.log(
      `[Escucha en vivo] Evidencia pericial capturada con éxito desde stream activo (${bytesAcumulados} bytes, ${(bytesAcumulados / 32000).toFixed(1)}s): ${tempWavUri}`
    );
    return tempWavUri;
  }

  /**
   * Limpia el acumulador en memoria.
   */
  private limpiarBuffer(): void {
    this.pcmChunks = [];
    this.totalBufferedBytes = 0;
  }

  /**
   * Detiene la Escucha en vivo y libera completamente el micrófono.
   */
  async stopAsync(): Promise<void> {
    this.isRunning = false;
    this.pendingStartOnActive = false;
    this.isStreamRecording = false;
    await AsyncStorage.setItem(STORAGE_KEY_MONITORING_ACTIVE, 'false');
    apoyarNativo?.marcarEscuchaActiva(false);

    if (this.audioDataSubscription) {
      this.audioDataSubscription.remove();
      this.audioDataSubscription = null;
    }
    if (this.interruptionSubscription) {
      this.interruptionSubscription.remove();
      this.interruptionSubscription = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    try {
      await AudioStudioModule.stopRecording();
    } catch (_) {}

    this.limpiarBuffer();
    console.log('[Escucha en vivo] Monitoreo acústico continuo detenido y hardware de audio liberado.');
  }

  /**
   * Retorna si la Escucha en vivo se encuentra activa.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Retorna la palabra clave actual de auxilio.
   */
  getKeyword(): string {
    return this.currentKeyword;
  }

  /**
   * Actualiza dinámicamente la palabra clave personalizada de auxilio (ej. "pizza", "socorro").
   */
  async setKeywordAsync(newKeyword: string): Promise<void> {
    const cleaned = normalizarPalabraClave(newKeyword);
    if (!cleaned) return;
    this.currentKeyword = cleaned;
    await AsyncStorage.setItem(STORAGE_KEY_KEYWORD, this.currentKeyword);
    console.log(`[Escucha en vivo] Palabra clave activa: "${this.currentKeyword}"`);
  }
}

export const acousticMonitoringService = new AcousticMonitoringService();
