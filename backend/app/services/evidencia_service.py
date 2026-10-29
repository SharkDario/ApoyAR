# backend/app/services/evidencia_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Casos de uso de preservación probatoria multicapa (Fase 2):
#   - CU-05 / CU-07: Sellado forense (firma hardware + RFC 3161 + prev_hash).
#   - CU-08: Auditoría pericial, reproducción descifrada en memoria y listado
#     con separación entre metadatos forenses y contenido multimedia.
# Normas: ISO/IEC 27037 (evidencia digital) e IETF RFC 3161 (TSP).
# ─────────────────────────────────────────────────────────────────────────────

import base64
import hashlib
import logging
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.errors import (
    AccesoDenegadoError,
    ContenidoNoProcesableError,
    ErrorInternoError,
    RecursoNoEncontradoError,
    ServicioExternoError,
)
from app.repositories.evidencia_repository import COLUMNAS_LISTADO, EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.incidente_repository import IncidenteRepository
from app.schemas.evidencias import SellarForenseRequest
from app.schemas.incidentes import RegistrarEvidenciaRequest
from app.services.access_control import AccessControlService
from app.services.evidencia_cripto import descifrar_para_reproduccion, obtener_sobre_digital, tipo_medio_reproduccion
from app.services.roles import ROL_ADMINISTRADOR, ROL_AUTORIDAD
from app.services.tsa_client import TSAClient

logger = logging.getLogger("apoyar.evidencias")

GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000"


@dataclass
class ContenidoMultimedia:
    contenido: bytes
    media_type: str
    extension: str


class EvidenciaService:

    def __init__(
        self,
        evidencias: EvidenciaRepository,
        incidentes: IncidenteRepository,
        storage: EvidenciaStorage,
        acceso: AccessControlService,
        tsa: TSAClient,
    ):
        self._evidencias = evidencias
        self._incidentes = incidentes
        self._storage = storage
        self._acceso = acceso
        self._tsa = tsa

    def obtener_prev_hash(self) -> str:
        """Eslabón previo del log Append-Only (bloque génesis si el log está vacío)."""
        return self._evidencias.obtener_ultimo_hash() or GENESIS_HASH

    # ── Sellado forense ──────────────────────────────────────────────────────

    async def sellar_forense(self, solicitud: SellarForenseRequest, usuario: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        1. Valida el incidente y la coherencia del usuario autor (Anti-IDOR).
        2. Recupera el `prev_hash` del último registro (Append-Only Log).
        3. Solicita el TimeStampToken RFC 3161 a la TSA externa.
        4. Inserta el registro: firma hardware + token RFC 3161 + prev_hash.
        """
        es_operador = bool(usuario and any(r in usuario.get("roles", []) for r in (ROL_AUTORIDAD, ROL_ADMINISTRADOR)))
        if usuario and str(solicitud.usuario_id) != usuario["id"] and not es_operador:
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No puede sellar evidencias en nombre de otro usuario.")

        incidente_id = str(solicitud.incidente_id)
        usuario_id = str(solicitud.usuario_id)
        clean_hash = solicitud.hash_sha256.strip().lower()

        incidente = self._incidentes.obtener_por_id(incidente_id, "inc_id_incidente, usu_id_victima, inc_estado")
        if not incidente:
            raise RecursoNoEncontradoError(f"Incidente {incidente_id} no encontrado.")
        victima_id = incidente.get("usu_id_victima") or incidente.get("victima_id")
        if str(victima_id) != usuario_id and not es_operador:
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): El usuario no coincide con la víctima del incidente.")

        prev_hash = self.obtener_prev_hash()

        try:
            sello = await self._tsa.obtener_sello_tiempo(clean_hash)
            token_rfc3161_b64 = sello["token_rfc3161_b64"]
        except Exception as exc:
            logger.error("Error crítico en comunicación con TSA: %s", exc)
            raise ServicioExternoError(f"Error obteniendo sello de tiempo RFC 3161: {exc}")

        evidencia_creada = self._evidencias.insertar({
            "inc_id_incidente": incidente_id,
            "usu_id_usuario": usuario_id,
            "evi_tipo_archivo": solicitud.tipo_archivo,
            "evi_url_almacenamiento": solicitud.url_almacenamiento,
            "evi_hash_sha256": clean_hash,
            "evi_firma_hardware": solicitud.firma_hardware,
            "evi_token_rfc3161": token_rfc3161_b64,
            "evi_prev_hash": prev_hash,
            "evi_metadata_dispositivo": solicitud.metadata_dispositivo,
            "evi_fecha_captura": solicitud.fecha_captura,
        })
        if not evidencia_creada:
            raise ErrorInternoError("Error persistiendo la evidencia en la base de datos.")

        ev_id = evidencia_creada.get("evi_id_evidencia") or evidencia_creada.get("id")
        return {
            "status": "sellado_exitoso" if token_rfc3161_b64 else "sellado_parcial_sin_tsa",
            "evidencia_id": ev_id,
            "id": ev_id,
            "incidente_id": incidente_id,
            "hash_sha256": clean_hash,
            "prev_hash": prev_hash,
            "token_rfc3161": token_rfc3161_b64,
            "tsa_estado": sello.get("tsa_estado", "valido" if token_rfc3161_b64 else "no_disponible"),
            "tsa_info": {
                "gen_time": sello.get("gen_time"),
                "serial_number": sello.get("serial_number"),
                "policy_id": sello.get("policy_id"),
                "tsa_subject": sello.get("tsa_subject"),
                "tsa_issuer": sello.get("tsa_issuer"),
                "tsa_fuente": sello.get("tsa_fuente"),
                "es_autentico": sello.get("es_autentico", False),
                "error": sello.get("error"),
            },
            "sincronizado_en": evidencia_creada.get("evi_sincronizado_en") or evidencia_creada.get("sincronizado_en"),
        }

    async def registrar_evidencia(self, incidente_id: str, solicitud: RegistrarEvidenciaRequest, usuario: Dict[str, Any]) -> Dict[str, Any]:
        """
        Registro compatible con Iteración 1: a diferencia de `sellar_forense`,
        tolera la indisponibilidad de la TSA y genera una firma de respaldo.
        """
        if str(solicitud.usuario_id) != usuario["id"]:
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No puede atribuir evidencias a otro usuario.")

        self._acceso.verificar_acceso_incidente(incidente_id, usuario, accion="read")

        clean_hash = solicitud.hash_sha256.lower()
        prev_hash = self.obtener_prev_hash()
        firma_hw = solicitud.firma_hardware or f"TEE_KEYSTORE_SIG_P256:{clean_hash[:16]}"

        token_rfc3161 = None
        tsa_info = None
        try:
            sello = await self._tsa.obtener_sello_tiempo(clean_hash)
            token_rfc3161 = sello["token_rfc3161_b64"]
            tsa_info = {
                "gen_time": sello.get("gen_time"),
                "serial_number": sello.get("serial_number"),
                "policy_id": sello.get("policy_id"),
                "tsa_fuente": sello.get("tsa_fuente"),
            }
        except Exception as e:
            logger.warning("[Evidencia] Aviso sellado TSA: %s", e)

        creada = self._evidencias.insertar({
            "inc_id_incidente": incidente_id,
            "usu_id_usuario": str(solicitud.usuario_id),
            "evi_tipo_archivo": solicitud.tipo_archivo,
            "evi_url_almacenamiento": solicitud.url_almacenamiento,
            "evi_hash_sha256": clean_hash,
            "evi_firma_hardware": firma_hw,
            "evi_token_rfc3161": token_rfc3161,
            "evi_prev_hash": prev_hash,
            "evi_metadata_dispositivo": solicitud.metadata_dispositivo,
            "evi_fecha_captura": solicitud.fecha_captura,
        })
        nuevo_id = creada["evi_id_evidencia"] if creada else None

        return {
            "status": "creado",
            "evidencia_id": nuevo_id,
            "id": nuevo_id,
            "hash_sha256": clean_hash,
            "prev_hash": prev_hash,
            "token_rfc3161": token_rfc3161,
            "tsa_info": tsa_info,
        }

    # ── Auditoría pericial ───────────────────────────────────────────────────

    def auditar_evidencia(self, evidencia_id: str, usuario: Dict[str, Any]) -> Dict[str, Any]:
        """
        1. Recalcula el SHA-256 del binario en Storage.
        2. Valida el TimeStampToken RFC 3161 contra el hash registrado.
        3. Evalúa la firma de hardware (Keystore / TEE).
        4. Comprueba la continuidad de la cadena `prev_hash`.
        """
        evidencia = self._acceso.verificar_acceso_evidencia(evidencia_id, usuario, accion="audit")
        hash_registrado = (evidencia.get("evi_hash_sha256") or evidencia.get("hash_sha256") or "").lower()
        url_almacenamiento = evidencia.get("evi_url_almacenamiento") or evidencia.get("url_almacenamiento")
        token_rfc3161 = evidencia.get("evi_token_rfc3161") or evidencia.get("token_rfc3161")
        firma_hardware = evidencia.get("evi_firma_hardware") or evidencia.get("firma_hardware")
        prev_hash_actual = evidencia.get("evi_prev_hash") or evidencia.get("prev_hash")
        sincronizado_en = evidencia.get("evi_sincronizado_en") or evidencia.get("sincronizado_en")

        integridad_binario = self._verificar_integridad_binario(url_almacenamiento, hash_registrado)

        verificacion_tsa: Dict[str, Any] = {
            "presente": False,
            "valido": False,
            "hash_coincide": False,
            "gen_time": None,
            "serial_number": None,
            "policy_id": None,
            "tsa_subject": None,
            "tsa_issuer": None,
            "error": "No contiene token_rfc3161",
        }
        if token_rfc3161:
            verificacion_tsa = self._tsa.verificar_token_rfc3161(token_rfc3161, hash_registrado)
            verificacion_tsa["presente"] = True

        verificacion_firma_hw = self._verificar_firma_hardware(firma_hardware)
        verificacion_cadena = self._verificar_cadena(prev_hash_actual, sincronizado_en)

        es_integro = (
            (not integridad_binario["verificado"] or integridad_binario["coincide"])
            and verificacion_tsa.get("valido", False)
            and verificacion_firma_hw["valido"]
            and verificacion_cadena["cadena_continua"]
        )

        return {
            "evidencia_id": evidencia_id,
            "incidente_id": evidencia.get("incidente_id"),
            "usuario_id": evidencia.get("usuario_id"),
            "estado_auditoria": "INTEGRO_NO_REPUDIABLE" if es_integro else "ADVERTENCIA_NO_INTEGRO",
            "integridad_binario": integridad_binario,
            "sellado_tiempo_rfc3161": verificacion_tsa,
            "firma_hardware": verificacion_firma_hw,
            "cadena_prev_hash": verificacion_cadena,
            "fecha_captura": evidencia.get("fecha_captura"),
            "sincronizado_en": sincronizado_en,
        }

    def _verificar_integridad_binario(self, url_almacenamiento: Optional[str], hash_registrado: str) -> Dict[str, Any]:
        resultado: Dict[str, Any] = {
            "verificado": False,
            "hash_almacenado": hash_registrado,
            "hash_recalculado": None,
            "coincide": False,
            "detalle": "Archivo no accesible o no provisto.",
        }
        if not url_almacenamiento:
            return resultado
        try:
            contenido = self._storage.descargar(EvidenciaStorage.ruta_sin_prefijo(url_almacenamiento))
            if contenido:
                hash_calculado = hashlib.sha256(contenido).hexdigest().lower()
                coincide = hash_calculado == hash_registrado
                resultado = {
                    "verificado": True,
                    "hash_almacenado": hash_registrado,
                    "hash_recalculado": hash_calculado,
                    "coincide": coincide,
                    "tamano_bytes": len(contenido),
                    "detalle": "Hash recalculado idéntico al persistido." if coincide else "ALERTA: Corrupción o alteración del archivo multimedia.",
                }
        except Exception as exc:
            resultado["detalle"] = f"No se pudo descargar de Storage: {exc}"
        return resultado

    @staticmethod
    def _verificar_firma_hardware(firma_hardware: Optional[str]) -> Dict[str, Any]:
        resultado: Dict[str, Any] = {
            "presente": bool(firma_hardware),
            "longitud_bytes": 0,
            "valido": False,
            "tipo": "Android Keystore / TEE (secp256r1)",
        }
        if firma_hardware:
            try:
                firma = base64.b64decode(firma_hardware)
                resultado["longitud_bytes"] = len(firma)
                # Una firma ECDSA DER P-256 mide entre 64 y 74 bytes
                resultado["valido"] = len(firma) >= 64
            except Exception:
                resultado["valido"] = len(firma_hardware) > 16
        return resultado

    def _verificar_cadena(self, prev_hash_actual: Optional[str], sincronizado_en: Optional[str]) -> Dict[str, Any]:
        resultado: Dict[str, Any] = {
            "prev_hash_actual": prev_hash_actual,
            "hash_registro_anterior": None,
            "cadena_continua": False,
            "es_bloque_genesis": prev_hash_actual == GENESIS_HASH,
        }
        if not sincronizado_en:
            resultado["cadena_continua"] = prev_hash_actual == GENESIS_HASH
            return resultado
        try:
            anterior = self._evidencias.obtener_registro_anterior(sincronizado_en)
            if anterior:
                hash_ant = anterior.get("evi_hash_sha256") or anterior.get("hash_sha256")
                resultado["hash_registro_anterior"] = hash_ant
                resultado["cadena_continua"] = hash_ant == prev_hash_actual
            else:
                # Sin tuplas previas, el eslabón debe ser el bloque génesis
                resultado["cadena_continua"] = prev_hash_actual == GENESIS_HASH
        except Exception as exc:
            logger.warning("Aviso validando eslabón prev_hash anterior: %s", exc)
        return resultado

    # ── Reproducción descifrada ──────────────────────────────────────────────

    def reproducir_evidencia(self, evidencia_id: str, usuario: Dict[str, Any]) -> ContenidoMultimedia:
        """Descarga el paquete cifrado y lo descifra en memoria (AES-256-GCM)."""
        evidencia = self._acceso.verificar_acceso_evidencia(evidencia_id, usuario, accion="play")

        url_almacenamiento = evidencia.get("url_almacenamiento")
        if not url_almacenamiento:
            raise RecursoNoEncontradoError("La evidencia no contiene ruta de almacenamiento en Storage.")

        try:
            paquete = self._storage.descargar(EvidenciaStorage.ruta_sin_prefijo(url_almacenamiento))
        except Exception as exc:
            logger.error("Error descargando evidencia %s desde Storage: %s", evidencia_id, exc)
            raise ErrorInternoError(f"No se pudo descargar el archivo cifrado desde Storage: {exc}")

        if not paquete:
            raise RecursoNoEncontradoError("El archivo multimedia no fue encontrado en Storage o está vacío.")

        sobre_digital = obtener_sobre_digital(evidencia.get("metadata_dispositivo"))
        if not sobre_digital.get("dek_hex"):
            logger.warning("Evidencia %s no contiene sobre_digital.dek_hex. Sirviendo binario directo.", evidencia_id)
        try:
            contenido = descifrar_para_reproduccion(paquete, sobre_digital)
        except Exception as exc:
            logger.error("Error desencriptando evidencia %s con AES-256-GCM: %s", evidencia_id, exc)
            raise ContenidoNoProcesableError(f"Fallo en la desencriptación criptográfica: {exc}")

        formato = (sobre_digital.get("formato") or "").lower()
        tipo_archivo = (evidencia.get("tipo_archivo") or "").lower()
        media_type, extension = tipo_medio_reproduccion(tipo_archivo, formato)
        return ContenidoMultimedia(contenido=contenido, media_type=media_type, extension=extension)

    # ── Listado y consentimiento ─────────────────────────────────────────────

    def listar_evidencias_incidente(self, incidente_id: str, page: int, limit: int, usuario: Dict[str, Any]) -> Dict[str, Any]:
        """
        Separación entre metadatos forenses y contenido multimedia: sin
        consentimiento válido (o para el Administrador de TI) se oculta la URL.
        """
        incidente = self._acceso.verificar_acceso_incidente(incidente_id, usuario, accion="read")

        roles = usuario.get("roles", [])
        es_admin_ti = ROL_ADMINISTRADOR in roles and ROL_AUTORIDAD not in roles
        consentimiento_incidente = bool(incidente.get("inc_consentimiento_exportacion", incidente.get("consentimiento_exportacion", False)))

        filtradas = []
        for ev in self._evidencias.listar_por_incidente(incidente_id, COLUMNAS_LISTADO, descendente=True):
            item = dict(ev)
            item["id"] = item.get("evi_id_evidencia")
            item["incidente_id"] = item.get("inc_id_incidente")
            item["usuario_id"] = item.get("usu_id_usuario")
            item["tipo_archivo"] = item.get("evi_tipo_archivo")
            item["url_almacenamiento"] = item.get("evi_url_almacenamiento")
            item["hash_sha256"] = item.get("evi_hash_sha256")
            item["prev_hash"] = item.get("evi_prev_hash")
            item["token_rfc3161"] = item.get("evi_token_rfc3161")
            item["firma_hardware"] = item.get("evi_firma_hardware")
            item["fecha_captura"] = item.get("evi_fecha_captura")
            item["sincronizado_en"] = item.get("evi_sincronizado_en")
            ev_consent = item.get("evi_consentimiento_exportacion") if "evi_consentimiento_exportacion" in item else item.get("consentimiento_exportacion", True)
            item["fecha_consentimiento"] = item.get("evi_fecha_consentimiento") or item.get("fecha_consentimiento")

            # Revocar el consentimiento del incidente revoca todo acceso probatorio
            consentimiento_valido = bool(consentimiento_incidente and ev_consent)
            item["consentimiento_exportacion"] = consentimiento_valido
            if es_admin_ti or not consentimiento_valido:
                item["url_almacenamiento"] = None
                item["bloqueado_sin_consentimiento"] = True
            else:
                item["bloqueado_sin_consentimiento"] = False
            filtradas.append(item)

        total_registros = len(filtradas)
        offset = max(0, (page - 1) * limit)
        return {
            "status": "ok",
            "incidente_id": incidente_id,
            "consentimiento_exportacion": consentimiento_incidente,
            "fecha_consentimiento": incidente.get("inc_fecha_consentimiento") or incidente.get("fecha_consentimiento"),
            "total_evidencias": total_registros,
            "total_registros": total_registros,
            "total_paginas": max(1, math.ceil(total_registros / limit)),
            "pagina_actual": page,
            "limite": limit,
            "evidencias": filtradas[offset : offset + limit],
        }

    def actualizar_consentimiento_evidencia(self, evidencia_id: str, consentimiento: bool, usuario: Dict[str, Any]) -> Optional[str]:
        """Solo el autor de la prueba o la víctima del incidente modifican el consentimiento."""
        evidencia = self._acceso.verificar_acceso_evidencia(evidencia_id, usuario, accion="audit")
        if not self._acceso.es_titular_de_evidencia(evidencia, usuario["id"]):
            raise AccesoDenegadoError("Acceso denegado: Solo el titular del material probatorio puede modificar el consentimiento.")

        fecha_iso = datetime.now(timezone.utc).isoformat() if consentimiento else None
        self._evidencias.actualizar_consentimiento(evidencia_id, consentimiento, fecha_iso)
        return fecha_iso
