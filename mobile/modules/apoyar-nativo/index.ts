// modules/apoyar-nativo/index.ts
// Acceso tipado al módulo Kotlin. En plataformas sin el módulo devuelve null.
import { requireOptionalNativeModule } from 'expo';

export interface ClaseAcustica {
  id: number;
  clase: string;
  score: number;
}

export interface ResultadoVentanaNativa {
  transcripcion: string;
  top_clases: ClaseAcustica[];
  puntajes: number[];
}

export interface DatosFirmaDispositivo {
  algoritmo: string;
  nivel: 'strongbox' | 'tee' | 'software';
  cadena_certificados_b64: string[];
}

interface ApoyarNativoApi {
  prepararModelos(): Promise<boolean>;
  analizarVentana(pcmBase64: string): Promise<ResultadoVentanaNativa>;
  firmarHash(hashHex: string): Promise<string>;
  obtenerDatosFirma(): Promise<DatosFirmaDispositivo>;
  envolverDekDispositivo(dekHex: string): Promise<string>;
  desenvolverDekDispositivo(envuelta: string): Promise<string>;
  envolverDekCustodia(dekHex: string, clavePublicaBase64: string): Promise<string>;
  marcarEscuchaActiva(activa: boolean): void;
  /** Habilita la activación con 3 pulsaciones de Volumen abajo en menos de 2 s (RF-2.4). */
  configurarBotonesFisicos(habilitado: boolean): void;
  addListener(evento: 'onPulsacionesVolumen', oyente: () => void): { remove(): void };
}

export const apoyarNativo = requireOptionalNativeModule<ApoyarNativoApi>('ApoyarNativo');
