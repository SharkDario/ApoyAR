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
from app.repositories.evidencia_repository import EvidenciaRepository, prefijo_expediente
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.admin import AsociarEvidenciaRequest, CorrelacionarIncidentesRequest, SugerenciasQuery

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
COLUMNAS_INCIDENTE_COINCIDENCIA = (
    "inc_victima_nombre, inc_latitud, inc_longitud, inc_direccion, inc_origen, inc_estado, "
    "inc_fecha_hora, inc_consentimiento_exportacion"
)


def es_coordenada_valida(latitud: float, longitud: float) -> bool:
    """(0, 0) identifica a los incidentes registrados sin señal GPS."""
    return not (latitud == 0 and longitud == 0)


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

            # La hora de cierre está en el historial que llena el trigger de auditoría.
            # Si se reabrió y se volvió a cerrar, vale el último cierre.
            cierres: Dict[str, str] = {}
            ids_cerrados = [inc["inc_id_incidente"] for inc in filas if inc.get("inc_estado") != "en_curso"]
            if ids_cerrados:
                try:
                    res = (
                        self._incidentes._query("historial_incidente")
                        .select("inc_id_incidente, hisinc_creado_en")
                        .in_("inc_id_incidente", ids_cerrados)
                        .eq("hisinc_estado_anterior", "en_curso")
                        .order("hisinc_creado_en")
                        .execute()
                    )
                    for fila in self._incidentes._filas(res):
                        cierres[fila["inc_id_incidente"]] = fila["hisinc_creado_en"]
                except Exception as exc:
                    logger.warning("No se pudo consultar la hora de cierre de los incidentes: %s", exc)

            incidentes = []
            for inc in filas:
                item = _alias_incidente_consola(inc, con_notas=True)
                item["fecha_fin"] = cierres.get(inc["inc_id_incidente"]) if inc.get("inc_estado") != "en_curso" else None
                incidentes.append(item)
            return _pagina(incidentes, total, page, limit)
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
                inc_id = str(inc.get("inc_id_incidente") or inc.get("id"))
                if consulta.incidente_id and str(consulta.incidente_id) == inc_id:
                    continue

                try:
                    lat_inc = float(inc.get("inc_latitud") or inc.get("latitud"))
                    lon_inc = float(inc.get("inc_longitud") or inc.get("longitud"))
                except (TypeError, ValueError):
                    continue

                if not es_coordenada_valida(lat_inc, lon_inc):
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

                radio_max = max(1.0, float(consulta.radio_metros))
                porcentaje = max(0.0, min(100.0, round((1.0 - (dist_m / radio_max)) * 100.0, 1)))

                coincidencias.append({
                    "tipo": "incidente",
                    "incidente_id": inc_id,
                    "victima_nombre": inc.get("inc_victima_nombre") or inc.get("victima_nombre") or "Anónimo / En Resguardo",
                    "latitud": lat_inc,
                    "longitud": lon_inc,
                    "direccion": inc.get("inc_direccion"),
                    "origen": inc.get("inc_origen"),
                    "distancia_metros": round(dist_m, 2),
                    "porcentaje_proximidad": porcentaje,
                    "diferencia_minutos": round(diff_min, 2),
                    "fecha_hora": inc.get("inc_fecha_hora") or inc.get("fecha_hora"),
                    "estado": inc.get("inc_estado") or inc.get("estado"),
                    "consentimiento_exportacion": inc.get("inc_consentimiento_exportacion"),
                    "clasificacion": "Posible Coincidencia Sugerida",
                })

            # También buscar evidencias registradas en la misma ventana temporal
            try:
                res_evidencias = (
                    self._evidencias._query()
                    .select("evi_id_evidencia, inc_id_incidente, usu_id_usuario, evi_tipo_archivo, evi_fecha_captura, evi_metadata_dispositivo, evi_motivo_asociacion, evi_origen_captura, evi_consentimiento_exportacion")
                    .gte("evi_fecha_captura", t_min)
                    .lte("evi_fecha_captura", t_max)
                    .execute()
                )
                filas_ev = self._evidencias._filas(res_evidencias)
                incidentes_padre: Dict[str, Optional[Dict[str, Any]]] = {}
                for ev in filas_ev:
                    ev_id = str(ev.get("evi_id_evidencia") or ev.get("id"))
                    inc_asoc = str(ev.get("inc_id_incidente") or "")
                    if consulta.incidente_id and inc_asoc == str(consulta.incidente_id):
                        continue
                    if consulta.incidente_id and str(ev.get("evi_motivo_asociacion") or "").startswith(prefijo_expediente(str(consulta.incidente_id))):
                        continue

                    # Extraer geolocalización de metadata_dispositivo o del incidente asociado
                    lat_ev, lon_ev = None, None
                    meta = ev.get("evi_metadata_dispositivo")
                    if isinstance(meta, dict):
                        lat_ev = meta.get("latitud") or meta.get("lat")
                        lon_ev = meta.get("longitud") or meta.get("lon") or meta.get("lng")

                    if inc_asoc and inc_asoc not in incidentes_padre:
                        incidentes_padre[inc_asoc] = self._incidentes.obtener_por_id(inc_asoc, COLUMNAS_INCIDENTE_COINCIDENCIA)
                    inc_padre = incidentes_padre.get(inc_asoc)

                    if lat_ev is None and inc_padre:
                        lat_ev = inc_padre.get("inc_latitud")
                        lon_ev = inc_padre.get("inc_longitud")

                    if lat_ev is None or lon_ev is None:
                        continue

                    try:
                        lat_ev_f = float(lat_ev)
                        lon_ev_f = float(lon_ev)
                    except (TypeError, ValueError):
                        continue

                    if not es_coordenada_valida(lat_ev_f, lon_ev_f):
                        continue

                    dist_m = calcular_haversine_metros(consulta.latitud, consulta.longitud, lat_ev_f, lon_ev_f)
                    if dist_m > consulta.radio_metros:
                        continue

                    try:
                        fh_ev = ev.get("evi_fecha_captura") or ""
                        f_ev_dt = datetime.fromisoformat(fh_ev.replace("Z", "+00:00"))
                        diff_min = abs((f_ev_dt - dt_base).total_seconds()) / 60.0
                    except Exception:
                        diff_min = 0.0

                    radio_max = max(1.0, float(consulta.radio_metros))
                    porcentaje = max(0.0, min(100.0, round((1.0 - (dist_m / radio_max)) * 100.0, 1)))

                    coincidencias.append({
                        "tipo": "evidencia_comunitaria",
                        "evidencia_id": ev_id,
                        "incidente_id": inc_asoc or None,
                        "incidente": {
                            "victima_nombre": inc_padre.get("inc_victima_nombre"),
                            "direccion": inc_padre.get("inc_direccion"),
                            "origen": inc_padre.get("inc_origen"),
                            "estado": inc_padre.get("inc_estado"),
                            "fecha_hora": inc_padre.get("inc_fecha_hora"),
                            "latitud": inc_padre.get("inc_latitud"),
                            "longitud": inc_padre.get("inc_longitud"),
                            "consentimiento_exportacion": inc_padre.get("inc_consentimiento_exportacion"),
                        } if inc_padre else None,
                        "origen_captura": ev.get("evi_origen_captura"),
                        "consentimiento_exportacion": ev.get("evi_consentimiento_exportacion"),
                        "tipo_archivo": ev.get("evi_tipo_archivo") or "archivo",
                        "latitud": lat_ev_f,
                        "longitud": lon_ev_f,
                        "distancia_metros": round(dist_m, 2),
                        "porcentaje_proximidad": porcentaje,
                        "diferencia_minutos": round(diff_min, 2),
                        "fecha_hora": ev.get("evi_fecha_captura"),
                        "clasificacion": "Posible Coincidencia Sugerida",
                    })
            except Exception as ev_err:
                logger.debug("Aviso buscando evidencias para correlación: %s", ev_err)

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

        incidente = self._incidentes.obtener_por_id(solicitud.incidente_id, "inc_id_incidente, inc_estado, inc_notas")
        if not incidente:
            raise RecursoNoEncontradoError(f"Incidente {solicitud.incidente_id} no encontrado.")
        if not self._evidencias.obtener_por_id(solicitud.evidencia_id, "evi_id_evidencia, inc_id_incidente"):
            raise RecursoNoEncontradoError(f"Evidencia {solicitud.evidencia_id} no encontrada.")

        now_iso = datetime.now(timezone.utc).isoformat()
        justificacion = solicitud.justificacion_operativa.strip()
        try:
            # Vinculación formal en base de datos: ahora soportada por los triggers de inmutabilidad (transición única NULL -> ID)
            self._evidencias.asociar_a_incidente(solicitud.evidencia_id, {
                "inc_id_incidente": solicitud.incidente_id,
                "usu_id_asociado_por": operador["id"],
                "evi_asociado_en": now_iso,
                "evi_motivo_asociacion": f"{prefijo_expediente(solicitud.incidente_id)}{justificacion}",
            })
            nota = f"[Evidencia asociada {now_iso}] {solicitud.evidencia_id}. Fundamentación: {justificacion} (Operador: {operador.get('email', operador['id'])})"
            notas = incidente.get("inc_notas") or ""
            self._incidentes.actualizar(solicitud.incidente_id, {"inc_notas": f"{notas}\n{nota}".strip()})
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

    def correlacionar_incidentes(self, solicitud: CorrelacionarIncidentesRequest, operador: Dict[str, Any]) -> Dict[str, Any]:
        """Relación entre incidentes cercanos en lugar y hora, según el criterio declarado por el operador (RF-3.6 / CU-10)."""
        if not solicitud.justificacion_operativa or len(solicitud.justificacion_operativa.strip()) < 10:
            raise SolicitudInvalidaError("Debe suministrar una fundamentación pericial u operativa de al menos 10 caracteres.")

        inc_orig = self._incidentes.obtener_por_id(solicitud.incidente_origen_id, "inc_id_incidente, inc_notas")
        if not inc_orig:
            raise RecursoNoEncontradoError(f"Incidente origen {solicitud.incidente_origen_id} no encontrado.")
        inc_dest = self._incidentes.obtener_por_id(solicitud.incidente_destino_id, "inc_id_incidente, inc_notas")
        if not inc_dest:
            raise RecursoNoEncontradoError(f"Incidente destino {solicitud.incidente_destino_id} no encontrado.")

        now_iso = datetime.now(timezone.utc).isoformat()
        justificacion = solicitud.justificacion_operativa.strip()
        operador_ref = operador.get("email", operador.get("id"))

        # La relación queda escrita en los dos incidentes, cada uno apuntando al otro
        try:
            for incidente, relacionado in ((inc_orig, solicitud.incidente_destino_id), (inc_dest, solicitud.incidente_origen_id)):
                nota = (
                    f"[Correlación espaciotemporal {now_iso}] "
                    f"Posible relación con incidente {relacionado}. "
                    f"Fundamentación: {justificacion} "
                    f"(Operador: {operador_ref})"
                )
                notas_actuales = incidente.get("inc_notas") or ""
                nuevas_notas = f"{notas_actuales}\n{nota}".strip() if notas_actuales else nota
                self._incidentes.actualizar(incidente["inc_id_incidente"], {"inc_notas": nuevas_notas})
        except Exception as exc:
            logger.error("Error al asentar notas de correlación: %s", exc)
            raise ErrorInternoError(f"No se pudo registrar la correlación en el expediente: {exc}")

        return {
            "status": "correlacion_exitosa",
            "incidente_origen_id": solicitud.incidente_origen_id,
            "incidente_destino_id": solicitud.incidente_destino_id,
            "operador_id": operador.get("id"),
            "fecha_hora": now_iso,
            "fundamentacion": justificacion,
        }
