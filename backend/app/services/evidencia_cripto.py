# backend/app/services/evidencia_cripto.py
# ─────────────────────────────────────────────────────────────────────────────
# Funciones puras de descifrado en memoria del sobre digital (AES-256-GCM)
# y de resolución de tipo MIME / extensión de los archivos de evidencia.
#
# Estructura del paquete cifrado: [12 bytes IV] + [Ciphertext + 16 bytes Tag].
# El IV y la DEK envuelta viajan en `evi_metadata_dispositivo.sobre_digital`:
# `dek_custodia_b64` (RSA-OAEP para el backend) y `dek_dispositivo_b64` (clave del
# Keystore del teléfono). `dek_hex` en claro sólo existe en evidencias anteriores.
# ─────────────────────────────────────────────────────────────────────────────

import base64
import io
import logging
import subprocess
import wave
from typing import Any, Dict, Optional, Tuple

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

logger = logging.getLogger("apoyar.evidencia_cripto")


def obtener_sobre_digital(metadata_dispositivo: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return (metadata_dispositivo or {}).get("sobre_digital") or {}


def tiene_dek(sobre_digital: Dict[str, Any]) -> bool:
    return bool(sobre_digital.get("dek_hex") or sobre_digital.get("dek_custodia_b64"))


def resolver_dek(sobre_digital: Dict[str, Any]) -> Optional[bytes]:
    """Devuelve la DEK en memoria, abriendo el sobre con la clave privada de custodia."""
    if sobre_digital.get("dek_hex"):
        return bytes.fromhex(sobre_digital["dek_hex"])
    envuelta = sobre_digital.get("dek_custodia_b64")
    if not envuelta:
        return None
    if not settings.dek_custodia_private_key_b64:
        raise ValueError("Falta DEK_CUSTODIA_PRIVATE_KEY_B64 en la configuración del backend.")
    clave = serialization.load_pem_private_key(base64.b64decode(settings.dek_custodia_private_key_b64), password=None)
    return clave.decrypt(
        base64.b64decode(envuelta),
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )


def descifrar_para_reproduccion(paquete: bytes, sobre_digital: Dict[str, Any]) -> bytes:
    """
    Descifra el paquete para reproducción inline. Sin DEK devuelve el binario tal cual.
    Lanza ValueError / InvalidTag si el paquete no puede descifrarse.
    """
    dek = resolver_dek(sobre_digital)
    iv_hex = sobre_digital.get("iv_hex")
    if not dek:
        return paquete

    aesgcm = AESGCM(dek)
    if iv_hex and paquete[:12] == bytes.fromhex(iv_hex):
        iv = paquete[:12]
        ct_with_tag = paquete[12:]
    elif iv_hex and len(paquete) > 16:
        iv = bytes.fromhex(iv_hex)
        ct_with_tag = paquete
    elif len(paquete) > 28:
        iv = paquete[:12]
        ct_with_tag = paquete[12:]
    else:
        raise ValueError("El paquete cifrado no tiene el tamaño mínimo requerido (IV + Tag).")
    return aesgcm.decrypt(iv, ct_with_tag, None)


def descifrar_para_exportacion(paquete: bytes, sobre_digital: Dict[str, Any], evidencia_id: Any = None) -> bytes:
    """
    Descifra el paquete para el ZIP forense. Si ninguna estrategia funciona,
    devuelve el binario original (el manifiesto registra los hashes).
    """
    iv_hex = sobre_digital.get("iv_hex")
    descifrado = None
    if not tiene_dek(sobre_digital):
        descifrado = paquete
    else:
        try:
            aesgcm = AESGCM(resolver_dek(sobre_digital))
            if len(paquete) >= 28:
                descifrado = aesgcm.decrypt(paquete[:12], paquete[12:], None)
            elif iv_hex:
                descifrado = aesgcm.decrypt(bytes.fromhex(iv_hex), paquete, None)
        except Exception as dec_fallback:
            logger.warning("Intento de desencriptación alternativo con IV hex para %s: %s", evidencia_id, dec_fallback)
            if iv_hex:
                try:
                    descifrado = aesgcm.decrypt(bytes.fromhex(iv_hex), paquete, None)
                except Exception:
                    pass

    return paquete if descifrado is None else descifrado


def es_audio_amr(contenido: bytes) -> bool:
    """Contenedor 3GP con audio AMR, lo que graba Android si no recibe las opciones de grabación."""
    return contenido[4:8] == b"ftyp" and b"samr" in contenido


def amr_a_wav(contenido: bytes) -> bytes:
    """
    Los navegadores no decodifican AMR: se convierte en memoria sólo para escucharlo.
    La evidencia guardada, su hash y su exportación no cambian. El mdat se envía a ffmpeg
    como archivo AMR porque el 3GP tiene el índice al final y por un pipe no se puede leer.
    """
    inicio = 0
    while True:
        tamano = int.from_bytes(contenido[inicio : inicio + 4], "big")
        cabecera = 8
        if tamano == 1:  # Android guarda el tamaño de mdat en el campo extendido de 64 bits
            tamano = int.from_bytes(contenido[inicio + 8 : inicio + 16], "big")
            cabecera = 16
        if contenido[inicio + 4 : inicio + 8] == b"mdat":
            tramas = contenido[inicio + cabecera : inicio + tamano]
            break
        if tamano < 8 or inicio + tamano >= len(contenido):
            raise ValueError("El contenedor 3GP no tiene datos de audio.")
        inicio += tamano

    proceso = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "amr", "-i", "pipe:0", "-f", "s16le", "-acodec", "pcm_s16le", "-ar", "8000", "-ac", "1", "pipe:1"],
        input=b"#!AMR\n" + tramas,
        capture_output=True,
        timeout=30,
        check=True,
    )
    if not proceso.stdout:
        raise ValueError("La conversión del audio no generó contenido.")

    salida = io.BytesIO()
    with wave.open(salida, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(proceso.stdout)
    return salida.getvalue()


def tipo_medio_reproduccion(tipo_archivo: str, formato: str) -> Tuple[str, str]:
    """(media_type, extensión) para servir la evidencia inline en el navegador."""
    if tipo_archivo == "video" or formato in ("mp4", "mov", "m4v"):
        return "video/mp4", formato or "mp4"
    if tipo_archivo == "imagen" or formato in ("jpg", "jpeg"):
        return "image/jpeg", formato or "jpg"
    if formato == "png":
        return "image/png", "png"
    if formato in ("m4a", "aac"):
        return "audio/mp4", formato
    if tipo_archivo == "audio" or formato in ("wav", "riff"):
        return "audio/wav", formato or "wav"
    return "application/octet-stream", formato or "bin"


def extension_exportacion(tipo_archivo: str, formato: str) -> str:
    """Extensión del archivo descifrado dentro del paquete ZIP."""
    if tipo_archivo == "video" or formato in ("mp4", "mov", "m4v"):
        return "mp4"
    if tipo_archivo == "imagen" or formato in ("jpg", "jpeg"):
        return "jpg"
    if formato == "png":
        return "png"
    if formato in ("wav", "riff"):
        return "wav"
    if tipo_archivo == "audio" or formato in ("m4a", "aac"):
        return "m4a"
    return formato or "bin"
