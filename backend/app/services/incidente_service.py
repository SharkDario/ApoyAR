# backend/app/services/incidente_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Casos de uso del incidente de emergencia:
#   - Activación del SOS (manual o acústica) y despacho de alertas (CU-06).
#   - Telemetría GPS en tiempo real (RF-4.3) y transición de estados.
#   - Consulta con Matriz de Visibilidad y consentimiento informado (Ley 25.326).
# ─────────────────────────────────────────────────────────────────────────────

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.errors import AccesoDenegadoError, RecursoNoEncontradoError, SolicitudInvalidaError
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.incidentes import ActivarIncidenteRequest, ActualizarEstadoRequest, ActualizarPosicionRequest
from app.services.access_control import AccessControlService
from app.services.alerta_service import AlertaService, lanzar_en_segundo_plano
from app.services.geocoding import NominatimGeocoder
from app.services.roles import ROL_ADMINISTRADOR, ROL_AUTORIDAD

logger = logging.getLogger("apoyar.incidentes")

ESTADOS_VALIDOS = ("en_curso", "cerrado", "falso_positivo", "cancelado")


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class IncidenteService:

    def __init__(
        self,
        incidentes: IncidenteRepository,
        evidencias: EvidenciaRepository,
        usuarios: UsuarioRepository,
        cargos: CargoInstitucionalRepository,
        acceso: AccessControlService,
        alertas: AlertaService,
        geocoder: NominatimGeocoder,
    ):
        self._incidentes = incidentes
        self._evidencias = evidencias
        self._usuarios = usuarios
        self._cargos = cargos
        self._acceso = acceso
        self._alertas = alertas
        self._geocoder = geocoder

    # ── Activación del SOS ───────────────────────────────────────────────────

    def activar_incidente(self, solicitud: ActivarIncidenteRequest, usuario: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Recibe el incidente ya creado por el móvil y responde de inmediato (202):
        0. Cierra incidentes previos 'en_curso' de la víctima (unicidad de alerta).
        1. Enriquece nombre de la víctima, origen y última ubicación.
        2. Lanza la geocodificación inversa en segundo plano.
        3. Delega en AlertaService el registro y envío de las alertas push.
        """
        victima_id = str(solicitud.victima_id)
        if usuario and victima_id != usuario["id"]:
            roles = usuario.get("roles", [])
            if ROL_AUTORIDAD not in roles and ROL_ADMINISTRADOR not in roles:
                raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No puede activar emergencias en nombre de otra víctima.")

        incidente_id = str(solicitud.incidente_id)
        ahora_iso = _ahora_iso()

        try:
            self._incidentes.cerrar_en_curso_de_victima(victima_id, incidente_id, f"Reemplazado por nuevo incidente {incidente_id}")
        except Exception as e:
            logger.warning("[Activar] Aviso cerrando incidentes previos: %s", e)

        try:
            self._enriquecer_incidente(incidente_id, victima_id, solicitud.origen, ahora_iso)
        except Exception as e:
            logger.warning("[Activar] Aviso enriqueciendo incidente: %s", e)

        lanzar_en_segundo_plano(self._resolver_direccion(incidente_id, solicitud.latitud, solicitud.longitud))

        resultado = self._alertas.desencadenar_alertas(incidente_id, victima_id, solicitud.latitud, solicitud.longitud)
        if "detalle" in resultado:
            return {"status": "aceptado", "alertas_encoladas": 0, "detalle": resultado["detalle"]}

        return {
            "status": "aceptado",
            "alertas_encoladas": resultado["alertas_encoladas"],
            "incidente_id": incidente_id,
            "origen": solicitud.origen,
        }

    def _enriquecer_incidente(self, incidente_id: str, victima_id: str, origen: str, ahora_iso: str) -> None:
        incidente = self._incidentes.obtener_por_id(incidente_id, "inc_victima_nombre, inc_origen")
        if not incidente:
            return
        campos: Dict[str, Any] = {"inc_ultima_ubicacion_en": ahora_iso}
        nombre_actual = incidente.get("inc_victima_nombre")
        if not nombre_actual or nombre_actual == "Tu contacto":
            persona = self._usuarios.obtener_persona(victima_id, "per_nombre, per_apellido")
            if persona:
                nombre = f"{persona.get('per_nombre', '')} {persona.get('per_apellido', '')}".strip()
                if nombre:
                    campos["inc_victima_nombre"] = nombre

        # Origen válido ante el check constraint ('manual' | 'automatico')
        origen_normalizado = "manual" if origen == "manual" else "automatico"
        if incidente.get("inc_origen") != origen_normalizado:
            campos["inc_origen"] = origen_normalizado

        self._incidentes.actualizar(incidente_id, campos)

    async def _resolver_direccion(self, incidente_id: str, latitud: float, longitud: float) -> None:
        """
        Al actualizarse `inc_direccion`, Supabase Realtime notifica a los
        dispositivos de la red de confianza suscritos al incidente.
        """
        try:
            direccion = await self._geocoder.resolver_direccion(latitud, longitud)
            if direccion:
                self._incidentes.actualizar(incidente_id, {"inc_direccion": direccion})
                logger.info("[Activar] Dirección enriquecida para incidente %s: %s", incidente_id, direccion)
        except Exception as exc:
            logger.warning("[Activar] Aviso resolviendo dirección en background: %s", exc)

    # ── Telemetría y estado ──────────────────────────────────────────────────

    def actualizar_posicion(self, incidente_id: str, solicitud: ActualizarPosicionRequest, usuario: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if usuario:
            self._acceso.verificar_acceso_incidente(incidente_id, usuario, accion="update_posicion")
        elif not self._incidentes.obtener_por_id(incidente_id, "inc_id_incidente"):
            # Autenticado por X-Api-Secret: solo se valida la existencia
            raise RecursoNoEncontradoError(f"Incidente {incidente_id} no encontrado.")

        campos = {
            "inc_latitud": solicitud.latitud,
            "inc_longitud": solicitud.longitud,
            "inc_ultima_ubicacion_en": _ahora_iso(),
        }
        if solicitud.direccion_aprox:
            campos["inc_direccion_aprox"] = solicitud.direccion_aprox

        if not self._incidentes.actualizar_si_en_curso(incidente_id, campos):
            raise RecursoNoEncontradoError(f"Incidente activo {incidente_id} no encontrado o ya cerrado.")

        return {
            "status": "actualizado",
            "incidente_id": incidente_id,
            "latitud": solicitud.latitud,
            "longitud": solicitud.longitud,
        }

    def actualizar_estado(self, incidente_id: str, solicitud: ActualizarEstadoRequest, usuario: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """El trigger de base de datos audita la transición en `historial_incidente`."""
        if solicitud.estado not in ESTADOS_VALIDOS:
            raise SolicitudInvalidaError(f"Estado inválido. Opciones válidas: {ESTADOS_VALIDOS}")

        if usuario:
            self._acceso.verificar_acceso_incidente(incidente_id, usuario, accion="update_estado")
        elif not self._incidentes.obtener_por_id(incidente_id, "inc_id_incidente"):
            raise RecursoNoEncontradoError(f"Incidente {incidente_id} no encontrado.")

        campos = {"inc_estado": solicitud.estado}
        if solicitud.notas:
            campos["inc_notas"] = solicitud.notas

        if not self._incidentes.actualizar(incidente_id, campos):
            raise RecursoNoEncontradoError(f"Incidente {incidente_id} no encontrado.")

        return {
            "status": "estado_actualizado",
            "incidente_id": incidente_id,
            "nuevo_estado": solicitud.estado,
        }

    # ── Consentimiento informado ─────────────────────────────────────────────

    def actualizar_consentimiento(
        self,
        incidente_id: str,
        consentimiento: bool,
        usuario: Dict[str, Any],
        detalle_denegado: str,
    ) -> Optional[str]:
        """
        Solo la víctima titular otorga o revoca el consentimiento; se replica en
        todas las evidencias del incidente. Devuelve la fecha del consentimiento.
        """
        self._acceso.verificar_titularidad_incidente(incidente_id, usuario, detalle_denegado)

        fecha_iso = _ahora_iso() if consentimiento else None
        self._incidentes.actualizar(incidente_id, {
            "inc_consentimiento_exportacion": consentimiento,
            "inc_fecha_consentimiento": fecha_iso,
        })
        try:
            self._evidencias.actualizar_consentimiento_de_incidente(incidente_id, consentimiento, fecha_iso)
        except Exception as ev_err:
            logger.warning("Aviso actualizando consentimiento en evidencias: %s", ev_err)

        logger.info("Consentimiento informado del incidente %s actualizado a %s por usuario %s", incidente_id, consentimiento, usuario["id"])
        return fecha_iso

    # ── Consulta con Matriz de Visibilidad ───────────────────────────────────

    def obtener_incidente(self, incidente_id: str, usuario: Dict[str, Any]) -> Dict[str, Any]:
        incidente = self._acceso.verificar_acceso_incidente(incidente_id, usuario, accion="read")
        roles = usuario.get("roles", [])
        user_id = usuario["id"]
        es_victima = str(incidente.get("usu_id_victima") or incidente.get("victima_id")) == user_id
        es_admin_ti = ROL_ADMINISTRADOR in roles and ROL_AUTORIDAD not in roles
        datos = dict(incidente)

        if es_admin_ti:
            # El Administrador de TI nunca ve ubicaciones en tiempo real
            self._ocultar_ubicacion(datos, "Bloqueado por perfil Administrador IT (Ley 25.326)")
        elif ROL_AUTORIDAD in roles and not es_victima:
            cargo = self._cargos.obtener_estado(user_id)
            cargo_activo = bool(cargo and cargo.get("carins_activo", False))
            estado = datos.get("inc_estado") or datos.get("estado")
            if not cargo_activo:
                self._ocultar_ubicacion(datos, "Cargo institucional inactivo")
            elif estado not in ("en_curso", "activo"):
                datos["ubicacion_en_vivo_activa"] = False

        return datos

    @staticmethod
    def _ocultar_ubicacion(datos: Dict[str, Any], motivo: str) -> None:
        datos["inc_latitud"] = None
        datos["inc_longitud"] = None
        datos["latitud"] = None
        datos["longitud"] = None
        datos["telemetria_bloqueada"] = motivo
