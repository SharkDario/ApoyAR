import base64
import hashlib
import io
import json
import re
import zipfile
import zlib
from PIL import Image

from app.services.export_service import export_service
from app.services.pdf_generator import generar_informe_tecnico_pdf, formatear_fecha_pericial

def extract_pdf_text(pdf_bytes: bytes) -> str:
    parts = []
    cursor = 0
    while True:
        s_idx = pdf_bytes.find(b"stream", cursor)
        if s_idx == -1:
            break
        start = s_idx + 6
        if pdf_bytes[start:start+1] == b"\r":
            start += 1
        if pdf_bytes[start:start+1] == b"\n":
            start += 1

        e_idx = pdf_bytes.find(b"endstream", start)
        if e_idx == -1:
            break

        stream_data = pdf_bytes[start:e_idx].strip()
        try:
            raw = base64.a85decode(stream_data, adobe=True)
            decomp = zlib.decompress(raw)
            dec_str = decomp.decode("latin1", errors="ignore")
            dec_str = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), dec_str)
            dec_str = dec_str.replace(r'\(', '(').replace(r'\)', ')')
            parts.append(dec_str)
        except Exception:
            try:
                decomp = zlib.decompress(stream_data)
                dec_str = decomp.decode("latin1", errors="ignore")
                dec_str = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), dec_str)
                dec_str = dec_str.replace(r'\(', '(').replace(r'\)', ')')
                parts.append(dec_str)
            except Exception:
                parts.append(stream_data.decode("latin1", errors="ignore"))
        cursor = e_idx + 9

    parts.append(pdf_bytes.decode("latin1", errors="ignore"))
    return "\n".join(parts)

def test_exportacion_titular_y_autoridad():
    print("Iniciando pruebas de exportación forense (5 correcciones)...")

    # 1. Crear una imagen JPEG simulada en memoria
    img = Image.new('RGB', (100, 100), color=(122, 31, 31))
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='JPEG')
    img_bytes = img_byte_arr.getvalue()

    hash_desencriptado = hashlib.sha256(img_bytes).hexdigest().lower()
    hash_cifrado = "1282afd3dbe32337ce5e8b8293201c4c211df572e2e9531a624b33b3e82e9d49"
    evidencia_id = "9a4c2437-1234-5678-90ab-cdef12345678"
    incidente_id = "2343eddd-aaaa-bbbb-cccc-ddddeeeeffff"

    token_tsa_dummy = base64.b64encode(b"DUMMY_RFC3161_TOKEN_ASN1_DER_CONTENT_FOR_TESTING").decode("utf-8")

    evidencias = [
        {
            "id": evidencia_id,
            "incidente_id": incidente_id,
            "tipo_archivo": "imagen",
            "url_almacenamiento": f"evidencias/{incidente_id}/{evidencia_id}.enc",
            "hash_sha256": hash_cifrado,
            "token_rfc3161": token_tsa_dummy,
            "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
            "metadata_dispositivo": {
                "sobre_digital": {
                    "formato": "jpg",
                    "hash_audio_plano": hash_desencriptado,
                    "tamano_audio_plano": len(img_bytes),
                    "tamano_paquete_cifrado": len(img_bytes) + 28,
                }
            },
            "fecha_captura": "2026-10-25T16:00:14.463663+00:00",
        }
    ]

    nombre_archivo_img = f"Segmento_1_Fotografia_{evidencia_id[:8]}.jpg"
    archivos_binarios = {
        nombre_archivo_img: img_bytes
    }

    # ── CASO A: Exportación Titular Ciudadano (Mobile) ───────────────────────
    ctx_titular = {
        "incidente_id": incidente_id,
        "fecha_hora": "2026-10-25T15:58:00+00:00",
        "estado": "en_curso",
        "origen": "sos_manual",
        "direccion": "María Pauzier, Barrio El Resguardo, Municipio de Formosa",
        "latitud": -26.15925,
        "longitud": -58.17874,
        "victima_id": "victima-uuid-1234",
        "victima_nombre": "María Laura Gómez",
        "victima_dni": "38.123.456",
        "es_victima": True,
        "es_exportacion_titular": True,
        "solicitante_id": "victima-uuid-1234",
        "solicitante_nombre": "María Laura Gómez",
        "solicitante_email": "maria.gomez@gmail.com",
        "solicitante_dni": "38.123.456",
        "solicitante_cargo": None,
        "solicitante_sede": None,
        "solicitante_institucion": None,
        "solicitante_dependencia": None,
        "solicitante_legajo": None,
        "motivo_exportacion": "Descarga y preservación personal de prueba pericial propia bajo soberanía criptográfica",
        "destino_declarado": "Dispositivo personal y repositorio soberano de la titular",
        "fecha_consentimiento": "2026-10-25T16:01:00+00:00",
        "consentimiento_info": "Otorgado el 2026-10-25T16:01:00+00:00 (Ley 25.326)",
    }

    zip_bytes_titular, hash_manifiesto_titular = export_service.generar_paquete_zip(
        ctx_titular, evidencias, archivos_binarios
    )

    with zipfile.ZipFile(io.BytesIO(zip_bytes_titular)) as zf:
        namelist = zf.namelist()
        print("Namelist ZIP Titular:", namelist)

        # 5. Limpieza de Archivos Duplicados dentro del .ZIP
        assert f"Acta_Cadena_Custodia_{incidente_id[:8]}.pdf" in namelist, "Debe existir Acta_Cadena_Custodia_<id>.pdf"
        assert "informe_tecnico_preservacion.pdf" not in namelist, "NO debe existir informe_tecnico_preservacion.pdf"
        assert nombre_archivo_img not in namelist, "NO debe existir copia suelta del jpg en la raíz del zip"
        assert f"evidencias/{nombre_archivo_img}" in namelist, "El jpg debe estar en evidencias/"
        assert f"tokens_tsa/Certificado_TSA_1_{evidencia_id[:8]}.tsr" in namelist, "Debe existir .tsr en tokens_tsa/"
        assert f"tokens_tsa/Certificado_TSA_1_{evidencia_id[:8]}.txt" in namelist, "Debe existir .txt en tokens_tsa/"

        # 4. Campo tsa_estado en manifiesto_integridad.json
        manifiesto_json = json.loads(zf.read("manifiesto_integridad.json").decode("utf-8"))
        ev_manifest = manifiesto_json["evidencias"][0]
        assert ev_manifest["tsa_estado"] == "certificado_rfc3161_valido", f"tsa_estado incorrecto: {ev_manifest['tsa_estado']}"
        assert ev_manifest["tiene_token_rfc3161"] is True
        assert ev_manifest["hash_sha256_paquete_cifrado"] == hash_cifrado
        assert ev_manifest["hash_sha256_archivo_desencriptado"] == hash_desencriptado

        # 3. Separación de régimen en Manifiesto Titular
        assert manifiesto_json["solicitante_rol"] == "Titular de los Datos (Ciudadano/Víctima)"
        assert manifiesto_json["solicitante_cargo"] is None
        assert manifiesto_json["solicitante_sede"] is None
        assert "SOBERANA DEL TITULAR" in manifiesto_json["regimen_exportacion"]
        assert "Copia probatoria personal descargada por su titular" in manifiesto_json["caracter_documento"]

        # 2 & 4. Verificación del PDF Titular
        pdf_bytes = zf.read(f"Acta_Cadena_Custodia_{incidente_id[:8]}.pdf")
        full_text = extract_pdf_text(pdf_bytes)

        assert "ACCESO Y PORTABILIDAD SOBERANA DEL TITULAR" in full_text
        assert "Copia probatoria personal descargada por su titular bajo Cifrado Soberano" in full_text
        assert "María Pauzier, Barrio El Resguardo, Municipio de Formosa" in full_text
        assert "(UTC-3 / ART)" in full_text
        # Hashes en sección 3
        assert "Sobre Cifrado" in full_text
        assert "Sellado TSA" in full_text
        assert "Archivo Original" in full_text
        assert "Desencriptado" in full_text
        assert hash_cifrado in full_text
        assert hash_desencriptado in full_text
        # Hashes en sección 4
        assert "JPG" in full_text
        assert "Sobre Cifrado TSA" in full_text

    print("[OK] CASO A (Titular) paso todas las aserciones exitosamente.")

    # ── CASO B: Exportación Autoridad (Web Panel) ───────────────────────────
    ctx_autoridad = {
        "incidente_id": incidente_id,
        "fecha_hora": "2026-10-25T15:58:00+00:00",
        "estado": "en_curso",
        "origen": "sos_manual",
        "direccion": "María Pauzier, Barrio El Resguardo, Municipio de Formosa",
        "latitud": -26.15925,
        "longitud": -58.17874,
        "victima_id": "victima-uuid-1234",
        "victima_nombre": "María Laura Gómez",
        "victima_dni": "38.123.456",
        "es_victima": False,
        "es_exportacion_titular": False,
        "solicitante_id": "perito-uuid-9999",
        "solicitante_nombre": "Dr. Fernando Morales",
        "solicitante_email": "fmorales@justiciaformosa.gob.ar",
        "solicitante_dni": "28.987.654",
        "solicitante_cargo": "Perito Informático Forense",
        "solicitante_sede": "Gabinete Pericial Forense (San Martín 450)",
        "solicitante_institucion": "Poder Judicial de Formosa",
        "solicitante_dependencia": "Dirección de Policía Científica y Forense",
        "solicitante_legajo": "MP-94821",
        "motivo_exportacion": "Instrucción de causa penal y peritaje informático de evidencia digital",
        "destino_declarado": "Juzgado de Instrucción y Correccional N.° 3",
        "fecha_consentimiento": "2026-10-25T16:01:00+00:00",
        "consentimiento_info": "Otorgado el 2026-10-25T16:01:00+00:00 (Ley 25.326)",
    }

    zip_bytes_autoridad, hash_manifiesto_autoridad = export_service.generar_paquete_zip(
        ctx_autoridad, evidencias, archivos_binarios
    )

    with zipfile.ZipFile(io.BytesIO(zip_bytes_autoridad)) as zf:
        manifiesto_json = json.loads(zf.read("manifiesto_integridad.json").decode("utf-8"))

        # Separación de régimen en Manifiesto Autoridad
        assert manifiesto_json["solicitante_rol"] == "Autoridad Judicial / Perito Forense"
        assert manifiesto_json["solicitante_cargo"] == "Perito Informático Forense"
        assert manifiesto_json["solicitante_sede"] == "Gabinete Pericial Forense (San Martín 450)"
        assert manifiesto_json["solicitante_institucion"] == "Poder Judicial de Formosa"
        assert manifiesto_json["solicitante_dependencia"] == "Dirección de Policía Científica y Forense"
        assert manifiesto_json["solicitante_legajo"] == "MP-94821"
        assert "EXPORTACIÓN INSTITUCIONAL CON CONSENTIMIENTO EXPRESO" in manifiesto_json["regimen_exportacion"]

        pdf_bytes = zf.read(f"Acta_Cadena_Custodia_{incidente_id[:8]}.pdf")
        full_text = extract_pdf_text(pdf_bytes)

        assert "EXPORTACIÓN INSTITUCIONAL CON CONSENTIMIENTO EXPRESO" in full_text
        assert "OTORGADO EXPRESAMENTE" in full_text
        assert "Dr. Fernando Morales" in full_text
        assert "MP-94821" in full_text
        assert "Perito Informático Forense" in full_text
        assert "Gabinete Pericial Forense (San Martín 450)" in full_text

    print("[OK] CASO B (Autoridad) paso todas las aserciones exitosamente.")
    print("\nTODAS LAS 5 CORRECCIONES FORENSES FUERON VERIFICADAS CON EXITO.")

if __name__ == "__main__":
    test_exportacion_titular_y_autoridad()
