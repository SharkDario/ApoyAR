# backend/app/repositories/auth_gateway.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a Supabase Auth (GoTrue): cuentas en `auth.users`.
#
# - Operaciones administrativas con el cliente service_role del backend.
# - Operaciones de sesión del usuario final (login, OTP de recuperación) con un
#   cliente anónimo nuevo por llamada, para no contaminar la sesión compartida.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Callable, Dict, List

from supabase import Client


class SupabaseAuthGateway:

    def __init__(self, admin_client: Client, crear_cliente_anonimo: Callable[[], Client]):
        self._admin = admin_client
        self._crear_cliente_anonimo = crear_cliente_anonimo

    # ── Administración (service_role) ────────────────────────────────────────

    def obtener_usuario(self, usuario_id: str) -> Any:
        """Devuelve el objeto `user` de GoTrue o None."""
        respuesta = self._admin.auth.admin.get_user_by_id(usuario_id)
        return respuesta.user if respuesta else None

    def listar_usuarios(self) -> List[Any]:
        respuesta = self._admin.auth.admin.list_users()
        usuarios = getattr(respuesta, "users", respuesta)
        return usuarios if isinstance(usuarios, list) else []

    def crear_usuario(self, atributos: Dict[str, Any]) -> str:
        nuevo = self._admin.auth.admin.create_user(atributos)
        return str(nuevo.user.id)

    def actualizar_password(self, usuario_id: str, password: str) -> None:
        self._admin.auth.admin.update_user_by_id(usuario_id, {"password": password})

    def eliminar_usuario(self, usuario_id: str) -> None:
        self._admin.auth.admin.delete_user(usuario_id)

    # ── Sesión del usuario final (cliente anónimo) ───────────────────────────

    def iniciar_sesion(self, email: str, password: str) -> str:
        """Autentica la credencial y devuelve el UUID del usuario."""
        res = self._crear_cliente_anonimo().auth.sign_in_with_password({"email": email, "password": password})
        return str(res.user.id)

    def iniciar_sesion_con_sesion(self, email: str, password: str) -> Any:
        """Autentica la credencial y devuelve la respuesta GoTrue completa (user + session)."""
        return self._crear_cliente_anonimo().auth.sign_in_with_password({"email": email, "password": password})

    def solicitar_recuperacion(self, email: str) -> None:
        self._crear_cliente_anonimo().auth.reset_password_for_email(email)

    def verificar_otp_recuperacion(self, email: str, codigo: str) -> str:
        res = self._crear_cliente_anonimo().auth.verify_otp({"email": email, "token": codigo, "type": "recovery"})
        return str(res.user.id)
