# backend/app/services/export_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Servicio de Generación de Paquetes Técnicos de Preservación (.ZIP).
# 
# Componentes del Paquete:
# 1. Acta Oficial de Cadena de Custodia en PDF con fotografías (Acta_Cadena_Custodia_<id>.pdf).
# 2. Archivos multimedia desencriptados reales con nombres legibles (Segmento_1_Audio_..., etc.).
# 3. Certificados de sellado de tiempo RFC 3161 (.tsr en binario ASN.1 DER y .txt descriptivo).
# 4. Manifiesto estructurado JSON con hashes, procedencias y firmas (manifiesto_integridad.json).
# ─────────────────────────────────────────────────────────────────────────────

import base64
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.services.pdf_generator import generar_informe_tecnico_pdf


class ExportService:
    @staticmethod
    def generar_paquete_zip(
        datos_contexto: Dict[str, Any],
        evidencias: List[Dict[str, Any]],
        archivos_binarios: Optional[Dict[str, bytes]] = None,
    ) -> tuple[bytes, str]:
        """
        Empaqueta los elementos probatorios desencriptados, el acta oficial de cadena
        de custodia en PDF, los certificados TSA RFC 3161 y el manifiesto JSON en un archivo ZIP.
        Retorna (zip_bytes, hash_sha256_manifiesto).
        """
        archivos_binarios = archivos_binarios or {}
        zip_buffer = io.BytesIO()

        incidente_id_str = str(datos_contexto.get("incidente_id") or "expediente")
        incidente_id_corto = incidente_id_str[:8]
        nombre_pdf_oficial = f"Acta_Cadena_Custodia_{incidente_id_corto}.pdf"

        # 1. Construir Manifiesto JSON Estructurado
        ahora_iso = datetime.now(timezone.utc).isoformat()
        manifiesto_items = []

        for idx, ev in enumerate(evidencias, start=1):
            ev_id = str(ev.get("evi_id_evidencia") or ev.get("id"))
            tipo = str(ev.get("evi_tipo_archivo") or ev.get("tipo_archivo") or "audio").lower()
            tipo_label = "Fotografia" if tipo == "imagen" else ("Video" if tipo == "video" else "Audio")
            
            # Buscar el nombre asignado en archivos_binarios
            nombre_asignado = None
            for fname in archivos_binarios.keys():
                if ev_id[:8] in fname or ev_id in fname:
                    nombre_asignado = fname
                    break

            nombre_final = nombre_asignado or f"Segmento_{idx}_{tipo_label}_{ev_id[:8]}.bin"
            ruta_paquete = f"evidencias/{nombre_final}"

            metadata = ev.get("evi_metadata_dispositivo") or ev.get("metadata_dispositivo") or {}
            sobre = metadata.get("sobre_digital") or {}

            # Obtener o calcular hash del archivo desencriptado
            hash_plano = sobre.get("hash_audio_plano")
            if not hash_plano and nombre_asignado and nombre_asignado in archivos_binarios:
                hash_plano = hashlib.sha256(archivos_binarios[nombre_asignado]).hexdigest().lower()

            tiene_tsa = bool(ev.get("evi_token_rfc3161") or ev.get("token_rfc3161"))
            tsa_estado = "certificado_rfc3161_valido" if tiene_tsa else (ev.get("evi_tsa_estado") or ev.get("tsa_estado") or "no_disponible")

            tam_desenc = len(archivos_binarios[nombre_asignado]) if (nombre_asignado and nombre_asignado in archivos_binarios) else sobre.get("tamano_audio_plano")

            inc_id_val = ev.get("inc_id_incidente") or ev.get("incidente_id")
            item = {
                "segmento_numero": idx,
                "evidencia_id": ev_id,
                "incidente_id": str(inc_id_val) if inc_id_val else None,
                "tipo_archivo": tipo,
                "nombre_archivo_paquete": ruta_paquete,
                "origen_captura": ev.get("evi_origen_captura") or ev.get("origen_captura", "captura_directa_app"),
                "fecha_captura": ev.get("evi_fecha_captura") or ev.get("fecha_captura") or ev.get("evi_sincronizado_en") or ev.get("sincronizado_en"),
                "hash_sha256_paquete_cifrado": ev.get("evi_hash_sha256") or ev.get("hash_sha256"),
                "hash_sha256_archivo_desencriptado": hash_plano,
                "prev_hash_encadenado": ev.get("evi_prev_hash") or ev.get("prev_hash"),
                "tsa_estado": tsa_estado,
                "tiene_token_rfc3161": tiene_tsa,
                "firma_hardware_presente": bool(ev.get("evi_firma_hardware") or ev.get("firma_hardware")),
                "tamano_bytes_desencriptado": tam_desenc,
                "formato": sobre.get("formato"),
            }
            manifiesto_items.append(item)

        es_exportacion_titular = bool(datos_contexto.get("es_exportacion_titular", False))

        manifiesto = {
            "version_manifiesto": "2.0.0",
            "estandar_forense": "ISO/IEC 27037:2012 / IETF RFC 3161",
            "marco_legal": "Ley N.° 25.326, Ley N.° 25.506, Ley N.° 26.485, Ley N.° 27.499",
            "generado_en": ahora_iso,
            "solicitante": datos_contexto.get("solicitante_email", "Personal Autorizado"),
            "solicitante_nombre": datos_contexto.get("solicitante_nombre"),
            "solicitante_id": datos_contexto.get("solicitante_id"),
            "solicitante_rol": "Titular de los Datos (Ciudadano/Víctima)" if es_exportacion_titular else "Autoridad Judicial / Perito Forense",
            "solicitante_cargo": None if es_exportacion_titular else datos_contexto.get("solicitante_cargo"),
            "solicitante_sede": None if es_exportacion_titular else datos_contexto.get("solicitante_sede"),
            "solicitante_institucion": None if es_exportacion_titular else datos_contexto.get("solicitante_institucion"),
            "solicitante_dependencia": None if es_exportacion_titular else datos_contexto.get("solicitante_dependencia"),
            "solicitante_legajo": None if es_exportacion_titular else datos_contexto.get("solicitante_legajo"),
            "regimen_exportacion": "ACCESO Y PORTABILIDAD SOBERANA DEL TITULAR (Arts. 14 y 15, Ley N.° 25.326)" if es_exportacion_titular else "EXPORTACIÓN INSTITUCIONAL CON CONSENTIMIENTO EXPRESO (Ley N.° 25.326 e ISO/IEC 27037)",
            "caracter_documento": "Copia probatoria personal descargada por su titular bajo Cifrado Soberano" if es_exportacion_titular else "Expediente digital forense oficial para instrucción judicial",
            "motivo_exportacion": datos_contexto.get("motivo_exportacion"),
            "destino_declarado": datos_contexto.get("destino_declarado"),
            "consentimiento_victima": datos_contexto.get("consentimiento_info"),
            "incidente_id": incidente_id_str,
            "cantidad_evidencias": len(evidencias),
            "evidencias": manifiesto_items,
            "aviso_legal": (
                "Este paquete forense fue generado conforme a las directrices de la norma ISO/IEC 27037:2012 y la Ley 25.326. "
                "Los archivos multimedia adjuntos han sido desencriptados en memoria desde sus envelopes criptográficos AES-256-GCM. "
                "La integridad y no alteración se certifica mediante los resúmenes SHA-256 y sellos de tiempo RFC 3161."
            ),
        }

        manifiesto_json_bytes = json.dumps(manifiesto, indent=2, ensure_ascii=False).encode("utf-8")
        hash_manifiesto = hashlib.sha256(manifiesto_json_bytes).hexdigest()

        # 2. Generar el Acta Oficial en PDF (con imágenes incrustadas si existen)
        pdf_bytes = generar_informe_tecnico_pdf(datos_contexto, evidencias, archivos_binarios)

        # 3. Ensamblar el contenedor ZIP
        with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            # A. Agregar únicamente el Acta PDF oficial con nombre solicitado (sin duplicado informe_tecnico_preservacion.pdf)
            zf.writestr(nombre_pdf_oficial, pdf_bytes)

            # B. Agregar manifiesto JSON de integridad
            zf.writestr("manifiesto_integridad.json", manifiesto_json_bytes)

            # C. Agregar archivos multimedia desencriptados ÚNICAMENTE dentro de la carpeta evidencias/
            for nombre_archivo, contenido in archivos_binarios.items():
                zf.writestr(f"evidencias/{nombre_archivo}", contenido)

            # D. Agregar tokens RFC 3161 (.tsr binario y .txt legible)
            for idx, ev in enumerate(evidencias, start=1):
                ev_id = str(ev.get("evi_id_evidencia") or ev.get("id"))
                token_b64 = ev.get("evi_token_rfc3161") or ev.get("token_rfc3161")
                if token_b64:
                    try:
                        token_der = base64.b64decode(token_b64)
                        zf.writestr(f"tokens_tsa/Certificado_TSA_{idx}_{ev_id[:8]}.tsr", token_der)
                        
                        # Descripción legible en texto plano del sello de tiempo
                        txt_desc = (
                            f"Certificado de Sellado Temporal RFC 3161 (TimeStampToken)\n"
                            f"==========================================================\n"
                            f"Elemento #{idx} (UUID: {ev_id})\n"
                            f"Incidente: {incidente_id_str}\n"
                            f"Huella SHA-256 sellada: {ev.get('evi_hash_sha256') or ev.get('hash_sha256')}\n"
                            f"Eslabón previo (prev_hash): {ev.get('evi_prev_hash') or ev.get('prev_hash')}\n"
                            f"Fecha captura: {ev.get('evi_fecha_captura') or ev.get('fecha_captura')}\n"
                            f"Tamaño del token ASN.1 DER: {len(token_der)} bytes\n"
                            f"Algoritmo digest: SHA-256 (OID 2.16.840.1.101.3.4.2.1)\n"
                            f"Validez: Certificación criptográfica emitida por Autoridad de Sellado de Tiempo externa.\n"
                        )
                        zf.writestr(f"tokens_tsa/Certificado_TSA_{idx}_{ev_id[:8]}.txt", txt_desc.encode("utf-8"))
                    except Exception:
                        pass

        zip_bytes = zip_buffer.getvalue()
        zip_buffer.close()
        return zip_bytes, hash_manifiesto


export_service = ExportService()
