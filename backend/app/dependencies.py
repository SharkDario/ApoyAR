# backend/app/dependencies.py
# ─────────────────────────────────────────────────────────────────────────────
# Raíz de composición: proveedores de FastAPI (Depends) que construyen la
# cadena Router → Service → Repository → Supabase en cada solicitud.
#
# Los repositorios y servicios no tienen estado propio, por lo que se crean por
# solicitud (FastAPI reutiliza cada dependencia dentro de una misma solicitud).
# Solo se comparten los componentes con estado o costosos: el cliente
# Supabase, el cliente TSA y los clientes de integración externa.
# Las pruebas sustituyen cualquier eslabón con app.dependency_overrides.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Callable

from fastapi import Depends
from supabase import Client

from app.config import settings
from app.database import crear_cliente_anonimo, supabase_admin
from app.repositories.alerta_temprana_repository import AlertaTempranaRepository
from app.repositories.auditoria_exportacion_repository import AuditoriaExportacionRepository
from app.repositories.auth_gateway import SupabaseAuthGateway
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.catalogo_repository import CatalogoInstitucionalRepository
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.perfil_repository import PerfilRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.repositories.seguridad_login_repository import SeguridadLoginRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.services.access_control import AccessControlService
from app.services.alerta_service import AlertaService
from app.services.autenticacion_institucional_service import AutenticacionInstitucionalService
from app.services.catalogo_service import CatalogoInstitucionalService
from app.services.cuenta_service import CuentaService
from app.services.evidencia_service import EvidenciaService
from app.services.export_service import ExportService, export_service
from app.services.exportacion_forense_service import ExportacionForenseService
from app.services.geocoding import NominatimGeocoder
from app.services.incidente_service import IncidenteService
from app.services.operador_service import OperadorService
from app.services.persona_service import PersonaService
from app.services.push_notifications import ExpoPushNotifier, NotificadorPush
from app.services.seguridad_login_service import SeguridadLoginService
from app.services.supervision_service import SupervisionService
from app.services.tsa_client import TSAClient, tsa_client

_expo_push_notifier = ExpoPushNotifier()
_geocoder = NominatimGeocoder()


# ── Infraestructura ──────────────────────────────────────────────────────────

def get_supabase_client() -> Client:
    return supabase_admin


def get_fabrica_cliente_anonimo() -> Callable[[], Client]:
    return crear_cliente_anonimo


def get_tsa_client() -> TSAClient:
    return tsa_client


def get_notificador_push() -> NotificadorPush:
    return _expo_push_notifier


def get_geocoder() -> NominatimGeocoder:
    return _geocoder


def get_empaquetador_zip() -> ExportService:
    return export_service


# ── Repositorios ─────────────────────────────────────────────────────────────

def get_incidente_repository(client: Client = Depends(get_supabase_client)) -> IncidenteRepository:
    return IncidenteRepository(client)


def get_evidencia_repository(client: Client = Depends(get_supabase_client)) -> EvidenciaRepository:
    return EvidenciaRepository(client)


def get_usuario_repository(client: Client = Depends(get_supabase_client)) -> UsuarioRepository:
    return UsuarioRepository(client)


def get_perfil_repository(client: Client = Depends(get_supabase_client)) -> PerfilRepository:
    return PerfilRepository(client)


def get_cargo_institucional_repository(client: Client = Depends(get_supabase_client)) -> CargoInstitucionalRepository:
    return CargoInstitucionalRepository(client)


def get_red_apoyo_repository(client: Client = Depends(get_supabase_client)) -> RedApoyoRepository:
    return RedApoyoRepository(client)


def get_alerta_temprana_repository(client: Client = Depends(get_supabase_client)) -> AlertaTempranaRepository:
    return AlertaTempranaRepository(client)


def get_catalogo_repository(client: Client = Depends(get_supabase_client)) -> CatalogoInstitucionalRepository:
    return CatalogoInstitucionalRepository(client)


def get_auditoria_exportacion_repository(client: Client = Depends(get_supabase_client)) -> AuditoriaExportacionRepository:
    return AuditoriaExportacionRepository(client)


def get_seguridad_login_repository(client: Client = Depends(get_supabase_client)) -> SeguridadLoginRepository:
    return SeguridadLoginRepository(client)


def get_seguridad_login_service(
    repo: SeguridadLoginRepository = Depends(get_seguridad_login_repository),
) -> SeguridadLoginService:
    return SeguridadLoginService(repo)


def get_evidencia_storage(client: Client = Depends(get_supabase_client)) -> EvidenciaStorage:
    return EvidenciaStorage(client)


def get_auth_gateway(
    client: Client = Depends(get_supabase_client),
    fabrica_anonimo: Callable[[], Client] = Depends(get_fabrica_cliente_anonimo),
) -> SupabaseAuthGateway:
    return SupabaseAuthGateway(client, fabrica_anonimo)


# ── Servicios ────────────────────────────────────────────────────────────────

def get_access_control_service(
    incidentes: IncidenteRepository = Depends(get_incidente_repository),
    evidencias: EvidenciaRepository = Depends(get_evidencia_repository),
    red_apoyo: RedApoyoRepository = Depends(get_red_apoyo_repository),
    cargos: CargoInstitucionalRepository = Depends(get_cargo_institucional_repository),
) -> AccessControlService:
    return AccessControlService(incidentes, evidencias, red_apoyo, cargos)


def get_cuenta_service(
    auth_gateway: SupabaseAuthGateway = Depends(get_auth_gateway),
    perfiles: PerfilRepository = Depends(get_perfil_repository),
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
    evidencias: EvidenciaRepository = Depends(get_evidencia_repository),
    storage: EvidenciaStorage = Depends(get_evidencia_storage),
) -> CuentaService:
    return CuentaService(auth_gateway, perfiles, usuarios, evidencias, storage)


def get_alerta_service(
    red_apoyo: RedApoyoRepository = Depends(get_red_apoyo_repository),
    alertas: AlertaTempranaRepository = Depends(get_alerta_temprana_repository),
    notificador: NotificadorPush = Depends(get_notificador_push),
) -> AlertaService:
    return AlertaService(red_apoyo, alertas, notificador)


def get_incidente_service(
    incidentes: IncidenteRepository = Depends(get_incidente_repository),
    evidencias: EvidenciaRepository = Depends(get_evidencia_repository),
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
    cargos: CargoInstitucionalRepository = Depends(get_cargo_institucional_repository),
    acceso: AccessControlService = Depends(get_access_control_service),
    alertas: AlertaService = Depends(get_alerta_service),
    geocoder: NominatimGeocoder = Depends(get_geocoder),
) -> IncidenteService:
    return IncidenteService(incidentes, evidencias, usuarios, cargos, acceso, alertas, geocoder)


def get_evidencia_service(
    evidencias: EvidenciaRepository = Depends(get_evidencia_repository),
    incidentes: IncidenteRepository = Depends(get_incidente_repository),
    storage: EvidenciaStorage = Depends(get_evidencia_storage),
    acceso: AccessControlService = Depends(get_access_control_service),
    tsa: TSAClient = Depends(get_tsa_client),
) -> EvidenciaService:
    return EvidenciaService(evidencias, incidentes, storage, acceso, tsa)


def get_exportacion_forense_service(
    incidentes: IncidenteRepository = Depends(get_incidente_repository),
    evidencias: EvidenciaRepository = Depends(get_evidencia_repository),
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
    cargos: CargoInstitucionalRepository = Depends(get_cargo_institucional_repository),
    auditoria: AuditoriaExportacionRepository = Depends(get_auditoria_exportacion_repository),
    storage: EvidenciaStorage = Depends(get_evidencia_storage),
    acceso: AccessControlService = Depends(get_access_control_service),
    empaquetador: ExportService = Depends(get_empaquetador_zip),
) -> ExportacionForenseService:
    return ExportacionForenseService(incidentes, evidencias, usuarios, cargos, auditoria, storage, acceso, empaquetador)


def get_persona_service(
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
    auth_gateway: SupabaseAuthGateway = Depends(get_auth_gateway),
) -> PersonaService:
    return PersonaService(usuarios, auth_gateway)


def get_autenticacion_institucional_service(
    auth_gateway: SupabaseAuthGateway = Depends(get_auth_gateway),
    perfiles: PerfilRepository = Depends(get_perfil_repository),
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
    seguridad_login: SeguridadLoginService = Depends(get_seguridad_login_service),
) -> AutenticacionInstitucionalService:
    return AutenticacionInstitucionalService(settings, auth_gateway, perfiles, usuarios, seguridad_login)


def get_catalogo_service(
    catalogo: CatalogoInstitucionalRepository = Depends(get_catalogo_repository),
) -> CatalogoInstitucionalService:
    return CatalogoInstitucionalService(catalogo)


def get_operador_service(
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
    perfiles: PerfilRepository = Depends(get_perfil_repository),
    cargos: CargoInstitucionalRepository = Depends(get_cargo_institucional_repository),
    auth_gateway: SupabaseAuthGateway = Depends(get_auth_gateway),
) -> OperadorService:
    return OperadorService(usuarios, perfiles, cargos, auth_gateway)


def get_supervision_service(
    incidentes: IncidenteRepository = Depends(get_incidente_repository),
    evidencias: EvidenciaRepository = Depends(get_evidencia_repository),
    usuarios: UsuarioRepository = Depends(get_usuario_repository),
) -> SupervisionService:
    return SupervisionService(incidentes, evidencias, usuarios)
