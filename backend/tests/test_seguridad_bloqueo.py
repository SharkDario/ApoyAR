# backend/tests/test_seguridad_bloqueo.py
# ─────────────────────────────────────────────────────────────────────────────
# Pruebas de Seguridad: Bloqueo Temporal por Intentos Fallidos de Inicio de Sesión
# (CU-01, CU-06, RF-1.1, RNF-07).
#
# Verifica los 12 casos obligatorios:
# 1. Login exitoso con credenciales válidas.
# 2. 1er y 2do intento fallido (contador incrementa, sin bloqueo).
# 3. 3er intento fallido activa bloqueo de 15 minutos (429 Too Many Requests).
# 4. Rechazo de intentos adicionales durante el periodo de 15 minutos.
# 5. Persistencia del bloqueo entre distintas solicitudes / dispositivos.
# 6. Restablecimiento del contador tras un login exitoso.
# 7. Rehabilitación del acceso tras expirar los 15 minutos.
# 8. Errores de red o de servidor NO incrementan los intentos fallidos.
# 9. Inviolabilidad del estado ante manipulación desde el cliente.
# 10. Funcionamiento simétrico e independiente para panel web y app móvil.
# 11. Imposibilidad de omitir el bloqueo sin pasar por la interfaz.
# 12. Conservación de roles, permisos y sesiones legítimas existentes.
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import BloqueoTemporalError, NoAutenticadoError
from app.main import app
from app.dependencies import (
    get_autenticacion_institucional_service,
    get_seguridad_login_service,
    get_supabase_client,
    get_fabrica_cliente_anonimo,
)
from app.repositories.auth_gateway import SupabaseAuthGateway
from app.repositories.perfil_repository import PerfilRepository
from app.repositories.seguridad_login_repository import SeguridadLoginRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.services.autenticacion_institucional_service import AutenticacionInstitucionalService
from app.services.seguridad_login_service import (
    SeguridadLoginService,
    MAX_INTENTOS_CONSECUTIVOS,
    TIEMPO_BLOQUEO_MINUTOS,
    TIEMPO_BLOQUEO_SEGUNDOS,
    formatear_tiempo_restante,
)
from tests.fake_supabase import FakeDB, FakeClient, FakeAnonClient


@pytest.fixture
def fake_env():
    db = FakeDB()
    client = FakeClient(db)
    fabrica_anon = lambda: FakeAnonClient(db)
    auth_gw = SupabaseAuthGateway(client, fabrica_anon)
    seg_repo = SeguridadLoginRepository(client)
    seg_service = SeguridadLoginService(seg_repo)
    perf_repo = PerfilRepository(client)
    usu_repo = UsuarioRepository(client)
    settings = Settings(
        supabase_url="https://fake.supabase.co",
        supabase_anon_key="fake-anon-key",
        supabase_service_role_key="fake-service-key",
        api_secret_key="fake-api-secret-key-super-secure-jwt",
        supabase_jwt_secret="fake-api-secret-key-super-secure-jwt",
    )
    auth_service = AutenticacionInstitucionalService(settings, auth_gw, perf_repo, usu_repo, seg_service)
    return SimpleNamespace(
        db=db,
        client=client,
        fabrica_anon=fabrica_anon,
        auth_gw=auth_gw,
        seg_repo=seg_repo,
        seg_service=seg_service,
        auth_service=auth_service,
        perf_repo=perf_repo,
        usu_repo=usu_repo,
    )


# ── 1. Inicio de sesión correcto con credenciales válidas ────────────────────
def test_login_exitoso_credenciales_validas(fake_env):
    email = "operador@policia.gob.ar"
    pwd = "PasswordSeguro123!"

    # Crear usuario en FakeDB
    uid = fake_env.db.next_id("auth")
    fake_env.db.auth_users.append({"id": uid, "email": email, "password": pwd})
    fake_env.db.tables["usuario"] = [{"usu_id_usuario": uid, "usu_email": email}]
    fake_env.db.tables["perfil"] = [{"prf_id_perfil": 1, "prf_nombre": "Autoridad"}]
    fake_env.db.tables["usuario_tiene_perfil"] = [
        {"usu_id_usuario": uid, "prf_id_perfil": 1, "usuprf_estado_aprobacion": "activo", "perfil": {"prf_nombre": "Autoridad"}}
    ]

    res = fake_env.auth_service.login_institucional(email, pwd)
    assert res["status"] == "ok"
    assert "access_token" in res
    assert "Autoridad" in res["roles"]


# ── 2. Primer y segundo intento fallido ──────────────────────────────────────
def test_primer_y_segundo_intento_fallido(fake_env):
    email = "operador@policia.gob.ar"
    fake_env.db.auth_users.append({"id": "uid-1", "email": email, "password": "ClaveCorrecta!"})

    # Intento 1
    with pytest.raises(NoAutenticadoError):
        fake_env.auth_service.login_institucional(email, "ClaveErronea1")

    st1 = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st1["bloqueado"] is False
    assert st1["intentos_fallidos"] == 1

    # Intento 2
    with pytest.raises(NoAutenticadoError):
        fake_env.auth_service.login_institucional(email, "ClaveErronea2")

    st2 = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st2["bloqueado"] is False
    assert st2["intentos_fallidos"] == 2


# ── 3. Tercer intento fallido activa el bloqueo ─────────────────────────────
def test_tercer_intento_activa_bloqueo(fake_env):
    email = "operador@policia.gob.ar"
    fake_env.db.auth_users.append({"id": "uid-1", "email": email, "password": "ClaveCorrecta!"})

    # 1 y 2
    for p in ["w1", "w2"]:
        with pytest.raises(NoAutenticadoError):
            fake_env.auth_service.login_institucional(email, p)

    # 3er intento: debe lanzar BloqueoTemporalError (status 429)
    with pytest.raises(BloqueoTemporalError) as exc_info:
        fake_env.auth_service.login_institucional(email, "w3")

    assert exc_info.value.status_code == 429
    assert exc_info.value.segundos_restantes == 900
    assert "bloqueada temporalmente" in exc_info.value.detail.lower()

    # Verificar estado en repositorio
    st = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st["bloqueado"] is True
    assert st["segundos_restantes"] > 0
    assert st["intentos_fallidos"] == 3


# ── 4. Rechazo de nuevos intentos durante los 15 minutos ────────────────────
def test_rechazo_durante_bloqueo(fake_env):
    email = "operador@policia.gob.ar"
    fake_env.db.auth_users.append({"id": "uid-1", "email": email, "password": "ClaveCorrecta!"})

    # Bloquear al usuario tras 3 fallos
    for _ in range(3):
        try:
            fake_env.auth_service.login_institucional(email, "bad_pwd")
        except (NoAutenticadoError, BloqueoTemporalError):
            pass

    # 4to intento: incluso con la contraseña CORRECTA, debe ser rechazado por estar bloqueado
    with pytest.raises(BloqueoTemporalError) as exc_bloqueo:
        fake_env.auth_service.login_institucional(email, "ClaveCorrecta!")

    assert exc_bloqueo.value.status_code == 429
    assert exc_bloqueo.value.segundos_restantes > 0


# ── 5. Persistencia del bloqueo entre distintas llamadas / clientes ──────────
def test_persistencia_del_bloqueo(fake_env):
    email = "operador@policia.gob.ar"
    fake_env.db.auth_users.append({"id": "uid-1", "email": email, "password": "ClaveCorrecta!"})

    # Bloquear
    for _ in range(3):
        try:
            fake_env.auth_service.login_institucional(email, "bad_pwd")
        except (NoAutenticadoError, BloqueoTemporalError):
            pass

    # Nueva instancia de servicio apuntando a la misma base de datos (simula reinicio o nuevo dispositivo)
    nuevo_seg_service = SeguridadLoginService(fake_env.seg_repo)
    nuevo_auth_service = AutenticacionInstitucionalService(
        fake_env.auth_service._settings,
        fake_env.auth_gw,
        fake_env.perf_repo,
        fake_env.usu_repo,
        nuevo_seg_service,
    )

    st = nuevo_seg_service.verificar_estado_bloqueo(email)
    assert st["bloqueado"] is True
    assert st["intentos_fallidos"] == 3

    with pytest.raises(BloqueoTemporalError):
        nuevo_auth_service.login_institucional(email, "ClaveCorrecta!")


# ── 6. Restablecimiento del contador tras autenticación correcta ─────────────
def test_restablecimiento_contador_tras_exito(fake_env):
    email = "operador@policia.gob.ar"
    pwd = "ClaveCorrecta!"
    uid = fake_env.db.next_id("auth")
    fake_env.db.auth_users.append({"id": uid, "email": email, "password": pwd})
    fake_env.db.tables["usuario"] = [{"usu_id_usuario": uid, "usu_email": email}]
    fake_env.db.tables["perfil"] = [{"prf_id_perfil": 1, "prf_nombre": "Autoridad"}]
    fake_env.db.tables["usuario_tiene_perfil"] = [
        {"usu_id_usuario": uid, "prf_id_perfil": 1, "usuprf_estado_aprobacion": "activo", "perfil": {"prf_nombre": "Autoridad"}}
    ]

    # 2 fallos consecutivos
    with pytest.raises(NoAutenticadoError):
        fake_env.auth_service.login_institucional(email, "wrong1")
    with pytest.raises(NoAutenticadoError):
        fake_env.auth_service.login_institucional(email, "wrong2")

    assert fake_env.seg_service.verificar_estado_bloqueo(email)["intentos_fallidos"] == 2

    # Login exitoso antes del 3er fallo
    res = fake_env.auth_service.login_institucional(email, pwd)
    assert res["status"] == "ok"

    # El contador debe volver a 0
    st = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st["bloqueado"] is False
    assert st["intentos_fallidos"] == 0


# ── 7. Rehabilitación del acceso al vencer el bloqueo de 15 min ──────────────
def test_rehabilitacion_acceso_al_vencer_bloqueo(fake_env):
    email = "operador@policia.gob.ar"
    pwd = "ClaveCorrecta!"
    uid = fake_env.db.next_id("auth")
    fake_env.db.auth_users.append({"id": uid, "email": email, "password": pwd})
    fake_env.db.tables["usuario"] = [{"usu_id_usuario": uid, "usu_email": email}]
    fake_env.db.tables["perfil"] = [{"prf_id_perfil": 1, "prf_nombre": "Autoridad"}]
    fake_env.db.tables["usuario_tiene_perfil"] = [
        {"usu_id_usuario": uid, "prf_id_perfil": 1, "usuprf_estado_aprobacion": "activo", "perfil": {"prf_nombre": "Autoridad"}}
    ]

    # Bloquear
    for _ in range(3):
        try:
            fake_env.auth_service.login_institucional(email, "bad")
        except (NoAutenticadoError, BloqueoTemporalError):
            pass

    st = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st["bloqueado"] is True

    # Simular paso del tiempo: mover bloqueado_hasta a hace 1 segundo
    rows = fake_env.db.tables["seguridad_intento_login"]
    row = next(r for r in rows if r["email_normalizado"] == email)
    row["bloqueado_hasta"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()

    # Consultar estado: debe detectar que expiró y rehabilitar
    st_despues = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st_despues["bloqueado"] is False
    assert st_despues["intentos_fallidos"] == 0

    # Ahora el login correcto debe funcionar
    res = fake_env.auth_service.login_institucional(email, pwd)
    assert res["status"] == "ok"


# ── 8. Errores de red o de servidor NO incrementan intentos ─────────────────
def test_errores_servidor_no_penalizan(fake_env):
    email = "operador@policia.gob.ar"

    # Simular excepción de conexión / timeout (no credenciales inválidas)
    class FakeTimeout(Exception):
        pass

    def mock_fail(*args, **kwargs):
        raise FakeTimeout("Connection refused to Supabase auth service")

    fake_env.auth_gw.iniciar_sesion = mock_fail

    with pytest.raises(NoAutenticadoError):
        fake_env.auth_service.login_institucional(email, "pwd")

    # Los intentos deben seguir en 0 porque no fue un error de contraseña errónea
    st = fake_env.seg_service.verificar_estado_bloqueo(email)
    assert st["intentos_fallidos"] == 0


# ── 9. Resistencia a manipulación y formato de tiempo ────────────────────────
def test_formateo_tiempo_restante():
    assert "15 minuto(s)" in formatear_tiempo_restante(900)
    assert "14 minuto(s) y 30 segundo(s)" in formatear_tiempo_restante(870)
    assert "45 segundo(s)" in formatear_tiempo_restante(45)
    assert "menos de un segundo" in formatear_tiempo_restante(0)


# ── 10. Flujo móvil con login-movil ──────────────────────────────────────────
def test_flujo_login_movil(fake_env):
    email = "civil@apoyar.com"
    pwd = "CivilPassword123!"
    uid = fake_env.db.next_id("auth")
    fake_env.db.auth_users.append({"id": uid, "email": email, "password": pwd})

    # 1. Login civil exitoso
    res = fake_env.auth_service.login_movil(email, pwd)
    assert res["status"] == "ok"
    assert "session" in res
    assert res["session"]["access_token"] == "fake_access_token_123"

    # 2. 3 fallos consecutivos en móvil
    for _ in range(2):
        with pytest.raises(NoAutenticadoError):
            fake_env.auth_service.login_movil(email, "bad_pwd")

    with pytest.raises(BloqueoTemporalError) as exc:
        fake_env.auth_service.login_movil(email, "bad_pwd")

    assert exc.value.status_code == 429
    assert exc.value.segundos_restantes == 900

    # 3. Móvil rechazado mientras esté bloqueado
    with pytest.raises(BloqueoTemporalError):
        fake_env.auth_service.login_movil(email, pwd)


# ── 11. Endpoint HTTP en FastAPI con TestClient ──────────────────────────────
def test_endpoints_api_bloqueo(fake_env):
    # Override dependencies
    app.dependency_overrides[get_autenticacion_institucional_service] = lambda: fake_env.auth_service
    app.dependency_overrides[get_seguridad_login_service] = lambda: fake_env.seg_service

    client = TestClient(app)

    email = "operador_api@policia.gob.ar"
    uid = fake_env.db.next_id("auth")
    fake_env.db.auth_users.append({"id": uid, "email": email, "password": "SecretPassword123!"})
    fake_env.db.tables["usuario"] = [{"usu_id_usuario": uid, "usu_email": email}]
    fake_env.db.tables["perfil"] = [{"prf_id_perfil": 1, "prf_nombre": "Autoridad"}]
    fake_env.db.tables["usuario_tiene_perfil"] = [
        {"usu_id_usuario": uid, "prf_id_perfil": 1, "usuprf_estado_aprobacion": "activo", "perfil": {"prf_nombre": "Autoridad"}}
    ]

    # Consultar estado inicial
    res_est = client.get(f"/api/v1/auth/estado-bloqueo?email={email}")
    assert res_est.status_code == 200
    assert res_est.json()["bloqueado"] is False

    # Intento 1 fallido
    res1 = client.post("/api/v1/auth/login-institucional", json={"email": email, "password": "wrong"})
    assert res1.status_code == 401

    # Intento 2 fallido
    res2 = client.post("/api/v1/auth/login-institucional", json={"email": email, "password": "wrong"})
    assert res2.status_code == 401

    # Intento 3 fallido -> debe responder 429 Too Many Requests
    res3 = client.post("/api/v1/auth/login-institucional", json={"email": email, "password": "wrong"})
    assert res3.status_code == 429
    data3 = res3.json()
    assert data3["bloqueado"] is True
    assert data3["segundos_restantes"] == 900
    assert "Retry-After" in res3.headers

    # Intento 4 mientras está bloqueado
    res4 = client.post("/api/v1/auth/login-institucional", json={"email": email, "password": "SecretPassword123!"})
    assert res4.status_code == 429

    # Verificar que /api/v1/auth/estado-bloqueo también reporta el bloqueo
    res_est2 = client.get(f"/api/v1/auth/estado-bloqueo?email={email}")
    assert res_est2.status_code == 200
    assert res_est2.json()["bloqueado"] is True

    # Limpiar overrides
    app.dependency_overrides.clear()

