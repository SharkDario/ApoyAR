# backend/app/routers/acustico.py
# ─────────────────────────────────────────────────────────────────────────────
# Router de Inferencia Acústica en Vivo para Vosk y YAMNet (CU-04 / RF-2.1).
# ─────────────────────────────────────────────────────────────────────────────

import logging
from fastapi import APIRouter, UploadFile, File, Form, Header, HTTPException, status
from typing import Optional
from app.services.acoustic_ai import acoustic_ai_service
from app.config import settings

logger = logging.getLogger("apoyar.acustico")
router = APIRouter(prefix="/api/v1/acustico", tags=["acustico"])


@router.post(
    "/analizar",
    summary="Analizar fragmento de audio en vivo con Vosk y YAMNet",
    description="Procesa ventanas continuas de audio de 3 segundos para detectar palabras clave o violencia ambiental."
)
async def analizar_audio_en_vivo(
    audio_file: Optional[UploadFile] = File(default=None),
    file: Optional[UploadFile] = File(default=None),
    palabra_clave: str = Form(default="pizza"),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
):
    # Verificación opcional de API secret si fue configurado
    if settings.api_secret_key and x_api_secret and x_api_secret != settings.api_secret_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Secreto de API inválido")

    # Aceptar campo 'audio_file' o 'file' indistintamente
    upload = audio_file or file
    if not upload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se recibió archivo de audio (esperado campo 'audio_file' o 'file')"
        )

    try:
        contenido_bytes = await upload.read()
        if not contenido_bytes:
            raise HTTPException(status_code=400, detail="Archivo de audio vacío (0 bytes)")

        logger.info(
            f"[Acústico] Audio recibido: {len(contenido_bytes)} bytes | Archivo: {upload.filename or 'audio'} | "
            f"Content-Type: {upload.content_type} | Palabra esperada: \"{palabra_clave}\""
        )

        resultado = acoustic_ai_service.analizar_audio(contenido_bytes, palabra_clave)

        # Logging detallado de punta a punta
        transcripcion = resultado.get("transcripcion") or resultado.get("transcripcion_vosk") or ""
        palabra_detectada = resultado.get("palabra_clave_detectada", False)
        top_clases = resultado.get("top_clases_yamnet", [])
        top3_str = ", ".join([f"{c['clase']} ({c['score']:.2f})" for c in top_clases[:3]])

        logger.info(f"[Acústico / Vosk] Transcripción: \"{transcripcion}\" | Palabra coincide: {palabra_detectada}")
        logger.info(f"[Acústico / YAMNet] Top-3 clases: {top3_str}")

        if resultado.get("amenaza_verbal_detectada", False):
            logger.warning(
                f"[Fusión IA] Amenaza verbal detectada en Speech: \"{resultado.get('frase_amenaza_detectada')}\" "
                f"(Categoría: {resultado.get('categoria_amenaza')}) -> Disparando Modo Resguardo"
            )

        if resultado.get("violencia_detectada", False):
            logger.warning(
                f"[Acústico / YAMNet] ¡ALERTA VIOLENCIA! Evento: {resultado.get('evento_violencia')} "
                f"({resultado.get('confianza_violencia', 0.0):.2f}) -> ¡DISPARO MODO RESGUARDO!"
            )

        return resultado
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[Acústico] Error procesando inferencia: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error en inferencia acústica: {exc}")


@router.post(
    "/transcribir-voz",
    summary="Transcribir palabra clave con Vosk ASR",
    description="Utilizado en el modal de configuración para transcribir la voz de la usuaria al definir su palabra clave."
)
async def transcribir_palabra_clave(
    audio_file: Optional[UploadFile] = File(default=None),
    file: Optional[UploadFile] = File(default=None),
    x_api_secret: Optional[str] = Header(default=None, alias="X-Api-Secret"),
):
    if settings.api_secret_key and x_api_secret and x_api_secret != settings.api_secret_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Secreto de API inválido")

    upload = audio_file or file
    if not upload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se recibió archivo de audio (esperado campo 'audio_file' o 'file')"
        )

    try:
        contenido_bytes = await upload.read()
        if not contenido_bytes:
            raise HTTPException(status_code=400, detail="Archivo de audio vacío (0 bytes)")

        logger.info(
            f"[Transcribir-Voz] Audio recibido: {len(contenido_bytes)} bytes | "
            f"Archivo: {upload.filename or 'voz'} | Content-Type: {upload.content_type}"
        )

        pcm_bytes, _ = acoustic_ai_service.convert_audio_to_pcm(contenido_bytes)
        texto = acoustic_ai_service.transcribir_vosk(pcm_bytes)

        logger.info(f"[Transcribir-Voz / Vosk] Transcripción obtenida: \"{texto}\" (válido: {bool(texto.strip())})")

        return {
            "status": "ok",
            "texto": texto,
            "es_valido": bool(texto.strip())
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[Transcribir-Voz] Error en transcripción: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error en transcripción Vosk: {exc}")

