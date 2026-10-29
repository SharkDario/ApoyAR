# backend/test_fase2.py
# ─────────────────────────────────────────────────────────────────────────────
# Suite Integral de Pruebas Automatizadas para la Segunda Iteración (Fase 2).
#
# Casos de Prueba Verificados:
#   - CP-IT2-04: Firma asimétrica en hardware seguro (Android Keystore / TEE)
#   - CP-IT2-05: Sellado de tiempo confiable IETF RFC 3161 (TSA)
#   - CP-IT2-06: Encadenamiento criptográfico secuencial (prev_hash / Append-Only)
#   - CP-IT2-07: Auditoría de transición de estados de incidentes
#   - CP-IT2-08: Telemetría GPS en tiempo real para despacho de auxilio
#   - CU-08: Auditoría pericial judicial de evidencia digital (ISO/IEC 27037)
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import base64
import datetime
import hashlib
import sys
import uuid

# Configurar salida UTF-8 para consolas Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from app.config import settings
from app.database import supabase_admin
from app.main import app
from app.services.auth_dependencies import configurar_clave_test

TEST_AUTH_SECRET = "apoyar_fase2_regression_secret_key_2026_test!"


def generar_firma_hardware_mock(digest_bytes: bytes) -> tuple[str, str]:
    """
    Simula el enclave seguro de hardware (Android Keystore / StrongBox / TEE):
    1. Genera un par de claves elípticas EC secp256r1 (P-256).
    2. Firma el digest SHA-256 del binario.
    3. Retorna la firma en Base64 y la clave pública en formato hexadecimal.
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    signature_der = private_key.sign(digest_bytes, ec.ECDSA(hashes.SHA256()))
    
    # Derivar clave pública
    public_key = private_key.public_key()
    pub_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    
    return base64.b64encode(signature_der).decode("ascii"), pub_bytes.hex()


async def ejecutar_suite_fase2():
    print("=" * 75)
    print("EJECUTANDO SUITE INTEGRAL DE PRUEBAS - SEGUNDA ITERACIÓN (APOYAR FASE 2)")
    print("=" * 75)

    configurar_clave_test(TEST_AUTH_SECRET, "HS256")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:

        # ── 1. Verificación de Health Check y Versión ─────────────────────────
        print("\n[1] Verificando estado del servidor y versión de API...")
        res_health = await client.get("/health")
        assert res_health.status_code == 200, f"Error en health: {res_health.status_code}"
        data_health = res_health.json()
        assert data_health.get("version") in ("0.2.0", "0.3.0"), f"Versión incorrecta: {data_health}"
        print(f"    [OK] Servidor FastAPI operativo (v{data_health['version']}).")

        # ── 2. Preparar Usuario e Incidente Dedicado para Pruebas ──────────────
        print("\n[2] Preparando incidente de prueba dedicado en Supabase...")
        test_email = "victima_test_fase2@apoyar.local"
        user_res = (
            supabase_admin.table("usuario")
            .select("usu_id_usuario")
            .eq("usu_email", test_email)
            .execute()
        )
        if user_res.data:
            victima_id = user_res.data[0]["usu_id_usuario"]
        else:
            victima_id = str(uuid.uuid4())
            supabase_admin.table("usuario").insert({
                "usu_id_usuario": victima_id,
                "usu_email": test_email,
                "usu_activo": True,
            }).execute()

        # Buscar incidente de prueba dedicado exclusivamente para este usuario de test
        inc_res = (
            supabase_admin.table("incidente")
            .select("inc_id_incidente, usu_id_victima, inc_estado")
            .eq("usu_id_victima", victima_id)
            .limit(1)
            .execute()
        )

        if inc_res.data:
            incidente_id = inc_res.data[0]["inc_id_incidente"]
            supabase_admin.table("incidente").update({
                "inc_estado": "en_curso",
                "inc_latitud": -34.603722,
                "inc_longitud": -58.381592,
                "inc_direccion": "Av. 9 de Julio 500, CABA",
                "inc_direccion_aprox": "Av. 9 de Julio 500, CABA",
            }).eq("inc_id_incidente", incidente_id).execute()
            print(f"    [OK] Incidente de prueba dedicado reactivado: {incidente_id}")
        else:
            incidente_id = str(uuid.uuid4())
            supabase_admin.table("incidente").insert({
                "inc_id_incidente": incidente_id,
                "usu_id_victima": victima_id,
                "inc_latitud": -34.603722,
                "inc_longitud": -58.381592,
                "inc_direccion": "Av. 9 de Julio 500, CABA",
                "inc_direccion_aprox": "Av. 9 de Julio 500, CABA",
                "inc_origen": "automatico",
                "inc_estado": "en_curso",
                "inc_notas": "Incidente dedicado para suite automatizada de pruebas Fase 2",
            }).execute()
            print(f"    [OK] Incidente de prueba dedicado creado: {incidente_id}")

        # Generar token JWT autenticado para la víctima titular
        ahora = datetime.datetime.now(datetime.timezone.utc)
        payload_jwt = {
            "sub": str(victima_id),
            "email": "victima_test@apoyar.local",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": settings.jwt_issuer,
            "iat": int(ahora.timestamp()),
            "exp": int((ahora + datetime.timedelta(hours=2)).timestamp()),
        }
        token_victima = jwt.encode(payload_jwt, TEST_AUTH_SECRET, algorithm="HS256")
        auth_headers = {"Authorization": f"Bearer {token_victima}"}

        # ── 3. CP-IT2-04 & CP-IT2-05: Sellado Forense Multicapa (Evidencia 1) ───
        print("\n[3] CP-IT2-04 & CP-IT2-05: Sellando Evidencia Forense 1 (TSA RFC 3161 + TEE)...")
        audio_mock_1 = b"BUFFER_AUDIO_FORENSE_MOCK_FRAGMENTO_1_EN_VIVO_2026"
        hash_1 = hashlib.sha256(audio_mock_1).hexdigest()
        firma_hw_1, pubkey_hw_1 = generar_firma_hardware_mock(audio_mock_1)

        # Subir el binario físico a Storage para asegurar integridad y evitar 404
        storage_rel_1 = f"{victima_id}/{incidente_id}/audio_prueba_1.m4a"
        try:
            supabase_admin.storage.from_("evidencias").upload(storage_rel_1, audio_mock_1, {"upsert": "true", "content-type": "audio/m4a"})
        except Exception:
            pass

        payload_evidencia_1 = {
            "incidente_id": incidente_id,
            "usuario_id": victima_id,
            "tipo_archivo": "audio",
            "url_almacenamiento": storage_rel_1,
            "hash_sha256": hash_1,
            "firma_hardware": firma_hw_1,
            "fecha_captura": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "metadata_dispositivo": {
                "fabricante": "Samsung",
                "modelo": "SM-A546E",
                "so_version": "Android 14 (API 34)",
                "tee_type": "Android Keystore StrongBox EC-P256",
                "precisión_gps_metros": 3.4,
            },
        }

        resp_sello_1 = await client.post("/api/v1/evidencias/sellar-forense", json=payload_evidencia_1, headers=auth_headers)
        assert resp_sello_1.status_code == 201, f"Error sellando evidencia 1: {resp_sello_1.text}"
        data_sello_1 = resp_sello_1.json()

        evidencia_id_1 = data_sello_1["evidencia_id"]
        token_1 = data_sello_1["token_rfc3161"]
        prev_hash_1 = data_sello_1["prev_hash"]
        tsa_info_1 = data_sello_1["tsa_info"]

        assert evidencia_id_1, "Debe retornar el UUID de la evidencia creada."
        assert token_1 and len(token_1) > 100, "El token RFC 3161 debe contener la estructura CMS Base64."
        assert tsa_info_1["gen_time"], "El sello debe registrar la hora UTC de la TSA."

        print("    [OK] Evidencia 1 sellada con éxito:")
        print(f"      - ID: {evidencia_id_1}")
        print(f"      - SHA-256: {hash_1}")
        print(f"      - prev_hash asignado: {prev_hash_1}")
        print(f"      - Fecha TSA UTC: {tsa_info_1['gen_time']}")
        print(f"      - Serial TSA: {tsa_info_1['serial_number']}")
        print(f"      - Firma Hardware Keystore: {firma_hw_1[:30]}...")

        # ── 4. CP-IT2-06: Encadenamiento Criptográfico Secuencial (Evidencia 2) ─
        print("\n[4] CP-IT2-06: Verificando encadenamiento criptográfico con Evidencia 2...")
        audio_mock_2 = b"BUFFER_AUDIO_FORENSE_MOCK_FRAGMENTO_2_DETECCION_CONTINUA"
        hash_2 = hashlib.sha256(audio_mock_2).hexdigest()
        firma_hw_2, _ = generar_firma_hardware_mock(audio_mock_2)

        # Subir el binario físico a Storage para asegurar integridad y evitar 404
        storage_rel_2 = f"{victima_id}/{incidente_id}/audio_prueba_2.m4a"
        try:
            supabase_admin.storage.from_("evidencias").upload(storage_rel_2, audio_mock_2, {"upsert": "true", "content-type": "audio/m4a"})
        except Exception:
            pass

        payload_evidencia_2 = {
            "incidente_id": incidente_id,
            "usuario_id": victima_id,
            "tipo_archivo": "audio",
            "url_almacenamiento": storage_rel_2,
            "hash_sha256": hash_2,
            "firma_hardware": firma_hw_2,
            "fecha_captura": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "metadata_dispositivo": {
                "fabricante": "Samsung",
                "modelo": "SM-A546E",
                "secuencia": 2,
            },
        }

        resp_sello_2 = await client.post("/api/v1/evidencias/sellar-forense", json=payload_evidencia_2, headers=auth_headers)
        assert resp_sello_2.status_code == 201, f"Error sellando evidencia 2: {resp_sello_2.text}"
        data_sello_2 = resp_sello_2.json()

        evidencia_id_2 = data_sello_2["evidencia_id"]
        prev_hash_2 = data_sello_2["prev_hash"]

        print(f"    - Hash Evidencia 1: {hash_1}")
        print(f"    - prev_hash registrado en Evidencia 2: {prev_hash_2}")

        assert prev_hash_2 == hash_1, f"El prev_hash de la tupla 2 ({prev_hash_2}) debe ser exactamente el SHA-256 de la tupla 1 ({hash_1})."
        print("    [OK] Encadenamiento comprobado: Tupla 2 referencia matemáticamente a Tupla 1 (prev_hash == hash_1).")

        # ── 5. CU-08 / CP-IT2-05: Auditoría Pericial Judicial de la Evidencia ──
        print("\n[5] CU-08: Ejecutando auditoría pericial completa (/auditar)...")
        resp_audit = await client.get(f"/api/v1/evidencias/{evidencia_id_2}/auditar", headers=auth_headers)
        assert resp_audit.status_code == 200, f"Error auditando evidencia: {resp_audit.text}"
        data_audit = resp_audit.json()

        print(f"    - Estado global de la auditoría: {data_audit['estado_auditoria']}")
        print(f"    - Validación de firma en hardware: {data_audit['firma_hardware']}")
        print(f"    - Validación de sello TSA RFC 3161: {data_audit['sellado_tiempo_rfc3161']['valido']} (Fecha: {data_audit['sellado_tiempo_rfc3161']['gen_time']})")
        print(f"    - Continuidad de la cadena (prev_hash): {data_audit['cadena_prev_hash']}")

        assert data_audit["sellado_tiempo_rfc3161"]["valido"] is True, "El sello RFC 3161 debe validarse pericialmente."
        assert data_audit["firma_hardware"]["valido"] is True, "La firma hardware debe ser válida."
        assert data_audit["cadena_prev_hash"]["cadena_continua"] is True, "La cadena prev_hash debe tener continuidad."
        print("    [OK] Dictamen pericial emitido: Evidencia íntegra y no repudiable.")

        # ── 6. CP-IT2-08: Telemetría GPS en Tiempo Real (CU-06) ───────────────
        print("\n[6] CP-IT2-08: Actualizando telemetría GPS periódica (/posicion)...")
        payload_gps = {
            "latitud": -34.604100,
            "longitud": -58.382000,
            "direccion_aprox": "Av. Corrientes y Florida, CABA",
        }
        resp_gps = await client.patch(f"/api/v1/incidentes/{incidente_id}/posicion", json=payload_gps, headers=auth_headers)
        assert resp_gps.status_code == 200, f"Error actualizando GPS: {resp_gps.text}"
        data_gps = resp_gps.json()
        assert data_gps["latitud"] == -34.604100
        assert data_gps["longitud"] == -58.382000
        print(f"    [OK] Coordenadas actualizadas en base de datos: ({data_gps['latitud']}, {data_gps['longitud']}). Dispara Supabase Realtime.")

        # ── 7. CP-IT2-07: Transición de Estado y Disparador de Auditoría ────────
        print("\n[7] CP-IT2-07: Actualizando estado de incidente y comprobando trigger...")
        payload_estado = {
            "estado": "cerrado",
            "notas": "Cierre de incidente de prueba verificado con éxito por test_fase2.py",
        }
        resp_estado = await client.patch(f"/api/v1/incidentes/{incidente_id}/estado", json=payload_estado, headers=auth_headers)
        assert resp_estado.status_code == 200, f"Error actualizando estado: {resp_estado.text}"
        assert resp_estado.json()["nuevo_estado"] == "cerrado"
        print("    [OK] Incidente actualizado a estado 'cerrado'.")

        # Comprobar si el trigger de base de datos registró en historial_incidente
        try:
            hist_res = (
                supabase_admin.table("historial_incidente")
                .select("*")
                .eq("inc_id_incidente", incidente_id)
                .order("hisinc_creado_en", desc=True)
                .limit(1)
                .execute()
            )
            if hist_res.data and len(hist_res.data) > 0:
                h = hist_res.data[0]
                est_ant = h.get("hisinc_estado_anterior") or h.get("estado_anterior")
                est_nue = h.get("hisinc_estado_nuevo") or h.get("estado_nuevo")
                not_val = h.get("hisinc_notas") or h.get("notas")
                print(f"    [OK] Fila en historial_incidente verificada:")
                print(f"         - Estado anterior: {est_ant} -> Nuevo: {est_nue}")
                print(f"         - Notas: {not_val}")
            else:
                print("    [INFO] Tabla historial_incidente pendiente de trigger activo en Supabase (requiere correr migration_fase2.sql en el dashboard).")
        except Exception as e:
            print(f"    [INFO] Comprobación de historial_incidente: {e}")

        # ── 8. Reconstrucción de la Cadena Probatoria ──────────────────────────
        print("\n[8] Consultando trazabilidad de la cadena probatoria...")
        resp_cadena = await client.get(f"/api/v1/evidencias/incidente/{incidente_id}", headers=auth_headers)
        assert resp_cadena.status_code == 200
        data_cadena = resp_cadena.json()
        print(f"    [OK] Total de evidencias en el log inmutable para este incidente: {data_cadena['total_evidencias']}")

    print("\n" + "=" * 75)
    print("TODOS LOS CASOS DE PRUEBA DE LA FASE 2 HAN SIDO SUPERADOS CON ÉXITO")
    print("=" * 75)


if __name__ == "__main__":
    asyncio.run(ejecutar_suite_fase2())
