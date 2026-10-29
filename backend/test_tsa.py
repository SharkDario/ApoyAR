# backend/test_tsa.py
# ─────────────────────────────────────────────────────────────────────────────
# Pruebas unitarias para el cliente de Sellado de Tiempo RFC 3161 (CU-07 / RNF-09).
# Verifica codificación ASN.1 DER, comunicación con TSA, extracción de TSTInfo,
# validación pericial de tokens y detección de hashes manipulados.
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import hashlib
import os
import random
import sys

# Compatibilidad con consola Windows (cp1252 / utf-8)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from app.services.tsa_client import tsa_client, TSAClient


async def run_tests():
    print("=" * 70)
    print("Iniciando Pruebas Unitarias: TSA Client RFC 3161 (ApoyAR Fase 2)")
    print("=" * 70)

    # 1. Prueba de generación y sellado con hash real
    contenido_prueba = b"Evidencia multimedia pericial de audio capturada en ApoyAR"
    hash_original = hashlib.sha256(contenido_prueba).hexdigest()
    print(f"\n[1] Hash SHA-256 a sellar: {hash_original}")

    print(f"    Consultando TSA ({tsa_client.tsa_url})...")
    res_sello = await tsa_client.obtener_sello_tiempo(hash_original)

    assert res_sello["token_rfc3161_b64"], "El token RFC 3161 no debe estar vacío."
    assert res_sello["gen_time"], "La marca temporal UTC debe estar presente."
    assert res_sello["serial_number"], "El número de serie del sello debe existir."
    assert res_sello["es_autentico"], "El resultado de verificación debe ser auténtico."

    print("    [OK] Sello de tiempo obtenido y deserializado exitosamente:")
    print(f"      - Fuente: {res_sello['tsa_fuente']}")
    print(f"      - Fecha atómica UTC (genTime): {res_sello['gen_time']}")
    print(f"      - OID de Política: {res_sello['policy_id']}")
    print(f"      - Serial Number: {res_sello['serial_number']}")
    print(f"      - Cert Subject: {res_sello['tsa_subject']}")
    print(f"      - Cert Issuer: {res_sello['tsa_issuer']}")
    print(f"      - Longitud Token Base64: {len(res_sello['token_rfc3161_b64'])} caracteres")

    # 2. Verificación pericial exitosa (hash idéntico)
    print("\n[2] Verificación pericial con hash auténtico...")
    verif = tsa_client.verificar_token_rfc3161(res_sello["token_rfc3161_b64"], hash_original)
    assert verif["valido"] is True, "El token debe validarse como íntegro para el hash correcto."
    assert verif["hash_coincide"] is True, "El digest extraído del TSTInfo debe coincidir exactamente."
    print("    [OK] Verificación pericial exitosa: Hash coincide y estructura ASN.1 intacta.")

    # 3. Detección de alteración o repudio (hash alterado)
    hash_alterado = hashlib.sha256(b"Evidencia adulterada con otro contenido").hexdigest()
    print(f"\n[3] Verificación pericial con hash manipulado ({hash_alterado[:16]}...)...")
    verif_tampered = tsa_client.verificar_token_rfc3161(res_sello["token_rfc3161_b64"], hash_alterado)
    assert verif_tampered["valido"] is False, "El token NO debe validarse si el hash fue alterado."
    assert verif_tampered["hash_coincide"] is False, "hash_coincide debe ser False."
    print(f"    [OK] Detección de alteración exitosa: {verif_tampered['error']}")

    # 4. Prueba del mecanismo de contingencia (Fallback TSA)
    print("\n[4] Prueba de mecanismo de contingencia (Fallback TSA local)...")
    cliente_offline = TSAClient(tsa_url="http://127.0.0.1:9999/no-existe", timeout_seconds=0.5)
    res_fallback = await cliente_offline.obtener_sello_tiempo(hash_original)
    assert res_fallback["token_rfc3161_b64"], "El token de fallback debe existir."
    assert res_fallback["tsa_fuente"] == "ApoyAR-Local-Fallback"
    
    verif_fb = cliente_offline.verificar_token_rfc3161(res_fallback["token_rfc3161_b64"], hash_original)
    assert verif_fb["valido"] is True, "El token de fallback debe ser matemáticamente válido."
    print("    [OK] Mecanismo de contingencia operativo sin excepciones:")
    print(f"      - Fuente: {res_fallback['tsa_fuente']}")
    print(f"      - Política OID: {res_fallback['policy_id']}")
    print(f"      - Fecha atómica UTC: {res_fallback['gen_time']}")

    print("\n" + "=" * 70)
    print("TODAS LAS PRUEBAS DE TSA RFC 3161 PASARON EXITOSAMENTE (100% OK)")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(run_tests())
