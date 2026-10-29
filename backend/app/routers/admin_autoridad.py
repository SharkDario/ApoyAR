# backend/app/routers/admin_autoridad.py
# ─────────────────────────────────────────────────────────────────────────────
# Endpoints Protegidos para Administración del Sistema y Operadores de Autoridad
# (CU-06, CU-09, RF-1.1, RNF-07).
#
# Aplica RBAC estricto:
#   - Administrador: gestión de ciclo de vida de usuarios, auditoría técnica.
#   - Autoridad: visualización de incidentes activos para respuesta operativa.
#
# Capa de presentación: valida la entrada, aplica RBAC y delega en los servicios.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import (
    get_autenticacion_institucional_service,
    get_catalogo_service,
    get_operador_service,
    get_supervision_service,
)
from app.schemas.admin import (
    AgregarRolRequest,
    AsociarEvidenciaRequest,
    CambiarCargoActivoRequest,
    CambiarEstadoCuentaRequest,
    CambiarPasswordRequest,
    ConfirmarRecuperacionRequest,
    CrearOperadorRequest,
    LoginInstitucionalRequest,
    LoginMovilRequest,
    RecuperarPasswordRequest,
    SugerenciasQuery,
    SuspenderOperadorRequest,
)
from app.services.auth_dependencies import get_current_active_user, require_role
from app.services.autenticacion_institucional_service import AutenticacionInstitucionalService
from app.services.catalogo_service import CatalogoInstitucionalService
from app.services.operador_service import OperadorService
from app.services.supervision_service import SupervisionService

router = APIRouter(prefix="/api/v1", tags=["admin_autoridad"])

solo_administrador = require_role(["Administrador"])
autoridad_o_administrador = require_role(["Autoridad", "Administrador"])


# ── 1. Endpoints de Usuario Autenticado / Perfil ─────────────────────────────

@router.get(
    "/auth/me",
    summary="Obtener perfil y rol del usuario autenticado",
    description="Retorna el usuario actual, sus roles institucionales normalizados y estado de cuenta.",
)
async def get_mi_perfil(
    user: Dict[str, Any] = Depends(get_current_active_user),
):
    return {
        "id": user["id"],
        "email": user.get("email"),
        "roles": user.get("roles", []),
    }


@router.post(
    "/auth/login-institucional",
    summary="Inicio de sesión institucional para Panel Web",
    description="Autentica operadores institucionales con su credencial general unificada en Supabase Auth con protección contra fuerza bruta.",
)
async def login_institucional(
    body: LoginInstitucionalRequest,
    service: AutenticacionInstitucionalService = Depends(get_autenticacion_institucional_service),
):
    return service.login_institucional(body.email, body.password)


@router.post(
    "/auth/login-movil",
    summary="Inicio de sesión móvil con protección contra fuerza bruta",
    description="Autentica usuarios civiles en la aplicación móvil con bloqueo de 15 minutos tras 3 intentos consecutivos fallidos.",
)
async def login_movil(
    body: LoginMovilRequest,
    service: AutenticacionInstitucionalService = Depends(get_autenticacion_institucional_service),
):
    return service.login_movil(body.email, body.password)


@router.get(
    "/auth/estado-bloqueo",
    summary="Consultar estado de bloqueo temporal de una cuenta",
    description="Informa si una cuenta está bloqueada y los segundos restantes sin revelar si la cuenta existe.",
)
async def consultar_estado_bloqueo(
    email: str = Query(..., description="Correo a consultar"),
    service: AutenticacionInstitucionalService = Depends(get_autenticacion_institucional_service),
):
    return service.consultar_estado_bloqueo(email)


@router.post(
    "/auth/recuperar-password",
    summary="Solicitar código de recuperación de contraseña por correo",
    description="Envía un token OTP de 6 dígitos al correo electrónico del usuario para restablecer su contraseña general unificada.",
)
async def solicitar_recuperacion_password(
    body: RecuperarPasswordRequest,
    service: AutenticacionInstitucionalService = Depends(get_autenticacion_institucional_service),
):
    return service.solicitar_recuperacion(body.email)


@router.post(
    "/auth/confirmar-recuperacion",
    summary="Confirmar código OTP y restablecer contraseña unificada",
    description="Aplica la nueva contraseña general en Supabase Auth y sincroniza public.usuario.password_hash.",
)
async def confirmar_recuperacion_password(
    body: ConfirmarRecuperacionRequest,
    service: AutenticacionInstitucionalService = Depends(get_autenticacion_institucional_service),
):
    return service.confirmar_recuperacion(body.email, body.codigo or body.token_o_codigo, body.nueva_password)


@router.put(
    "/auth/cambiar-password",
    summary="[DESHABILITADO] Modificación directa de contraseña no permitida",
    description="El cambio directo de contraseña dentro del panel ha sido deshabilitado. La única vía permitida es la recuperación por correo electrónico.",
)
async def cambiar_mi_password(
    body: Optional[CambiarPasswordRequest] = None,
    user: Dict[str, Any] = Depends(get_current_active_user),
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Acceso denegado: La modificación directa de contraseñas dentro del panel ha sido eliminada. La única vía habilitada en el sistema es la 'Recuperación de contraseña por correo electrónico'.",
    )


@router.put(
    "/admin/usuarios/{usuario_id}/password",
    summary="[DESHABILITADO] Reseteo manual por administrador no permitido",
    description="Los administradores no pueden modificar ni resetear manualmente las contraseñas de otros usuarios. La única vía es la recuperación por correo.",
)
async def admin_cambiar_password_usuario(
    usuario_id: str,
    body: Optional[CambiarPasswordRequest] = None,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Acceso denegado: Los administradores ya no pueden modificar ni resetear manualmente las contraseñas de otros usuarios. La única vía permitida para modificar una contraseña es el flujo de recuperación de contraseña por correo electrónico.",
    )


# ── Catálogos Institucionales 3FN (Público / Autenticado) ────────────────────

@router.get(
    "/instituciones",
    summary="Listar instituciones públicas participantes (3FN)",
    description="Retorna las instituciones públicas registradas para selección en el alta de operadores.",
)
async def listar_instituciones(service: CatalogoInstitucionalService = Depends(get_catalogo_service)):
    return {"status": "ok", "instituciones": service.listar_instituciones()}


@router.get(
    "/dependencias",
    summary="Listar dependencias u oficinas operativas (3FN)",
    description="Retorna las dependencias, opcionalmente filtradas por institución.",
)
async def listar_dependencias(
    institucion_id: Optional[int] = None,
    service: CatalogoInstitucionalService = Depends(get_catalogo_service),
):
    return {"status": "ok", "dependencias": service.listar_dependencias(institucion_id)}


@router.get(
    "/sedes",
    summary="Listar sedes físicas (3FN)",
    description="Retorna las sedes físicas, opcionalmente filtradas por dependencia.",
)
async def listar_sedes(
    dependencia_id: Optional[int] = None,
    service: CatalogoInstitucionalService = Depends(get_catalogo_service),
):
    return {"status": "ok", "sedes": service.listar_sedes(dependencia_id)}


@router.get(
    "/cargos",
    summary="Listar tipos de cargos institucionales estándar (3FN Pura)",
    description="Retorna el catálogo estándar de cargos para selección al dar de alta una Autoridad.",
)
async def listar_cargos(service: CatalogoInstitucionalService = Depends(get_catalogo_service)):
    return {"status": "ok", "cargos": service.listar_cargos()}


# ── 2. Endpoints de Administrador y Búsqueda de Usuarios ────────────────────

@router.get(
    "/admin/buscar-usuarios",
    summary="Buscar usuarios registrados para vinculación como operadores (Solo Administrador)",
    description="Permite buscar ciudadanos registrados por DNI, Nombre/Apellido o Email para reutilizar su entidad Persona sin duplicar datos.",
)
async def buscar_usuarios_existentes(
    q: str = Query(..., min_length=1, description="Término de búsqueda: DNI, Nombre, Apellido o Email"),
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    usuarios = service.buscar_usuarios(q)
    return {
        "status": "ok",
        "total": len(usuarios),
        "usuarios": usuarios,
        "resultados": usuarios,
    }


@router.get(
    "/admin/usuarios",
    summary="Listar operadores institucionales con paginación de 10 en 10 y filtro activo/inactivo (Solo Administrador)",
    description="Permite auditar operadores institucionales en funciones o inactivos con paginación estricta de 10 registros por página.",
)
async def listar_usuarios_admin(
    page: int = 1,
    limit: int = 10,
    estado: Optional[str] = None,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.listar_operadores(page, limit, estado)


@router.post(
    "/admin/usuarios",
    summary="Crear o vincular operador institucional con soporte Multi-Rol (Solo Administrador)",
    description="Permite registrar desde cero o vincular un usuario civil existente, asignando roles simultáneos (Autoridad / Administrador) y credenciales institucionales independientes.",
)
async def crear_operador_institucional(
    body: CrearOperadorRequest,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.crear_operador(body, admin_user)


@router.post(
    "/admin/usuarios/{usuario_id}/agregar-rol",
    summary="Asignar rol institucional adicional irreversible por auditoría (Solo Administrador)",
    description="Permite agregar el rol Autoridad o Administrador a un operador activo. Regla estricta: una vez asignado, no se puede revocar ni eliminar por trazabilidad de auditoría.",
)
async def agregar_rol_operador(
    usuario_id: str,
    body: AgregarRolRequest,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.agregar_rol(usuario_id, body, admin_user)


@router.post(
    "/admin/usuarios/{usuario_id}/suspender",
    summary="Suspender operador institucionalmente sin afectar App Móvil civil",
    description="Inhabilita el acceso al Panel Web marcando como suspendido en usuario_tiene_perfil y cargo_institucional, manteniendo intacta su cuenta civil.",
)
async def suspender_operador(
    usuario_id: str,
    body: Optional[SuspenderOperadorRequest] = None,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.suspender(usuario_id, body.notas if body else None, admin_user)


@router.post(
    "/admin/usuarios/{usuario_id}/reactivar",
    summary="Reactivar operador institucional previamente suspendido",
    description="Reactiva las credenciales institucionales y el cargo operativo en el Panel Web.",
)
async def reactivar_operador(
    usuario_id: str,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.reactivar(usuario_id, admin_user)


@router.patch(
    "/admin/usuarios/{usuario_id}/cargo-activo",
    summary="Activar o desactivar cargo institucional (compatibilidad)",
)
async def cambiar_activo_cargo(
    usuario_id: str,
    body: CambiarCargoActivoRequest,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.cambiar_cargo_activo(usuario_id, body.activo)


@router.patch(
    "/admin/usuarios/{usuario_id}/estado",
    summary="Aprobar, suspender o revocar estado del perfil institucional (compatibilidad)",
)
async def cambiar_estado_cuenta(
    usuario_id: str,
    body: CambiarEstadoCuentaRequest,
    admin_user: Dict[str, Any] = Depends(solo_administrador),
    service: OperadorService = Depends(get_operador_service),
):
    return service.cambiar_estado(usuario_id, body.estado, body.notas, admin_user)


# ── 3. Endpoints de Autoridad Operativa y Monitoreo Cartográfico ──────────────

@router.get(
    "/autoridad/incidentes-activos",
    summary="Consultar incidentes activos para consola de mando (Autoridad y Administrador)",
    description="Retorna los incidentes con estado 'en_curso' con paginación estricta de 10 en 10.",
)
async def listar_incidentes_activos_autoridad(
    page: int = 1,
    limit: int = 10,
    current_op: Dict[str, Any] = Depends(autoridad_o_administrador),
    service: SupervisionService = Depends(get_supervision_service),
):
    return service.listar_incidentes_activos(page, limit)


@router.get(
    "/autoridad/incidentes",
    summary="Listar incidentes para consola de supervisión con paginación de 10 en 10",
    description="Retorna incidentes con filtro opcional por estado y paginación estricta de 10 registros por página.",
)
async def listar_incidentes_autoridad(
    estado: Optional[str] = None,
    page: int = 1,
    limit: int = 10,
    current_op: Dict[str, Any] = Depends(autoridad_o_administrador),
    service: SupervisionService = Depends(get_supervision_service),
):
    return service.listar_incidentes(estado, page, limit)


@router.post(
    "/autoridad/sugerencias-coincidencias",
    summary="Sugerencias Analíticas Espaciotemporales Haversine (Sección 9 / Fase 5)",
    description="""
    Evalúa la proximidad geográfica (d <= radio_metros) y cronológica (|dt| <= ventana_minutos).
    Presenta las coincidencias exclusivamente bajo el rótulo de 'Posible Coincidencia Sugerida'.
    No efectúa ninguna vinculación automática ni sustituye el criterio pericial humano.
    """,
)
async def sugerir_coincidencias_haversine(
    body: SugerenciasQuery,
    current_op: Dict[str, Any] = Depends(autoridad_o_administrador),
    service: SupervisionService = Depends(get_supervision_service),
):
    return service.sugerir_coincidencias(body)


@router.post(
    "/autoridad/asociar-evidencia",
    summary="Vinculación formal asistida de evidencia por operador humano (Fase 5)",
    description="""
    Permite a un operador autorizado unificar formalmente un elemento de evidencia
    con un incidente, declarando motivo operativo y registrando su identidad para auditoría.
    """,
)
async def asociar_evidencia_a_incidente(
    body: AsociarEvidenciaRequest,
    current_op: Dict[str, Any] = Depends(autoridad_o_administrador),
    service: SupervisionService = Depends(get_supervision_service),
):
    return service.asociar_evidencia(body, current_op)
