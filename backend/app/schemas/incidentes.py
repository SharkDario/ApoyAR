# backend/app/schemas/incidentes.py
# ─────────────────────────────────────────────────────────────────────────────
# Esquemas Pydantic (DTO de entrada) de los endpoints de incidentes.
# Validan el cuerpo de las solicitudes HTTP; no son entidades persistentes.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Optional

from pydantic import BaseModel, Field, UUID4


class ActualizarPersonaRequest(BaseModel):
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    dni: Optional[str] = None
    telefono: Optional[str] = None
    direccion: Optional[str] = None
    genero: Optional[str] = None


class ActivarIncidenteRequest(BaseModel):
    """
    Payload que envía el móvil al activar la emergencia (manual o acústica).
    """
    incidente_id: UUID4 = Field(description="UUID del incidente ya creado en Supabase.")
    victima_id: UUID4 = Field(description="UUID del usuario que activó el SOS.")
    latitud: float = Field(ge=-90, le=90)
    longitud: float = Field(ge=-180, le=180)
    origen: str = Field(default="manual", description="'manual' (botón) o 'automatico' (Vosk/YAMNet)")


class ActualizarPosicionRequest(BaseModel):
    """
    Payload para actualizaciones periódicas de coordenadas GPS durante un incidente activo (CU-06).
    """
    latitud: float = Field(ge=-90, le=90)
    longitud: float = Field(ge=-180, le=180)
    direccion_aprox: Optional[str] = None


class ActualizarEstadoRequest(BaseModel):
    """
    Payload para transiciones de estado del incidente ('en_curso', 'cerrado', 'falso_positivo', 'cancelado').
    """
    estado: str = Field(description="Nuevo estado del incidente.")
    notas: Optional[str] = Field(default=None, description="Motivo o fundamentación del cambio de estado.")


class RegistrarEvidenciaRequest(BaseModel):
    """
    Payload compatible con Iteración 1 y 2 para registrar evidencia capturada.
    """
    usuario_id: UUID4
    tipo_archivo: str = Field(description="'audio', 'video', o 'imagen'")
    url_almacenamiento: str = Field(description="Path en Storage: evidencias/{incidente_id}/archivo.m4a")
    hash_sha256: str = Field(min_length=64, max_length=64, description="SHA-256 hex calculado localmente en el dispositivo.")
    firma_hardware: Optional[str] = Field(default=None, description="Firma asimétrica y atestación de hardware (Keystore/TEE) en Base64.")
    fecha_captura: str = Field(description="ISO 8601 timestamp generado en el dispositivo al momento de la captura.")
    metadata_dispositivo: Optional[dict] = Field(default=None)


class ActualizarConsentimientoIncidenteRequest(BaseModel):
    consentimiento_exportacion: bool = Field(description="True para autorizar acceso y exportación judicial, False para revocarlo")
