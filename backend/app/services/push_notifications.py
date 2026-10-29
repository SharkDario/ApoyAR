# backend/app/services/push_notifications.py
# ─────────────────────────────────────────────────────────────────────────────
# Integración con Expo Push API (Expo Push Service) para notificaciones push.
# La lógica de backend debe manejar este envío porque requiere una clave
# de servidor (no se puede exponer la lógica completa desde el móvil).
#
# El backend NO habla con Firebase Cloud Messaging ni con APNs: envía cada
# mensaje a la Expo Push API, que lo reenvía al servicio nativo de la
# plataforma del dispositivo. La respuesta de la API es un "push ticket"
# (aceptación del envío), no una confirmación de entrega.
#
# Referencia: https://docs.expo.dev/push-notifications/sending-notifications/
# ─────────────────────────────────────────────────────────────────────────────

from typing import List, Optional, Protocol

import httpx

EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send"


class NotificadorPush(Protocol):
    """Contrato del componente que despacha las alertas push a la red de apoyo."""

    async def desencadenar_alertas_incidente(
        self,
        incidente_id: str,
        victima_id: str,
        latitud: float,
        longitud: float,
        tokens_contactos: List[str],
    ) -> List[dict]: ...


class ExpoPushNotifier:
    """Cliente de la Expo Push API (implementa NotificadorPush)."""

    def __init__(self, api_url: str = EXPO_PUSH_API_URL, timeout_seconds: float = 10.0):
        self.api_url = api_url
        self.timeout_seconds = timeout_seconds

    async def enviar_push_notification(
        self,
        expo_push_token: str,
        titulo: str,
        cuerpo: str,
        data: Optional[dict] = None,
    ) -> dict:
        """
        Envía una notificación push vía Expo Push API (HTTP POST).

        Args:
            expo_push_token: Token del dispositivo receptor (formato: ExponentPushToken[...]).
            titulo: Título de la notificación.
            cuerpo: Texto del cuerpo de la notificación.
            data: Payload JSON adicional (ej. incidente_id, coordenadas).

        Returns:
            Respuesta JSON de la API de Expo (push ticket).
        """
        payload = {
            "to": expo_push_token,
            "sound": "default",
            "title": titulo,
            "body": cuerpo,
            "data": data or {},
            "priority": "high",  # Crítico: garantiza entrega inmediata en Android
            "channelId": "emergencias",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.api_url,
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Accept-encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            return response.json()

    async def desencadenar_alertas_incidente(
        self,
        incidente_id: str,
        victima_id: str,
        latitud: float,
        longitud: float,
        tokens_contactos: List[str],
    ) -> List[dict]:
        """
        Envía la alerta SOS a cada token de la red de apoyo, uno por uno.

        Se ejecuta en segundo plano (asyncio.create_task) desde AlertaService,
        desacoplado de la respuesta 202 del endpoint /activar. Un fallo en un
        token no interrumpe el envío a los demás. No hay reintentos.

        Returns:
            Lista de resultados por token: {"token", "ok", "respuesta" | "error"}.
        """
        resultados = []
        for token in tokens_contactos:
            try:
                resultado = await self.enviar_push_notification(
                    expo_push_token=token,
                    titulo="⚠ ALERTA DE EMERGENCIA",
                    cuerpo="Una persona de tu red de apoyo necesita ayuda urgente.",
                    data={
                        "incidente_id": incidente_id,
                        "victima_id": victima_id,
                        "latitud": latitud,
                        "longitud": longitud,
                        "tipo": "sos_activado",
                    },
                )
                resultados.append({"token": token, "ok": True, "respuesta": resultado})
            except Exception as exc:
                resultados.append({"token": token, "ok": False, "error": str(exc)})

        return resultados
