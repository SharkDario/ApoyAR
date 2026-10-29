# backend/app/repositories/base.py
# ─────────────────────────────────────────────────────────────────────────────
# Clase base de los repositorios de ApoyAR.
#
# Los repositorios encapsulan las consultas a PostgreSQL realizadas con el
# cliente oficial de Supabase (PostgREST). No hay ORM: cada método devuelve
# filas como diccionarios con los nombres de columna reales del esquema.
# Las reglas de negocio y de autorización pertenecen a los servicios.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from supabase import Client


class SupabaseRepository:
    """Repositorio base: recibe por inyección el cliente Supabase del backend."""

    tabla: str = ""

    def __init__(self, client: Client):
        self._client = client

    def _query(self, tabla: Optional[str] = None):
        return self._client.table(tabla or self.tabla)

    @staticmethod
    def _primera_fila(respuesta: Any) -> Optional[Dict[str, Any]]:
        return respuesta.data[0] if respuesta.data else None

    @staticmethod
    def _filas(respuesta: Any) -> List[Dict[str, Any]]:
        return respuesta.data or []
