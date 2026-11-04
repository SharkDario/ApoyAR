# backend/app/services/access_control.py
# ─────────────────────────────────────────────────────────────────────────────
# Autorización a nivel de recurso (Anti-IDOR / BOLA) y Matriz de Visibilidad
# (Ley 25.326 e ISO/IEC 27037:2012).
#
# El backend usa la clave service_role (bypass de RLS), por lo que estas reglas
# imperativas son las que impiden acceder a incidentes o evidencias ajenas.
# ─────────────────────────────────────────────────────────────────────────────

import uuid
from typing import Any, Dict

from app.errors import AccesoDenegadoError, RecursoNoEncontradoError, SolicitudInvalidaError
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.services.roles import (
    P_EVIDENCIA_AUDITAR,
    P_INCIDENTE_ACTUALIZAR,
    P_INCIDENTE_MONITOREAR,
    ROL_AUTORIDAD,
    es_operador_institucional,
    roles_de,
    tiene_permiso,
)

COLUMNAS_INCIDENTE_ACCESO = (
    "inc_id_incidente, usu_id_victima, inc_estado, inc_origen, inc_fecha_hora, inc_latitud, "
    "inc_longitud, inc_direccion, inc_consentimiento_exportacion, inc_fecha_consentimiento"
)

# Pares (columna canónica, alias legado) que se exponen en ambos sentidos.
_ALIAS_INCIDENTE = [
    ("inc_id_incidente", "id"),
    ("usu_id_victima", "victima_id"),
    ("inc_estado", "estado"),
    ("inc_origen", "origen"),
    ("inc_fecha_hora", "fecha_hora"),
    ("inc_latitud", "latitud"),
    ("inc_longitud", "longitud"),
    ("inc_direccion", "direccion"),
    ("inc_consentimiento_exportacion", "consentimiento_exportacion"),
    ("inc_fecha_consentimiento", "fecha_consentimiento"),
]
_ALIAS_EVIDENCIA = [
    ("evi_id_evidencia", "id"),
    ("usu_id_usuario", "usuario_id"),
    ("inc_id_incidente", "incidente_id"),
    ("evi_tipo_archivo", "tipo_archivo"),
    ("evi_url_almacenamiento", "url_almacenamiento"),
    ("evi_hash_sha256", "hash_sha256"),
    ("evi_hash_cifrado", "hash_cifrado"),
    ("evi_firma_hardware", "firma_hardware"),
    ("evi_token_rfc3161", "token_rfc3161"),
    ("evi_tsa_estado", "tsa_estado"),
    ("evi_origen_captura", "origen_captura"),
    ("evi_prev_hash", "prev_hash"),
    ("evi_consentimiento_exportacion", "consentimiento_exportacion"),
    ("evi_fecha_consentimiento", "fecha_consentimiento"),
    ("evi_fecha_captura", "fecha_captura"),
    ("evi_sincronizado_en", "sincronizado_en"),
    ("evi_metadata_dispositivo", "metadata_dispositivo"),
]
_COLUMNAS_BOOLEANAS_CONSENTIMIENTO = {"inc_consentimiento_exportacion", "evi_consentimiento_exportacion"}

ACCIONES_CONTENIDO_MULTIMEDIA = ("download", "export", "play", "read_content")


def _con_alias_bidireccionales(fila: Dict[str, Any], pares) -> Dict[str, Any]:
    """Retrocompatibilidad: expone cada campo con su nombre canónico y su alias legado."""
    valores = {}
    for canonica, alias in pares:
        if canonica in _COLUMNAS_BOOLEANAS_CONSENTIMIENTO:
            valores[canonica] = fila.get(canonica) if canonica in fila else fila.get(alias)
        else:
            valores[canonica] = fila.get(canonica) or fila.get(alias)
    for canonica, alias in pares:
        fila[alias] = valores[canonica]
    for canonica, _ in pares:
        fila[canonica] = valores[canonica]
    return fila


def _validar_uuid(valor: str, mensaje: str) -> str:
    try:
        return str(uuid.UUID(str(valor)))
    except ValueError:
        raise SolicitudInvalidaError(mensaje)


class AccessControlService:

    def __init__(
        self,
        incidentes: IncidenteRepository,
        evidencias: EvidenciaRepository,
        red_apoyo: RedApoyoRepository,
        cargos: CargoInstitucionalRepository,
    ):
        self._incidentes = incidentes
        self._evidencias = evidencias
        self._red_apoyo = red_apoyo
        self._cargos = cargos

    # ── Habilitación institucional ───────────────────────────────────────────

    def tiene_cargo_activo(self, usuario_id: str) -> bool:
        """True si el usuario posee un cargo institucional habilitado (errores → False)."""
        try:
            cargo = self._cargos.obtener_estado(usuario_id)
            return bool(cargo and (cargo.get("carins_activo", False) or cargo.get("activo", False)))
        except Exception:
            return False

    # ── Incidentes ───────────────────────────────────────────────────────────

    def verificar_acceso_incidente(self, incidente_id: str, usuario: Dict[str, Any], accion: str = "read") -> Dict[str, Any]:
        """
        Reglas (por permiso, tablas permiso y perfil_tiene_permiso):
        - Víctima titular: acceso total.
        - 'update_posicion': solo la víctima titular.
        - 'update_estado': víctima titular o permiso 'incidente.actualizar'.
        - 'live_gps': permiso 'incidente.monitorear' e incidente activo; la Autoridad,
          además, con cargo institucional activo.
        - Lectura: permiso 'incidente.monitorear' o 'evidencia.auditar'.
        - Contacto: lectura si existe vínculo activo en `red_apoyo` y el incidente está 'en_curso'.
        """
        inc_uuid = _validar_uuid(incidente_id, "Identificador de incidente no es un UUID válido.")
        incidente = self._incidentes.obtener_por_id(inc_uuid, COLUMNAS_INCIDENTE_ACCESO)
        if not incidente:
            raise RecursoNoEncontradoError(f"Incidente {incidente_id} no encontrado.")
        _con_alias_bidireccionales(incidente, _ALIAS_INCIDENTE)

        user_id = usuario["id"]
        victima_id = str(incidente.get("usu_id_victima") or incidente.get("victima_id"))
        roles = roles_de(usuario)

        if victima_id == user_id:
            return incidente

        if accion == "update_posicion":
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): Solo la víctima titular puede transmitir telemetría para este incidente.")

        if accion == "update_estado":
            if tiene_permiso(usuario, P_INCIDENTE_ACTUALIZAR):
                return incidente
            raise AccesoDenegadoError("Acceso denegado: No tiene permisos para cambiar el estado de este incidente.")

        if accion == "live_gps":
            if not tiene_permiso(usuario, P_INCIDENTE_MONITOREAR):
                raise AccesoDenegadoError("Acceso denegado: Su perfil no tiene permiso para ver la ubicación de los incidentes.")
            if ROL_AUTORIDAD in roles:
                cargo = self._cargos.obtener_estado(user_id)
                if not cargo or not cargo.get("carins_activo", False):
                    raise AccesoDenegadoError("Acceso denegado: Su cargo institucional se encuentra inactivo o no habilitado para monitoreo operativo.")
            if incidente.get("inc_estado") not in ("en_curso", "activo") and incidente.get("estado") not in ("en_curso", "activo"):
                raise AccesoDenegadoError("Acceso denegado: La geolocalización en tiempo real solo está disponible mientras el incidente se encuentre en estado activo/SOS (Ley 25.326).")
            return incidente

        if accion == "read" and (tiene_permiso(usuario, P_INCIDENTE_MONITOREAR) or tiene_permiso(usuario, P_EVIDENCIA_AUDITAR)):
            return incidente

        if accion == "read":
            en_curso = incidente.get("inc_estado") == "en_curso" or incidente.get("estado") == "en_curso"
            if self._red_apoyo.existe_vinculo_activo(victima_id, user_id) and en_curso:
                return incidente

        raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No tiene autorización sobre el incidente solicitado.")

    def verificar_titularidad_incidente(self, incidente_id: str, usuario: Dict[str, Any], detalle_denegado: str) -> Dict[str, Any]:
        """Acceso de lectura y, además, que el usuario sea la víctima titular."""
        incidente = self.verificar_acceso_incidente(incidente_id, usuario, accion="read")
        victima = incidente.get("usu_id_victima") or incidente.get("victima_id")
        if str(victima) != usuario["id"]:
            raise AccesoDenegadoError(detalle_denegado)
        return incidente

    # ── Evidencias ───────────────────────────────────────────────────────────

    def verificar_acceso_evidencia(self, evidencia_id: str, usuario: Dict[str, Any], accion: str = "audit") -> Dict[str, Any]:
        """
        Matriz de Visibilidad:
        - Autor de la prueba o víctima titular del incidente: acceso soberano.
        - Permiso 'evidencia.auditar' (Autoridad): metadatos ('audit') siempre;
          contenido multimedia ('download' / 'export' / 'play' / 'read_content')
          solo con consentimiento del titular.
        - Operadores sin ese permiso (Administrador) y contactos: nunca (403).
        """
        ev_uuid = _validar_uuid(evidencia_id, "Identificador de evidencia no es un UUID válido.")
        evidencia = self._evidencias.obtener_por_id(ev_uuid)
        if not evidencia:
            raise RecursoNoEncontradoError(f"Evidencia {evidencia_id} no encontrada.")
        _con_alias_bidireccionales(evidencia, _ALIAS_EVIDENCIA)

        user_id = usuario["id"]
        autor_id = str(evidencia.get("usu_id_usuario") or evidencia.get("usuario_id"))
        incidente_id = evidencia.get("inc_id_incidente") or evidencia.get("incidente_id")

        if autor_id == user_id:
            return evidencia
        if incidente_id and self._es_victima_del_incidente(str(incidente_id), user_id):
            return evidencia

        if not tiene_permiso(usuario, P_EVIDENCIA_AUDITAR):
            if es_operador_institucional(usuario):
                raise AccesoDenegadoError("Acceso denegado: Su perfil no tiene permiso para auditar evidencias probatorias ni contenido multimedia.")
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No tiene autorización para auditar o consultar esta evidencia ajena.")

        if accion in ACCIONES_CONTENIDO_MULTIMEDIA and not self._tiene_consentimiento(evidencia, autor_id, incidente_id):
            raise AccesoDenegadoError("Acceso denegado: Se requiere el consentimiento informado expreso de la víctima/testigo para acceder al contenido multimedia probatorio o exportarlo (Ley 25.326 / ISO 27037).")
        return evidencia

    def _tiene_consentimiento(self, evidencia: Dict[str, Any], autor_id: str, incidente_id: Any) -> bool:
        """
        Consentimiento del titular. Para la prueba de la propia víctima cuentan el
        del incidente y el de la evidencia; para la de un testigo (autor distinto
        de la víctima, o sin incidente) cuenta solo el que dio el testigo.
        """
        consentimiento_evidencia = bool(evidencia.get("evi_consentimiento_exportacion", evidencia.get("consentimiento_exportacion")))
        if not incidente_id:
            return consentimiento_evidencia
        try:
            inc = self._incidentes.obtener_por_id(str(incidente_id), "usu_id_victima, inc_consentimiento_exportacion")
        except Exception:
            return consentimiento_evidencia
        if not inc:
            return consentimiento_evidencia
        if str(inc.get("usu_id_victima")) != autor_id:
            return consentimiento_evidencia
        return bool(inc.get("inc_consentimiento_exportacion")) and bool(evidencia.get("evi_consentimiento_exportacion", True))

    def _es_victima_del_incidente(self, incidente_id: str, usuario_id: str) -> bool:
        try:
            inc = self._incidentes.obtener_por_id(incidente_id, "usu_id_victima")
            return bool(inc and str(inc.get("usu_id_victima")) == usuario_id)
        except Exception:
            return False

    def es_titular_de_evidencia(self, evidencia: Dict[str, Any], usuario_id: str) -> bool:
        """Autor de la evidencia o víctima del incidente asociado."""
        if str(evidencia.get("usu_id_usuario") or evidencia.get("usuario_id")) == usuario_id:
            return True
        inc_id = evidencia.get("inc_id_incidente") or evidencia.get("incidente_id")
        if not inc_id:
            return False
        inc = self._incidentes.obtener_por_id(str(inc_id), "usu_id_victima")
        return bool(inc and str(inc.get("usu_id_victima") or inc.get("victima_id")) == usuario_id)
