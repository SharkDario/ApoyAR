# backend/app/services/seguridad_login_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Servicio de Seguridad: Bloqueo Temporal por Intentos Fallidos de Autenticación.
#
# Política:
# - Hasta 3 intentos fallidos consecutivos.
# - Bloqueo estricto de 15 minutos (900 s).
# - Restablecimiento automático tras éxito o al expirar la ventana.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional
import logging

from app.errors import BloqueoTemporalError
from app.repositories.seguridad_login_repository import SeguridadLoginRepository

logger = logging.getLogger("apoyar.seguridad_login")

MAX_INTENTOS_CONSECUTIVOS = 3
TIEMPO_BLOQUEO_MINUTOS = 15
TIEMPO_BLOQUEO_SEGUNDOS = 900


def formatear_tiempo_restante(segundos: int) -> str:
    """Formatea los segundos restantes a un mensaje amigable y claro."""
    if segundos <= 0:
        return "menos de un segundo"
    minutos = segundos // 60
    segs = segundos % 60
    if minutos > 0 and segs > 0:
        return f"{minutos} minuto(s) y {segs} segundo(s)"
    elif minutos > 0:
        return f"{minutos} minuto(s)"
    else:
        return f"{segs} segundo(s)"


class SeguridadLoginService:

    def __init__(self, seguridad_repo: SeguridadLoginRepository):
        self._repo = seguridad_repo

    def verificar_estado_bloqueo(self, email: str) -> Dict[str, Any]:
        """
        Consulta si una cuenta está bloqueada temporalmente.
        No revela la existencia de la cuenta si no está bloqueada.
        """
        estado = self._repo.consultar_estado_bloqueo(email)
        if estado["bloqueado"]:
            tiempo_str = formatear_tiempo_restante(estado["segundos_restantes"])
            estado["mensaje"] = (
                f"Demasiados intentos fallidos. Su cuenta se encuentra bloqueada temporalmente. "
                f"Intente nuevamente en {tiempo_str}."
            )
        else:
            estado["mensaje"] = None
        return estado

    def exigir_no_bloqueado(self, email: str) -> None:
        """
        Lanza BloqueoTemporalError si la cuenta se encuentra bajo bloqueo activo.
        """
        estado = self.verificar_estado_bloqueo(email)
        if estado["bloqueado"]:
            tiempo_str = formatear_tiempo_restante(estado["segundos_restantes"])
            raise BloqueoTemporalError(
                detail=(
                    f"Demasiados intentos fallidos. Su cuenta se encuentra bloqueada temporalmente. "
                    f"Intente nuevamente en {tiempo_str}."
                ),
                segundos_restantes=estado["segundos_restantes"],
                bloqueado_hasta=estado["bloqueado_hasta"],
                intentos_fallidos=estado["intentos_fallidos"],
            )

    def registrar_exito(self, email: str) -> None:
        """Restablece el contador de intentos fallidos tras una autenticación válida."""
        self._repo.registrar_intento(email, exitoso=True)

    def registrar_fallo(self, email: str) -> Dict[str, Any]:
        """
        Registra un intento fallido y evalúa si activa el bloqueo de 15 minutos.
        Si se activa el bloqueo, lanza BloqueoTemporalError.
        """
        estado = self._repo.registrar_intento(email, exitoso=False)
        if estado["bloqueado"]:
            tiempo_str = formatear_tiempo_restante(estado["segundos_restantes"])
            raise BloqueoTemporalError(
                detail=(
                    f"Ha superado el límite de {MAX_INTENTOS_CONSECUTIVOS} intentos fallidos consecutivos. "
                    f"Su cuenta ha sido bloqueada temporalmente por {TIEMPO_BLOQUEO_MINUTOS} minutos. "
                    f"Intente nuevamente en {tiempo_str}."
                ),
                segundos_restantes=estado["segundos_restantes"],
                bloqueado_hasta=estado["bloqueado_hasta"],
                intentos_fallidos=estado["intentos_fallidos"],
            )
        return estado

