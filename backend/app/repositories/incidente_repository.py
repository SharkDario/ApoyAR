# backend/app/repositories/incidente_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de la tabla `incidente`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository

# PostgREST devuelve hasta 1000 filas por consulta; los filtros `in` van en la URL
_LOTE = 1000
_LOTE_IDS = 150
COLUMNAS_ESTADISTICAS = (
    "inc_id_incidente, usu_id_victima, inc_latitud, inc_longitud, inc_direccion, "
    "inc_direccion_aprox, inc_origen, inc_estado, inc_fecha_hora, inc_notas"
)
# inc_notas solo se usa en los incidentes anonimizados (rango de edad y género, migración 024)


class IncidenteRepository(SupabaseRepository):
    tabla = "incidente"

    def obtener_por_id(self, incidente_id: str, columnas: str = "*") -> Optional[Dict[str, Any]]:
        res = self._query().select(columnas).eq("inc_id_incidente", incidente_id).execute()
        return self._primera_fila(res)

    def actualizar(self, incidente_id: str, campos: Dict[str, Any]) -> List[Dict[str, Any]]:
        res = self._query().update(campos).eq("inc_id_incidente", incidente_id).execute()
        return self._filas(res)

    def actualizar_si_en_curso(self, incidente_id: str, campos: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Actualiza solo si el incidente sigue 'en_curso' (telemetría GPS)."""
        res = (
            self._query()
            .update(campos)
            .eq("inc_id_incidente", incidente_id)
            .eq("inc_estado", "en_curso")
            .execute()
        )
        return self._filas(res)

    def cerrar_en_curso_de_victima(self, victima_id: str, excepto_incidente_id: str, notas: str) -> None:
        """Cierra los incidentes 'en_curso' previos de la víctima, salvo el indicado, agregando la nota."""
        previos = self._filas(
            self._query()
            .select("inc_id_incidente, inc_notas")
            .eq("usu_id_victima", victima_id)
            .eq("inc_estado", "en_curso")
            .neq("inc_id_incidente", excepto_incidente_id)
            .execute()
        )
        for previo in previos:
            notas_actuales = previo.get("inc_notas") or ""
            (
                self._query()
                .update({"inc_estado": "cerrado", "inc_notas": f"{notas_actuales}\n{notas}".strip() if notas_actuales else notas})
                .eq("inc_id_incidente", previo["inc_id_incidente"])
                .eq("inc_estado", "en_curso")
                .execute()
            )

    def contar(self, estado: Optional[str] = None) -> int:
        query = self._query().select("inc_id_incidente", count="exact")
        if estado:
            query = query.eq("inc_estado", estado)
        res = query.execute()
        return res.count if res.count is not None else len(res.data or [])

    def listar_paginado(
        self,
        columnas: str,
        orden: str,
        offset: int,
        limit: int,
        estado: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = self._query().select(columnas)
        if estado:
            query = query.eq("inc_estado", estado)
        res = query.order(orden, desc=True).range(offset, offset + limit - 1).execute()
        return self._filas(res)

    # ── Consultas para estadísticas (RF-4.4): sin nombres ni notas ───────────

    def listar_para_estadisticas(
        self,
        desde_iso: Optional[str] = None,
        hasta_iso: Optional[str] = None,
        origen: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Incidentes del período con las columnas que usan las estadísticas, de a 1000 filas."""
        filas: List[Dict[str, Any]] = []
        desde = 0
        while True:
            query = self._query().select(COLUMNAS_ESTADISTICAS)
            if desde_iso:
                query = query.gte("inc_fecha_hora", desde_iso)
            if hasta_iso:
                query = query.lte("inc_fecha_hora", hasta_iso)
            if origen:
                query = query.eq("inc_origen", origen)
            lote = self._filas(query.order("inc_fecha_hora").range(desde, desde + _LOTE - 1).execute())
            filas.extend(lote)
            if len(lote) < _LOTE:
                return filas
            desde += _LOTE

    def obtener_fechas_cierre_historial(self, incidente_ids: List[str]) -> Dict[str, str]:
        """Fecha de cierre de cada incidente: el último paso de 'en_curso' a otro estado en `historial_incidente`."""
        cierres: Dict[str, str] = {}
        for i in range(0, len(incidente_ids), _LOTE_IDS):
            res = (
                self._query("historial_incidente")
                .select("inc_id_incidente, hisinc_creado_en")
                .in_("inc_id_incidente", incidente_ids[i:i + _LOTE_IDS])
                .eq("hisinc_estado_anterior", "en_curso")
                .order("hisinc_creado_en")
                .execute()
            )
            for fila in self._filas(res):
                if fila.get("hisinc_creado_en"):
                    cierres[str(fila["inc_id_incidente"])] = fila["hisinc_creado_en"]
        return cierres

    def listar_en_ventana_temporal(self, desde_iso: str, hasta_iso: str) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("inc_id_incidente, inc_victima_nombre, inc_latitud, inc_longitud, inc_direccion, inc_origen, inc_fecha_hora, inc_estado, inc_consentimiento_exportacion")
            .gte("inc_fecha_hora", desde_iso)
            .lte("inc_fecha_hora", hasta_iso)
            .execute()
        )
        return self._filas(res)
