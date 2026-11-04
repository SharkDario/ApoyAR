# backend/app/repositories/perfil_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de perfiles y permisos (RBAC dinámico):
#   perfil, usuario_tiene_perfil, permiso (con modulo y accion) y
#   perfil_tiene_permiso.
# ─────────────────────────────────────────────────────────────────────────────

import logging
from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository

logger = logging.getLogger("apoyar.perfiles")

# Perfil con sus permisos (migración 021). Si las columnas nuevas todavía no
# existen, se usa la consulta básica y los permisos salen del respaldo en código.
_SELECT_PERFIL_COMPLETO = "perfil(prf_nombre, prf_activo, prf_tipo, perfil_tiene_permiso(permiso(prm_nombre)))"
_SELECT_PERFIL_BASICO = "perfil(prf_nombre)"


class PerfilRepository(SupabaseRepository):
    tabla = "usuario_tiene_perfil"

    # ── Asignaciones de perfiles a usuarios ──────────────────────────────────

    def _asignaciones(self, columnas: str, filtro=None) -> List[Dict[str, Any]]:
        for perfil in (_SELECT_PERFIL_COMPLETO, _SELECT_PERFIL_BASICO):
            try:
                consulta = self._query().select(f"{columnas}, {perfil}")
                if filtro:
                    consulta = filtro(consulta)
                return self._filas(consulta.execute())
            except Exception as exc:
                if perfil == _SELECT_PERFIL_BASICO:
                    raise
                logger.warning("Consulta de permisos no disponible (¿falta la migración 021?): %s", exc)
        return []

    def listar_asignaciones_de_usuario(self, usuario_id: str) -> List[Dict[str, Any]]:
        return self._asignaciones(
            "prf_id_perfil, usuprf_estado_aprobacion",
            lambda q: q.eq("usu_id_usuario", usuario_id),
        )

    def listar_asignaciones_de_usuarios(self, usuario_ids: List[str]) -> List[Dict[str, Any]]:
        return self._asignaciones(
            "usu_id_usuario, prf_id_perfil, usuprf_estado_aprobacion",
            lambda q: q.in_("usu_id_usuario", usuario_ids),
        )

    def listar_todas_las_asignaciones(self) -> List[Dict[str, Any]]:
        return self._asignaciones(
            "usu_id_usuario, prf_id_perfil, usuprf_estado_aprobacion, usu_id_aprobado_por, usuprf_aprobado_en, usuprf_notas"
        )

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

    def contar_asignaciones_de_perfil(self, perfil_id: str) -> int:
        res = self._query().select("usu_id_usuario", count="exact").eq("prf_id_perfil", perfil_id).execute()
        return res.count or 0

    # ── Catálogo de perfiles ─────────────────────────────────────────────────

    def listar_perfiles(self) -> List[Dict[str, Any]]:
        res = (
            self._query("perfil")
            .select("prf_id_perfil, prf_nombre, prf_descripcion, prf_activo, prf_tipo, prf_sistema, "
                    "perfil_tiene_permiso(permiso(prm_nombre))")
            .order("prf_nombre")
            .execute()
        )
        return self._filas(res)

    def obtener_perfil(self, perfil_id: str) -> Optional[Dict[str, Any]]:
        res = (
            self._query("perfil")
            .select("prf_id_perfil, prf_nombre, prf_descripcion, prf_activo, prf_tipo, prf_sistema")
            .eq("prf_id_perfil", perfil_id)
            .execute()
        )
        return self._primera_fila(res)

    def obtener_perfiles_por_nombre(self, nombres: List[str]) -> List[Dict[str, Any]]:
        if not nombres:
            return []
        res = (
            self._query("perfil")
            .select("prf_id_perfil, prf_nombre, prf_activo, prf_tipo, prf_sistema")
            .in_("prf_nombre", nombres)
            .execute()
        )
        return self._filas(res)

    def insertar_perfil(self, datos: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._primera_fila(self._query("perfil").insert(datos).execute())

    def actualizar_perfil(self, perfil_id: str, campos: Dict[str, Any]) -> None:
        self._query("perfil").update(campos).eq("prf_id_perfil", perfil_id).execute()

    def eliminar_perfil(self, perfil_id: str) -> None:
        self._query("perfil").delete().eq("prf_id_perfil", perfil_id).execute()

    # ── Catálogo de permisos ─────────────────────────────────────────────────

    def listar_permisos(self) -> List[Dict[str, Any]]:
        res = (
            self._query("permiso")
            .select("prm_id_permiso, prm_nombre, prm_descripcion, prm_ambito, modulo(mod_nombre), accion(acc_nombre)")
            .order("prm_nombre")
            .execute()
        )
        return self._filas(res)

    def reemplazar_permisos_de_perfil(self, perfil_id: str, permiso_ids: List[str]) -> None:
        self._query("perfil_tiene_permiso").delete().eq("prf_id_perfil", perfil_id).execute()
        if permiso_ids:
            self._query("perfil_tiene_permiso").insert(
                [{"prf_id_perfil": perfil_id, "prm_id_permiso": pid} for pid in permiso_ids]
            ).execute()
