// src/services/colaEvidencias.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cola local persistente para trabajar sin conexión (RF-3.4 / RNF-06).
//
// Cada operación se guarda en disco antes de intentar enviarla y sólo se borra
// cuando el servidor confirma. El incidente, la alerta y el cierre se envían en orden
// y antes que las evidencias: si una evidencia falla, la emergencia no queda abierta.
// Sin red, se reintenta con espera creciente.
// Los archivos de la cola ya están cifrados: nunca se guarda audio ni imagen en claro.
// ─────────────────────────────────────────────────────────────────────────────

import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { getApiBaseUrl, getApiSecretKey } from '../lib/api';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../lib/cryptoForense';
import { programar } from '../lib/temporizadorAudio';

export type EndpointSellado = 'sellar-forense' | 'sellar-comunitaria';

type Tarea =
  | { tipo: 'incidente'; datos: Record<string, unknown> }
  | { tipo: 'activar'; cuerpo: Record<string, unknown> }
  | { tipo: 'estado_incidente'; incidenteId: string; estado: string; notas: string }
  | {
      tipo: 'evidencia';
      archivo: string;
      rutaStorage: string;
      endpoint: EndpointSellado;
      cuerpo: Record<string, unknown> & { hash_sha256: string };
    };

const DIRECTORIO_COLA = `${FileSystem.documentDirectory}cola_evidencias/`;
const DIRECTORIO_RECHAZADAS = `${DIRECTORIO_COLA}rechazadas/`;
const ESPERA_INICIAL_MS = 5000;
const ESPERA_MAXIMA_MS = 60000;
const LIMITE_OPERACION_MS = 30000;
const LIMITE_EVIDENCIA_MS = 90000;

/** Sin red, sin sesión o servidor caído: la operación queda en la cola y se reintenta. */
class ErrorTemporal extends Error {}

type TareaEnCola = { nombre: string; tarea: Tarea };

class ColaEvidencias {
  private procesando = false;
  private secuencia = 0;
  private espera = ESPERA_INICIAL_MS;
  private temporizador: (() => void) | null = null;
  private suscripcionApp: { remove: () => void } | null = null;

  /** Reanuda lo pendiente de sesiones anteriores y reintenta al volver a la app. */
  iniciar(): void {
    if (!this.suscripcionApp) {
      this.suscripcionApp = AppState.addEventListener('change', (estado) => {
        if (estado === 'active') this.procesarAsync();
      });
    }
    this.procesarAsync();
  }

  async encolarAsync(tarea: Tarea): Promise<void> {
    await this.asegurarDirectoriosAsync();
    await this.guardarTareaAsync(tarea);
    this.procesarAsync();
  }

  async encolarEvidenciaAsync(
    paquete: Uint8Array,
    rutaStorage: string,
    endpoint: EndpointSellado,
    cuerpo: Record<string, unknown> & { hash_sha256: string }
  ): Promise<void> {
    await this.asegurarDirectoriosAsync();
    const archivo = `${DIRECTORIO_COLA}${this.nuevoNombre()}.enc`;
    await FileSystem.writeAsStringAsync(archivo, uint8ArrayToBase64(paquete), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await this.guardarTareaAsync({ tipo: 'evidencia', archivo, rutaStorage, endpoint, cuerpo });
    this.procesarAsync();
  }

  async pendientesAsync(): Promise<number> {
    await this.asegurarDirectoriosAsync();
    return (await this.listarTareasAsync()).length;
  }

  /** Envía las tareas de a una. Devuelve cuántas quedaron pendientes. */
  async procesarAsync(): Promise<number> {
    if (this.procesando) return this.pendientesAsync();
    this.procesando = true;
    try {
      await this.asegurarDirectoriosAsync();
      // La siguiente se elige en cada vuelta porque llegan tareas mientras se envían las anteriores
      for (let actual = await this.siguienteTareaAsync(); actual; actual = await this.siguienteTareaAsync()) {
        const { nombre, tarea } = actual;
        const ruta = `${DIRECTORIO_COLA}${nombre}`;
        try {
          await this.ejecutarConLimiteAsync(tarea);
          await this.descartarAsync(ruta, tarea);
        } catch (err) {
          if (err instanceof ErrorTemporal) {
            console.warn(`[Cola] Tarea ${tarea.tipo} pendiente, se reintentará: ${err.message}`);
            this.programarReintento();
            return this.pendientesAsync();
          }
          // Rechazo definitivo: se aparta para no bloquear la cola, sin perder el archivo
          console.error(`[Cola] Tarea ${tarea.tipo} rechazada:`, err);
          await FileSystem.moveAsync({ from: ruta, to: `${DIRECTORIO_RECHAZADAS}${nombre}` });
        }
      }
      this.espera = ESPERA_INICIAL_MS;
      return 0;
    } finally {
      this.procesando = false;
    }
  }

  /** La más antigua que no sea evidencia y, si no queda ninguna, la evidencia más antigua. */
  private async siguienteTareaAsync(): Promise<TareaEnCola | null> {
    let primeraEvidencia: TareaEnCola | null = null;
    for (const nombre of await this.listarTareasAsync()) {
      const tarea = JSON.parse(await FileSystem.readAsStringAsync(`${DIRECTORIO_COLA}${nombre}`)) as Tarea;
      if (tarea.tipo !== 'evidencia') return { nombre, tarea };
      primeraEvidencia ??= { nombre, tarea };
    }
    return primeraEvidencia;
  }

  /** Al cambiar de red una conexión puede quedar colgada sin error y no debe detener la cola. */
  private ejecutarConLimiteAsync(tarea: Tarea): Promise<void> {
    const limite = tarea.tipo === 'evidencia' ? LIMITE_EVIDENCIA_MS : LIMITE_OPERACION_MS;
    return new Promise<void>((resolve, reject) => {
      const cancelar = programar(() => reject(new ErrorTemporal(`Sin respuesta en ${limite / 1000} s`)), limite);
      this.ejecutarAsync(tarea).then(resolve, reject).finally(cancelar);
    });
  }

  private async ejecutarAsync(tarea: Tarea): Promise<void> {
    // Sin sesión las políticas RLS rechazan la tarea, y eso no significa que sea inválida
    if (tarea.tipo === 'incidente' || tarea.tipo === 'evidencia') {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new ErrorTemporal('Sin sesión iniciada');
    }

    switch (tarea.tipo) {
      case 'incidente':
        return this.crearIncidenteAsync(tarea.datos);
      case 'activar':
        return this.enviarAsync('POST', '/api/v1/incidentes/activar', tarea.cuerpo);
      case 'estado_incidente':
        return this.enviarAsync('PATCH', `/api/v1/incidentes/${tarea.incidenteId}/estado`, {
          estado: tarea.estado,
          notas: tarea.notas,
        });
      case 'evidencia':
        return this.subirEvidenciaAsync(tarea);
    }
  }

  private async crearIncidenteAsync(datos: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.from('incidente').insert(datos);
    if (!error || error.code === '23505') return; // 23505: ya llegó en un intento anterior
    if (!error.code || error.code.startsWith('PGRST') || error.message?.includes('Network')) {
      throw new ErrorTemporal(error.message);
    }
    throw new Error(error.message);
  }

  private async subirEvidenciaAsync(tarea: Extract<Tarea, { tipo: 'evidencia' }>): Promise<void> {
    const contenido = await FileSystem.readAsStringAsync(tarea.archivo, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const { error: errorSubida } = await supabase.storage
      .from('evidencias')
      .upload(tarea.rutaStorage, base64ToUint8Array(contenido), {
        contentType: 'application/octet-stream', // binario cifrado, no reproducible directo
        upsert: true,
      });
    if (errorSubida) {
      const estado = Number((errorSubida as any).statusCode ?? (errorSubida as any).status);
      const rechazada = estado >= 400 && estado < 500 && ![401, 408, 429].includes(estado);
      if (rechazada) throw new Error(`Storage respondió ${estado}: ${errorSubida.message}`);
      throw new ErrorTemporal(errorSubida.message);
    }

    // Si se perdió la respuesta de un intento anterior, la evidencia ya está registrada
    const { data: existente, error: errorConsulta } = await supabase
      .from('evidencia')
      .select('evi_id_evidencia')
      .eq('evi_hash_sha256', tarea.cuerpo.hash_sha256)
      .maybeSingle();
    if (errorConsulta) throw new ErrorTemporal(errorConsulta.message);
    if (existente) return;

    await this.enviarAsync('POST', `/api/v1/evidencias/${tarea.endpoint}`, tarea.cuerpo);
  }

  private async enviarAsync(metodo: string, ruta: string, cuerpo: Record<string, unknown>): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Secret': getApiSecretKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    let respuesta: Response;
    try {
      respuesta = await fetch(`${getApiBaseUrl()}${ruta}`, { method: metodo, headers, body: JSON.stringify(cuerpo) });
    } catch (err: any) {
      throw new ErrorTemporal(err?.message || 'Sin conexión');
    }

    if (respuesta.ok) return;
    if (respuesta.status >= 500 || respuesta.status === 401 || respuesta.status === 429) {
      throw new ErrorTemporal(`HTTP ${respuesta.status} en ${ruta}`);
    }
    throw new Error(`HTTP ${respuesta.status} en ${ruta}: ${await respuesta.text()}`);
  }

  private async descartarAsync(ruta: string, tarea: Tarea): Promise<void> {
    if (tarea.tipo === 'evidencia') {
      await FileSystem.deleteAsync(tarea.archivo, { idempotent: true });
    }
    await FileSystem.deleteAsync(ruta, { idempotent: true });
  }

  private programarReintento(): void {
    if (this.temporizador) return;
    this.temporizador = programar(() => {
      this.temporizador = null;
      this.procesarAsync();
    }, this.espera);
    this.espera = Math.min(this.espera * 2, ESPERA_MAXIMA_MS);
  }

  private async asegurarDirectoriosAsync(): Promise<void> {
    await FileSystem.makeDirectoryAsync(DIRECTORIO_RECHAZADAS, { intermediates: true }).catch(() => {});
  }

  private nuevoNombre(): string {
    this.secuencia += 1;
    return `${String(Date.now()).padStart(15, '0')}_${String(this.secuencia).padStart(6, '0')}`;
  }

  private async guardarTareaAsync(tarea: Tarea): Promise<void> {
    const destino = `${DIRECTORIO_COLA}${this.nuevoNombre()}.json`;
    const temporal = `${destino}.tmp`;
    await FileSystem.writeAsStringAsync(temporal, JSON.stringify(tarea));
    await FileSystem.moveAsync({ from: temporal, to: destino });
  }

  private async listarTareasAsync(): Promise<string[]> {
    const archivos = await FileSystem.readDirectoryAsync(DIRECTORIO_COLA);
    return archivos.filter((nombre) => nombre.endsWith('.json')).sort();
  }
}

export const colaEvidencias = new ColaEvidencias();
