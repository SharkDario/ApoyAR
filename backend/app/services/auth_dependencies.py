# backend/app/services/auth_dependencies.py
# ─────────────────────────────────────────────────────────────────────────────
# Dependencias FastAPI de autenticación y autorización (capa de presentación).
#
#   1. get_current_user: extrae el Bearer (header o ?token=) y lo valida con
#      JwtVerifier (firma, exp, iss, aud, sub).
#   2. get_current_active_user: CuentaService comprueba la cuenta y resuelve
#      los roles con aprobación 'activo'.
#   3. require_role: RBAC por rol. La autorización por recurso (Anti-IDOR) la
#      aplican los servicios mediante AccessControlService.
#   4. Validación del encabezado X-Api-Secret del servicio móvil en segundo plano.
#
# Los errores de aplicación se traducen aquí a HTTPException.
# ─────────────────────────────────────────────────────────────────────────────

from contextlib import contextmanager
from typing import Any, Callable, Dict, List, Optional

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.database import supabase_admin
from app.dependencies import get_cuenta_service
from app.errors import AppError
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.services.access_control import AccessControlService
from app.services.cuenta_service import CuentaService
from app.services.jwt_verifier import JwtVerifier
from app.services.roles import normalizar_rol

__all__ = [
    "configurar_clave_test",
    "exigir_usuario_o_api_secret",
    "get_current_active_user",
    "get_current_user",
    "get_optional_current_active_user",
    "normalizar_rol",
    "rechazar_api_secret_invalido",
    "require_role",
    "verify_evidence_access",
    "verify_incident_ownership",
]

security_bearer = HTTPBearer(auto_error=False)

# Instancia compartida: conserva en memoria la caché JWKS de Supabase Auth
jwt_verifier = JwtVerifier(settings)


def configurar_clave_test(clave: Optional[str], algoritmo: Optional[str] = "HS256") -> None:
    """Permite a la suite de pruebas inyectar claves locales sin conexión de red."""
    jwt_verifier.configurar_clave_test(clave, algoritmo)


@contextmanager
def _como_http_exception():
    try:
        yield
    except AppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail, headers=exc.headers)


# ── 1. Autenticación ─────────────────────────────────────────────────────────

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Acepta el token por Header Authorization Bearer o por Query Parameter (?token=)."""
    raw_token = None
    if credentials and credentials.credentials:
        raw_token = credentials.credentials.strip()
    elif token and token.strip():
        raw_token = token.strip()

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Falta el encabezado de autorización Bearer.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    with _como_http_exception():
        return jwt_verifier.verificar(raw_token)


async def get_current_active_user(
    current_user: Dict[str, Any] = Depends(get_current_user),
    cuentas: CuentaService = Depends(get_cuenta_service),
) -> Dict[str, Any]:
    with _como_http_exception():
        return cuentas.resolver_usuario_activo(current_user)


async def get_optional_current_active_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    cuentas: CuentaService = Depends(get_cuenta_service),
) -> Optional[Dict[str, Any]]:
    """
    Sin encabezado Bearer devuelve None para permitir X-Api-Secret (servicio
    móvil en segundo plano). Un Bearer malformado o vencido produce 401.
    """
    if not credentials or not credentials.credentials:
        return None
    with _como_http_exception():
        identidad = jwt_verifier.verificar(credentials.credentials.strip())
        return cuentas.resolver_usuario_activo(identidad)


def require_role(allowed_roles: List[str]) -> Callable:
    """Exige al menos uno de los roles indicados."""
    normalized_allowed = list(dict.fromkeys(normalizar_rol(r) for r in allowed_roles))

    async def _role_checker(user: Dict[str, Any] = Depends(get_current_active_user)) -> Dict[str, Any]:
        user_roles = list(dict.fromkeys(user.get("roles", [])))
        if not set(user_roles).intersection(normalized_allowed):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso denegado: Se requiere uno de los roles {normalized_allowed}. Roles actuales: {user_roles}",
            )
        return user

    return _role_checker


# ── 2. X-Api-Secret ──────────────────────────────────────────────────────────

def rechazar_api_secret_invalido(x_api_secret: Optional[str]) -> None:
    """Si se envía X-Api-Secret, debe ser el correcto."""
    if x_api_secret and x_api_secret != settings.api_secret_key:
        raise HTTPException(status_code=401, detail="Invalid API Secret")


def exigir_usuario_o_api_secret(current_user: Optional[Dict[str, Any]], x_api_secret: Optional[str]) -> None:
    """Autenticación dual: Bearer de usuario activo o X-Api-Secret válido."""
    is_api_secret_valid = bool(x_api_secret and settings.api_secret_key and x_api_secret == settings.api_secret_key)
    if x_api_secret and not is_api_secret_valid:
        raise HTTPException(status_code=401, detail="Invalid API Secret")
    if not current_user and not is_api_secret_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Falta encabezado de autorización Bearer o X-Api-Secret válido.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── 3. Adaptadores de compatibilidad (scripts y pruebas existentes) ──────────

def _control_de_acceso_por_defecto() -> AccessControlService:
    return AccessControlService(
        IncidenteRepository(supabase_admin),
        EvidenciaRepository(supabase_admin),
        RedApoyoRepository(supabase_admin),
        CargoInstitucionalRepository(supabase_admin),
    )


async def verify_incident_ownership(
    incidente_id: str,
    user: Dict[str, Any],
    action: str = "read",
    control: Optional[AccessControlService] = None,
) -> Dict[str, Any]:
    """Delegado a AccessControlService.verificar_acceso_incidente (errores como HTTPException)."""
    with _como_http_exception():
        return (control or _control_de_acceso_por_defecto()).verificar_acceso_incidente(incidente_id, user, action)


async def verify_evidence_access(
    evidencia_id: str,
    user: Dict[str, Any],
    action: str = "audit",
    control: Optional[AccessControlService] = None,
) -> Dict[str, Any]:
    """Delegado a AccessControlService.verificar_acceso_evidencia (errores como HTTPException)."""
    with _como_http_exception():
        return (control or _control_de_acceso_por_defecto()).verificar_acceso_evidencia(evidencia_id, user, action)
