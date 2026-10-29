# backend/app/repositories/alerta_temprana_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de la tabla `alerta_temprana` (una fila por contacto alertado).
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List

from app.repositories.base import SupabaseRepository


class AlertaTempranaRepository(SupabaseRepository):
    tabla = "alerta_temprana"

    def registrar_alertas(self, alertas: List[Dict[str, Any]]) -> None:
        self._query().insert(alertas).execute()
