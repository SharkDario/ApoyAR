# backend/app/schemas/admin.py
# ─────────────────────────────────────────────────────────────────────────────
# Esquemas Pydantic (DTO de entrada) de autenticación institucional,
# administración de operadores y consola de Autoridad.
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class LoginInstitucionalRequest(BaseModel):
    email: str = Field(..., description="Correo electrónico del operador institucional")
    password: str = Field(..., description="Contraseña institucional")


class LoginMovilRequest(BaseModel):
    email: str = Field(..., description="Correo electrónico de la cuenta")
    password: str = Field(..., description="Contraseña de la cuenta")


class RecuperarPasswordRequest(BaseModel):
    email: str = Field(..., description="Correo del usuario a recuperar")
    contexto: str = Field(default="panel_web", description="'panel_web' o 'movil'")


class ConfirmarRecuperacionRequest(BaseModel):
    email: str = Field(..., description="Correo electrónico registrado")
    codigo: Optional[str] = Field(default=None, description="Código numérico de 6 dígitos")
    token_o_codigo: Optional[str] = Field(default=None, description="Alias para código OTP")
    nueva_password: str = Field(..., min_length=8, description="Nueva contraseña cumpliendo política")
    contexto: Optional[str] = Field(default="general", description="'panel_web', 'movil' o 'general'")


class CambiarEstadoCuentaRequest(BaseModel):
    estado: str = Field(description="'activo', 'suspendido', 'pendiente' o 'revocado'")
    notas: Optional[str] = Field(default=None, description="Motivo del cambio de estado operativo")


class CambiarPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, description="Nueva contraseña de acceso (mínimo 8 caracteres)")


class AgregarRolRequest(BaseModel):
    rol: str = Field(..., description="'Autoridad' o 'Administrador'")
    id_institucion: Optional[int] = Field(default=None, description="ID de Institución")
    id_dependencia: Optional[int] = Field(default=None, description="ID de Dependencia")
    id_sede: Optional[int] = Field(default=None, description="ID de Sede física")
    id_cargo: Optional[int] = Field(default=None, description="ID de Cargo Institucional")
    nombre_cargo: Optional[str] = Field(default=None, description="Nombre descriptivo del cargo")
    legajo_o_matricula: Optional[str] = Field(default=None, description="Legajo o matrícula profesional obligatorio")


class SuspenderOperadorRequest(BaseModel):
    notas: Optional[str] = Field(default=None, description="Motivo de la suspensión operativa institucional")


class CrearOperadorRequest(BaseModel):
    email: str = Field(..., description="Correo electrónico institucional")
    password: str = Field(..., min_length=8, description="Contraseña de acceso seguro")
    rol: Optional[str] = Field(default="Autoridad", description="'Autoridad' o 'Administrador'")
    roles: Optional[List[str]] = Field(default=None, description="Lista de roles asignados simultáneamente")
    usuario_id_existente: Optional[str] = Field(default=None, description="UUID de usuario existente para vinculación")
    nombre: str = Field(..., min_length=1, description="Nombre de pila según DNI")
    apellido: str = Field(..., min_length=1, description="Apellido según DNI")
    dni: str = Field(..., min_length=6, max_length=20, description="DNI / Documento Nacional de Identidad único")
    genero: Optional[str] = Field(default="No especificado", description="Género ('Femenino', 'Masculino', 'No binario', 'Otro')")
    fecha_nacimiento: Optional[str] = Field(default=None, description="Fecha de nacimiento en formato YYYY-MM-DD")
    telefono: Optional[str] = Field(default=None, description="Teléfono de contacto institucional")
    direccion: Optional[str] = Field(default=None, description="Dependencia policial, judicial o domicilio")
    notas: Optional[str] = Field(default=None, description="Notas operativas de habilitación")
    # Campos 3FN Institucionales
    id_institucion: Optional[int] = Field(default=None)
    id_dependencia: Optional[int] = Field(default=None)
    id_sede: Optional[int] = Field(default=None)
    id_cargo: Optional[int] = Field(default=None)
    nombre_cargo: Optional[str] = Field(default=None)
    legajo_o_matricula: Optional[str] = Field(default=None)
    legajo_personal: Optional[str] = Field(default=None)


class CambiarCargoActivoRequest(BaseModel):
    activo: bool = Field(description="Estado operativo del cargo institucional (True o False)")


class SugerenciasQuery(BaseModel):
    latitud: float
    longitud: float
    fecha_hora: datetime
    radio_metros: float = 500.0
    ventana_minutos: int = 30


class AsociarEvidenciaRequest(BaseModel):
    evidencia_id: str
    incidente_id: str
    justificacion_operativa: str
