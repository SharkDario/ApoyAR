# backend/app/main.py
# ─────────────────────────────────────────────────────────────────────────────
# Punto de entrada del backend FastAPI de ApoyAR.
# ─────────────────────────────────────────────────────────────────────────────

import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.errors import AppError, BloqueoTemporalError
from app.routers import incidentes, evidencias, acustico, admin_autoridad, usuarios

logger = logging.getLogger("apoyar.backend")

app = FastAPI(
    title="ApoyAR API",
    description="Backend de la plataforma de protección y preservación forense ApoyAR.",
    version="0.3.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    """Traduce los errores de la capa de servicios al formato de HTTPException."""
    content: dict = {"detail": exc.detail}
    if isinstance(exc, BloqueoTemporalError):
        content.update({
            "bloqueado": True,
            "segundos_restantes": exc.segundos_restantes,
            "bloqueado_hasta": exc.bloqueado_hasta,
            "intentos_fallidos": exc.intentos_fallidos,
        })
    return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Excepción no controlada en %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:8082",
        "http://127.0.0.1:8082",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length", "X-Manifest-Hash"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(incidentes.router)
app.include_router(evidencias.router)
app.include_router(acustico.router)
app.include_router(admin_autoridad.router)
app.include_router(usuarios.router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["sistema"])
async def health_check():
    """Verificación de estado del servidor. Útil para monitoreo y CI."""
    return {"status": "ok", "version": "0.2.0"}
