# backend/app/services/atestacion_hardware.py
# ─────────────────────────────────────────────────────────────────────────────
# Verificación de la firma de hardware de una evidencia (RF-3.2):
#   1. Comprueba la firma ECDSA P-256 del hash con el certificado del dispositivo.
#   2. Valida la cadena de atestación hasta una raíz oficial de Google.
#   3. Lee el nivel de seguridad declarado por el hardware (TEE o StrongBox).
#
# Las raíces provienen de https://android.googleapis.com/attestation/root.
# ─────────────────────────────────────────────────────────────────────────────

import base64
from pathlib import Path
from typing import Any, Dict, List, Optional

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

OID_ATESTACION_ANDROID = x509.ObjectIdentifier("1.3.6.1.4.1.11129.2.1.17")
RUTA_RAICES_GOOGLE = Path(__file__).with_name("raices_atestacion_google.pem")
NIVELES_SEGURIDAD = {0: "software", 1: "tee", 2: "strongbox"}


def _raices_google() -> List[bytes]:
    certificados = x509.load_pem_x509_certificates(RUTA_RAICES_GOOGLE.read_bytes())
    return [_clave_publica_der(c) for c in certificados]


def _clave_publica_der(certificado: x509.Certificate) -> bytes:
    return certificado.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def _leer_tlv(datos: bytes, inicio: int):
    """Devuelve (etiqueta, inicio_del_valor, longitud) de un elemento DER con etiqueta simple."""
    etiqueta = datos[inicio]
    longitud = datos[inicio + 1]
    posicion = inicio + 2
    if longitud & 0x80:
        cantidad = longitud & 0x7F
        longitud = int.from_bytes(datos[posicion:posicion + cantidad], "big")
        posicion += cantidad
    return etiqueta, posicion, longitud


def nivel_de_atestacion(certificado: x509.Certificate) -> Optional[str]:
    """Lee attestationSecurityLevel de la extensión KeyDescription del certificado."""
    try:
        extension = certificado.extensions.get_extension_for_oid(OID_ATESTACION_ANDROID)
    except x509.ExtensionNotFound:
        return None

    datos = extension.value.value
    _, cuerpo, _ = _leer_tlv(datos, 0)
    _, valor_version, largo_version = _leer_tlv(datos, cuerpo)
    etiqueta, valor_nivel, largo_nivel = _leer_tlv(datos, valor_version + largo_version)
    if etiqueta != 0x0A:  # ENUMERATED
        return None
    return NIVELES_SEGURIDAD.get(int.from_bytes(datos[valor_nivel:valor_nivel + largo_nivel], "big"))


def _cadena_hasta_raiz_google(cadena: List[x509.Certificate]) -> bool:
    for certificado, emisor in zip(cadena, cadena[1:]):
        try:
            certificado.verify_directly_issued_by(emisor)
        except (InvalidSignature, ValueError, TypeError):
            return False
    return _clave_publica_der(cadena[-1]) in _raices_google()


def verificar_firma_evidencia(
    firma_b64: Optional[str],
    hash_hex: str,
    datos_firma: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    `valido` sólo es True si la firma coincide con el hash, la cadena llega a una raíz
    de Google y la clave vive en TEE o StrongBox. Sin certificados no hay nada que
    verificar, como ocurre con las evidencias anteriores a RF-3.2.
    """
    resultado: Dict[str, Any] = {
        "presente": bool(firma_b64),
        "longitud_bytes": 0,
        "valido": False,
        "tipo": "Android Keystore (ECDSA secp256r1)",
        "firma_verificada": False,
        "cadena_verificada": False,
        "nivel_seguridad": None,
        "detalle": "La evidencia no incluye certificados del dispositivo; la firma no es verificable.",
    }
    certificados_b64 = (datos_firma or {}).get("cadena_certificados_b64") or []
    if not firma_b64 or not certificados_b64:
        return resultado

    try:
        firma = base64.b64decode(firma_b64)
        resultado["longitud_bytes"] = len(firma)
        cadena = [x509.load_der_x509_certificate(base64.b64decode(c)) for c in certificados_b64]
        hoja = cadena[0]

        hoja.public_key().verify(firma, bytes.fromhex(hash_hex), ec.ECDSA(hashes.SHA256()))
        resultado["firma_verificada"] = True
        resultado["cadena_verificada"] = _cadena_hasta_raiz_google(cadena)
        resultado["nivel_seguridad"] = nivel_de_atestacion(hoja)
        resultado["valido"] = resultado["cadena_verificada"] and resultado["nivel_seguridad"] in ("tee", "strongbox")
        resultado["detalle"] = (
            "Firma verificada con clave atestada por hardware."
            if resultado["valido"]
            else "La firma coincide, pero la clave no está atestada por hardware seguro reconocido."
        )
    except InvalidSignature:
        resultado["detalle"] = "La firma no corresponde al hash registrado."
    except (ValueError, TypeError, AttributeError, IndexError) as exc:
        resultado["detalle"] = f"No se pudo interpretar la firma o sus certificados: {exc}"
    return resultado
