# backend/app/repositories/auditoria_exportacion_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de la trazabilidad de exportaciones forenses:
# `reporte_judicial` y `exportacion_evidencia` (registros inmutables).
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict

from app.repositories.base import SupabaseRepository


class AuditoriaExportacionRepository(SupabaseRepository):

    def registrar_reporte_judicial(self, datos: Dict[str, Any]) -> None:
        self._query("reporte_judicial").insert(datos).execute()

    def registrar_exportacion(self, datos: Dict[str, Any]) -> None:
        self._query("exportacion_evidencia").insert(datos).execute()
