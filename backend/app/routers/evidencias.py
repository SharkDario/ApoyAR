# backend/app/routers/evidencias.py
# ─────────────────────────────────────────────────────────────────────────────
# Endpoints de Preservación Probatoria Multicapa y Auditoría Pericial (Fase 2).
#
# Cumple con:
#   - CU-05: Capturar y sellar evidencia forense (Firma Hardware TEE + Envelope Encryption)
#   - CU-07: Preservar y sellar evidencia (RFC 3161 / Supabase Append-Only Log)
#   - CU-08: Exportar y auditar evidencia judicial (Auditoría Forense)
#   - Normas: ISO/IEC 27037 (Gestión de Evidencia Digital) e IETF RFC 3161 (TSP)
#
# Capa de presentación: valida la entrada, autentica y delega en los servicios.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.dependencies import get_evidencia_service, get_exportacion_forense_service, get_incidente_service
from app.schemas.evidencias import (
    DESTINO_EXPORTACION_POR_DEFECTO,
    JUSTIFICACION_EXPORTACION_POR_DEFECTO,
    ActualizarConsentimientoRequest,
    ExportarRequest,
    SellarForenseRequest,
)
from app.services.auth_dependencies import (
    exigir_usuario_o_api_secret,
    get_current_active_user,
    get_optional_current_active_user,
)
from app.services.evidencia_service import EvidenciaService
from app.services.exportacion_forense_service import ArchivoExportado, ExportacionForenseService
from app.services.incidente_service import IncidenteService

router = APIRouter(prefix="/api/v1/evidencias", tags=["evidencias"])


def _respuesta_zip(archivo: ArchivoExportado, con_cabeceras_extra: bool) -> Response:
    headers = {"Content-Disposition": f'attachment; filename="{archivo.nombre_archivo}"'}
    if con_cabeceras_extra:
        headers["Content-Type"] = "application/zip"
        headers["Cache-Control"] = "no-cache"
    headers["X-Manifest-Hash"] = archivo.hash_manifiesto
    return Response(content=archivo.contenido, media_type="application/zip", headers=headers)


@router.post(
    "/sellar-forense",
    status_code=status.HTTP_201_CREATED,
    summary="Sellado Forense Multicapa de Evidencia (CU-07 / RF-3.3 / RF-3.4)",
    description="""
    Ejecuta el protocolo de preservación probatoria multicapa de costo cero:
    1. Valida la existencia del incidente y la coherencia del usuario autor.
    2. Recupera de forma atómica el `prev_hash` del último registro insertado (Append-Only Log).
    3. Solicita a la TSA externa independiente un TimeStampToken oficial bajo IETF RFC 3161.
    4. Persiste de forma inmutable el registro en PostgreSQL, vinculando:
       - Capa 1: Firma asimétrica en hardware seguro (Android Keystore / TEE).
       - Capa 2: TimeStampToken normativo RFC 3161 en Base64.
       - Capa 3: Eslabón criptográfico de la cadena relacional (`prev_hash`).
    """,
)
async def sellar_forense(
    body: SellarForenseRequest,
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_current_active_user),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
    service: EvidenciaService = Depends(get_evidencia_service),
):
    exigir_usuario_o_api_secret(current_user, x_api_secret)
    return await service.sellar_forense(body, current_user)


@router.get(
    "/{evidencia_id}/auditar",
    summary="Auditoría Pericial y Cadena de Custodia (CU-08 / RF-3.5 / RNF-09)",
    description="""
    Audita integralmente un elemento probatorio registrado:
    1. Descarga el binario desde Supabase Storage (si está disponible) y recalcula su SHA-256.
    2. Inspecciona el TimeStampToken RFC 3161, valida su sintaxis ASN.1 DER y contrasta la huella sellada.
    3. Evalúa la firma en hardware seguro (Android Keystore / TEE).
    4. Comprueba la continuidad matemática de la cadena con el eslabón `prev_hash` precedente.
    """,
)
async def auditar_evidencia(
    evidencia_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: EvidenciaService = Depends(get_evidencia_service),
):
    return service.auditar_evidencia(evidencia_id, current_user)


@router.get(
    "/{evidencia_id}/reproducir",
    summary="Reproducción y Desencriptación Forense en Memoria (CU-08 / ISO 27037 / Ley 25.326)",
    description="""
    Permite reproducir o previsualizar de forma desencriptada una evidencia multimedia (video, audio o imagen):
    1. Valida permisos RBAC y consentimiento de exportación (Ley 25.326). Los administradores de TI sin atribuciones judiciales o sin consentimiento son rechazados con HTTP 403.
    2. Descarga el paquete binario cifrado (AES-256-GCM) desde Supabase Storage.
    3. Recupera la DEK y el IV desde el sobre digital forense asociado.
    4. Desencripta el payload en memoria y verifica su integridad SHA-256.
    5. Retorna la respuesta con el media_type correspondiente (video/mp4, audio/mp4, image/jpeg, etc.) para visualización directa en navegador.
    """,
)
async def reproducir_evidencia(
    evidencia_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: EvidenciaService = Depends(get_evidencia_service),
):
    multimedia = service.reproducir_evidencia(evidencia_id, current_user)
    return Response(
        content=multimedia.contenido,
        media_type=multimedia.media_type,
        headers={
            "Content-Disposition": f'inline; filename="evidencia_{evidencia_id}.{multimedia.extension}"',
            "Content-Length": str(len(multimedia.contenido)),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
    )


@router.get(
    "/incidente/{incidente_id}",
    summary="Listar evidencias de un incidente con encadenamiento criptográfico y paginación",
    description="Retorna las evidencias asociadas a un incidente aplicando separación entre metadatos forenses y multimedia (Ley 25.326) con paginación de 10 en 10.",
)
async def listar_evidencias_incidente(
    incidente_id: str,
    page: int = 1,
    limit: int = 10,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: EvidenciaService = Depends(get_evidencia_service),
):
    return service.listar_evidencias_incidente(incidente_id, page, limit, current_user)


@router.patch(
    "/incidente/{incidente_id}/consentimiento",
    summary="Actualizar consentimiento informado para exportación judicial de incidente (Ley 25.326)",
    description="Permite a la víctima titular autorizar o revocar el acceso institucional a sus archivos probatorios multimedia.",
)
async def actualizar_consentimiento_incidente(
    incidente_id: str,
    body: ActualizarConsentimientoRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: IncidenteService = Depends(get_incidente_service),
):
    fecha = service.actualizar_consentimiento(
        incidente_id,
        body.consentimiento_exportacion,
        current_user,
        detalle_denegado="Acceso denegado: Solo la persona titular de los datos puede otorgar o revocar el consentimiento informado.",
    )
    return {
        "status": "ok",
        "incidente_id": incidente_id,
        "consentimiento_exportacion": body.consentimiento_exportacion,
        "fecha_consentimiento": fecha,
        "mensaje": "Consentimiento informado actualizado correctamente conforme a la Ley 25.326 e ISO/IEC 27037.",
    }


@router.patch(
    "/{evidencia_id}/consentimiento",
    summary="Actualizar consentimiento informado para evidencia individual (Ley 25.326)",
    description="Permite al autor o titular de la prueba autorizar el acceso y exportación judicial.",
)
async def actualizar_consentimiento_evidencia(
    evidencia_id: str,
    body: ActualizarConsentimientoRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: EvidenciaService = Depends(get_evidencia_service),
):
    fecha = service.actualizar_consentimiento_evidencia(evidencia_id, body.consentimiento_exportacion, current_user)
    return {
        "status": "ok",
        "evidencia_id": evidencia_id,
        "consentimiento_exportacion": body.consentimiento_exportacion,
        "fecha_consentimiento": fecha,
        "mensaje": "Consentimiento de la evidencia actualizado correctamente.",
    }


# ── Exportaciones Técnicas de Preservación y Trazabilidad (Fase 6) ───────────

@router.get(
    "/incidente/{incidente_id}/exportar",
    summary="Descargar Paquete Probatorio ZIP de Incidente (Ley 25.326 / ISO 27037)",
    description="Descarga el paquete forense ZIP con informe PDF, manifiesto SHA-256/RFC 3161 y archivos multimedia desencriptados.",
)
async def exportar_paquete_incidente_get(
    incidente_id: str,
    destino_declarado: Optional[str] = DESTINO_EXPORTACION_POR_DEFECTO,
    justificacion: Optional[str] = JUSTIFICACION_EXPORTACION_POR_DEFECTO,
    origen_exportacion: Optional[str] = Query(None, description="Origen de exportación: 'autoridad' o 'titular'"),
    token: Optional[str] = Query(None, description="Token JWT para descargas directas en navegador"),
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: ExportacionForenseService = Depends(get_exportacion_forense_service),
):
    archivo = service.exportar_incidente(
        incidente_id=incidente_id,
        destino_declarado=destino_declarado or DESTINO_EXPORTACION_POR_DEFECTO,
        justificacion=justificacion or JUSTIFICACION_EXPORTACION_POR_DEFECTO,
        usuario=current_user,
        origen_exportacion=origen_exportacion,
    )
    return _respuesta_zip(archivo, con_cabeceras_extra=True)


@router.post(
    "/incidente/{incidente_id}/exportar",
    summary="Generar Paquete Técnico ZIP de Incidente (Ley 25.326 / ISO 27037)",
)
@router.post(
    "/exportar/incidente/{incidente_id}",
    summary="Generar Paquete Técnico ZIP de Incidente (Compatibilidad)",
)
async def exportar_paquete_incidente_post(
    incidente_id: str,
    body: Optional[ExportarRequest] = None,
    origen_exportacion: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: ExportacionForenseService = Depends(get_exportacion_forense_service),
):
    archivo = service.exportar_incidente(
        incidente_id=incidente_id,
        destino_declarado=(body.destino_declarado if body and body.destino_declarado else None) or DESTINO_EXPORTACION_POR_DEFECTO,
        justificacion=(body.justificacion if body and body.justificacion else None) or JUSTIFICACION_EXPORTACION_POR_DEFECTO,
        usuario=current_user,
        origen_exportacion=(body.origen_exportacion if body and body.origen_exportacion else None) or origen_exportacion,
    )
    return _respuesta_zip(archivo, con_cabeceras_extra=True)


@router.get(
    "/incidente/{incidente_id}/pdf",
    summary="Descargar Acta / Informe Técnico PDF de Cadena de Custodia (Ley 25.326)",
    description="Genera y retorna directamente el informe técnico oficial en PDF emitido con ReportLab para visualización o archivo directo.",
)
async def descargar_informe_pdf(
    incidente_id: str,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: ExportacionForenseService = Depends(get_exportacion_forense_service),
):
    archivo = service.generar_informe_pdf(incidente_id, current_user)
    return Response(
        content=archivo.contenido,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{archivo.nombre_archivo}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.post(
    "/exportar/individual/{evidencia_id}",
    summary="Generar Paquete Técnico ZIP de Evidencia Individual (Fase 6 / CU-08)",
    description="Genera el paquete ZIP técnico y reporte PDF para un elemento probatorio individual con control soberano de consentimiento (Ley 25.326).",
)
async def exportar_paquete_individual(
    evidencia_id: str,
    body: ExportarRequest,
    current_user: Dict[str, Any] = Depends(get_current_active_user),
    service: ExportacionForenseService = Depends(get_exportacion_forense_service),
):
    archivo = service.exportar_evidencia_individual(evidencia_id, body.destino_declarado, body.justificacion, current_user)
    return _respuesta_zip(archivo, con_cabeceras_extra=False)
