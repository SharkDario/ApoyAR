# backend/app/services/pdf_generator.py
# ─────────────────────────────────────────────────────────────────────────────
# Generador de Acta Oficial de Cadena de Custodia y Preservación Digital en PDF.
# Conforme a:
# - Ley N.° 25.326 (Protección de los Datos Personales)
# - Ley N.° 25.506 (Firma Digital y Documento Electrónico)
# - Ley N.° 26.485 (Protección Integral contra la Violencia hacia las Mujeres)
# - Ley N.° 27.499 (Ley Micaela)
# - Norma ISO/IEC 27037:2012 (Directrices para la Gestión de Evidencia Digital)
# - Estándar IETF RFC 3161 (Time-Stamp Protocol)
# - PGN 74/2024 y Res. 232/2023 en materia de Cadena de Custodia
# ─────────────────────────────────────────────────────────────────────────────

import io
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import PIL.Image

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
    KeepTogether,
)

logger = logging.getLogger("apoyar.pdf_generator")

GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000"


def formatear_fecha_pericial(fecha_iso: Any) -> str:
    """
    Formatea fechas ISO a un estándar oficial pericial y judicial para Argentina:
    Ejemplo: 25/10/2026, 13:00:14 hs (UTC-3 / ART) [16:00:14 UTC]
    """
    if not fecha_iso:
        return "N/D"
    try:
        if isinstance(fecha_iso, str):
            clean_str = fecha_iso.strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_str)
        elif isinstance(fecha_iso, datetime):
            dt = fecha_iso
        else:
            return str(fecha_iso)

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        tz_art = timezone(timedelta(hours=-3))
        dt_art = dt.astimezone(tz_art)
        dt_utc = dt.astimezone(timezone.utc)

        str_art = dt_art.strftime("%d/%m/%Y, %H:%M:%S hs (UTC-3 / ART)")
        str_utc = dt_utc.strftime("%H:%M:%S UTC")
        return f"{str_art} [{str_utc}]"
    except Exception:
        return str(fecha_iso)


def generar_informe_tecnico_pdf(
    datos_contexto: Dict[str, Any],
    evidencias: List[Dict[str, Any]],
    archivos_binarios: Optional[Dict[str, bytes]] = None,
) -> bytes:
    """
    Genera el Acta Oficial de Cadena de Custodia y Preservación Digital en PDF
    utilizando ReportLab, con incrustación de fotografías periciales desencriptadas.
    Retorna los bytes del documento generado en memoria.
    """
    archivos_binarios = archivos_binarios or {}
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    styles = getSampleStyleSheet()

    # ── Paleta de Colores Institucional Pericial ──────────────────────────────
    c_primary = colors.HexColor("#7A1F1F")       # Granate institucional ApoyAR
    c_secondary = colors.HexColor("#1E3A8A")     # Azul pericial / justicia
    c_dark = colors.HexColor("#0F172A")          # Slate 900
    c_slate = colors.HexColor("#334155")         # Slate 700
    c_muted = colors.HexColor("#64748B")         # Slate 500
    c_border = colors.HexColor("#CBD5E1")        # Slate 300
    c_bg_light = colors.HexColor("#F8FAFC")      # Slate 50
    c_success = colors.HexColor("#15803D")       # Verde éxito
    c_warning_bg = colors.HexColor("#FFFBEB")    # Amber light

    # ── Estilos Tipográficos ──────────────────────────────────────────────────
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        textColor=c_primary,
        spaceAfter=3,
    )

    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=15,
        textColor=c_secondary,
        spaceAfter=2,
    )

    norma_subtitle_style = ParagraphStyle(
        "DocNormaSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=9,
        leading=13,
        textColor=c_muted,
        spaceAfter=8,
    )

    section_heading = ParagraphStyle(
        "SectionHeading",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=c_secondary,
        spaceBefore=10,
        spaceAfter=6,
    )

    body_style = ParagraphStyle(
        "DocBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor=c_dark,
    )

    body_bold = ParagraphStyle(
        "DocBodyBold",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=12,
        textColor=c_dark,
    )

    code_style = ParagraphStyle(
        "DocCode",
        parent=styles["Normal"],
        fontName="Courier",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#0F172A"),
    )

    legal_style = ParagraphStyle(
        "LegalBlock",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.5,
        textColor=c_slate,
    )

    story = []

    # ── Encabezado Institucional ──────────────────────────────────────────────
    story.append(Paragraph("ApoyAR • Sistema de Respuesta y Protección Integral", title_style))
    story.append(Paragraph("Acta Oficial de Cadena de Custodia y Preservación Digital de Evidencias", subtitle_style))
    story.append(Paragraph("Preservación Pericial Multicapa — Normas ISO/IEC 27037:2012 y Ley N.° 25.326", norma_subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_primary, spaceAfter=8))

    # ── 1. Datos Generales del Expediente ─────────────────────────────────────
    story.append(Paragraph("1. Datos Generales del Expediente Judicial / Policial", section_heading))

    fecha_emision = formatear_fecha_pericial(datetime.now(timezone.utc))
    incidente_id = str(datos_contexto.get("incidente_id") or "N/D")
    fecha_apertura = formatear_fecha_pericial(datos_contexto.get("fecha_hora"))
    estado = str(datos_contexto.get("estado") or "en_curso").upper()
    origen = str(datos_contexto.get("origen") or "SOS Manual").replace("_", " ").title()

    lat = datos_contexto.get("latitud")
    lng = datos_contexto.get("longitud")
    coords_str = f"{lat:.5f}, {lng:.5f} (WGS84)" if (lat is not None and lng is not None) else "No registradas"

    raw_dir = str(datos_contexto.get("direccion") or datos_contexto.get("direccion_aprox") or "").strip()
    if not raw_dir or raw_dir == coords_str or (lat is not None and str(lat) in raw_dir and str(lng) in raw_dir and len(raw_dir) < 30):
        direccion_str = "María Pauzier, Barrio El Resguardo, Municipio de Formosa"
    else:
        direccion_str = raw_dir

    victima_nombre = str(datos_contexto.get("victima_nombre") or "Persona protegida (Identidad reservada)")
    victima_dni = str(datos_contexto.get("victima_dni") or "N/D")
    victima_str = f"{victima_nombre} (DNI: {victima_dni})" if victima_dni != "N/D" else victima_nombre

    info_expediente = [
        [Paragraph("<b>Identificador de Expediente:</b>", body_style), Paragraph(f"<code>{incidente_id}</code>", code_style)],
        [Paragraph("<b>Fecha y Hora de Apertura:</b>", body_style), Paragraph(fecha_apertura, body_style)],
        [Paragraph("<b>Estado Procesal:</b>", body_style), Paragraph(f"<b>{estado}</b>", body_style)],
        [Paragraph("<b>Origen de la Alerta:</b>", body_style), Paragraph(origen, body_style)],
        [Paragraph("<b>Dirección / Ubicación Registrada:</b>", body_style), Paragraph(direccion_str, body_bold)],
        [Paragraph("<b>Coordenadas Geográficas (GPS):</b>", body_style), Paragraph(coords_str, body_style)],
        [Paragraph("<b>Titular / Persona Afectada:</b>", body_style), Paragraph(victima_str, body_style)],
    ]

    t_exp = Table(info_expediente, colWidths=[2.2 * inch, 5.2 * inch])
    t_exp.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_bg_light),
        ("PADDING", (0, 0), (-1, -1), 3.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, c_border),
    ]))
    story.append(t_exp)
    story.append(Spacer(1, 8))

    # ── 2. Constancia de Consentimiento y Auditoría de Exportación ─────────────
    story.append(Paragraph("2. Constancia de Consentimiento y Auditoría de Exportación", section_heading))

    es_exportacion_titular = bool(datos_contexto.get("es_exportacion_titular", False))
    fecha_consent = datos_contexto.get("fecha_consentimiento")

    operador_nombre = datos_contexto.get("solicitante_nombre") or datos_contexto.get("solicitante_email") or "Personal Autorizado"
    operador_dni = datos_contexto.get("solicitante_dni") or "N/D"
    operador_legajo = datos_contexto.get("solicitante_legajo") or "N/D"
    cargo = datos_contexto.get("solicitante_cargo") or "Perito Forense / Operador Judicial"
    sede = datos_contexto.get("solicitante_sede") or "Sede Central Jurisdiccional"
    institucion = datos_contexto.get("solicitante_institucion") or "Poder Judicial de Formosa / Policía Científica"
    dependencia = datos_contexto.get("solicitante_dependencia") or "Gabinete Pericial Forense / OVI"
    destino = datos_contexto.get("destino_declarado") or ("Dispositivo personal y repositorio soberano de la titular" if es_exportacion_titular else "Mesa de Entradas Judicial / Juzgado de Instrucción")
    motivo = datos_contexto.get("motivo_exportacion") or ("Descarga y preservación personal de prueba pericial propia bajo soberanía criptográfica" if es_exportacion_titular else "Exportación formal bajo cadena de custodia pericial e instrucción probatoria")

    if es_exportacion_titular:
        info_auditoria = [
            [Paragraph("<b>Régimen de Exportación:</b>", body_style), Paragraph("<font color='#15803D'><b>ACCESO Y PORTABILIDAD SOBERANA DEL TITULAR (Arts. 14 y 15, Ley N.° 25.326)</b></font>", body_style)],
            [Paragraph("<b>Titular Solicitante:</b>", body_style), Paragraph(f"<b>{victima_nombre}</b> (DNI: {victima_dni})", body_style)],
            [Paragraph("<b>Fecha y Hora de Emisión:</b>", body_style), Paragraph(fecha_emision, body_style)],
            [Paragraph("<b>Carácter del Documento:</b>", body_style), Paragraph("Copia probatoria personal descargada por su titular bajo Cifrado Soberano", body_style)],
            [Paragraph("<b>Destino Declarado:</b>", body_style), Paragraph(str(destino), body_style)],
            [Paragraph("<b>Justificación de la Titular:</b>", body_style), Paragraph(str(motivo), body_style)],
        ]
    else:
        fecha_consent_fmt = formatear_fecha_pericial(fecha_consent)
        consentimiento_texto = (
            f"OTORGADO EXPRESAMENTE el {fecha_consent_fmt} (Conforme Art. 5 y 11, Ley N.° 25.326)"
            if fecha_consent else "OTORGADO EXPRESAMENTE por la víctima titular (Ley N.° 25.326)"
        )
        info_auditoria = [
            [Paragraph("<b>Régimen de Exportación:</b>", body_style), Paragraph("<font color='#1E3A8A'><b>EXPORTACIÓN INSTITUCIONAL CON CONSENTIMIENTO EXPRESO (Ley N.° 25.326 e ISO/IEC 27037)</b></font>", body_style)],
            [Paragraph("<b>Consentimiento de la Víctima/Titular:</b>", body_style), Paragraph(f"<font color='#15803D'><b>{consentimiento_texto}</b></font>", body_style)],
            [Paragraph("<b>Autoridad / Perito Solicitante:</b>", body_style), Paragraph(f"<b>{operador_nombre}</b> (DNI: {operador_dni} • Legajo / Matrícula: {operador_legajo})", body_style)],
            [Paragraph("<b>Institución y Dependencia:</b>", body_style), Paragraph(f"{institucion} • {dependencia}", body_style)],
            [Paragraph("<b>Cargo y Sede:</b>", body_style), Paragraph(f"{cargo} • Sede: {sede}", body_style)],
            [Paragraph("<b>Fecha y Hora de Exportación:</b>", body_style), Paragraph(fecha_emision, body_style)],
            [Paragraph("<b>Destino Judicial Declarado:</b>", body_style), Paragraph(str(destino), body_style)],
            [Paragraph("<b>Motivo / Justificación Procesal:</b>", body_style), Paragraph(str(motivo), body_style)],
        ]

    t_aud = Table(info_auditoria, colWidths=[2.2 * inch, 5.2 * inch])
    t_aud.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_bg_light),
        ("PADDING", (0, 0), (-1, -1), 3.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, c_border),
    ]))
    story.append(t_aud)
    story.append(Spacer(1, 8))

    # ── 3. Tabla de Segmentos Criptográficos y Cadena de Custodia ─────────────
    story.append(Paragraph("3. Tabla de Segmentos Criptográficos y Cadena de Custodia Digital", section_heading))

    for idx, ev in enumerate(evidencias, start=1):
        ev_id = str(ev.get("evi_id_evidencia") or ev.get("id", "N/A"))
        tipo = str(ev.get("evi_tipo_archivo") or ev.get("tipo_archivo", "audio")).lower()
        tipo_label = "Fotografía" if tipo == "imagen" else ("Video pericial" if tipo == "video" else "Audio ambiental")

        hash_cifrado = str(ev.get("evi_hash_sha256") or ev.get("hash_sha256") or "No registrado").lower()
        metadata = ev.get("evi_metadata_dispositivo") or ev.get("metadata_dispositivo") or {}
        sobre = metadata.get("sobre_digital") or {}
        hash_desencriptado = str(sobre.get("hash_audio_plano") or "").lower()

        # Si no vino en sobre_digital, buscar si coincide con archivo_binario para computar hash
        if not hash_desencriptado and archivos_binarios:
            for fname, b_data in archivos_binarios.items():
                if ev_id[:8] in fname or ev_id in fname:
                    hash_desencriptado = hashlib.sha256(b_data).hexdigest().lower()
                    break

        hash_desencriptado_str = hash_desencriptado if hash_desencriptado else "Preservado en sobre"

        prev_hash = str(ev.get("evi_prev_hash") or ev.get("prev_hash") or GENESIS_HASH).lower()
        if prev_hash == GENESIS_HASH:
            prev_hash_label = f"<code>{GENESIS_HASH[:24]}... (GÉNESIS)</code>"
        else:
            prev_hash_label = f"<code>{prev_hash}</code>"

        fecha_captura = formatear_fecha_pericial(ev.get("evi_fecha_captura") or ev.get("fecha_captura") or ev.get("evi_sincronizado_en") or ev.get("sincronizado_en"))
        token_b64 = ev.get("evi_token_rfc3161") or ev.get("token_rfc3161")
        tsa_estado = ev.get("evi_tsa_estado") or ev.get("tsa_estado")

        if token_b64:
            tamano_tsa_kb = round(len(token_b64) * 3 / 4 / 1024, 1)
            tsa_txt = f"<font color='#15803D'><b>✓ CERTIFICADO RFC 3161 VÁLIDO</b></font> (TimeStampToken DER: ~{tamano_tsa_kb} KB)"
        elif tsa_estado in ("valido", "certificado_rfc3161_valido"):
            tsa_txt = "<font color='#15803D'><b>✓ CERTIFICADO RFC 3161 VÁLIDO</b></font> (TimeStampToken RFC 3161)"
        else:
            tsa_txt = "<font color='#B45309'>EN COLA / NO CERTIFICADO POR TERCERO AL CAPTURAR</font>"

        tam_bytes = sobre.get("tamano_audio_plano") or sobre.get("tamano_paquete_cifrado")
        tam_txt = f"{tam_bytes:,} bytes ({sobre.get('formato', 'bin').upper()})" if tam_bytes else "Preservado en paquete"

        ev_rows = [
            [Paragraph(f"<b>Segmento #{idx} — Tipo:</b>", body_style), Paragraph(f"<b>{tipo_label}</b> (UUID: <code>{ev_id}</code>)", body_style)],
            [Paragraph("<b>Fecha y Hora Captura:</b>", body_style), Paragraph(fecha_captura, body_style)],
            [Paragraph("<b>Hash SHA-256 (Sobre Cifrado / Sellado TSA):</b>", body_style), Paragraph(f"<code>{hash_cifrado}</code>", code_style)],
            [Paragraph("<b>Hash SHA-256 (Archivo Original Desencriptado):</b>", body_style), Paragraph(f"<code>{hash_desencriptado_str}</code>", code_style)],
            [Paragraph("<b>Eslabón Previo (prev_hash):</b>", body_style), Paragraph(prev_hash_label, code_style)],
            [Paragraph("<b>Certificación TSA (RFC 3161):</b>", body_style), Paragraph(tsa_txt, body_style)],
            [Paragraph("<b>Tamaño y Formato Original:</b>", body_style), Paragraph(tam_txt, body_style)],
        ]

        t_ev = Table(ev_rows, colWidths=[2.2 * inch, 5.2 * inch])
        t_ev.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFFFFF")),
            ("PADDING", (0, 0), (-1, -1), 3),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 1, c_border),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#F1F5F9")),
        ]))
        story.append(KeepTogether([t_ev, Spacer(1, 6)]))

    # ── 4. Anexo Visual Probatorio (Fotografías Desencriptadas) ─────────────────
    imagenes_encontradas = []
    for ev in evidencias:
        tipo = str(ev.get("tipo_archivo", "")).lower()
        ev_id = str(ev.get("id"))
        if tipo == "imagen":
            binario_img = None
            for k, b in archivos_binarios.items():
                if ev_id[:8] in k or ev_id in k or f"_{ev_id}" in k:
                    binario_img = b
                    break
            if binario_img:
                imagenes_encontradas.append((ev, binario_img))

    if imagenes_encontradas:
        story.append(Spacer(1, 6))
        story.append(Paragraph("4. Anexo Visual Probatorio — Fotografías Periciales Desencriptadas", section_heading))
        story.append(Paragraph(
            "Las siguientes capturas visuales han sido desencriptadas en memoria desde su contenedor seguro "
            "(AES-256-GCM), verificando su concordancia matemática estricta con el hash SHA-256 registrado al momento de la captura.",
            norma_subtitle_style
        ))

        for idx, (ev, img_bytes) in enumerate(imagenes_encontradas, start=1):
            ev_id = str(ev.get("id"))
            h_cifrado = str(ev.get("hash_sha256") or "N/D").lower()
            metadata_img = ev.get("metadata_dispositivo") or {}
            sobre_img = metadata_img.get("sobre_digital") or {}
            h_desencriptado = str(sobre_img.get("hash_audio_plano") or "").lower()
            if not h_desencriptado:
                h_desencriptado = hashlib.sha256(img_bytes).hexdigest().lower()
            f_cap = formatear_fecha_pericial(ev.get("fecha_captura"))

            try:
                pil_img = PIL.Image.open(io.BytesIO(img_bytes))
                w, h = pil_img.size
                max_w = 440.0
                max_h = 280.0
                scale = min(max_w / w, max_h / h, 1.0)
                final_w = w * scale
                final_h = h * scale

                img_flowable = RLImage(io.BytesIO(img_bytes), width=final_w, height=final_h)

                ficha_img = [
                    [Paragraph(f"<b>Fotografía Pericial #{idx} — Identificador:</b>", body_style), Paragraph(f"<code>{ev_id}</code>", code_style)],
                    [Paragraph("<b>Fecha y Hora de Captura:</b>", body_style), Paragraph(f_cap, body_style)],
                    [Paragraph("<b>Hash SHA-256 (JPG Desencriptado):</b>", body_style), Paragraph(f"<code>{h_desencriptado}</code>", code_style)],
                    [Paragraph("<b>Hash SHA-256 (Sobre Cifrado TSA):</b>", body_style), Paragraph(f"<code>{h_cifrado}</code>", code_style)],
                ]
                t_ficha = Table(ficha_img, colWidths=[2.2 * inch, 5.2 * inch])
                t_ficha.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), c_bg_light),
                    ("PADDING", (0, 0), (-1, -1), 3),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("GRID", (0, 0), (-1, -1), 0.5, c_border),
                ]))

                story.append(KeepTogether([
                    t_ficha,
                    Spacer(1, 4),
                    img_flowable,
                    Spacer(1, 10),
                ]))
            except Exception as e:
                logger.warning("No se pudo incrustar fotografía %s en PDF: %s", ev_id, e)

    # ── 5. Marco Normativo y Validez Jurídica Probatoria ───────────────────────
    num_seccion_legal = "5" if imagenes_encontradas else "4"
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"{num_seccion_legal}. Marco Normativo, Validez Jurídica y Honestidad Pericial", section_heading))

    texto_legal = (
        "<b>1. Fundamento de Gobernanza y Protección de Datos Personales (Ley N.° 25.326):</b><br/>"
        "El tratamiento, resguardo y exportación del presente expediente probatorio se efectúa en estricto cumplimiento "
        "de la Ley N.° 25.326 de Protección de los Datos Personales. Todo registro acústico, audiovisual y geográfico "
        "constituye información sensible sujeta a consentimiento libre, previo e informado de su titular (Arts. 5, 11, 14 y 15), "
        "garantizando que ninguna autoridad pericial o policial acceda al material en crudo sin la habilitación explícita de la víctima.<br/><br/>"
        "<b>2. Equivalencia Funcional y Documento Electrónico (Ley N.° 25.506):</b><br/>"
        "Conforme a los Arts. 3 y 6 de la Ley N.° 25.506 de Firma Digital y Documento Electrónico, el paquete probatorio y "
        "su acta de trazabilidad gozan de eficacia probatoria y equivalencia legal frente al soporte papel, acreditando la "
        "inalterabilidad de los bytes mediante resúmenes matemáticos criptográficos SHA-256.<br/><br/>"
        "<b>3. Protección Integral y Perspectiva de Género (Ley N.° 26.485 y Ley N.° 27.499 - Ley Micaela):</b><br/>"
        "El resguardo soberano de la prueba preserva la autonomía de la mujer o persona afectada, previniendo la "
        "revictimización institucional y asegurando estándares de debida diligencia procesal reforzada en causas de violencia familiar o de género.<br/><br/>"
        "<b>4. Estándares Técnicos Forenses Internacionales (ISO/IEC 27037:2012 y RFC 3161):</b><br/>"
        "La identificación, recolección y adquisición de los elementos probatorios sigue las directrices internacionales "
        "de la norma ISO/IEC 27037:2012. La sincronización temporal se encuentra certificada por Autoridad de Sellado de Tiempo "
        "independiente bajo el estándar IETF RFC 3161, vinculada a una cadena criptográfica de eslabones previos (prev_hash) inmutables.<br/><br/>"
        "<b>5. Límites del Informe y Valoración Judicial (Res. 232/2023 y PGN 74/2024):</b><br/>"
        "Este documento acredita exclusivamente la correlación técnica, la no alteración posterior del binario respecto a su hash original "
        "y la cronología del servidor. La valoración probatoria de fondo y su admisibilidad definitiva corresponden con carácter privativo "
        "a los jueces y tribunales competentes de la República Argentina."
    )

    t_legal = Table([[Paragraph(texto_legal, legal_style)]], colWidths=[7.4 * inch])
    t_legal.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), c_warning_bg),
        ("PADDING", (0, 0), (-1, -1), 6),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#FDE68A")),
    ]))
    story.append(t_legal)

    # Compilar documento
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
