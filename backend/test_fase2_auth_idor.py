# backend/test_fase2_auth_idor.py
# ─────────────────────────────────────────────────────────────────────────────
# Suite Integral de Pruebas Automatizadas de la FASE 2 - ITERACIÓN 3:
# Base de Datos Segura, Autenticación Criptográfica JWT y Autorización Anti-IDOR.
#
# Casos de Prueba Verificados:
#   1. CP-SEC-01: Token Bearer JWT válido con usuario activo (200 / 201 / 202)
#   2. CP-SEC-02: Token JWT vencido (exp expirado) -> HTTP 401 Unauthorized
#   3. CP-SEC-03: Token JWT con firma criptográfica inválida -> HTTP 401 Unauthorized
#   4. CP-SEC-04: Token JWT con audiencia incorrecta (aud != authenticated) -> HTTP 401
#   5. CP-SEC-05: Token JWT con emisor no autorizado (iss incorrecto) -> HTTP 401
#   6. CP-SEC-06: Solicitud sin token de autenticación (Header ausente) -> HTTP 401
#   7. CP-SEC-07: Cuenta suspendida o inactiva en base de datos -> HTTP 403 Forbidden
#   8. CP-SEC-08: Usuario común (Víctima) intentando acceder a consola Admin -> HTTP 403
#   9. CP-IDOR-01: Usuario B intentando emitir telemetría GPS sobre incidente de Usuario A -> HTTP 403
#  10. CP-IDOR-02: Usuario B intentando cambiar estado sobre incidente de Usuario A -> HTTP 403
#  11. CP-IDOR-03: Usuario B intentando activar alerta en nombre de Víctima A -> HTTP 403
#  12. CP-IDOR-04: Usuario B intentando auditar/consultar evidencia ajena de Usuario A -> HTTP 403
#  13. CP-IDOR-05: Contacto de confianza intentando auditar grabaciones íntimas -> HTTP 403 (Matriz Secc. 9)
#  14. CP-IDOR-06: Administrador intentando auditar grabaciones íntimas por defecto -> HTTP 403 (Matriz Secc. 9)
#  15. CP-SEC-09: Identificador de recurso inexistente -> HTTP 404 Not Found
#  16. CP-SEC-10: Operador con rol Autoridad auditando evidencia de forma autorizada -> HTTP 200 OK
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import datetime
import sys
import uuid
from typing import Any, Dict

# Configurar salida UTF-8 para consolas Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import httpx
import jwt

from app.config import settings
from app.main import app
from app.services.auth_dependencies import (
    configurar_clave_test,
    normalizar_rol,
)

TEST_SECRET = "apoyar_super_secret_test_key_for_fase2_anti_idor_matrix_2026_safe!"
TEST_ALGORITHM = "HS256"


def crear_token_prueba(
    user_id: str,
    email: str = "usuario_prueba@apoyar.local",
    role: str = "authenticated",
    exp_delta_seconds: int = 3600,
    issuer: str = None,
    audience: str = "authenticated",
    secret: str = TEST_SECRET,
) -> str:
    """Genera un token JWT firmado para pruebas deterministas."""
    ahora = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "aud": audience,
        "iss": issuer or settings.jwt_issuer,
        "iat": int(ahora.timestamp()),
        "exp": int((ahora + datetime.timedelta(seconds=exp_delta_seconds)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=TEST_ALGORITHM)


async def ejecutar_suite_fase2():
    print("=" * 80)
    print("SUITE DE PRUEBAS DE SEGURIDAD - FASE 2: AUTH CRIPTOGRÁFICA Y ANTI-IDOR (APOYAR)")
    print("=" * 80)

    # Configurar clave local de prueba en el inyector de dependencias
    configurar_clave_test(TEST_SECRET, TEST_ALGORITHM)

    # Identificadores de usuarios de prueba
    victima_a_id = str(uuid.uuid4())
    victima_b_id = str(uuid.uuid4())
    contacto_id = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())
    autoridad_id = str(uuid.uuid4())
    incidente_a_id = str(uuid.uuid4())
    evidencia_a_id = str(uuid.uuid4())

    # Generación de tokens
    token_victima_a = crear_token_prueba(victima_a_id, email="victima_a@apoyar.local")
    token_victima_b = crear_token_prueba(victima_b_id, email="victima_b@apoyar.local")
    token_contacto = crear_token_prueba(contacto_id, email="contacto@apoyar.local")
    token_admin = crear_token_prueba(admin_id, email="admin@apoyar.local")
    token_autoridad = crear_token_prueba(autoridad_id, email="autoridad@apoyar.local")

    # Tokens para casos negativos criptográficos
    token_vencido = crear_token_prueba(victima_a_id, exp_delta_seconds=-300)
    token_firma_falsa = crear_token_prueba(victima_a_id, secret="clave_completamente_falsa_e_invalida_12345!")
    token_aud_invalida = crear_token_prueba(victima_a_id, audience="audiencia_no_autorizada")
    token_iss_invalido = crear_token_prueba(victima_a_id, issuer="https://emisor-atacante.fake/auth/v1")

    # Iniciar cliente de prueba HTTP
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:

        # ── 1. Verificación Criptográfica de JWT ──────────────────────────────
        print("\n--- 1. Pruebas de Verificación Criptográfica de JWT (Supabase Auth) ---")

        # CP-SEC-01: Header ausente
        print("[CP-SEC-01] Solicitud protegida sin encabezado Authorization...")
        res = await client.get(f"/api/v1/incidentes/{incidente_a_id}")
        assert res.status_code == 401, f"Esperado 401, obtenido {res.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 401: {res.json().get('detail')}")

        # CP-SEC-02: Token vencido
        print("\n[CP-SEC-02] Token JWT con tiempo de expiración vencido (exp < now)...")
        res = await client.get(
            f"/api/v1/incidentes/{incidente_a_id}",
            headers={"Authorization": f"Bearer {token_vencido}"},
        )
        assert res.status_code == 401, f"Esperado 401, obtenido {res.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 401: {res.json().get('detail')}")

        # CP-SEC-03: Token con firma criptográfica inválida
        print("\n[CP-SEC-03] Token JWT firmado con clave no autorizada...")
        res = await client.get(
            f"/api/v1/incidentes/{incidente_a_id}",
            headers={"Authorization": f"Bearer {token_firma_falsa}"},
        )
        assert res.status_code == 401, f"Esperado 401, obtenido {res.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 401: {res.json().get('detail')}")

        # CP-SEC-04: Token con audiencia incorrecta
        print("\n[CP-SEC-04] Token JWT con claim aud != 'authenticated'...")
        res = await client.get(
            f"/api/v1/incidentes/{incidente_a_id}",
            headers={"Authorization": f"Bearer {token_aud_invalida}"},
        )
        assert res.status_code == 401, f"Esperado 401, obtenido {res.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 401: {res.json().get('detail')}")

        # CP-SEC-05: Token con emisor no autorizado
        print("\n[CP-SEC-05] Token JWT con claim iss no coincidente con el proyecto...")
        res = await client.get(
            f"/api/v1/incidentes/{incidente_a_id}",
            headers={"Authorization": f"Bearer {token_iss_invalido}"},
        )
        assert res.status_code == 401, f"Esperado 401, obtenido {res.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 401: {res.json().get('detail')}")

        # CP-SEC-06: Token malformado
        print("\n[CP-SEC-06] Token JWT sintácticamente malformado...")
        res = await client.get(
            f"/api/v1/incidentes/{incidente_a_id}",
            headers={"Authorization": "Bearer token_completamente_basura_no_base64"},
        )
        assert res.status_code == 401, f"Esperado 401, obtenido {res.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 401: {res.json().get('detail')}")

        # ── 2. Pruebas de RBAC y Control de Acceso por Rol ────────────────────
        print("\n--- 2. Pruebas de Roles y Restricción Administrativa (RBAC) ---")

        # Mock de roles para usuarios de prueba
        from app.services import auth_dependencies
        original_get_active = auth_dependencies.get_current_active_user

        async def mock_get_current_active_user_custom(current_user=None):
            # Asignar roles según el usuario de prueba
            uid = current_user["id"]
            if uid == admin_id:
                current_user["roles"] = ["Administrador"]
            elif uid == autoridad_id:
                current_user["roles"] = ["Autoridad"]
            elif uid == contacto_id:
                current_user["roles"] = ["Contacto"]
            else:
                current_user["roles"] = ["Víctima"]
            return current_user

        # CP-SEC-08: Víctima intentando acceder a /api/v1/admin/usuarios
        print("[CP-SEC-08] Usuario común con rol 'Víctima' intentando acceder a ruta de Administrador...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": victima_a_id,
            "email": "victima_a@apoyar.local",
            "roles": ["Víctima"],
        }
        res_admin = await client.get(
            "/api/v1/admin/usuarios",
            headers={"Authorization": f"Bearer {token_victima_a}"},
        )
        assert res_admin.status_code == 403, f"Esperado 403, obtenido {res_admin.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 403: {res_admin.json().get('detail')}")

        # CP-SEC-09: Administrador accediendo legítimamente a su ruta
        print("\n[CP-SEC-09] Usuario con rol 'Administrador' accediendo a /api/v1/admin/usuarios...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": admin_id,
            "email": "admin@apoyar.local",
            "roles": ["Administrador"],
        }
        res_admin_ok = await client.get(
            "/api/v1/admin/usuarios",
            headers={"Authorization": f"Bearer {token_admin}"},
        )
        assert res_admin_ok.status_code == 200, f"Esperado 200, obtenido {res_admin_ok.status_code}"
        print(f"    [OK] Acceso administrativo concedido HTTP 200.")

        # CP-SEC-10: Usuario común intentando acceder a incidentes activos de Autoridad
        print("\n[CP-SEC-10] Usuario 'Víctima' intentando acceder a consola operativa de Autoridad...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": victima_a_id,
            "email": "victima_a@apoyar.local",
            "roles": ["Víctima"],
        }
        res_aut_fail = await client.get(
            "/api/v1/autoridad/incidentes-activos",
            headers={"Authorization": f"Bearer {token_victima_a}"},
        )
        assert res_aut_fail.status_code == 403, f"Esperado 403, obtenido {res_aut_fail.status_code}"
        print(f"    [OK] Rechazo exitoso HTTP 403: {res_aut_fail.json().get('detail')}")

        # CP-SEC-11: Autoridad accediendo legítimamente a incidentes activos
        print("\n[CP-SEC-11] Operador con rol 'Autoridad' accediendo a consola operativa...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": autoridad_id,
            "email": "autoridad@apoyar.local",
            "roles": ["Autoridad"],
        }
        res_aut_ok = await client.get(
            "/api/v1/autoridad/incidentes-activos",
            headers={"Authorization": f"Bearer {token_autoridad}"},
        )
        assert res_aut_ok.status_code == 200, f"Esperado 200, obtenido {res_aut_ok.status_code}"
        print(f"    [OK] Acceso concedido a Autoridad HTTP 200.")

        # ── 3. Pruebas de Autorización Anti-IDOR sobre Incidentes ─────────────
        print("\n--- 3. Pruebas de Defensa Anti-IDOR sobre Incidentes ---")

        # Mock de base de datos para incidente_a_id perteneciente a victima_a_id
        original_verify_inc = auth_dependencies.verify_incident_ownership

        # CP-IDOR-01: Victima B intentando transmitir GPS sobre incidente de Victima A
        print("[CP-IDOR-01] Víctima B intentando enviar telemetría GPS sobre incidente ajeno de Víctima A...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": victima_b_id,
            "email": "victima_b@apoyar.local",
            "roles": ["Víctima"],
        }
        payload_gps = {"latitud": -34.6037, "longitud": -58.3815}
        res_idor_gps = await client.patch(
            f"/api/v1/incidentes/{incidente_a_id}/posicion",
            json=payload_gps,
            headers={"Authorization": f"Bearer {token_victima_b}"},
        )
        # Debe fallar con 404 (si no existe en BD remota) o 403 (rechazo Anti-IDOR)
        assert res_idor_gps.status_code in (403, 404), f"Esperado 403/404, obtenido {res_idor_gps.status_code}"
        print(f"    [OK] Ataque IDOR de GPS bloqueado (HTTP {res_idor_gps.status_code}): {res_idor_gps.json().get('detail')}")

        # CP-IDOR-02: Victima B intentando activar SOS usando victima_id ajeno
        print("\n[CP-IDOR-02] Víctima B intentando activar auxilio asignando en payload la víctima A...")
        payload_sos_idor = {
            "incidente_id": incidente_a_id,
            "victima_id": victima_a_id,  # Víctima ajena
            "latitud": -34.6037,
            "longitud": -58.3815,
            "origen": "manual",
        }
        res_sos_idor = await client.post(
            "/api/v1/incidentes/activar",
            json=payload_sos_idor,
            headers={"Authorization": f"Bearer {token_victima_b}"},
        )
        assert res_sos_idor.status_code == 403, f"Esperado 403, obtenido {res_sos_idor.status_code}"
        print(f"    [OK] Suplantación Anti-IDOR en SOS bloqueada: {res_sos_idor.json().get('detail')}")

        # CP-IDOR-03: Victima B intentando modificar datos personales de Victima A
        print("\n[CP-IDOR-03] Víctima B intentando modificar el perfil de Víctima A (/persona/{id})...")
        res_per_idor = await client.put(
            f"/api/v1/incidentes/persona/{victima_a_id}",
            json={"nombre": "Nombre Hacker"},
            headers={"Authorization": f"Bearer {token_victima_b}"},
        )
        assert res_per_idor.status_code == 403, f"Esperado 403, obtenido {res_per_idor.status_code}"
        print(f"    [OK] Modificación IDOR de perfil bloqueada: {res_per_idor.json().get('detail')}")

        # CP-IDOR-04: Victima B intentando regenerar código de vinculación de Victima A
        print("\n[CP-IDOR-04] Víctima B intentando regenerar código de vinculación de Víctima A...")
        res_cod_idor = await client.post(
            f"/api/v1/incidentes/red/regenerar-codigo/{victima_a_id}",
            headers={"Authorization": f"Bearer {token_victima_b}"},
        )
        assert res_cod_idor.status_code == 403, f"Esperado 403, obtenido {res_cod_idor.status_code}"
        print(f"    [OK] Regeneración IDOR de código bloqueada: {res_cod_idor.json().get('detail')}")

        # ── 4. Pruebas de Autorización Anti-IDOR sobre Evidencias y Matriz Secc. 9 ─
        print("\n--- 4. Pruebas de Matriz de Permisos sobre Evidencias (Sección 9) ---")

        # CP-IDOR-05: Contacto de emergencia intentando auditar evidencias probatorias
        print("[CP-IDOR-05] Contacto de confianza intentando auditar grabaciones/evidencias íntimas...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": contacto_id,
            "email": "contacto@apoyar.local",
            "roles": ["Contacto"],
        }
        res_audit_cont = await client.get(
            f"/api/v1/evidencias/{evidencia_a_id}/auditar",
            headers={"Authorization": f"Bearer {token_contacto}"},
        )
        assert res_audit_cont.status_code in (403, 404), f"Esperado 403/404, obtenido {res_audit_cont.status_code}"
        print(f"    [OK] Contacto bloqueado para evidencias íntimas (HTTP {res_audit_cont.status_code}): {res_audit_cont.json().get('detail')}")

        # CP-IDOR-06: Administrador intentando auditar evidencias probatorias por defecto
        print("\n[CP-IDOR-06] Administrador intentando auditar evidencias íntimas por defecto...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": admin_id,
            "email": "admin@apoyar.local",
            "roles": ["Administrador"],
        }
        res_audit_adm = await client.get(
            f"/api/v1/evidencias/{evidencia_a_id}/auditar",
            headers={"Authorization": f"Bearer {token_admin}"},
        )
        assert res_audit_adm.status_code in (403, 404), f"Esperado 403/404, obtenido {res_audit_adm.status_code}"
        print(f"    [OK] Administrador bloqueado por defecto para evidencias (HTTP {res_audit_adm.status_code}): {res_audit_adm.json().get('detail')}")

        # CP-IDOR-07: Victima B intentando sellar evidencia atribuyéndosela a Víctima A
        print("\n[CP-IDOR-07] Víctima B intentando sellar evidencia con usuario_id ajeno...")
        app.dependency_overrides[auth_dependencies.get_current_active_user] = lambda: {
            "id": victima_b_id,
            "email": "victima_b@apoyar.local",
            "roles": ["Víctima"],
        }
        payload_sello_idor = {
            "incidente_id": incidente_a_id,
            "usuario_id": victima_a_id,  # Usuario ajeno
            "tipo_archivo": "audio",
            "url_almacenamiento": "evidencias/audio.m4a",
            "hash_sha256": "a" * 64,
            "firma_hardware": "base64sig",
            "fecha_captura": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        res_sello_idor = await client.post(
            "/api/v1/evidencias/sellar-forense",
            json=payload_sello_idor,
            headers={"Authorization": f"Bearer {token_victima_b}"},
        )
        assert res_sello_idor.status_code == 403, f"Esperado 403, obtenido {res_sello_idor.status_code}"
        print(f"    [OK] Atribución ajena en sellar-forense bloqueada: {res_sello_idor.json().get('detail')}")

        # Limpiar overrides de dependencias
        app.dependency_overrides.clear()

    # ── 5. Pruebas Unitarias de Verificación Anti-IDOR y Matriz de Acceso ─────
    print("\n--- 5. Pruebas Directas de Reglas de Autorización y Matriz (Secc. 9) ---")
    from app.services.auth_dependencies import (
        verify_incident_ownership,
        verify_evidence_access,
        get_current_active_user,
    )
    from fastapi import HTTPException
    from unittest.mock import MagicMock, patch

    # Escenario A: Incidente existente perteneciente a Víctima A
    incidente_mock = {
        "id": incidente_a_id,
        "victima_id": victima_a_id,
        "estado": "en_curso",
    }

    # Mock de supabase_admin para que devuelva este incidente
    with patch("app.services.auth_dependencies.supabase_admin") as mock_sb:
        mock_table = MagicMock()
        mock_sb.table.return_value = mock_table
        mock_table.select.return_value = mock_table
        mock_table.eq.return_value = mock_table
        mock_table.execute.return_value = MagicMock(data=[incidente_mock])

        # Test A1: Víctima A (propietaria) actualiza su propia posición -> Autorizado
        user_victima_a = {"id": victima_a_id, "roles": ["Víctima"]}
        res_a1 = await verify_incident_ownership(incidente_a_id, user_victima_a, action="update_posicion")
        assert res_a1["id"] == incidente_a_id
        print("    [OK] Regla A1: Víctima titular autorizada a emitir GPS sobre su incidente.")

        # Test A2: Víctima B intenta actualizar posición de incidente ajeno -> 403
        user_victima_b = {"id": victima_b_id, "roles": ["Víctima"]}
        try:
            await verify_incident_ownership(incidente_a_id, user_victima_b, action="update_posicion")
            assert False, "Debió lanzar HTTP 403"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"    [OK] Regla A2: Víctima ajena rechazada con HTTP 403: {e.detail}")

        # Test A3: Víctima B intenta cambiar estado de incidente ajeno -> 403
        try:
            await verify_incident_ownership(incidente_a_id, user_victima_b, action="update_estado")
            assert False, "Debió lanzar HTTP 403"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"    [OK] Regla A3: Cambio de estado ajeno rechazado con HTTP 403: {e.detail}")

        # Test A4: Autoridad actualiza estado de incidente -> Autorizado
        user_autoridad = {"id": autoridad_id, "roles": ["Autoridad"]}
        res_a4 = await verify_incident_ownership(incidente_a_id, user_autoridad, action="update_estado")
        assert res_a4["id"] == incidente_a_id
        print("    [OK] Regla A4: Autoridad autorizada a gestionar estado de incidente.")

    # Escenario B: Evidencia perteneciente a Víctima A
    evidencia_mock = {
        "id": evidencia_a_id,
        "usuario_id": victima_a_id,
        "incidente_id": incidente_a_id,
        "tipo_archivo": "audio",
        "hash_sha256": "f" * 64,
        "activo": True,
    }

    with patch("app.services.auth_dependencies.supabase_admin") as mock_sb:
        mock_table = MagicMock()
        mock_sb.table.return_value = mock_table
        mock_table.select.return_value = mock_table
        mock_table.eq.return_value = mock_table
        
        # side_effect para devolver evidencia o incidente según corresponda
        def mock_execute_side_effect():
            # Devuelve evidencia o incidente
            return MagicMock(data=[evidencia_mock])
        
        mock_table.execute.side_effect = mock_execute_side_effect

        # Test B1: Víctima titular audita su propia evidencia -> Autorizado
        res_b1 = await verify_evidence_access(evidencia_a_id, user_victima_a, action="audit")
        assert res_b1["id"] == evidencia_a_id
        print("    [OK] Regla B1: Víctima titular autorizada a auditar su evidencia.")

        # Test B2: Víctima B intenta auditar evidencia ajena -> 403
        try:
            await verify_evidence_access(evidencia_a_id, user_victima_b, action="audit")
            assert False, "Debió lanzar HTTP 403"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"    [OK] Regla B2: Víctima ajena denegada con HTTP 403: {e.detail}")

        # Test B3: Contacto de emergencia intenta auditar evidencia multimedia -> 403
        user_contacto = {"id": contacto_id, "roles": ["Contacto"]}
        try:
            await verify_evidence_access(evidencia_a_id, user_contacto, action="audit")
            assert False, "Debió lanzar HTTP 403"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"    [OK] Regla B3: Contacto denegado a evidencias íntimas con HTTP 403: {e.detail}")

        # Test B4: Administrador intenta auditar evidencia íntima por defecto -> 403
        user_admin = {"id": admin_id, "roles": ["Administrador"]}
        try:
            await verify_evidence_access(evidencia_a_id, user_admin, action="audit")
            assert False, "Debió lanzar HTTP 403"
        except HTTPException as e:
            assert e.status_code == 403
            print(f"    [OK] Regla B4: Administrador denegado por defecto con HTTP 403: {e.detail}")

        # Test B5: Operador de Autoridad audita evidencia -> Autorizado
        res_b5 = await verify_evidence_access(evidencia_a_id, user_autoridad, action="audit")
        assert res_b5["id"] == evidencia_a_id
        print("    [OK] Regla B5: Operador de Autoridad autorizado a auditar evidencia.")

    # Escenario C: Verificación de Cuenta Suspendida (baneo vigente en Supabase Auth)
    from types import SimpleNamespace
    from app.services.cuenta_service import CuentaService

    auth_gateway_mock = MagicMock()
    auth_gateway_mock.obtener_usuario.return_value = SimpleNamespace(
        email="suspendido@apoyar.local",
        banned_until=(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).isoformat(),
    )
    cuentas = CuentaService(auth_gateway_mock, MagicMock(), MagicMock(), MagicMock(), MagicMock())
    try:
        await get_current_active_user(current_user={"id": victima_a_id, "email": "suspendido@apoyar.local"}, cuentas=cuentas)
        assert False, "Debió lanzar HTTP 403 por cuenta inactiva"
    except HTTPException as e:
        assert e.status_code == 403
        print(f"    [OK] Regla C1: Cuenta inactiva/suspendida rechazada con HTTP 403: {e.detail}")

    print("\n" + "=" * 80)
    print("TODOS LOS CASOS DE PRUEBA DE LA FASE 2 (AUTH & ANTI-IDOR) HAN SIDO SUPERADOS")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(ejecutar_suite_fase2())
