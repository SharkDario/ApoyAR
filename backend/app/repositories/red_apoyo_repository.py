# backend/app/repositories/red_apoyo_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de la red de confianza: vínculos `red_apoyo` y los tokens
# Expo Push de los dispositivos (`dispositivo_usuario`) de esos contactos.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List

from app.repositories.base import SupabaseRepository


class RedApoyoRepository(SupabaseRepository):
    tabla = "red_apoyo"

    def listar_contactos_activos(self, victima_id: str) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select("usu_id_contacto")
            .eq("usu_id_victima", victima_id)
            .eq("redapo_estado", "activo")
            .execute()
        )
        return self._filas(res)

    def existe_vinculo_activo(self, victima_id: str, contacto_id: str) -> bool:
        res = (
            self._query()
            .select("redapo_id_red, redapo_estado")
            .eq("usu_id_victima", victima_id)
            .eq("usu_id_contacto", contacto_id)
            .eq("redapo_estado", "activo")
            .execute()
        )
        return bool(res.data)

    def listar_tokens_push_activos(self, usuario_ids: List[str]) -> List[Dict[str, Any]]:
        """Dispositivos activos con `disusu_expo_push_token` no nulo de los usuarios indicados."""
        res = (
            self._query("dispositivo_usuario")
            .select("usu_id_usuario, disusu_expo_push_token")
            .in_("usu_id_usuario", usuario_ids)
            .eq("disusu_activo", True)
            .not_.is_("disusu_expo_push_token", "null")
            .execute()
        )
        return self._filas(res)
