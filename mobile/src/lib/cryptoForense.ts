// src/lib/cryptoForense.ts
// ─────────────────────────────────────────────────────────────────────────────
// Módulo de Criptografía Forense y Hardware Enclave (CU-05 / RF-3.1 / RNF-02).
//
// Implementa:
// 1. Huella digital criptográfica SHA-256 exacta sobre binarios multimedia.
// 2. Firma ECDSA P-256 en hardware seguro (Android Keystore: TEE o StrongBox).
// 3. Cifrado en sobre (Envelope Encryption) con AES-256-GCM NIST SP 800-38D.
// 4. Protección de la DEK: envuelta por la clave maestra del Keystore y por la clave
//    pública de custodia del backend. Nunca se guarda ni se transmite en claro.
// 5. Desencriptación y verificación de integridad para reproducción autorizada.
// ─────────────────────────────────────────────────────────────────────────────

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { gcm } from '@noble/ciphers/aes.js';
import { apoyarNativo, type DatosFirmaDispositivo } from '../../modules/apoyar-nativo';

export interface SobreDigital {
  algoritmo: 'AES-256-GCM';
  dek_hex?: string; // Sólo en evidencias anteriores a RF-3.2
  dek_dispositivo_b64?: string;
  dek_custodia_b64?: string;
  iv_hex: string;
  tag_hex: string;
  hash_audio_plano: string;
  tamano_audio_plano: number;
  tamano_paquete_cifrado: number;
  formato: string;
}

export interface EnvelopeCifradoResult {
  paqueteCifradoBytes: Uint8Array;
  paqueteCifradoBase64: string;
  hashSha256Paquete: string; // Hash del binario cifrado que se audita con TSA RFC 3161
  hashAudioPlano: string;   // Hash del audio original antes de cifrar
  dekHex: string;
  ivHex: string;
  tagHex: string;
  firmaHardwareBase64: string;
  sobreDigital: SobreDigital;
}

export interface DesencriptarResultado {
  audioUri: string;
  fileUri: string;
  bytesDesencriptados: Uint8Array;
  hashRecalculadoPlano: string;
  integridadVerificada: boolean;
}

// ── Helpers Binarios y de Conversión ──────────────────────────────────────────

/**
 * Detecta si los bytes corresponden a un contenedor WAV (cabecera 'RIFF....WAVE').
 */
export function esWavRiff(bytes: Uint8Array): boolean {
  return (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
  );
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Calcula la huella digital SHA-256 exacta sobre un arreglo de bytes en memoria.
 */
export function calcularHashSha256Bytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes)).toLowerCase();
}

/**
 * Calcula la huella digital SHA-256 exacta sobre los bytes reales de un archivo local.
 */
export async function calcularHashArchivoAsync(fileUri: string): Promise<string> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error(`El archivo de audio no existe en: ${fileUri}`);
    }

    const base64Content = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64Content);
    return calcularHashSha256Bytes(bytes);
  } catch (error) {
    console.warn('[CryptoForense] Error leyendo archivo para hash:', error);
    throw error;
  }
}

/**
 * Firma el hash con la clave ECDSA P-256 del Android Keystore. La clave nunca sale del hardware.
 * Si el teléfono no puede firmar, la evidencia se preserva igual y la auditoría la marca sin firma.
 */
export async function firmarConHardwareKeystoreAsync(hashSha256: string): Promise<string> {
  try {
    if (apoyarNativo) return await apoyarNativo.firmarHash(hashSha256);
  } catch (err) {
    console.warn('[CryptoForense] No se pudo firmar en el Keystore:', err);
  }
  return `SIN_FIRMA_HARDWARE:${hashSha256.slice(0, 16)}`;
}

/** Certificados de atestación con los que el backend verifica la firma. */
export async function obtenerDatosFirmaDispositivoAsync(): Promise<DatosFirmaDispositivo | null> {
  try {
    return apoyarNativo ? await apoyarNativo.obtenerDatosFirma() : null;
  } catch (err) {
    console.warn('[CryptoForense] No se pudieron obtener los certificados del Keystore:', err);
    return null;
  }
}

/**
 * Protege la DEK de dos formas: con la clave maestra del Keystore, para que la titular la
 * abra en su teléfono, y con la clave pública de custodia, para el acceso autorizado del backend.
 */
async function protegerDekAsync(dekHex: string): Promise<Pick<SobreDigital, 'dek_dispositivo_b64' | 'dek_custodia_b64'>> {
  if (!apoyarNativo) {
    throw new Error('El Keystore del dispositivo no está disponible para proteger la clave de cifrado.');
  }
  const dek_dispositivo_b64 = await apoyarNativo.envolverDekDispositivo(dekHex);
  const clavePublica = (process.env.EXPO_PUBLIC_DEK_CUSTODIA_PUBLIC_KEY || '').trim();
  if (!clavePublica) {
    console.warn('[CryptoForense] Falta EXPO_PUBLIC_DEK_CUSTODIA_PUBLIC_KEY: el backend no podrá abrir esta evidencia.');
    return { dek_dispositivo_b64 };
  }
  return {
    dek_dispositivo_b64,
    dek_custodia_b64: await apoyarNativo.envolverDekCustodia(dekHex, clavePublica),
  };
}

/** Abre la DEK de una evidencia en este teléfono. Devuelve undefined si no es posible. */
export async function resolverDekEvidenciaAsync(sobre?: Partial<SobreDigital> | null): Promise<string | undefined> {
  if (sobre?.dek_hex) return sobre.dek_hex;
  if (!sobre?.dek_dispositivo_b64 || !apoyarNativo) return undefined;
  try {
    return await apoyarNativo.desenvolverDekDispositivo(sobre.dek_dispositivo_b64);
  } catch (err) {
    console.warn('[CryptoForense] Esta evidencia se cifró en otro dispositivo o instalación:', err);
    return undefined;
  }
}

/** Cifra con la DEK los datos del dispositivo que no hacen falta en claro. */
export async function cifrarMetadatosAsync(datos: Record<string, unknown>, dekHex: string) {
  const ivBytes = await Crypto.getRandomBytesAsync(12);
  const contenido = gcm(hexToBytes(dekHex), ivBytes).encrypt(new TextEncoder().encode(JSON.stringify(datos)));
  return {
    algoritmo: 'AES-256-GCM' as const,
    iv_hex: bytesToHex(ivBytes),
    contenido_b64: uint8ArrayToBase64(contenido),
  };
}

/**
 * Ejecuta cifrado en sobre (Envelope Encryption con AES-256-GCM) sobre el archivo de audio.
 *
 * Flujo:
 * 1. Lee los bytes reales del audio en claro (.m4a / .wav).
 * 2. Calcula SHA-256 sobre el audio original en claro.
 * 3. Genera DEK de 256 bits (32 bytes) e IV de 96 bits (12 bytes) aleatorios.
 * 4. Cifra el audio con AES-256-GCM obteniendo ciphertext + tag (16 bytes).
 * 5. Empaqueta el binario: [12 bytes IV] + [Ciphertext + Tag].
 * 6. Calcula SHA-256 sobre el paquete cifrado para el sellado RFC 3161 y el endpoint /auditar.
 * 7. Firma la huella del paquete cifrado con la clave del Keystore.
 * 8. Retorna el paquete cifrado y el sobre digital completo.
 */
export async function cifrarAudioEnvelopeAsync(
  audioUri: string
): Promise<EnvelopeCifradoResult> {
  const fileInfo = await FileSystem.getInfoAsync(audioUri);
  if (!fileInfo.exists) {
    throw new Error(`El archivo de audio no existe en: ${audioUri}`);
  }

  const base64Content = await FileSystem.readAsStringAsync(audioUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const plainBytes = base64ToUint8Array(base64Content);
  if (plainBytes.length === 0) {
    throw new Error(`El archivo de audio está vacío: ${audioUri}`);
  }

  // 1. Huella del audio en claro
  const hashAudioPlano = calcularHashSha256Bytes(plainBytes);

  // 2. Generación de claves aleatorias en hardware
  const dekBytes = await Crypto.getRandomBytesAsync(32); // AES-256
  const ivBytes = await Crypto.getRandomBytesAsync(12);  // 96-bit nonce GCM

  const dekHex = bytesToHex(dekBytes);
  const ivHex = bytesToHex(ivBytes);

  // 3. Cifrado AES-256-GCM
  const cipher = gcm(dekBytes, ivBytes);
  const encryptedWithTag = cipher.encrypt(plainBytes);

  const tagBytes = encryptedWithTag.slice(encryptedWithTag.length - 16);
  const tagHex = bytesToHex(tagBytes);

  // 4. Paquete binario para Supabase Storage: [12 bytes IV] + [Ciphertext + 16 bytes Tag]
  const paqueteCifradoBytes = new Uint8Array(12 + encryptedWithTag.length);
  paqueteCifradoBytes.set(ivBytes, 0);
  paqueteCifradoBytes.set(encryptedWithTag, 12);

  // 5. Huella digital del paquete que se almacena y se audita con TSA RFC 3161
  const hashSha256Paquete = calcularHashSha256Bytes(paqueteCifradoBytes);

  // 6. Firma hardware TEE sobre la huella auditable
  const firmaHardwareBase64 = await firmarConHardwareKeystoreAsync(hashSha256Paquete);

  // OPTIMIZACIÓN EXTREMA: Solo computar Base64 si el archivo es pequeño (<256 KB) para evitar
  // saturar la memoria y el hilo de JS; la subida a Storage usa directamente paqueteCifradoBytes.
  const paqueteCifradoBase64 = paqueteCifradoBytes.length < 262144 ? uint8ArrayToBase64(paqueteCifradoBytes) : '';

  const sobreDigital: SobreDigital = {
    algoritmo: 'AES-256-GCM',
    ...(await protegerDekAsync(dekHex)),
    iv_hex: ivHex,
    tag_hex: tagHex,
    hash_audio_plano: hashAudioPlano,
    tamano_audio_plano: plainBytes.length,
    tamano_paquete_cifrado: paqueteCifradoBytes.length,
    formato: esWavRiff(plainBytes) ? 'wav' : 'm4a',
  };

  return {
    paqueteCifradoBytes,
    paqueteCifradoBase64,
    hashSha256Paquete,
    hashAudioPlano,
    dekHex,
    ivHex,
    tagHex,
    firmaHardwareBase64,
    sobreDigital,
  };
}

/**
 * Cifra cualquier archivo multimedia (audio, imagen, video) aplicando Sobre Digital (Envelope Encryption):
 * DEK efímera AES-256-GCM + IV aleatorio + Hash SHA-256 + Firma Keystore TEE.
 */
export async function cifrarArchivoEnvelopeAsync(
  fileUri: string,
  tipo: 'audio' | 'imagen' | 'video' = 'audio',
  extensionSugerida?: string
): Promise<EnvelopeCifradoResult> {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error(`El archivo no existe en: ${fileUri}`);
  }

  const base64Content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const plainBytes = base64ToUint8Array(base64Content);
  if (plainBytes.length === 0) {
    throw new Error(`El archivo está vacío: ${fileUri}`);
  }

  const hashPlano = calcularHashSha256Bytes(plainBytes);

  const dekBytes = await Crypto.getRandomBytesAsync(32);
  const ivBytes = await Crypto.getRandomBytesAsync(12);

  const dekHex = bytesToHex(dekBytes);
  const ivHex = bytesToHex(ivBytes);

  const cipher = gcm(dekBytes, ivBytes);
  const encryptedWithTag = cipher.encrypt(plainBytes);

  const tagBytes = encryptedWithTag.slice(encryptedWithTag.length - 16);
  const tagHex = bytesToHex(tagBytes);

  const paqueteCifradoBytes = new Uint8Array(12 + encryptedWithTag.length);
  paqueteCifradoBytes.set(ivBytes, 0);
  paqueteCifradoBytes.set(encryptedWithTag, 12);

  const hashSha256Paquete = calcularHashSha256Bytes(paqueteCifradoBytes);
  const firmaHardwareBase64 = await firmarConHardwareKeystoreAsync(hashSha256Paquete);
  // OPTIMIZACIÓN EXTREMA: Solo computar Base64 si el archivo es pequeño (<256 KB) para evitar
  // saturar la memoria y el hilo de JS; la subida a Storage usa directamente paqueteCifradoBytes.
  const paqueteCifradoBase64 = paqueteCifradoBytes.length < 262144 ? uint8ArrayToBase64(paqueteCifradoBytes) : '';

  let formato = extensionSugerida || (tipo === 'imagen' ? 'jpg' : tipo === 'video' ? 'mp4' : 'wav');
  if (tipo === 'audio' && !extensionSugerida) {
    formato = esWavRiff(plainBytes) ? 'wav' : 'm4a';
  }

  const sobreDigital: SobreDigital = {
    algoritmo: 'AES-256-GCM',
    ...(await protegerDekAsync(dekHex)),
    iv_hex: ivHex,
    tag_hex: tagHex,
    hash_audio_plano: hashPlano,
    tamano_audio_plano: plainBytes.length,
    tamano_paquete_cifrado: paqueteCifradoBytes.length,
    formato,
  };

  return {
    paqueteCifradoBytes,
    paqueteCifradoBase64,
    hashSha256Paquete,
    hashAudioPlano: hashPlano,
    dekHex,
    ivHex,
    tagHex,
    firmaHardwareBase64,
    sobreDigital,
  };
}

/**
 * Desencripta un paquete multimedia cifrado con AES-256-GCM y lo escribe en un archivo
 * temporal local con la extensión adecuada para visualización o reproducción inmediata.
 */
export async function desencriptarArchivoEnvelopeAsync(
  paqueteBytes: Uint8Array,
  dekHex: string,
  extensionSugerida: string = 'wav',
  ivHexOpcional?: string,
  hashPlanoEsperado?: string
): Promise<DesencriptarResultado> {
  if (paqueteBytes.length <= 28) {
    throw new Error('El paquete cifrado es demasiado pequeño o está corrupto (mínimo 28 bytes).');
  }

  const dekBytes = hexToBytes(dekHex);
  if (dekBytes.length !== 32) {
    throw new Error(`Longitud de DEK inválida (esperada 32 bytes, recibido ${dekBytes.length})`);
  }

  let ivBytes: Uint8Array;
  let ciphertextWithTag: Uint8Array;

  if (ivHexOpcional && ivHexOpcional.length === 24) {
    ivBytes = hexToBytes(ivHexOpcional);
    const primerSegmento = paqueteBytes.slice(0, 12);
    if (bytesToHex(primerSegmento) === ivHexOpcional) {
      ciphertextWithTag = paqueteBytes.slice(12);
    } else {
      ciphertextWithTag = paqueteBytes;
    }
  } else {
    ivBytes = paqueteBytes.slice(0, 12);
    ciphertextWithTag = paqueteBytes.slice(12);
  }

  const decipher = gcm(dekBytes, ivBytes);
  const plainBytes = decipher.decrypt(ciphertextWithTag);

  const hashRecalculadoPlano = calcularHashSha256Bytes(plainBytes);
  const integridadVerificada = hashPlanoEsperado
    ? hashRecalculadoPlano.toLowerCase() === hashPlanoEsperado.toLowerCase()
    : true;

  const cacheDir = `${FileSystem.cacheDirectory}evidencias_desencriptadas/`;
  const dirInfo = await FileSystem.getInfoAsync(cacheDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  }

  let ext = extensionSugerida;
  if (ext === 'audio' || ext === 'wav' || ext === 'm4a') {
    ext = esWavRiff(plainBytes) ? 'wav' : 'm4a';
  }

  const tempUri = `${cacheDir}preview_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const base64Plain = uint8ArrayToBase64(plainBytes);
  await FileSystem.writeAsStringAsync(tempUri, base64Plain, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    audioUri: tempUri,
    fileUri: tempUri,
    bytesDesencriptados: plainBytes,
    hashRecalculadoPlano,
    integridadVerificada,
  };
}

/**
 * Desencripta un paquete de audio cifrado con AES-256-GCM y lo escribe en un archivo
 * temporal local para reproducción inmediata con el reproductor nativo.
 */
export async function desencriptarAudioEnvelopeAsync(
  paqueteBytes: Uint8Array,
  dekHex: string,
  ivHexOpcional?: string,
  hashAudioPlanoEsperado?: string
): Promise<DesencriptarResultado> {
  return desencriptarArchivoEnvelopeAsync(
    paqueteBytes,
    dekHex,
    'wav',
    ivHexOpcional,
    hashAudioPlanoEsperado
  );
}
