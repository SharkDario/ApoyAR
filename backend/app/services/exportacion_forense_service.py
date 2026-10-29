# backend/app/services/exportacion_forense_service.py
# ─────────────────────────────────────────────────────────────────────────────
# CU-08: Exportación judicial de evidencia (Ley 25.326 / ISO 27037).
#   - Paquete ZIP del incidente (acta PDF, manifiesto, multimedia descifrada,
#     tokens RFC 3161) con registro en `reporte_judicial` y `exportacion_evidencia`.
#   - Acta PDF de cadena de custodia del incidente.
#   - Paquete ZIP de una evidencia individual.
# ─────────────────────────────────────────────────────────────────────────────

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.errors import AccesoDenegadoError, RecursoNoEncontradoError
from app.repositories.auditoria_exportacion_repository import AuditoriaExportacionRepository
from app.repositories.cargo_institucional_repository import (
    COLUMNAS_ADSCRIPCION_COMPLETA,
    COLUMNAS_ADSCRIPCION_INDIVIDUAL,
    COLUMNAS_ADSCRIPCION_INFORME,
    CargoInstitucionalRepository,
)
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.services.access_control import AccessControlService
from app.services.evidencia_cripto import descifrar_para_exportacion, extension_exportacion, obtener_sobre_digital
from app.services.export_service import ExportService
from app.services.pdf_generator import generar_informe_tecnico_pdf
from app.services.roles import ROL_ADMINISTRADOR, ROL_AUTORIDAD, rol_actor_auditoria

logger = logging.getLogger("apoyar.exportacion")

MOTIVO_TITULAR = "Descarga y preservación personal de prueba pericial propia bajo soberanía criptográfica"
DESTINO_TITULAR = "Dispositivo personal y repositorio soberano de la titular"
COLUMNAS_INCIDENTE_EXPORTACION = (
    "inc_id_incidente, usu_id_victima, inc_estado, inc_fecha_hora, inc_latitud, inc_longitud, inc_direccion, "
    "inc_direccion_aprox, inc_origen, inc_consentimiento_exportacion, inc_fecha_consentimiento, inc_victima_nombre"
)
COLUMNAS_INCIDENTE_INFORME = "inc_id_incidente, usu_id_victima, inc_estado, inc_fecha_hora, inc_consentimiento_exportacion, inc_fecha_consentimiento"


@dataclass
class ArchivoExportado:
    contenido: bytes
    nombre_archivo: str
    hash_manifiesto: Optional[str] = None


@dataclass
class Adscripcion:
    cargo: str
    sede: str
    legajo: str
    institucion: str = "Poder Judicial de Formosa / Policía Provincial"
    dependencia: str = "Oficina de Violencia Intrafamiliar / Comisaría"


def _nombre_completo(persona: Dict[str, Any]) -> str:
    return f"{persona.get('per_nombre', '') or persona.get('nombre', '')} {persona.get('per_apellido', '') or persona.get('apellido', '')}".strip()


class ExportacionForenseService:

    def __init__(
        self,
        incidentes: IncidenteRepository,
        evidencias: EvidenciaRepository,
        usuarios: UsuarioRepository,
        cargos: CargoInstitucionalRepository,
        auditoria: AuditoriaExportacionRepository,
        storage: EvidenciaStorage,
        acceso: AccessControlService,
        empaquetador: ExportService,
    ):
        self._incidentes = incidentes
        self._evidencias = evidencias
        self._usuarios = usuarios
        self._cargos = cargos
        self._auditoria = auditoria
        self._storage = storage
        self._acceso = acceso
        self._empaquetador = empaquetador

    # ── Paquete ZIP del incidente ────────────────────────────────────────────

    def exportar_incidente(
        self,
        incidente_id: str,
        destino_declarado: str,
        justificacion: str,
        usuario: Dict[str, Any],
        origen_exportacion: Optional[str] = None,
    ) -> ArchivoExportado:
        roles = usuario.get("roles", [])
        user_id = str(usuario["id"])

        es_autoridad = (ROL_AUTORIDAD in roles) or self._acceso.tiene_cargo_activo(user_id)
        if (ROL_ADMINISTRADOR in roles) and not es_autoridad:
            raise AccesoDenegadoError("Acceso denegado: El perfil Administrador (IT) puro tiene vedada la exportación de material probatorio y multimedia de las víctimas.")

        incidente = self._incidentes.obtener_por_id(incidente_id, COLUMNAS_INCIDENTE_EXPORTACION)
        if not incidente:
            raise RecursoNoEncontradoError("Incidente no encontrado.")
        self._alias_incidente_exportacion(incidente)

        es_victima = str(incidente.get("victima_id")) == user_id
        if not es_autoridad and not es_victima:
            raise AccesoDenegadoError("Acceso denegado: No posee permisos de Autoridad judicial o policial ni es la persona titular.")
        if es_autoridad and not es_victima and not bool(incidente.get("consentimiento_exportacion")):
            raise AccesoDenegadoError("Acceso denegado: La víctima o testigo no ha otorgado el consentimiento informado para la exportación judicial de este incidente (Ley 25.326 / ISO 27037).")

        solicitante_nombre, solicitante_dni = self._datos_persona(user_id, usuario.get("email", "Usuario Autenticado"), "solicitante")
        victima_nombre, victima_dni = incidente.get("victima_nombre"), "N/D"
        if incidente.get("victima_id"):
            victima_nombre, victima_dni = self._datos_victima(str(incidente.get("victima_id")), victima_nombre)

        adscripcion = self._adscripcion_completa(user_id, es_victima)
        evidencias = self._evidencias_para_exportacion(incidente_id)
        archivos_binarios = self._descifrar_archivos(evidencias)

        es_exportacion_titular = (origen_exportacion == "titular") or (es_victima and origen_exportacion != "autoridad")
        motivo = MOTIVO_TITULAR if es_exportacion_titular else justificacion
        destino = DESTINO_TITULAR if es_exportacion_titular else destino_declarado

        contexto = {
            "incidente_id": incidente_id,
            "fecha_hora": incidente.get("fecha_hora"),
            "estado": incidente.get("estado"),
            "origen": incidente.get("origen"),
            "direccion": incidente.get("direccion") or incidente.get("direccion_aprox"),
            "latitud": incidente.get("latitud"),
            "longitud": incidente.get("longitud"),
            "victima_id": incidente.get("victima_id"),
            "victima_nombre": victima_nombre,
            "victima_dni": victima_dni,
            "es_victima": es_victima,
            "es_exportacion_titular": es_exportacion_titular,
            "solicitante_id": user_id,
            "solicitante_nombre": victima_nombre if es_exportacion_titular else solicitante_nombre,
            "solicitante_email": usuario.get("email", "Usuario Autenticado"),
            "solicitante_dni": victima_dni if es_exportacion_titular else solicitante_dni,
            "solicitante_cargo": None if es_exportacion_titular else adscripcion.cargo,
            "solicitante_sede": None if es_exportacion_titular else adscripcion.sede,
            "solicitante_institucion": None if es_exportacion_titular else adscripcion.institucion,
            "solicitante_dependencia": None if es_exportacion_titular else adscripcion.dependencia,
            "solicitante_legajo": None if es_exportacion_titular else adscripcion.legajo,
            "motivo_exportacion": motivo,
            "destino_declarado": destino,
            "fecha_consentimiento": incidente.get("fecha_consentimiento"),
            "consentimiento_info": f"Otorgado el {incidente.get('fecha_consentimiento') or 'Previamente registrado'} (Ley 25.326)",
        }

        zip_bytes, hash_manifiesto = self._empaquetador.generar_paquete_zip(contexto, evidencias, archivos_binarios)
        ahora_iso = datetime.now(timezone.utc).isoformat()

        try:
            self._auditoria.registrar_reporte_judicial({
                "inc_id_incidente": incidente_id,
                "usu_id_generado_por": user_id,
                "repjud_url_documento": f"reportes/judicial_{incidente_id[:8]}_{secrets.token_hex(4)}.zip",
                "repjud_hash_documento": hash_manifiesto,
                "repjud_fecha_generacion": ahora_iso,
                "repjud_legajo_snapshot": None if es_exportacion_titular else adscripcion.legajo,
                "repjud_cargo_snapshot": None if es_exportacion_titular else adscripcion.cargo,
                "repjud_sede_snapshot": None if es_exportacion_titular else adscripcion.sede,
                "repjud_justificacion": motivo,
                "repjud_destino_declarado": destino,
            })
        except Exception as r_exc:
            logger.warning("Aviso registrando reporte_judicial: %s", r_exc)

        try:
            self._auditoria.registrar_exportacion({
                "expevi_tipo_exportacion": "incidente",
                "evi_id_evidencia": None,
                "usu_id_solicitado_por": user_id,
                "expevi_rol_actor": "Titular (Víctima)" if es_exportacion_titular else rol_actor_auditoria(roles, "Autoridad"),
                "expevi_destino_declarado": destino,
                "expevi_justificacion": motivo,
                "expevi_hash_manifiesto": hash_manifiesto,
                "expevi_cantidad_archivos": len(evidencias),
            })
        except Exception as exc:
            logger.error("Error registrando auditoría de exportación: %s", exc)

        return ArchivoExportado(
            contenido=zip_bytes,
            nombre_archivo=f"Expediente_Forense_ApoyAR_{incidente_id[:8]}.zip",
            hash_manifiesto=hash_manifiesto,
        )

    @staticmethod
    def _alias_incidente_exportacion(incidente: Dict[str, Any]) -> None:
        incidente["id"] = incidente.get("inc_id_incidente")
        incidente["victima_id"] = incidente.get("usu_id_victima")
        incidente["estado"] = incidente.get("inc_estado")
        incidente["fecha_hora"] = incidente.get("inc_fecha_hora")
        incidente["latitud"] = incidente.get("inc_latitud")
        incidente["longitud"] = incidente.get("inc_longitud")
        incidente["direccion"] = incidente.get("inc_direccion")
        incidente["direccion_aprox"] = incidente.get("inc_direccion_aprox")
        incidente["origen"] = incidente.get("inc_origen")
        incidente["consentimiento_exportacion"] = incidente.get("inc_consentimiento_exportacion")
        incidente["fecha_consentimiento"] = incidente.get("inc_fecha_consentimiento")
        incidente["victima_nombre"] = incidente.get("inc_victima_nombre")

    def _datos_persona(self, usuario_id: str, nombre_por_defecto: str, etiqueta: str) -> Tuple[str, str]:
        nombre, dni = nombre_por_defecto, "N/D"
        try:
            persona = self._usuarios.obtener_persona(usuario_id, "per_nombre, per_apellido, per_dni")
            if persona:
                nombre = _nombre_completo(persona) or nombre
                dni = persona.get("per_dni") or persona.get("dni") or "N/D"
        except Exception as err:
            logger.warning("Aviso obteniendo persona del %s: %s", etiqueta, err)
        return nombre, dni

    def _datos_victima(self, victima_id: str, nombre_registrado: Optional[str]) -> Tuple[Optional[str], str]:
        nombre, dni = nombre_registrado, "N/D"
        try:
            persona = self._usuarios.obtener_persona(victima_id, "per_nombre, per_apellido, per_dni")
            if persona:
                if not nombre:
                    nombre = _nombre_completo(persona)
                dni = persona.get("per_dni") or persona.get("dni") or "N/D"
        except Exception as err:
            logger.warning("Aviso obteniendo persona de la víctima: %s", err)
        return nombre, dni

    def _adscripcion_completa(self, usuario_id: str, es_victima: bool) -> Adscripcion:
        adscripcion = Adscripcion(
            cargo="Titular de los Datos Personales (Soberanía Ciudadana)" if es_victima else "Personal Policial / Judicial Autorizado",
            sede="Dispositivo Personal Soberano" if es_victima else "Dependencia Jurisdiccional",
            legajo="N/D",
        )
        try:
            c_info = self._cargos.obtener_adscripcion(usuario_id, COLUMNAS_ADSCRIPCION_COMPLETA)
            if c_info:
                adscripcion.legajo = c_info.get("carins_legajo_o_matricula") or c_info.get("legajo_o_matricula") or adscripcion.legajo
                adscripcion.cargo = (c_info.get("cargo") or {}).get("car_nombre_cargo") or (c_info.get("cargo") or {}).get("nombre_cargo") or adscripcion.cargo
                sede_obj = c_info.get("sede") or {}
                s_nom = sede_obj.get("sed_nombre_sede") or sede_obj.get("nombre_sede", "")
                s_dir = sede_obj.get("sed_direccion") or sede_obj.get("direccion", "")
                if s_nom:
                    adscripcion.sede = f"{s_nom} ({s_dir})".strip()
                dep_obj = sede_obj.get("dependencia") or {}
                d_nom = dep_obj.get("dep_nombre") or dep_obj.get("nombre")
                if d_nom:
                    adscripcion.dependencia = d_nom
                inst_obj = dep_obj.get("institucion") or {}
                i_nom = inst_obj.get("ins_nombre") or inst_obj.get("nombre")
                if i_nom:
                    adscripcion.institucion = i_nom
        except Exception as exc:
            logger.warning("Aviso obteniendo adscripción de autoridad: %s", exc)
        return adscripcion

    def _evidencias_para_exportacion(self, incidente_id: str) -> List[Dict[str, Any]]:
        evidencias = self._evidencias.listar_por_incidente(incidente_id, "*", descendente=False)
        for ev in evidencias:
            ev["id"] = ev.get("evi_id_evidencia") or ev.get("id")
            ev["tipo_archivo"] = ev.get("evi_tipo_archivo") or ev.get("tipo_archivo")
            ev["url_almacenamiento"] = ev.get("evi_url_almacenamiento") or ev.get("url_almacenamiento")
            ev["hash_sha256"] = ev.get("evi_hash_sha256") or ev.get("hash_sha256")
            ev["prev_hash"] = ev.get("evi_prev_hash") or ev.get("prev_hash")
            ev["token_rfc3161"] = ev.get("evi_token_rfc3161") or ev.get("token_rfc3161")
            ev["firma_hardware"] = ev.get("evi_firma_hardware") or ev.get("firma_hardware")
            ev["metadata_dispositivo"] = ev.get("evi_metadata_dispositivo") or ev.get("metadata_dispositivo")
            ev["fecha_captura"] = ev.get("evi_fecha_captura") or ev.get("fecha_captura")
            ev["sincronizado_en"] = ev.get("evi_sincronizado_en") or ev.get("sincronizado_en")
            ev["incidente_id"] = ev.get("inc_id_incidente") or ev.get("incidente_id")
            ev["usuario_id"] = ev.get("usu_id_usuario") or ev.get("usuario_id")
        return evidencias

    def _descifrar_archivos(self, evidencias: List[Dict[str, Any]]) -> Dict[str, bytes]:
        """Descarga y descifra en memoria cada archivo multimedia para adjuntarlo al ZIP."""
        archivos: Dict[str, bytes] = {}
        for idx, ev in enumerate(evidencias, start=1):
            try:
                ruta = EvidenciaStorage.ruta_relativa(ev.get("url_almacenamiento") or "")
                if not ruta:
                    continue
                paquete = self._storage.descargar(ruta)
                if not paquete:
                    continue

                sobre_digital = obtener_sobre_digital(ev.get("metadata_dispositivo"))
                formato = (sobre_digital.get("formato") or "").lower()
                tipo_archivo = (ev.get("tipo_archivo") or "audio").lower()
                tipo_label = "Fotografia" if tipo_archivo == "imagen" else ("Video" if tipo_archivo == "video" else "Audio")

                descifrado = descifrar_para_exportacion(paquete, sobre_digital, ev.get("id"))

                hash_esperado = sobre_digital.get("hash_audio_plano")
                hash_calculado = hashlib.sha256(descifrado).hexdigest()
                if hash_esperado and hash_esperado != hash_calculado:
                    logger.warning("Discrepancia de SHA-256 en evidencia %s (esperado: %s, obtenido: %s)", ev.get("id"), hash_esperado, hash_calculado)

                ext = extension_exportacion(tipo_archivo, formato)
                archivos[f"Segmento_{idx}_{tipo_label}_{str(ev.get('id'))[:8]}.{ext}"] = descifrado
            except Exception as dec_err:
                logger.warning("Aviso procesando evidencia %s para exportación: %s", ev.get("id"), dec_err)
        return archivos

    # ── Acta PDF del incidente ───────────────────────────────────────────────

    def generar_informe_pdf(self, incidente_id: str, usuario: Dict[str, Any]) -> ArchivoExportado:
        user_id = str(usuario["id"])
        roles = usuario.get("roles", [])

        incidente = self._incidentes.obtener_por_id(incidente_id, COLUMNAS_INCIDENTE_INFORME)
        if not incidente:
            raise RecursoNoEncontradoError("Incidente no encontrado.")
        incidente["id"] = incidente.get("inc_id_incidente")
        incidente["victima_id"] = incidente.get("usu_id_victima")
        incidente["estado"] = incidente.get("inc_estado")
        incidente["fecha_hora"] = incidente.get("inc_fecha_hora")
        incidente["consentimiento_exportacion"] = incidente.get("inc_consentimiento_exportacion")
        incidente["fecha_consentimiento"] = incidente.get("inc_fecha_consentimiento")

        es_victima = str(incidente.get("usu_id_victima")) == user_id
        if not es_victima:
            if not (ROL_AUTORIDAD in roles or self._acceso.tiene_cargo_activo(user_id)):
                raise AccesoDenegadoError("Acceso denegado: Se requiere rol de Autoridad.")
            if not bool(incidente.get("inc_consentimiento_exportacion")):
                raise AccesoDenegadoError("Acceso denegado: Se requiere consentimiento informado de la víctima (Ley 25.326).")

        cargo = "Titular de los Datos Personales (Soberanía Ciudadana)" if es_victima else "Personal Policial / Judicial Autorizado"
        sede = "Dispositivo Personal Soberano" if es_victima else "Dependencia Jurisdiccional"
        legajo = "N/D"
        try:
            c_info = self._cargos.obtener_adscripcion(user_id, COLUMNAS_ADSCRIPCION_INFORME)
            if c_info:
                legajo = c_info.get("carins_legajo_o_matricula") or c_info.get("legajo_o_matricula") or "N/D"
                cargo_obj = c_info.get("cargo") or {}
                cargo = cargo_obj.get("car_nombre_cargo") or cargo_obj.get("nombre_cargo") or "Oficial de Guardia en Comisaría"
                sede_obj = c_info.get("sede") or {}
                sede = f"{sede_obj.get('sed_nombre_sede') or sede_obj.get('nombre_sede', '')} ({sede_obj.get('sed_direccion') or sede_obj.get('direccion', '')})"
        except Exception:
            pass

        evidencias = [self._alias_evidencia_informe(ev) for ev in self._evidencias.listar_por_incidente(incidente_id, "*", descendente=False)]
        fecha_consentimiento = incidente.get("inc_fecha_consentimiento") or incidente.get("fecha_consentimiento")
        contexto = {
            "incidente_id": incidente_id,
            "solicitante_id": user_id,
            "solicitante_email": usuario.get("email", "Usuario Autenticado"),
            "solicitante_cargo": cargo,
            "solicitante_sede": sede,
            "solicitante_legajo": legajo,
            "motivo_exportacion": "Certificación probatoria oficial de integridad y cadena de custodia",
            "destino_declarado": "Tribunales / Autoridades Jurisdiccionales",
            "fecha_consentimiento": fecha_consentimiento,
            "consentimiento_info": f"Otorgado el {fecha_consentimiento or 'Previamente registrado'} (Ley 25.326)",
        }
        return ArchivoExportado(
            contenido=generar_informe_tecnico_pdf(contexto, evidencias),
            nombre_archivo=f"informe_cadena_custodia_{incidente_id[:8]}.pdf",
        )

    @staticmethod
    def _alias_evidencia_informe(ev: Dict[str, Any]) -> Dict[str, Any]:
        copia = dict(ev)
        copia["id"] = ev.get("evi_id_evidencia") or ev.get("id")
        copia["incidente_id"] = ev.get("inc_id_incidente") or ev.get("incidente_id")
        copia["usuario_id"] = ev.get("usu_id_usuario") or ev.get("usuario_id")
        copia["asociado_por"] = ev.get("usu_id_asociado_por") or ev.get("asociado_por")
        copia["tipo_archivo"] = ev.get("evi_tipo_archivo") or ev.get("tipo_archivo")
        copia["url_almacenamiento"] = ev.get("evi_url_almacenamiento") or ev.get("url_almacenamiento")
        copia["hash_sha256"] = ev.get("evi_hash_sha256") or ev.get("hash_sha256")
        copia["hash_cifrado"] = ev.get("evi_hash_cifrado") or ev.get("hash_cifrado")
        copia["firma_hardware"] = ev.get("evi_firma_hardware") or ev.get("firma_hardware")
        copia["token_rfc3161"] = ev.get("evi_token_rfc3161") or ev.get("token_rfc3161")
        copia["tsa_estado"] = ev.get("evi_tsa_estado") or ev.get("tsa_estado")
        copia["origen_captura"] = ev.get("evi_origen_captura") or ev.get("origen_captura")
        copia["prev_hash"] = ev.get("evi_prev_hash") or ev.get("prev_hash")
        copia["consentimiento_exportacion"] = ev.get("evi_consentimiento_exportacion") if "evi_consentimiento_exportacion" in ev else ev.get("consentimiento_exportacion")
        copia["fecha_consentimiento"] = ev.get("evi_fecha_consentimiento") or ev.get("fecha_consentimiento")
        copia["fecha_captura"] = ev.get("evi_fecha_captura") or ev.get("fecha_captura")
        copia["sincronizado_en"] = ev.get("evi_sincronizado_en") or ev.get("sincronizado_en")
        return copia

    # ── Paquete ZIP de evidencia individual ──────────────────────────────────

    def exportar_evidencia_individual(
        self,
        evidencia_id: str,
        destino_declarado: Optional[str],
        justificacion: Optional[str],
        usuario: Dict[str, Any],
    ) -> ArchivoExportado:
        roles = usuario.get("roles", [])
        user_id = usuario["id"]

        if ROL_ADMINISTRADOR in roles and ROL_AUTORIDAD not in roles:
            raise AccesoDenegadoError("Acceso denegado: El perfil Administrador (IT) tiene vedada la exportación de material probatorio y multimedia de las víctimas.")

        raw = self._evidencias.obtener_por_id(evidencia_id)
        if not raw:
            raise RecursoNoEncontradoError("Evidencia no encontrada.")
        evidencia = dict(raw)
        evidencia["id"] = raw.get("evi_id_evidencia") or raw.get("id")
        evidencia["incidente_id"] = raw.get("inc_id_incidente") or raw.get("incidente_id")
        evidencia["usuario_id"] = raw.get("usu_id_usuario") or raw.get("usuario_id")
        evidencia["consentimiento_exportacion"] = raw.get("evi_consentimiento_exportacion") if "evi_consentimiento_exportacion" in raw else raw.get("consentimiento_exportacion")
        evidencia["fecha_consentimiento"] = raw.get("evi_fecha_consentimiento") or raw.get("fecha_consentimiento")
        evidencia["hash_sha256"] = raw.get("evi_hash_sha256") or raw.get("hash_sha256")
        evidencia["url_almacenamiento"] = raw.get("evi_url_almacenamiento") or raw.get("url_almacenamiento")
        evidencia["tipo_archivo"] = raw.get("evi_tipo_archivo") or raw.get("tipo_archivo")
        evidencia["fecha_captura"] = raw.get("evi_fecha_captura") or raw.get("fecha_captura")

        es_titular = str(evidencia["usuario_id"]) == user_id
        consentimiento_concedido = bool(evidencia.get("consentimiento_exportacion"))

        inc_id = evidencia.get("inc_id_incidente") or evidencia.get("incidente_id")
        if inc_id:
            inc = self._incidentes.obtener_por_id(str(inc_id), "inc_consentimiento_exportacion, usu_id_victima")
            if inc:
                if str(inc.get("usu_id_victima")) == user_id:
                    es_titular = True
                if not consentimiento_concedido:
                    # Consentimiento en cascada desde el incidente
                    consentimiento_concedido = bool(inc.get("inc_consentimiento_exportacion"))

        if not es_titular:
            if not consentimiento_concedido:
                raise AccesoDenegadoError("Acceso denegado: La víctima o testigo titular no ha otorgado consentimiento informado para exportar esta evidencia (Ley 25.326 / ISO 27037).")
            # Anti-IDOR: un tercero solo exporta material ajeno si es Autoridad (rol o
            # cargo institucional; la vigencia del cargo se valida a continuación)
            if ROL_AUTORIDAD not in roles and not self._tiene_cargo_registrado(user_id):
                raise AccesoDenegadoError("Acceso denegado: No posee permisos de Autoridad judicial o policial ni es la persona titular.")

        cargo, sede, legajo = "Personal Policial / Judicial Autorizado", "Dependencia Jurisdiccional", "N/D"
        try:
            c_info = self._cargos.obtener_adscripcion(user_id, COLUMNAS_ADSCRIPCION_INDIVIDUAL)
            if c_info:
                if not (c_info.get("carins_activo") or c_info.get("activo", False)):
                    raise AccesoDenegadoError("Acceso denegado: Su cargo institucional no se encuentra habilitado para emitir reportes judiciales.")
                legajo = c_info.get("carins_legajo_o_matricula") or c_info.get("legajo_o_matricula") or "N/D"
                cargo_obj = c_info.get("cargo") or {}
                cargo = cargo_obj.get("car_nombre_cargo") or cargo_obj.get("nombre_cargo") or "Perito en Informática y Acústica Forense"
                sede_obj = c_info.get("sede") or {}
                sede = f"{sede_obj.get('sed_nombre_sede') or sede_obj.get('nombre_sede', '')} ({sede_obj.get('sed_direccion') or sede_obj.get('direccion', '')})"
        except AccesoDenegadoError:
            raise
        except Exception as exc:
            logger.warning("Aviso obteniendo adscripción de autoridad: %s", exc)

        fecha_consentimiento = evidencia.get("evi_fecha_consentimiento") or evidencia.get("fecha_consentimiento")
        contexto = {
            "incidente_id": evidencia.get("inc_id_incidente") or evidencia.get("incidente_id") or "Sin incidente vinculado (Evidencia individual)",
            "solicitante_id": user_id,
            "solicitante_email": usuario.get("email", "Usuario Autenticado"),
            "solicitante_cargo": cargo,
            "solicitante_sede": sede,
            "solicitante_legajo": legajo,
            "motivo_exportacion": justificacion,
            "destino_declarado": destino_declarado,
            "fecha_consentimiento": fecha_consentimiento,
            "consentimiento_info": f"Otorgado el {fecha_consentimiento or 'Previamente registrado'} (Ley 25.326)",
        }

        zip_bytes, hash_manifiesto = self._empaquetador.generar_paquete_zip(contexto, [evidencia])

        try:
            self._auditoria.registrar_exportacion({
                "expevi_tipo_exportacion": "individual",
                "evi_id_evidencia": evidencia_id,
                "usu_id_solicitado_por": user_id,
                "expevi_rol_actor": rol_actor_auditoria(roles, "Titular"),
                "expevi_destino_declarado": destino_declarado,
                "expevi_justificacion": justificacion,
                "expevi_hash_manifiesto": hash_manifiesto,
                "expevi_cantidad_archivos": 1,
            })
        except Exception as exc:
            logger.error("Error registrando auditoría de exportación individual: %s", exc)

        return ArchivoExportado(
            contenido=zip_bytes,
            nombre_archivo=f"apoyar_evidencia_{evidencia_id[:8]}_export.zip",
            hash_manifiesto=hash_manifiesto,
        )

    def _tiene_cargo_registrado(self, usuario_id: str) -> bool:
        try:
            return self._cargos.obtener_estado(usuario_id) is not None
        except Exception:
            return False
