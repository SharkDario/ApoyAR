// src/lib/analisisAcustico.ts
// ─────────────────────────────────────────────────────────────────────────────
// Análisis acústico en el dispositivo (RF-2.2 / RNF-06).
//
// Kotlin ejecuta Vosk y YAMNet; aquí se aplican las mismas reglas de decisión que
// AcousticAIService del backend, con las mismas claves en el resultado.
// ─────────────────────────────────────────────────────────────────────────────

import { apoyarNativo } from '../../modules/apoyar-nativo';

// 'local': el audio se analiza en el teléfono y el backend sólo se usa si fallan los modelos.
// 'servidor': se analiza en el backend y lo local sólo se usa sin conexión (no cumple RF-2.2).
export const PRIORIDAD_ANALISIS: 'local' | 'servidor' = 'local';

const VIOLENCE_THRESHOLD = 0.22;
const VIOLENCE_SENSITIVE_THRESHOLD = 0.12;

const VIOLENCE_CLASSES: Record<number, string> = {
  6: 'Shout',
  9: 'Yell',
  10: 'Children shouting',
  11: 'Screaming',
  19: 'Crying, sobbing',
  20: 'Baby cry, infant cry',
  22: 'Wail, moan',
  33: 'Groan',
  435: 'Glass',
  461: 'Slap, smack',
  462: 'Whack, thwack',
  463: 'Smash, crash',
};

const DICCIONARIO_VIOLENCIA_VERBAL: { categoria: string; patrones: string[] }[] = [
  {
    categoria: 'amenaza_de_muerte_o_agresion',
    patrones: [
      'te voy a matar', 'te mato', 'te voy a romper', 'te voy a hacer mierda', 'te voy a reventar',
      'te voy a quebrar', 'te voy a destruir', 'te vas a morir', 'te voy a pegar', 'te vas a arrepentir',
      'de aca no salis viva', 'de aqui no sales viva', 'te voy a degollar', 'te tiro por la ventana',
      'te voy a cagar a palos',
    ],
  },
  {
    categoria: 'coaccion_y_retencion',
    patrones: [
      'no vas a salir', 'no vas a ir a ningun lado', 'no te vas a ir', 'de aca no te vas', 'de aqui no te vas',
      'adonde vas', 'a donde te pensas que vas', 'dame el celular', 'dame el telefono', 'soltame',
      'no me toques', 'dejame en paz', 'dejame salir', 'dejame ir', 'no me pegues',
    ],
  },
  {
    categoria: 'silenciamiento_hostil',
    patrones: [
      'callate', 'callate la boca', 'cerra la boca', 'cerra el orto', 'no grites',
      'te dije que te calles', 'no hables', 'silencio',
    ],
  },
  {
    categoria: 'pedido_auxilio',
    patrones: [
      'auxilio', 'socorro', 'ayuda por favor', 'ayudame', 'ayudenme', 'por favor ayuda', 'llama a la policia',
      'llama al 911', 'por favor no me pegues', 'por favor no', 'basta por favor', 'soltame por favor',
    ],
  },
  {
    categoria: 'insulto_agresion_directa',
    patrones: [
      'hija de puta', 'hijo de puta', 'la concha de tu madre', 'pedazo de mierda', 'sos una mierda',
      'maldita perra', 'estupida de mierda', 'inutil', 'tarada', 'basura',
    ],
  },
];

export function normalizarTexto(texto: string): string {
  return (texto || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?"'\-_]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

export function evaluarAmenazaVerbal(transcripcion: string): { frase: string; categoria: string } | null {
  const texto = normalizarTexto(transcripcion);
  if (!texto) return null;

  const tokens = new Set(texto.split(' '));
  for (const { categoria, patrones } of DICCIONARIO_VIOLENCIA_VERBAL) {
    for (const patron of patrones) {
      const normalizado = normalizarTexto(patron);
      const coincide = normalizado.includes(' ') ? texto.includes(normalizado) : tokens.has(normalizado);
      if (coincide) return { frase: patron, categoria };
    }
  }
  return null;
}

export function contienePalabraClave(transcripcion: string, palabraClave: string): boolean {
  const texto = normalizarTexto(transcripcion);
  const clave = normalizarTexto(palabraClave);
  if (!clave) return false;
  if (texto.includes(clave)) return true;

  const palabras = new Set(texto.split(' '));
  return clave.split(' ').every((palabra) => palabras.has(palabra));
}

function bytesABase64(bytes: Uint8Array): string {
  let binario = '';
  const TAMANO_BLOQUE = 0x8000;
  for (let i = 0; i < bytes.length; i += TAMANO_BLOQUE) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + TAMANO_BLOQUE) as unknown as number[]);
  }
  return btoa(binario);
}

export async function prepararModelosLocalesAsync(): Promise<void> {
  if (!apoyarNativo) return;
  try {
    await apoyarNativo.prepararModelos();
    console.log('[Análisis local] Modelos Vosk y YAMNet listos en el dispositivo.');
  } catch (err) {
    console.warn('[Análisis local] No se pudieron preparar los modelos:', err);
  }
}

/**
 * Analiza una ventana de PCM mono 16 kHz. Devuelve las mismas claves que
 * POST /api/v1/acustico/analizar para que el flujo de disparo sea uno solo.
 */
export async function analizarVentanaLocalAsync(pcmBytes: Uint8Array, palabraClave: string): Promise<any> {
  if (!apoyarNativo) {
    throw new Error('El módulo nativo de análisis acústico no está disponible.');
  }

  const { transcripcion, top_clases, puntajes } = await apoyarNativo.analizarVentana(bytesABase64(pcmBytes));

  let eventoViolencia: string | null = null;
  let confianzaViolencia = 0;
  for (const [indice, nombre] of Object.entries(VIOLENCE_CLASSES)) {
    const puntaje = puntajes[Number(indice)] ?? 0;
    if (puntaje > confianzaViolencia) {
      confianzaViolencia = puntaje;
      eventoViolencia = nombre;
    }
  }

  const amenaza = evaluarAmenazaVerbal(transcripcion);
  const palabraDetectada = contienePalabraClave(transcripcion, palabraClave);
  const umbral = amenaza ? VIOLENCE_SENSITIVE_THRESHOLD : VIOLENCE_THRESHOLD;
  const violenciaDetectada = eventoViolencia !== null && confianzaViolencia >= umbral;
  const dominante = top_clases[0] ?? { clase: 'Unknown', score: 0 };

  return {
    transcripcion,
    palabra_clave_detectada: palabraDetectada,
    amenaza_verbal_detectada: amenaza !== null,
    frase_amenaza_detectada: amenaza?.frase ?? null,
    categoria_amenaza: amenaza?.categoria ?? null,
    violencia_detectada: violenciaDetectada,
    evento_violencia: violenciaDetectada ? eventoViolencia : null,
    yamnet_violence_class: violenciaDetectada ? eventoViolencia : null,
    confianza_violencia: confianzaViolencia,
    yamnet_violence_score: confianzaViolencia,
    yamnet_top_class: dominante.clase,
    yamnet_top_score: dominante.score,
    top_clases_yamnet: top_clases,
  };
}
