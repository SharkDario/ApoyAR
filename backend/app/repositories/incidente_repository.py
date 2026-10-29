# backend/app/repositories/incidente_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de la tabla `incidente`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository


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
        """Cierra los incidentes 'en_curso' previos de la víctima, salvo el indicado."""
        (
            self._query()
            .update({"inc_estado": "cerrado", "inc_notas": notas})
            .eq("usu_id_victima", victima_id)
            .eq("inc_estado", "en_curso")
            .neq("inc_id_incidente", excepto_incidente_id)
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

    def listar_en_ventana_temporal(self, desde_iso: str, hasta_iso: str) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("inc_id_incidente, inc_victima_nombre, inc_latitud, inc_longitud, inc_fecha_hora, inc_estado")
            .gte("inc_fecha_hora", desde_iso)
            .lte("inc_fecha_hora", hasta_iso)
            .execute()
        )
        return self._filas(res)
