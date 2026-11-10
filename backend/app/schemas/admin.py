# backend/app/schemas/admin.py
# ─────────────────────────────────────────────────────────────────────────────
# Esquemas Pydantic (DTO de entrada) de autenticación institucional,
# administración de operadores y consola de Autoridad.
# ─────────────────────────────────────────────────────────────────────────────

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

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
    rol: str = Field(..., description="Perfil institucional: 'Autoridad', 'Administrador' o uno personalizado")
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
    roles: Optional[List[str]] = Field(default=None, description="Perfiles institucionales asignados (de sistema o personalizados)")
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


class ActualizarOperadorRequest(BaseModel):
    nombre: Optional[str] = Field(default=None, description="Nombre de pila según DNI")
    apellido: Optional[str] = Field(default=None, description="Apellido según DNI")
    dni: Optional[str] = Field(default=None, description="DNI único")
    genero: Optional[str] = Field(default=None, description="Género")
    fecha_nacimiento: Optional[str] = Field(default=None, description="Fecha de nacimiento en formato YYYY-MM-DD")
    telefono: Optional[str] = Field(default=None, description="Teléfono de contacto institucional")
    direccion: Optional[str] = Field(default=None, description="Dirección")
    notas: Optional[str] = Field(default=None, description="Notas operativas de habilitación")
    id_institucion: Optional[int] = Field(default=None, description="ID de Institución")
    id_dependencia: Optional[int] = Field(default=None, description="ID de Dependencia")
    id_sede: Optional[int] = Field(default=None, description="ID de Sede")
    id_cargo: Optional[int] = Field(default=None, description="ID de Cargo")
    nombre_cargo: Optional[str] = Field(default=None, description="Nombre del Cargo")
    legajo_o_matricula: Optional[str] = Field(default=None, description="Legajo o matrícula institucional")
    perfiles_personalizados: Optional[List[str]] = Field(
        default=None,
        description="Perfiles personalizados del operador (reemplaza los actuales). Los de sistema no se quitan.",
    )


class CambiarCargoActivoRequest(BaseModel):
    activo: bool = Field(description="Estado operativo del cargo institucional (True o False)")


class SugerenciasQuery(BaseModel):
    latitud: float
    longitud: float
    fecha_hora: datetime
    radio_metros: float = 500.0
    ventana_minutos: int = 30
    incidente_id: Optional[str] = Field(default=None, description="ID opcional del incidente de referencia")


class AsociarEvidenciaRequest(BaseModel):
    evidencia_id: str
    incidente_id: str
    justificacion_operativa: str


class CorrelacionarIncidentesRequest(BaseModel):
    incidente_origen_id: str = Field(..., description="ID del incidente base o expediente")
    incidente_destino_id: str = Field(..., description="ID del incidente o evento correlacionado")
    justificacion_operativa: str = Field(..., min_length=10, description="Motivación pericial y operativa fundada")


class PerfilRequest(BaseModel):
    nombre: str = Field(..., min_length=3, max_length=50, description="Nombre del perfil personalizado")
    descripcion: Optional[str] = Field(default=None, max_length=255)
    permisos: List[str] = Field(default_factory=list, description="Permisos institucionales (modulo.accion)")


class ActualizarPerfilRequest(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=3, max_length=50)
    descripcion: Optional[str] = Field(default=None, max_length=255)
    permisos: Optional[List[str]] = Field(default=None, description="Reemplaza los permisos del perfil")
    activo: Optional[bool] = Field(default=None)


# ── Estadísticas anónimas de emergencias (RF-4.4 / CU-11) ────────────────────

class FiltroEstadisticasQuery(BaseModel):
    """Filtros del tablero de estadísticas. Las fechas son días calendario de Argentina (UTC-3)."""
    fecha_desde: Optional[date] = Field(default=None, description="Primer día incluido (YYYY-MM-DD)")
    fecha_hasta: Optional[date] = Field(default=None, description="Último día incluido (YYYY-MM-DD)")
    departamento: Optional[str] = Field(default=None, max_length=60, description="Departamento provincial")
    localidad: Optional[str] = Field(default=None, max_length=80, description="Localidad")
    origen: Optional[Literal["manual", "automatico"]] = Field(default=None, description="Cómo se activó el Modo Resguardo")


class ResumenEstadisticasResponse(BaseModel):
    """Totales agregados: no lleva nombres, documentos, teléfonos, direcciones exactas ni evidencias."""
    generado_en: str
    filtros: Dict[str, Any]
    total_incidentes: int
    incidentes_en_curso: int
    incidentes_cerrados: int
    victimas_distintas: int
    duracion_promedio_min: Optional[float]
    duracion_mediana_min: Optional[float]
    duracion_p90_min: Optional[float]
    casos_con_duracion: int
    distribucion_duracion: List[Dict[str, Any]]
    porcentaje_automatico: float
    porcentaje_manual: float
    por_origen: List[Dict[str, Any]]
    serie_mensual: List[Dict[str, Any]]
    por_hora: List[Dict[str, Any]]
    por_dia_semana: List[Dict[str, Any]]
    matriz_horaria: List[Dict[str, Any]]
    por_departamento: List[Dict[str, Any]]
    por_localidad: List[Dict[str, Any]]
    por_barrio: List[Dict[str, Any]]
    sin_ubicacion: int
    puntos_calor: List[Dict[str, Any]]
    piramide_etaria: List[Dict[str, Any]]
    por_genero: List[Dict[str, Any]]
    vinculos_red_apoyo: List[Dict[str, Any]]
    red_promedio_contactos: Optional[float]
