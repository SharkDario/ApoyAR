# backend/app/routers/usuarios.py
# ─────────────────────────────────────────────────────────────────────────────
# Endpoints de Gestión Soberana de Usuario y Privacidad (Ley 25.326)
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict

from fastapi import APIRouter, Depends

from app.dependencies import get_cuenta_service
from app.services.auth_dependencies import get_current_active_user
from app.services.cuenta_service import CuentaService

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
    2. Borra en cascada atómica todas las evidencias, incidentes, reportes, red de apoyo y perfiles.
    3. Elimina definitivamente la cuenta de autenticación en Supabase Auth (auth.users).
    Esta acción es permanente, soberana e irreversible.
    """,
)
async def eliminar_mi_cuenta(
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: CuentaService = Depends(get_cuenta_service),
):
    user_id = str(current_user["id"])
    service.eliminar_cuenta(user_id)
    return {
        "status": "ok",
        "usuario_id": user_id,
        "mensaje": "Tu cuenta y todos tus datos personales han sido eliminados permanentemente conforme al Art. 16 de la Ley N.° 25.326.",
    }
