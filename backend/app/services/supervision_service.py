# backend/app/services/supervision_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Consola operativa de Autoridad y Administrador:
#   - Incidentes activos e historial paginados (10 en 10).
#   - Correlación espaciotemporal Haversine (sugerencias, nunca vinculación automática).
#   - Vinculación formal asistida de evidencia a un incidente (Fase 5).
# ─────────────────────────────────────────────────────────────────────────────

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.errors import ErrorInternoError, RecursoNoEncontradoError, SolicitudInvalidaError
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.admin import AsociarEvidenciaRequest, SugerenciasQuery

logger = logging.getLogger("apoyar.admin_autoridad")

COLUMNAS_INCIDENTES_ACTIVOS = (
    "inc_id_incidente, usu_id_victima, inc_victima_nombre, inc_latitud, inc_longitud, inc_direccion, "
    "inc_direccion_aprox, inc_estado, inc_fecha_hora, inc_ultima_ubicacion_en, inc_origen, "
    "inc_consentimiento_exportacion, inc_fecha_consentimiento"
)
COLUMNAS_INCIDENTES_HISTORIAL = (
    "inc_id_incidente, usu_id_victima, inc_victima_nombre, inc_latitud, inc_longitud, inc_direccion, "
    "inc_direccion_aprox, inc_origen, inc_estado, inc_notas, inc_fecha_hora, inc_ultima_ubicacion_en, "
    "inc_consentimiento_exportacion, inc_fecha_consentimiento"
)


def calcular_haversine_metros(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia ortodrómica en metros entre dos coordenadas WGS84."""
    r_tierra = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r_tierra * c


_ALIAS_CONSOLA = {
    "id": "inc_id_incidente",
    "victima_id": "usu_id_victima",
    "victima_nombre": "inc_victima_nombre",
    "latitud": "inc_latitud",
    "longitud": "inc_longitud",
    "direccion": "inc_direccion",
    "direccion_aprox": "inc_direccion_aprox",
    "origen": "inc_origen",
    "estado": "inc_estado",
    "fecha_hora": "inc_fecha_hora",
    "consentimiento_exportacion": "inc_consentimiento_exportacion",
    "fecha_consentimiento": "inc_fecha_consentimiento",
}


def _alias_incidente_consola(inc: Dict[str, Any], con_notas: bool) -> Dict[str, Any]:
    d = dict(inc)
    for alias, columna in _ALIAS_CONSOLA.items():
        d[alias] = d.get(columna)
    if con_notas:
        d["notas"] = d.get("inc_notas")
    d["last_location_at"] = d.get("inc_ultima_ubicacion_en") or d.get("inc_last_location_at")
    return d


def _pagina(incidentes: List[Dict[str, Any]], total_registros: int, page: int, limit: int) -> Dict[str, Any]:
    return {
        "status": "ok",
        "incidentes": incidentes,
        "total_registros": total_registros,
        "total_paginas": max(1, math.ceil(total_registros / limit)),
        "pagina_actual": page,
        "limite": limit,
    }


class SupervisionService:

    def __init__(self, incidentes: IncidenteRepository, evidencias: EvidenciaRepository, usuarios: UsuarioRepository):
        self._incidentes = incidentes
        self._evidencias = evidencias
        self._usuarios = usuarios

    def listar_incidentes_activos(self, page: int, limit: int) -> Dict[str, Any]:
        try:
            total = self._incidentes.contar(estado="en_curso")
            offset = max(0, (page - 1) * limit)
            filas = self._incidentes.listar_paginado(COLUMNAS_INCIDENTES_ACTIVOS, "inc_ultima_ubicacion_en", offset, limit, estado="en_curso")
            return _pagina([_alias_incidente_consola(inc, con_notas=False) for inc in filas], total, page, limit)
        except Exception as exc:
            logger.error("Error consultando incidentes activos: %s", exc)
            raise ErrorInternoError(f"Error consultando incidentes: {exc}")

    def listar_incidentes(self, estado: Optional[str], page: int, limit: int) -> Dict[str, Any]:
        try:
            filtro = estado if estado and estado in ("en_curso", "cerrado") else None
            total = self._incidentes.contar(estado=filtro)
            offset = max(0, (page - 1) * limit)
            filas = self._incidentes.listar_paginado(COLUMNAS_INCIDENTES_HISTORIAL, "inc_fecha_hora", offset, limit, estado=filtro)
            for inc in filas:
                self._completar_nombre_victima(inc)
            return _pagina([_alias_incidente_consola(inc, con_notas=True) for inc in filas], total, page, limit)
        except Exception as exc:
            logger.error("Error consultando incidentes para autoridad: %s", exc)
            raise ErrorInternoError(f"Error consultando incidentes: {exc}")

    def _completar_nombre_victima(self, inc: Dict[str, Any]) -> None:
        """Si falta `inc_victima_nombre`, lo deriva de `persona` y lo persiste."""
        v_id = inc.get("usu_id_victima") or inc.get("victima_id")
        if inc.get("inc_victima_nombre") or not v_id:
            return
        try:
            persona = self._usuarios.obtener_persona(v_id, "per_nombre, per_apellido")
            if persona:
                nombre = f"{persona.get('per_nombre', '')} {persona.get('per_apellido', '')}".strip()
                if nombre:
                    inc["inc_victima_nombre"] = nombre
                    self._incidentes.actualizar(inc.get("inc_id_incidente") or inc.get("id"), {"inc_victima_nombre": nombre})
        except Exception as e_p:
            logger.debug("Aviso enriqueciendo victima_nombre: %s", e_p)

    def sugerir_coincidencias(self, consulta: SugerenciasQuery) -> Dict[str, Any]:
        """
        Coincidencia si d <= radio_metros y |Δt| <= ventana_minutos. Se presentan
        como 'Posible Coincidencia Sugerida': no reemplazan el criterio pericial.
        """
        try:
            dt_base = consulta.fecha_hora
            if dt_base.tzinfo is None:
                dt_base = dt_base.replace(tzinfo=timezone.utc)
            t_min = (dt_base - timedelta(minutes=consulta.ventana_minutos)).isoformat()
            t_max = (dt_base + timedelta(minutes=consulta.ventana_minutos)).isoformat()

            coincidencias = []
            for inc in self._incidentes.listar_en_ventana_temporal(t_min, t_max):
                try:
                    lat_inc = float(inc.get("inc_latitud") or inc.get("latitud"))
                    lon_inc = float(inc.get("inc_longitud") or inc.get("longitud"))
                except (TypeError, ValueError):
                    continue

                dist_m = calcular_haversine_metros(consulta.latitud, consulta.longitud, lat_inc, lon_inc)
                if dist_m > consulta.radio_metros:
                    continue
                try:
                    fh = inc.get("inc_fecha_hora") or inc.get("fecha_hora")
                    f_inc_dt = datetime.fromisoformat(fh.replace("Z", "+00:00"))
                    diff_min = abs((f_inc_dt - dt_base).total_seconds()) / 60.0
                except Exception:
                    diff_min = 0.0

                coincidencias.append({
                    "incidente_id": inc.get("inc_id_incidente") or inc.get("id"),
                    "victima_nombre": inc.get("inc_victima_nombre") or inc.get("victima_nombre") or "Anónimo / En Resguardo",
                    "latitud": lat_inc,
                    "longitud": lon_inc,
                    "distancia_metros": round(dist_m, 2),
                    "diferencia_minutos": round(diff_min, 2),
                    "fecha_hora": inc.get("inc_fecha_hora") or inc.get("fecha_hora"),
                    "estado": inc.get("inc_estado") or inc.get("estado"),
                    "clasificacion": "Posible Coincidencia Sugerida",
                })

            coincidencias.sort(key=lambda x: (x["distancia_metros"], x["diferencia_minutos"]))
            return {
                "status": "ok",
                "criterio": {
                    "radio_metros": consulta.radio_metros,
                    "ventana_minutos": consulta.ventana_minutos,
                    "punto_referencia": [consulta.latitud, consulta.longitud],
                },
                "cantidad_sugerencias": len(coincidencias),
                "sugerencias": coincidencias,
            }
        except Exception as exc:
            logger.error("Error en cálculo analítico Haversine: %s", exc)
            raise ErrorInternoError(f"Error evaluando correlación espaciotemporal: {exc}")

    def asociar_evidencia(self, solicitud: AsociarEvidenciaRequest, operador: Dict[str, Any]) -> Dict[str, Any]:
        """Vinculación formal con motivo declarado e identidad del operador para auditoría."""
        if not solicitud.justificacion_operativa or len(solicitud.justificacion_operativa.strip()) < 10:
            raise SolicitudInvalidaError("Debe suministrar una justificación operativa formal de al menos 10 caracteres.")

        if not self._incidentes.obtener_por_id(solicitud.incidente_id, "inc_id_incidente, inc_estado"):
            raise RecursoNoEncontradoError(f"Incidente {solicitud.incidente_id} no encontrado.")
        if not self._evidencias.obtener_por_id(solicitud.evidencia_id, "evi_id_evidencia, inc_id_incidente"):
            raise RecursoNoEncontradoError(f"Evidencia {solicitud.evidencia_id} no encontrada.")

        now_iso = datetime.now(timezone.utc).isoformat()
        justificacion = solicitud.justificacion_operativa.strip()
        try:
            self._evidencias.asociar_a_incidente(solicitud.evidencia_id, {
                "inc_id_incidente": solicitud.incidente_id,
                "usu_id_asociado_por": operador["id"],
                "evi_asociado_en": now_iso,
                "evi_motivo_asociacion": justificacion,
            })
        except Exception as exc:
            logger.error("Error al asociar evidencia: %s", exc)
            raise ErrorInternoError(f"No se pudo completar la asociación formal: {exc}")

        return {
            "status": "asociacion_exitosa",
            "evidencia_id": solicitud.evidencia_id,
            "incidente_id": solicitud.incidente_id,
            "operador_id": operador["id"],
            "asociado_en": now_iso,
            "justificacion": justificacion,
        }
