# backend/app/services/autenticacion_institucional_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Autenticación de operadores del Panel Web (Autoridad / Administrador),
# autenticación móvil protegida contra fuerza bruta, y recuperación de
# contraseña unificada mediante OTP de Supabase Auth.
# ─────────────────────────────────────────────────────────────────────────────

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import jwt

from app.config import Settings
from app.errors import (
    AccesoDenegadoError,
    BloqueoTemporalError,
    ErrorInternoError,
    NoAutenticadoError,
    SolicitudInvalidaError,
)
from app.repositories.auth_gateway import SupabaseAuthGateway
from app.repositories.perfil_repository import PerfilRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.services.password_policy import hash_institutional_password, validar_complejidad_password
from app.services.roles import ROL_AUTORIDAD, ROL_CIVIL, leer_perfil_asignado

# Id fijo del perfil Civil (migración 021), por si la búsqueda por nombre no devuelve nada
PERFIL_CIVIL_ID = "41909988-8cb7-44db-81c6-4699c2401d40"
from app.services.seguridad_login_service import SeguridadLoginService

logger = logging.getLogger("apoyar.admin_autoridad")

MENSAJE_RECUPERACION = "Si el correo está registrado, recibirás un código de 6 dígitos."
MENSAJE_RESTABLECIDA = "Contraseña restablecida exitosamente. Ya puede iniciar sesión con su nueva clave."
DURACION_TOKEN_HORAS = 24


class AutenticacionInstitucionalService:

    def __init__(
        self,
        settings: Settings,
        auth_gateway: SupabaseAuthGateway,
        perfiles: PerfilRepository,
        usuarios: UsuarioRepository,
        seguridad_login: Optional[SeguridadLoginService] = None,
    ):
        self._settings = settings
        self._auth = auth_gateway
        self._perfiles = perfiles
        self._usuarios = usuarios
        self._seguridad = seguridad_login

    def consultar_estado_bloqueo(self, email: str) -> Dict[str, Any]:
        """Consulta el estado de bloqueo para un email sin revelar existencia."""
        if not self._seguridad:
            return {"bloqueado": False, "segundos_restantes": 0, "intentos_fallidos": 0, "bloqueado_hasta": None}
        return self._seguridad.verificar_estado_bloqueo(email)

    def login_institucional(self, email: str, password: str) -> Dict[str, Any]:
        """
        1. Verifica que la cuenta no esté bajo bloqueo temporal (3 intentos / 15 min).
        2. Autentica la credencial unificada contra Supabase Auth.
        3. Exige al menos un rol institucional no suspendido ni revocado.
        4. Si el login es exitoso, resetea el contador de intentos fallidos.
        5. Emite un JWT HS256 de 24 h con los roles institucionales.
        """
        email_clean = email.strip().lower()

        if self._seguridad:
            self._seguridad.exigir_no_bloqueado(email_clean)

        try:
            user_id = self._auth.iniciar_sesion(email_clean, password)
        except BloqueoTemporalError:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            logger.warning("Fallo de autenticación unificada para %s: %s", email_clean, exc)
            # Solo contabilizar si es fallo de credenciales
            if "invalid" in msg or "grant" in msg or "credential" in msg or "password" in msg:
                if self._seguridad:
                    self._seguridad.registrar_fallo(email_clean)
            raise NoAutenticadoError("Credenciales incorrectas o usuario inexistente.", con_desafio_bearer=False)

        if self._seguridad:
            self._seguridad.registrar_exito(email_clean)

        roles = self._roles_institucionales(user_id)
        permisos = self._permisos_institucionales(user_id)

        signing_secret = self._settings.supabase_jwt_secret or self._settings.api_secret_key
        jwt_claims = {
            "sub": user_id,
            "email": email_clean,
            "role": "authenticated",
            "aud": self._settings.supabase_jwt_audience,
            "iss": self._settings.jwt_issuer,
            "exp": datetime.now(timezone.utc) + timedelta(hours=DURACION_TOKEN_HORAS),
            "roles": roles,
        }
        token = jwt.encode(jwt_claims, signing_secret, algorithm="HS256")

        return {
            "status": "ok",
            "access_token": token,
            "token_type": "bearer",
            "expires_in": DURACION_TOKEN_HORAS * 3600,
            "user": {"id": user_id, "email": email_clean},
            "usuario": {"id": user_id, "email": email_clean},
            "roles": roles,
            "permisos": permisos,
        }

    def _permisos_institucionales(self, user_id: str) -> List[str]:
        """Permisos de los perfiles institucionales activos (los que usa el panel para mostrar secciones)."""
        permisos: set = set()
        try:
            for r in self._perfiles.listar_asignaciones_de_usuario(user_id):
                perfil = leer_perfil_asignado(r)
                if perfil["tipo"] == "institucional" and perfil["activo"] and perfil["estado"] == "activo":
                    permisos |= perfil["permisos"]
        except Exception as exc:
            logger.warning("Aviso leyendo permisos de %s: %s", user_id, exc)
        return sorted(permisos)

    def login_movil(self, email: str, password: str) -> Dict[str, Any]:
        """
        Autenticación protegida para la aplicación móvil ApoyAR.
        1. Comprueba bloqueo temporal (3 fallos / 15 min).
        2. Autentica contra Supabase GoTrue.
        3. Si éxito, resetea intentos y retorna access_token + refresh_token.
        4. Si fallo por credenciales, contabiliza intento y bloquea si llega a 3.
        """
        email_clean = email.strip().lower()

        if self._seguridad:
            self._seguridad.exigir_no_bloqueado(email_clean)

        try:
            res = self._auth.iniciar_sesion_con_sesion(email_clean, password)
            if not res or not res.session or not res.user:
                raise NoAutenticadoError("Credenciales incorrectas.", con_desafio_bearer=False)
        except BloqueoTemporalError:
            raise
        except Exception as exc:
            msg = str(exc).lower()
            logger.warning("Fallo de autenticación móvil para %s: %s", email_clean, exc)
            if "invalid" in msg or "grant" in msg or "credential" in msg or "password" in msg:
                if self._seguridad:
                    self._seguridad.registrar_fallo(email_clean)
            raise NoAutenticadoError("Credenciales incorrectas. Revisá tu correo y contraseña.", con_desafio_bearer=False)

        if self._seguridad:
            self._seguridad.registrar_exito(email_clean)

        self._asegurar_perfil_civil(str(res.user.id))

        return {
            "status": "ok",
            "session": {
                "access_token": res.session.access_token,
                "refresh_token": res.session.refresh_token,
                "token_type": getattr(res.session, "token_type", "bearer") or "bearer",
                "expires_in": getattr(res.session, "expires_in", 3600),
                "expires_at": getattr(res.session, "expires_at", None),
            },
            "user": {
                "id": str(res.user.id),
                "email": res.user.email,
            },
        }

    def _asegurar_perfil_civil(self, user_id: str) -> None:
        """
        Un operador del panel no recibe el perfil Civil al darse de alta (migración 016).
        Si entra a la app móvil con su misma cuenta, se le asigna en ese momento para
        que pueda activar el Modo Resguardo y recibir alertas. Un error acá no impide el ingreso.
        """
        try:
            ids_civil = self._perfiles.buscar_ids_perfil(ROL_CIVIL) or [PERFIL_CIVIL_ID]
            if any(self._perfiles.existe_asignacion(user_id, pid) for pid in ids_civil):
                return
            self._perfiles.insertar_asignacion({
                "usu_id_usuario": user_id,
                "prf_id_perfil": ids_civil[0],
                "usuprf_estado_aprobacion": "activo",
                "usuprf_notas": "Perfil civil asignado al iniciar sesión en la app móvil",
            })
            logger.info("Perfil Civil asignado a %s al ingresar a la app móvil", user_id)
        except Exception as exc:
            logger.warning("No se pudo asignar el perfil Civil a %s: %s", user_id, exc)

    def _roles_institucionales(self, user_id: str) -> List[str]:
        roles: List[str] = []
        try:
            estados = []
            # Cualquier perfil institucional activo da acceso al panel: los de
            # sistema (Autoridad, Administrador) y los personalizados del Administrador.
            for r in self._perfiles.listar_asignaciones_de_usuario(user_id):
                perfil = leer_perfil_asignado(r)
                if perfil["tipo"] == "institucional" and perfil["activo"]:
                    roles.append(perfil["nombre"])
                    estados.append(perfil["estado"])

            if not roles:
                raise AccesoDenegadoError("Acceso denegado: El usuario no cuenta con un perfil institucional para el panel web.")
            if all(estado in ("suspendido", "revocado") for estado in estados):
                raise AccesoDenegadoError("Acceso denegado: Cuenta de operador suspendida. Comuníquese con la administración del sistema.")
        except AccesoDenegadoError:
            raise
        except Exception as exc:
            logger.error("Error verificando roles de operador: %s", exc)
            roles = [ROL_AUTORIDAD]
        return roles

    def solicitar_recuperacion(self, email: str) -> Dict[str, Any]:
        """Respuesta neutra: no revela si el correo existe."""
        email_clean = email.strip().lower()
        try:
            self._auth.solicitar_recuperacion(email_clean)
        except Exception as exc:
            logger.warning("Fallo al solicitar reset de contraseña para %s: %s", email_clean, exc)
        return {"status": "ok", "message": MENSAJE_RECUPERACION, "mensaje": MENSAJE_RECUPERACION}

    def confirmar_recuperacion(self, email: str, codigo: str, nueva_password: str) -> Dict[str, Any]:
        """Verifica el OTP, aplica la nueva contraseña en Supabase Auth y sincroniza `usu_password_hash`."""
        email_clean = email.strip().lower()
        validar_complejidad_password(nueva_password)

        codigo = (codigo or "").strip()
        if not codigo:
            raise SolicitudInvalidaError("Debe proporcionar el código de 6 dígitos.")

        try:
            user_id = self._auth.verificar_otp_recuperacion(email_clean, codigo)
        except Exception as exc:
            logger.info("verify_otp falló para %s: %s", email_clean, exc)
            raise SolicitudInvalidaError("El código es incorrecto o ha expirado.")

        try:
            self._auth.actualizar_password(user_id, nueva_password)
        except Exception as exc:
            logger.error("Error restableciendo contraseña unificada en Supabase Auth para %s: %s", email_clean, exc)
            raise ErrorInternoError("No se pudo actualizar la contraseña. Intente nuevamente más tarde.")

        try:
            self._usuarios.actualizar_password_hash(user_id, hash_institutional_password(nueva_password))
        except Exception as e:
            logger.warning("No se pudo actualizar password_hash en public.usuario para %s: %s", email_clean, e)

        # Si había intentos fallidos acumulados en esta cuenta, se restablecen al recuperar
        if self._seguridad:
            self._seguridad.registrar_exito(email_clean)

        return {"status": "ok", "message": MENSAJE_RESTABLECIDA, "mensaje": MENSAJE_RESTABLECIDA}
