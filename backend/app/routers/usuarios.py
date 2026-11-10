# backend/app/routers/usuarios.py
# ─────────────────────────────────────────────────────────────────────────────
# Endpoints de Gestión Soberana de Usuario y Privacidad (Ley 25.326)
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.config import settings
from app.dependencies import get_cuenta_service, get_operador_service
from app.services.auth_dependencies import get_current_active_user
from app.services.cuenta_service import CuentaService
from app.services.operador_service import OperadorService


class ValidarRegistroRequest(BaseModel):
    email: Optional[str] = Field(default=None, max_length=254)
    dni: Optional[str] = Field(default=None, max_length=20)
    telefono: Optional[str] = Field(default=None, max_length=20)


# Mensajes para quien se registra en la app (la validación es la misma del alta de operadores)
_MENSAJES_REGISTRO = {
    "email": "Ya existe una cuenta con este correo. Si es tuya (por ejemplo, del panel web), iniciá sesión con ella.",
    "dni": "Ya hay una cuenta registrada con este DNI.",
    "telefono": "Este número de teléfono ya está registrado en otra cuenta.",
}

router = APIRouter(
    prefix="/api/v1/usuarios",
    tags=["usuarios", "privacidad", "ley-25326"],
)


@router.delete(
    "/me",
    summary="Eliminar cuenta y suprimir todos los datos personales (Art. 16 Ley 25.326)",
    description="""
    Ejecuta el Derecho de Supresión y Olvido garantizado por la Ley N.° 25.326:
    1. Elimina todos los archivos cifrados de evidencia en Supabase Storage (bucket evidencias).
    2. En un solo paso borra las evidencias, reportes, red de apoyo, perfiles y datos personales, y conserva
       los incidentes del Modo Resguardo disociados (sin dueño, nombre, dirección ni notas) para las estadísticas.
    3. Elimina definitivamente la cuenta de autenticación en Supabase Auth (auth.users).
    Esta acción es permanente, soberana e irreversible.
    """,
)
async def eliminar_mi_cuenta(
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: CuentaService = Depends(get_cuenta_service),
):
    user_id = str(current_user["id"])
    resultado = service.eliminar_cuenta(user_id)
    return {
        "status": "ok",
        "usuario_id": user_id,
        "incidentes_anonimizados": resultado.get("incidentes_anonimizados", 0),
        "mensaje": "Tu cuenta, tus datos personales y tus pruebas fueron eliminados de forma permanente (Art. 16 de la Ley N.° 25.326). Tus emergencias se conservan solo como datos estadísticos, sin nada que te identifique.",
    }


@router.post(
    "/validar-registro",
    summary="Comprobar antes del registro que el correo, el DNI y el teléfono no estén en uso",
    description="Lo usa la app móvil antes de crear la cuenta. Requiere X-Api-Secret, porque todavía no hay sesión.",
)
async def validar_registro(
    body: ValidarRegistroRequest,
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: OperadorService = Depends(get_operador_service),
):
    if not (x_api_secret and settings.api_secret_key and x_api_secret == settings.api_secret_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="X-Api-Secret inválido o ausente.")
    resultado = service.validar_unicidad_operador(email=body.email, dni=body.dni, telefono=body.telefono)
    errores = {campo: _MENSAJES_REGISTRO.get(campo, mensaje) for campo, mensaje in resultado["errores"].items()}
    return {"disponible": not errores, "errores": errores}
