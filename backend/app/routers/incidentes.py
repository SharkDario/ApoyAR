# backend/app/routers/incidentes.py
# ─────────────────────────────────────────────────────────────────────────────
# Endpoints de Incidentes y Evidencia para ApoyAR (Fase 1 y 2).
#
# Flujo del incidente (refleja el patrón offline-first y despacho en tiempo real):
#   CLIENTE MÓVIL:
#     1. Crea el incidente directo en Supabase (RLS: victima_id = auth.uid())
#     2. Llama POST /activar → backend emite push INMEDIATAMENTE (< 500ms)
#     3. En paralelo: graba audio, calcula SHA-256, firma con Keystore y sube a Storage
#     4. Llama POST /api/v1/evidencias/sellar-forense o POST /{id}/evidencia
#     5. Envía periódicamente PATCH /{id}/posicion para telemetría GPS en tiempo real
#
# Capa de presentación: valida la entrada, autentica y delega en los servicios.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile, status

from app.config import settings
from app.dependencies import get_evidencia_service, get_incidente_service, get_persona_service
from app.schemas.incidentes import (
    ActivarIncidenteRequest,
    ActualizarConsentimientoIncidenteRequest,
    ActualizarEstadoRequest,
    ActualizarPersonaRequest,
    ActualizarPosicionRequest,
    RegistrarEvidenciaRequest,
)
from app.services.auth_dependencies import (
    exigir_usuario_o_api_secret,
    get_current_active_user,
    get_optional_current_active_user,
    rechazar_api_secret_invalido,
)
from app.services.evidencia_service import EvidenciaService
from app.services.incidente_service import IncidenteService
from app.services.persona_service import PersonaService

router = APIRouter(prefix="/api/v1/incidentes", tags=["incidentes"])


@router.post(
    "/activar",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Activar SOS y desencadenar alertas (Manual o Acústica)",
    description="""
    Recibe el evento de incidente creado por la app móvil.

    Flujo interno (IncidenteService.activar_incidente → AlertaService.desencadenar_alertas):
    1. Obtiene los tokens push de los contactos de la víctima desde Supabase.
    2. Crea registros en `alerta_temprana` (uno por contacto).
    3. Envía las push notifications vía Expo Push API de forma asincrónica.
    4. Responde al móvil con 202 ACCEPTED (RNF-01: respuesta en < 500ms).
    """,
)
async def activar_incidente(
    body: ActivarIncidenteRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: IncidenteService = Depends(get_incidente_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return service.activar_incidente(body, current_user)


@router.patch(
    "/{incidente_id}/posicion",
    summary="Actualizar telemetría GPS en tiempo real (CU-06 / RF-4.3 / RNF-01)",
    description="Actualiza las coordenadas del incidente. Dispara eventos Supabase Realtime a los contactos de emergencia conectados.",
)
async def actualizar_posicion_incidente(
    incidente_id: str,
    body: ActualizarPosicionRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: IncidenteService = Depends(get_incidente_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return service.actualizar_posicion(incidente_id, body, current_user)


@router.patch(
    "/{incidente_id}/estado",
    summary="Actualizar estado del incidente con auditoría automática (CP-IT2-07)",
    description="Modifica el estado del incidente ('cerrado', 'falso_positivo', etc.). El trigger de base de datos audita el cambio en historial_incidente.",
)
async def actualizar_estado_incidente(
    incidente_id: str,
    body: ActualizarEstadoRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: IncidenteService = Depends(get_incidente_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return service.actualizar_estado(incidente_id, body, current_user)


@router.post(
    "/{incidente_id}/evidencia",
    status_code=status.HTTP_201_CREATED,
    summary="Registrar evidencia capturada (Compatible Fase 1 y 2)",
    description="""
    Registra los metadatos de la evidencia en la base de datos bajo la arquitectura forense.
    Obtiene el TimeStampToken oficial de la TSA y encadena con el prev_hash más reciente.
    """,
)
async def registrar_evidencia(
    incidente_id: str,
    body: RegistrarEvidenciaRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: EvidenciaService = Depends(get_evidencia_service),
):
    return await service.registrar_evidencia(incidente_id, body, current_user)


@router.patch(
    "/{incidente_id}/consentimiento",
    summary="Actualizar consentimiento informado para exportación judicial (Ley 25.326)",
    description="Permite a la víctima titular autorizar o revocar el acceso institucional a sus archivos probatorios multimedia.",
)
async def actualizar_consentimiento_incidente(
    incidente_id: str,
    body: ActualizarConsentimientoIncidenteRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: IncidenteService = Depends(get_incidente_service),
):
    fecha = service.actualizar_consentimiento(
        incidente_id,
        body.consentimiento_exportacion,
        current_user,
        detalle_denegado="Acceso denegado: Solo la persona titular de los datos puede otorgar o revocar el consentimiento informado (Ley 25.326).",
    )
    return {
        "status": "ok",
        "incidente_id": incidente_id,
        "consentimiento_exportacion": body.consentimiento_exportacion,
        "fecha_consentimiento": fecha,
        "mensaje": "Consentimiento informado actualizado correctamente (Ley 25.326 / ISO 27037).",
    }


@router.get(
    "/{incidente_id}",
    summary="Consultar incidente protegido con Anti-IDOR y Gobernanza de Visibilidad",
    description="Obtiene los datos del incidente verificando que el usuario sea la víctima titular, contacto activo o autoridad, aplicando la Matriz de Visibilidad (Ley 25.326).",
)
async def obtener_incidente(
    incidente_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: IncidenteService = Depends(get_incidente_service),
):
    return {"status": "ok", "incidente": service.obtener_incidente(incidente_id, current_user)}


@router.get(
    "/persona/{usuario_id}",
    summary="Obtener perfil completo de persona",
    description="Endpoint seguro para bypassear RLS del cliente y obtener el perfil completo del usuario con verificación Anti-IDOR."
)
async def obtener_contacto_persona(
    usuario_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: PersonaService = Depends(get_persona_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return service.obtener_perfil(usuario_id, current_user)


@router.put(
    "/persona/{usuario_id}",
    summary="Actualizar perfil de persona",
    description="Actualiza los datos personales (nombre, apellido, dni, telefono, direccion) de forma segura con verificación Anti-IDOR."
)
async def actualizar_persona(
    usuario_id: str,
    body: ActualizarPersonaRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: PersonaService = Depends(get_persona_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return {"status": "ok", "data": service.actualizar_perfil(usuario_id, body, current_user)}


@router.post(
    "/red/regenerar-codigo/{usuario_id}",
    summary="Regenerar código de vinculación único",
    description="Genera un código aleatorio alfanumérico para vincular contactos con verificación Anti-IDOR."
)
async def regenerar_codigo_vinculacion(
    usuario_id: str,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: PersonaService = Depends(get_persona_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return {"codigo": service.regenerar_codigo_vinculacion(usuario_id, current_user)}


@router.post(
    "/analizar-audio",
    summary="Analizar fragmento de audio en vivo con Vosk y YAMNet (Alias)",
    description="Endpoint alias para compatibilidad."
)
async def analizar_audio_alias(
    audio_file: Optional[UploadFile] = File(default=None),
    file: Optional[UploadFile] = File(default=None),
    palabra_clave: str = Form(default="pizza"),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
):
    from app.services.acoustic_ai import acoustic_ai_service
    if settings.api_secret_key and x_api_secret and x_api_secret != settings.api_secret_key:
        raise HTTPException(status_code=401, detail="Invalid API Secret")

    upload = audio_file or file
    if not upload:
        raise HTTPException(status_code=400, detail="No se recibió archivo de audio (esperado 'audio_file' o 'file')")

    contenido_bytes = await upload.read()
    if not contenido_bytes:
        raise HTTPException(status_code=400, detail="Archivo de audio vacío")

    return acoustic_ai_service.analizar_audio(contenido_bytes, palabra_clave)
