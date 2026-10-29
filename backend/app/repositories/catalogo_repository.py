# backend/app/repositories/catalogo_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de los catálogos institucionales 3FN:
# `institucion`, `dependencia`, `sede` y `cargo`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository


class CatalogoInstitucionalRepository(SupabaseRepository):

    def listar_instituciones(self) -> List[Dict[str, Any]]:
        return self._filas(self._query("institucion").select("*").order("ins_id_institucion").execute())

    def listar_dependencias(self, institucion_id: Optional[int] = None) -> List[Dict[str, Any]]:
        query = self._query("dependencia").select("*").order("dep_id_dependencia")
        if institucion_id is not None:
            query = query.eq("ins_id_institucion", institucion_id)
        return self._filas(query.execute())

    def listar_sedes(self, dependencia_id: Optional[int] = None) -> List[Dict[str, Any]]:
        query = self._query("sede").select("*").order("sed_id_sede")
        if dependencia_id is not None:
            query = query.eq("dep_id_dependencia", dependencia_id)
        return self._filas(query.execute())

    def listar_cargos(self) -> List[Dict[str, Any]]:
        return self._filas(self._query("cargo").select("car_id_cargo, car_nombre_cargo").order("car_id_cargo").execute())
