# backend/app/errors.py
# ─────────────────────────────────────────────────────────────────────────────
# Errores de aplicación independientes de HTTP.
#
# Los servicios (capa de negocio) lanzan estas excepciones; la capa de
# presentación las traduce a respuestas HTTP con el mismo formato que
# FastAPI usa para HTTPException: {"detail": "..."} + headers opcionales.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Dict, Optional


class AppError(Exception):
    """Error de aplicación con código de estado HTTP equivalente."""

    status_code: int = 500

    def __init__(self, detail: str, headers: Optional[Dict[str, str]] = None):
        super().__init__(detail)
        self.detail = detail
        self.headers = headers


class SolicitudInvalidaError(AppError):
    status_code = 400


class NoAutenticadoError(AppError):
    status_code = 401

    def __init__(self, detail: str, con_desafio_bearer: bool = True):
        super().__init__(detail, headers={"WWW-Authenticate": "Bearer"} if con_desafio_bearer else None)


class AccesoDenegadoError(AppError):
    status_code = 403


class RecursoNoEncontradoError(AppError):
    status_code = 404


class ContenidoNoProcesableError(AppError):
    status_code = 422


class BloqueoTemporalError(AppError):
    status_code = 429

    def __init__(
        self,
        detail: str,
        segundos_restantes: int = 900,
        bloqueado_hasta: Optional[str] = None,
        intentos_fallidos: int = 3,
    ):
        super().__init__(detail, headers={"Retry-After": str(max(1, segundos_restantes))})
        self.segundos_restantes = segundos_restantes
        self.bloqueado_hasta = bloqueado_hasta
        self.intentos_fallidos = intentos_fallidos


class ErrorInternoError(AppError):
    status_code = 500


class ServicioExternoError(AppError):
    status_code = 502
