# backend/app/services/cuenta_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Ciclo de vida de la cuenta del usuario autenticado:
#   - Resolución de cuenta activa y roles operativos (RBAC).
#   - Derecho de supresión de la cuenta y sus datos (Art. 16 Ley 25.326).
# ─────────────────────────────────────────────────────────────────────────────

import datetime
import logging
from typing import Any, Dict, List

from app.errors import AccesoDenegadoError, ErrorInternoError
from app.repositories.auth_gateway import SupabaseAuthGateway
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.perfil_repository import PerfilRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.services.roles import ROL_VICTIMA, normalizar_rol

logger = logging.getLogger("apoyar.cuenta")


def _baneo_vigente(banned_until: Any) -> bool:
    ahora = datetime.datetime.now(datetime.timezone.utc)
    if isinstance(banned_until, datetime.datetime):
        hasta = banned_until if banned_until.tzinfo else banned_until.replace(tzinfo=datetime.timezone.utc)
        return hasta > ahora
    try:
        hasta = datetime.datetime.fromisoformat(str(banned_until).replace("Z", "+00:00"))
        if hasta.tzinfo is None:
            hasta = hasta.replace(tzinfo=datetime.timezone.utc)
        return hasta > ahora
    except ValueError:
        return str(banned_until) > ahora.isoformat()


class CuentaService:

    def __init__(
        self,
        auth_gateway: SupabaseAuthGateway,
        perfiles: PerfilRepository,
        usuarios: UsuarioRepository,
        evidencias: EvidenciaRepository,
        storage: EvidenciaStorage,
    ):
        self._auth = auth_gateway
        self._perfiles = perfiles
        self._usuarios = usuarios
        self._evidencias = evidencias
        self._storage = storage

    def resolver_usuario_activo(self, identidad: Dict[str, Any]) -> Dict[str, Any]:
        """
        Verifica que la cuenta no esté suspendida en Supabase Auth y agrega a la
        identidad los roles con aprobación 'activo' de `usuario_tiene_perfil`.
        Sin perfiles explícitos, el usuario de la app móvil opera como 'Víctima'.
        """
        user_id = identidad["id"]

        try:
            usuario_auth = self._auth.obtener_usuario(user_id)
            banned_until = getattr(usuario_auth, "banned_until", None) if usuario_auth else None
            if banned_until and _baneo_vigente(banned_until):
                raise AccesoDenegadoError("La cuenta de usuario se encuentra suspendida o deshabilitada.")
        except AccesoDenegadoError:
            raise
        except Exception as exc:
            logger.debug("Aviso consultando GoTrue para %s: %s", user_id, exc)

        roles: List[str] = []
        try:
            for row in self._perfiles.listar_asignaciones_de_usuario(user_id):
                estado_ap = row.get("usuprf_estado_aprobacion") or row.get("estado_aprobacion")
                if estado_ap and estado_ap != "activo":
                    continue
                p_data = row.get("perfil")
                if isinstance(p_data, dict):
                    nombre_p = p_data.get("prf_nombre") or p_data.get("nombre")
                    if nombre_p:
                        roles.append(normalizar_rol(nombre_p))
        except Exception as exc:
            logger.warning("Aviso consultando perfiles de %s: %s", user_id, exc)

        if not roles:
            roles = [ROL_VICTIMA]

        # Sin duplicados y en orden estable (el orden de un set variaba entre procesos)
        identidad["roles"] = list(dict.fromkeys(roles))
        return identidad

    def eliminar_cuenta(self, usuario_id: str) -> None:
        """
        Derecho de supresión: 1) purga los archivos cifrados del bucket,
        2) borra en cascada los registros (RPC SECURITY DEFINER) y
        3) elimina la cuenta de Supabase Auth.
        """
        logger.info("Iniciando supresión soberana de cuenta para usuario: %s (Art. 16 Ley 25.326)", usuario_id)

        try:
            rutas = []
            for row in self._evidencias.listar_rutas_de_usuario(usuario_id):
                ruta = EvidenciaStorage.ruta_relativa(row.get("evi_url_almacenamiento") or row.get("url_almacenamiento") or "")
                if ruta:
                    rutas.append(ruta)
            if rutas:
                logger.info("Purgando %d archivos en bucket evidencias para usuario %s", len(rutas), usuario_id)
                self._storage.eliminar(rutas)
        except Exception as st_err:
            logger.warning("Aviso purgando archivos en storage para usuario %s: %s", usuario_id, st_err)

        try:
            resultado = self._usuarios.eliminar_cuenta_en_cascada(usuario_id)
            logger.info("Resultado de RPC fn_eliminar_cuenta_usuario: %s", resultado)
        except Exception as rpc_err:
            logger.error("Error en RPC de supresión de cuenta para usuario %s: %s", usuario_id, rpc_err)
            raise ErrorInternoError(f"No se pudo completar la supresión de registros en la base de datos: {rpc_err}")

        try:
            self._auth.eliminar_usuario(usuario_id)
            logger.info("Usuario %s eliminado definitivamente de auth.users", usuario_id)
        except Exception as auth_err:
            logger.debug("Aviso en delete_user GoTrue: %s", auth_err)
