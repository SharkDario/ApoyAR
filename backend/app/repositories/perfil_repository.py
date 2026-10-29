# backend/app/repositories/perfil_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de roles: catálogo `perfil` y asignaciones `usuario_tiene_perfil`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository


class PerfilRepository(SupabaseRepository):
    tabla = "usuario_tiene_perfil"

    def listar_asignaciones_de_usuario(self, usuario_id: str) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("prf_id_perfil, usuprf_estado_aprobacion, perfil(prf_nombre)")
            .eq("usu_id_usuario", usuario_id)
            .execute()
        )
        return self._filas(res)

    def listar_asignaciones_de_usuarios(self, usuario_ids: List[str]) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("usu_id_usuario, usuprf_estado_aprobacion, perfil(prf_nombre)")
            .in_("usu_id_usuario", usuario_ids)
            .execute()
        )
        return self._filas(res)

    def listar_todas_las_asignaciones(self) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("usu_id_usuario, prf_id_perfil, usuprf_estado_aprobacion, usu_id_aprobado_por, usuprf_aprobado_en, usuprf_notas, perfil(prf_nombre, prf_descripcion)")
            .execute()
        )
        return self._filas(res)

    def buscar_ids_perfil(self, nombre: str) -> List[Any]:
        """IDs del catálogo `perfil` cuyo nombre coincide sin distinguir mayúsculas."""
        res = self._query("perfil").select("prf_id_perfil").ilike("prf_nombre", nombre).execute()
        return [fila["prf_id_perfil"] for fila in self._filas(res)]

    def existe_asignacion(self, usuario_id: str, perfil_id: Any) -> bool:
        res = (
            self._query()
            .select("usu_id_usuario")
            .eq("usu_id_usuario", usuario_id)
            .eq("prf_id_perfil", perfil_id)
            .execute()
        )
        return bool(res.data)

    def insertar_asignacion(self, datos: Dict[str, Any]) -> None:
        self._query().insert(datos).execute()

    def upsert_asignacion(self, datos: Dict[str, Any]) -> None:
        self._query().upsert(datos).execute()

    def eliminar_asignacion(self, usuario_id: str, perfil_id: Any) -> None:
        self._query().delete().eq("usu_id_usuario", usuario_id).eq("prf_id_perfil", perfil_id).execute()

    def actualizar_asignaciones_de_usuario(self, usuario_id: str, campos: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
        res = self._query().update(campos).eq("usu_id_usuario", usuario_id).execute()
        return self._filas(res)
