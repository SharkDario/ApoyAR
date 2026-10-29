# backend/app/schemas/evidencias.py
# ─────────────────────────────────────────────────────────────────────────────
# Esquemas Pydantic (DTO de entrada) de los endpoints de evidencias.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, UUID4

DESTINO_EXPORTACION_POR_DEFECTO = "Mesa de Entradas Judicial / Juzgado de Instrucción"
JUSTIFICACION_EXPORTACION_POR_DEFECTO = "Exportación formal bajo cadena de custodia emitida por Autoridad (Ley 25.326 / ISO 27037)"


class SellarForenseRequest(BaseModel):
    """
    Payload transaccional para sellado forense multinivel de evidencia.
    """
    incidente_id: UUID4 = Field(description="UUID del incidente al que pertenece la evidencia.")
    usuario_id: UUID4 = Field(description="UUID del usuario que capturó la prueba.")
    tipo_archivo: str = Field(description="'audio', 'video' o 'imagen'")
    url_almacenamiento: str = Field(description="Ruta interna en Supabase Storage (ej. 'evidencias/usr/inc/audio.m4a')")
    hash_sha256: str = Field(
        min_length=64,
        max_length=64,
        description="Huella digital SHA-256 en minúsculas calculada localmente sobre el binario capturado.",
    )
    firma_hardware: str = Field(
        description="Firma digital asimétrica ECDSA P-256 generada dentro de Android Keystore / TEE en Base64.",
    )
    fecha_captura: str = Field(
        description="Marca temporal ISO-8601 registrada por el dispositivo captor.",
    )
    metadata_dispositivo: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Metadatos contextuales: modelo, fabricante, versión de SO, precisión satelital.",
    )


class ActualizarConsentimientoRequest(BaseModel):
    consentimiento_exportacion: bool = Field(description="True para autorizar acceso y exportación judicial, False para revocarlo")


class ExportarRequest(BaseModel):
    destino_declarado: Optional[str] = Field(DESTINO_EXPORTACION_POR_DEFECTO, description="Organismo, juzgado o fin de la exportación")
    justificacion: Optional[str] = Field(JUSTIFICACION_EXPORTACION_POR_DEFECTO, description="Motivo operativo o legal de la solicitud")
    origen_exportacion: Optional[str] = Field(None, description="Origen de exportación: 'autoridad' o 'titular'")
