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
from app.services.roles import ROL_CIVIL, leer_perfil_asignado, permisos_por_defecto

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
        permisos: set = set()
        try:
            for row in self._perfiles.listar_asignaciones_de_usuario(user_id):
                perfil = leer_perfil_asignado(row)
                if perfil["estado"] != "activo" or not perfil["activo"] or not perfil["nombre"]:
                    continue
                roles.append(perfil["nombre"])
                permisos |= perfil["permisos"]
        except Exception as exc:
            logger.warning("Aviso consultando perfiles de %s: %s", user_id, exc)

        if not roles:
            roles = [ROL_CIVIL]
            permisos = permisos_por_defecto(roles)

        # Sin duplicados y en orden estable (el orden de un set variaba entre procesos)
        identidad["roles"] = list(dict.fromkeys(roles))
        identidad["permisos"] = sorted(permisos)
        return identidad

    def eliminar_cuenta(self, usuario_id: str) -> Dict[str, Any]:
        """
        Derecho de supresión (Art. 16 Ley 25.326):
        1) Borra de Storage los archivos de las pruebas de la persona.
        2) Ejecuta `fn_eliminar_cuenta_usuario` en la base, en un solo paso: borra las
           pruebas, la red de apoyo, los perfiles, los datos personales y la cuenta, y
           conserva los incidentes disociados (sin dueño, nombre, dirección ni notas y
           con las coordenadas redondeadas) para las estadísticas (migración 024).
        Si la base no completa la operación, no se informa éxito.
        """
        logger.info("Iniciando supresión de la cuenta %s (Art. 16 Ley 25.326)", usuario_id)

        # 1. Archivos de las pruebas (la base no puede borrar objetos de Storage)
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

        # 2. Supresión atómica en la base, con incidentes anonimizados
        try:
            resultado = self._usuarios.eliminar_cuenta_en_cascada(usuario_id) or {}
        except Exception as exc:
            logger.error("La supresión de la cuenta %s no se completó: %s", usuario_id, exc)
            raise ErrorInternoError("No se pudo eliminar la cuenta. No se borró ningún dato; intentá de nuevo más tarde.")
        logger.info(
            "Cuenta %s eliminada: %s evidencias borradas, %s incidentes anonimizados",
            usuario_id, resultado.get("evidencias_eliminadas"), resultado.get("incidentes_anonimizados"),
        )
        return resultado
