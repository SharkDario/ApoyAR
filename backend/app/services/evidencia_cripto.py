# backend/app/services/evidencia_cripto.py
# ─────────────────────────────────────────────────────────────────────────────
# Funciones puras de descifrado en memoria del sobre digital (AES-256-GCM)
# y de resolución de tipo MIME / extensión de los archivos de evidencia.
#
# Estructura del paquete cifrado: [12 bytes IV] + [Ciphertext + 16 bytes Tag].
# La DEK y el IV viajan en `evi_metadata_dispositivo.sobre_digital`.
# ─────────────────────────────────────────────────────────────────────────────

import logging
from typing import Any, Dict, Optional, Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("apoyar.evidencia_cripto")


def obtener_sobre_digital(metadata_dispositivo: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return (metadata_dispositivo or {}).get("sobre_digital") or {}


def descifrar_para_reproduccion(paquete: bytes, sobre_digital: Dict[str, Any]) -> bytes:
    """
    Descifra el paquete para reproducción inline. Sin DEK devuelve el binario tal cual.
    Lanza ValueError / InvalidTag si el paquete no puede descifrarse.
    """
    dek_hex = sobre_digital.get("dek_hex")
    iv_hex = sobre_digital.get("iv_hex")
    if not dek_hex:
        return paquete

    aesgcm = AESGCM(bytes.fromhex(dek_hex))
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
    dek_hex = sobre_digital.get("dek_hex")
    iv_hex = sobre_digital.get("iv_hex")
    descifrado = None
    if not dek_hex:
        descifrado = paquete
    else:
        try:
            aesgcm = AESGCM(bytes.fromhex(dek_hex))
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


def tipo_medio_reproduccion(tipo_archivo: str, formato: str) -> Tuple[str, str]:
    """(media_type, extensión) para servir la evidencia inline en el navegador."""
    if tipo_archivo == "video" or formato in ("mp4", "mov", "m4v"):
        return "video/mp4", formato or "mp4"
    if tipo_archivo == "imagen" or formato in ("jpg", "jpeg"):
        return "image/jpeg", formato or "jpg"
    if formato == "png":
        return "image/png", "png"
    if tipo_archivo == "audio" or formato in ("wav", "riff"):
        return "audio/wav", formato or "wav"
    if formato in ("m4a", "aac"):
        return "audio/mp4", formato or "m4a"
    return "application/octet-stream", formato or "bin"


def extension_exportacion(tipo_archivo: str, formato: str) -> str:
    """Extensión del archivo descifrado dentro del paquete ZIP."""
    if tipo_archivo == "video" or formato in ("mp4", "mov", "m4v"):
        return "mp4"
    if tipo_archivo == "imagen" or formato in ("jpg", "jpeg"):
        return "jpg"
    if formato == "png":
        return "png"
    if tipo_archivo == "audio" or formato in ("m4a", "aac"):
        return "m4a"
    if formato in ("wav", "riff"):
        return "wav"
    return formato or "bin"
