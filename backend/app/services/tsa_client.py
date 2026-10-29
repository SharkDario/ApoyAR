# backend/app/services/tsa_client.py
# ─────────────────────────────────────────────────────────────────────────────
# Módulo de Sellado de Tiempo Confiable bajo estándar IETF RFC 3161 (TSP).
# Implementa el patrón Adapter (RNF-09) para interactuar con Autoridades de
# Sellado de Tiempo (TSA) externas e independientes (ej. FreeTSA, DigiCert,
# o Autoridades Certificantes de firma digital bajo Ley 25.506).
# ─────────────────────────────────────────────────────────────────────────────

import base64
import datetime
import hashlib
import random
import re
import logging
from typing import Any, Dict, Optional

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pyasn1.codec.der import decoder, encoder
from pyasn1.type import tag, univ, useful
from pyasn1_modules import rfc2459, rfc3161, rfc5280, rfc5652

from app.config import settings

logger = logging.getLogger("apoyar.tsa")

# OID estándar para SHA-256 en ASN.1 (NIST id-sha256)
OID_SHA256 = univ.ObjectIdentifier("2.16.840.1.101.3.4.2.1")
# OID para CMS id-signedData
OID_SIGNED_DATA = univ.ObjectIdentifier("1.2.840.113549.1.7.2")
# OID para id-ct-TSTInfo (encapsulated content RFC 3161)
OID_CT_TST_INFO = univ.ObjectIdentifier("1.2.840.113549.1.9.16.1.4")
# OID de política de prueba/contingencia
OID_POLICY_FALLBACK = univ.ObjectIdentifier("1.3.6.1.4.1.99999.1")


def _parse_generalized_time(gt_str: str) -> str:
    """Convierte un GeneralizedTime ASN.1 (ej. '20261019203104Z') a ISO-8601 UTC."""
    raw = str(gt_str).strip()
    if raw.endswith("Z"):
        raw_clean = raw[:-1]
    else:
        raw_clean = raw

    if "." in raw_clean:
        dt = datetime.datetime.strptime(raw_clean, "%Y%m%d%H%M%S.%f")
    else:
        dt = datetime.datetime.strptime(raw_clean, "%Y%m%d%H%M%S")

    dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.isoformat()


class TSAClient:
    """
    Cliente de Sellado de Tiempo compatible con IETF RFC 3161.
    Soporta emisión, deserialización DER y validación pericial de tokens CMS.
    """

    def __init__(self, tsa_url: Optional[str] = None, timeout_seconds: Optional[float] = None):
        self.tsa_url = tsa_url or settings.tsa_url
        self.timeout_seconds = timeout_seconds or settings.tsa_timeout_seconds

    def _crear_peticion_der(self, hash_sha256: str) -> tuple[bytes, int]:
        """
        Construye la estructura ASN.1 TimeStampReq con el hash SHA-256 y un nonce aleatorio.
        """
        hash_bytes = bytes.fromhex(hash_sha256)
        if len(hash_bytes) != 32:
            raise ValueError("El hash debe ser SHA-256 de 32 bytes (64 caracteres hexadecimales).")

        nonce = random.getrandbits(64)

        req = rfc3161.TimeStampReq()
        req["version"] = 1

        imprint = rfc3161.MessageImprint()
        imprint["hashAlgorithm"] = rfc5280.AlgorithmIdentifier()
        imprint["hashAlgorithm"]["algorithm"] = OID_SHA256
        imprint["hashedMessage"] = hash_bytes
        req["messageImprint"] = imprint

        req["nonce"] = nonce
        req["certReq"] = True

        return encoder.encode(req), nonce

    def _crear_token_fallback(self, hash_sha256: str, nonce: int) -> bytes:
        """
        Genera un TimeStampToken criptográfico ASN.1 local de contingencia en caso
        de indisponibilidad total de la red o entorno air-gapped de pruebas.
        """
        logger.warning("Generando sello RFC 3161 local de contingencia (Fallback TSA).")
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        gt_str = now_utc.strftime("%Y%m%d%H%M%SZ")

        tst_info = rfc3161.TSTInfo()
        tst_info["version"] = 1
        tst_info["policy"] = OID_POLICY_FALLBACK

        imprint = rfc3161.MessageImprint()
        imprint["hashAlgorithm"] = rfc5280.AlgorithmIdentifier()
        imprint["hashAlgorithm"]["algorithm"] = OID_SHA256
        imprint["hashedMessage"] = bytes.fromhex(hash_sha256)
        tst_info["messageImprint"] = imprint

        tst_info["serialNumber"] = random.getrandbits(32)
        tst_info["genTime"] = useful.GeneralizedTime(gt_str)
        tst_info["nonce"] = nonce

        econtent_der = encoder.encode(tst_info)

        signed_data = rfc5652.SignedData()
        signed_data["version"] = 3
        signed_data["digestAlgorithms"] = rfc5652.DigestAlgorithmIdentifiers()
        signed_data["encapContentInfo"] = rfc5652.EncapsulatedContentInfo()
        signed_data["encapContentInfo"]["eContentType"] = OID_CT_TST_INFO
        target_econtent = signed_data["encapContentInfo"].getComponentByName("eContent")
        signed_data["encapContentInfo"]["eContent"] = target_econtent.clone(value=econtent_der)
        signed_data["signerInfos"] = rfc5652.SignerInfos()

        content_info = rfc5652.ContentInfo()
        content_info["contentType"] = OID_SIGNED_DATA
        target_content = content_info.getComponentByName("content")
        content_info["content"] = target_content.clone(value=encoder.encode(signed_data))

        return encoder.encode(content_info)

    async def obtener_sello_tiempo(self, hash_sha256: str) -> Dict[str, Any]:
        """
        Emite una solicitud RFC 3161 a la TSA externa para el hash suministrado.
        Retorna los metadatos forenses estructurados y el token en Base64.
        
        Tratamiento veraz: Si la TSA externa no responde o falla, no se generan tokens
        sintéticos ni se simula autenticidad. Se registra honestamente como 'no_disponible'.
        """
        clean_hash = hash_sha256.strip().lower()
        if not re.fullmatch(r"^[a-f0-9]{64}$", clean_hash):
            raise ValueError(f"Hash SHA-256 inválido: '{hash_sha256}'. Se requieren 64 hexadecimales.")

        der_req, nonce = self._crear_peticion_der(clean_hash)
        token_der: Optional[bytes] = None
        tsa_fuente = self.tsa_url
        tsa_error: Optional[str] = None

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    self.tsa_url,
                    content=der_req,
                    headers={
                        "Content-Type": "application/timestamp-query",
                        "Accept": "application/timestamp-reply",
                    },
                )

                if response.status_code == 200:
                    ts_resp, _ = decoder.decode(response.content, asn1Spec=rfc3161.TimeStampResp())
                    pki_status = int(ts_resp["status"]["status"])
                    if pki_status not in (0, 1):  # 0: granted, 1: grantedWithMods
                        raise RuntimeError(f"La TSA rechazó la solicitud con código: {pki_status}")

                    token = ts_resp["timeStampToken"]
                    token_der = encoder.encode(token)
                else:
                    tsa_error = f"TSA externa respondió con HTTP {response.status_code}"
                    logger.warning(
                        "TSA externa respondió con HTTP %s. No se genera token sintético (tratamiento veraz).",
                        response.status_code,
                    )
        except (httpx.RequestError, httpx.TimeoutException, Exception) as exc:
            tsa_error = f"{type(exc).__name__}: {exc}"
            logger.warning(
                "No se pudo contactar a la TSA externa (%s: %s). Tratamiento veraz: registrando indisponibilidad.",
                type(exc).__name__,
                exc,
            )

        # Si se obtuvo el token legítimo de la TSA externa
        if token_der is not None:
            info_verificacion = self.verificar_token_rfc3161(
                base64.b64encode(token_der).decode("ascii"),
                clean_hash,
            )
            return {
                "tsa_estado": "valido" if info_verificacion.get("valido", False) else "error_validacion",
                "token_rfc3161_b64": base64.b64encode(token_der).decode("ascii"),
                "gen_time": info_verificacion.get("gen_time"),
                "serial_number": info_verificacion.get("serial_number"),
                "policy_id": info_verificacion.get("policy_id"),
                "tsa_subject": info_verificacion.get("tsa_subject"),
                "tsa_issuer": info_verificacion.get("tsa_issuer"),
                "hash_sha256": clean_hash,
                "nonce": nonce,
                "tsa_fuente": tsa_fuente,
                "es_autentico": info_verificacion.get("valido", False),
                "error": info_verificacion.get("error"),
            }

        # Contingencia veraz: no se finge un sello RFC 3161 válido
        return {
            "tsa_estado": "no_disponible",
            "token_rfc3161_b64": None,
            "gen_time": None,
            "serial_number": None,
            "policy_id": None,
            "tsa_subject": None,
            "tsa_issuer": None,
            "hash_sha256": clean_hash,
            "nonce": nonce,
            "tsa_fuente": tsa_fuente,
            "es_autentico": False,
            "error": tsa_error or "TSA externa no disponible.",
        }

    def verificar_token_rfc3161(self, token_b64: str, hash_sha256_esperado: str) -> Dict[str, Any]:
        """
        Inspecciona y valida un TimeStampToken codificado en Base64.
        Contrasta la huella digest sellada contra el hash esperado y extrae los datos de auditoría.
        """
        try:
            token_der = base64.b64decode(token_b64)
            content_info, _ = decoder.decode(token_der, asn1Spec=rfc5652.ContentInfo())

            # El contenido es SignedData
            raw_content = bytes(content_info["content"])
            signed_data, _ = decoder.decode(raw_content, asn1Spec=rfc5652.SignedData())

            # Extraer eContent que contiene el TSTInfo
            econtent = signed_data["encapContentInfo"]["eContent"]
            tst_info, _ = decoder.decode(econtent.asOctets(), asn1Spec=rfc3161.TSTInfo())

            policy_id = str(tst_info["policy"])
            serial_number = str(int(tst_info["serialNumber"]))
            gen_time = _parse_generalized_time(str(tst_info["genTime"]))

            # Extraer el hash encapsulado en messageImprint
            imprint_bytes = bytes(tst_info["messageImprint"]["hashedMessage"])
            hash_encapsulado = imprint_bytes.hex().lower()

            hash_esperado_clean = hash_sha256_esperado.strip().lower()
            hash_coincide = hash_encapsulado == hash_esperado_clean

            # Extraer certificados de la TSA si están adjuntos
            tsa_subject = "No adjunto"
            tsa_issuer = "No adjunto"
            certs = signed_data["certificates"]
            if certs is not None and certs.hasValue():
                for c in certs:
                    try:
                        c_der = encoder.encode(c.getComponent())
                        cert_obj = x509.load_der_x509_certificate(c_der)
                        tsa_subject = cert_obj.subject.rfc4514_string()
                        tsa_issuer = cert_obj.issuer.rfc4514_string()
                        break
                    except Exception:
                        continue

            return {
                "valido": hash_coincide,
                "hash_coincide": hash_coincide,
                "hash_sellado": hash_encapsulado,
                "hash_esperado": hash_esperado_clean,
                "gen_time": gen_time,
                "serial_number": serial_number,
                "policy_id": policy_id,
                "tsa_subject": tsa_subject,
                "tsa_issuer": tsa_issuer,
                "error": None if hash_coincide else "El hash sellado no coincide con el digest esperado.",
            }
        except Exception as exc:
            return {
                "valido": False,
                "hash_coincide": False,
                "hash_sellado": None,
                "hash_esperado": hash_sha256_esperado,
                "gen_time": None,
                "serial_number": None,
                "policy_id": None,
                "tsa_subject": None,
                "tsa_issuer": None,
                "error": f"Error decodificando estructura ASN.1 del TimeStampToken: {exc}",
            }


# Instancia única del cliente TSA
tsa_client = TSAClient()
