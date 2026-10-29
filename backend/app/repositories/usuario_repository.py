# backend/app/repositories/usuario_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos de identidad civil: tablas `usuario` y `persona` (3FN).
# Un `usuario` referencia a su `persona` mediante `per_id_persona`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository

# Caracteres con significado sintáctico en los filtros `or=(...)` de PostgREST.
_CARACTERES_FILTRO_POSTGREST = ",()"


class UsuarioRepository(SupabaseRepository):
    tabla = "usuario"

    # ── usuario ──────────────────────────────────────────────────────────────

    def obtener_persona(self, usuario_id: str, columnas_persona: str = "*") -> Optional[Dict[str, Any]]:
        """Devuelve la fila `persona` vinculada al usuario, o None si no existe."""
        res = (
            self._query()
            .select(f"per_id_persona, persona:per_id_persona({columnas_persona})")
            .eq("usu_id_usuario", usuario_id)
            .execute()
        )
        fila = self._primera_fila(res)
        return fila.get("persona") if fila and fila.get("persona") else None

    def obtener_id_persona(self, usuario_id: str) -> Optional[Any]:
        res = self._query().select("per_id_persona").eq("usu_id_usuario", usuario_id).execute()
        fila = self._primera_fila(res)
        return fila.get("per_id_persona") if fila else None

    def vincular_persona(self, usuario_id: str, persona_id: Any) -> None:
        self._query().update({"per_id_persona": persona_id}).eq("usu_id_usuario", usuario_id).execute()

    def upsert(self, datos: Dict[str, Any]) -> None:
        self._query().upsert(datos).execute()

    def actualizar_password_hash(self, usuario_id: str, password_hash: str) -> None:
        self._query().update({"usu_password_hash": password_hash}).eq("usu_id_usuario", usuario_id).execute()

    def eliminar_cuenta_en_cascada(self, usuario_id: str) -> Any:
        """Invoca la función SECURITY DEFINER `fn_eliminar_cuenta_usuario` (Ley 25.326)."""
        return self._client.rpc("fn_eliminar_cuenta_usuario", {"p_usuario_id": usuario_id}).execute().data

    # ── persona ──────────────────────────────────────────────────────────────

    def insertar_persona(self, datos: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        res = self._query("persona").insert(datos).execute()
        return self._primera_fila(res)

    def actualizar_persona(self, persona_id: Any, datos: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        res = self._query("persona").update(datos).eq("per_id_persona", persona_id).execute()
        return self._primera_fila(res)

    def buscar_personas_por_dni(self, dni: str) -> List[Dict[str, Any]]:
        res = (
            self._query("persona")
            .select("per_id_persona, usuario:usuario(usu_id_usuario)")
            .eq("per_dni", dni)
            .execute()
        )
        return self._filas(res)

    def buscar_personas(self, termino: str, limite: int = 20) -> List[Dict[str, Any]]:
        """Búsqueda parcial por DNI, nombre, apellido o teléfono (con su usuario)."""
        termino_seguro = "".join(c for c in termino if c not in _CARACTERES_FILTRO_POSTGREST)
        res = (
            self._query("persona")
            .select("per_id_persona, per_nombre, per_apellido, per_dni, per_genero, per_fecha_nacimiento, per_telefono, per_direccion, usuario:usuario(usu_id_usuario, usu_email)")
            .or_(
                f"per_dni.ilike.%{termino_seguro}%,per_nombre.ilike.%{termino_seguro}%,"
                f"per_apellido.ilike.%{termino_seguro}%,per_telefono.ilike.%{termino_seguro}%"
            )
            .limit(limite)
            .execute()
        )
        return self._filas(res)

    def listar_personas_de_usuarios(self, usuario_ids: List[str]) -> List[Dict[str, Any]]:
        if not usuario_ids:
            return []
        res = (
            self._query("usuario")
            .select("usu_id_usuario, per_id_persona, persona:per_id_persona(*)")
            .in_("usu_id_usuario", usuario_ids)
            .execute()
        )
        resultados = []
        for r in self._filas(res):
            p = r.get("persona")
            if p and isinstance(p, dict):
                p["usu_id_usuario"] = r.get("usu_id_usuario")
                p["usuario_id"] = r.get("usu_id_usuario")
                resultados.append(p)
        return resultados
