# backend/app/services/alerta_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Caso de uso "desencadenar alertas" del incidente (CU-06 / RF-4.1):
# resuelve la red de apoyo de la víctima, registra una `alerta_temprana` por
# contacto y despacha las notificaciones push en segundo plano vía Expo.
#
# Los destinatarios de la alerta (contactos de la red) NO obtienen por ello
# acceso a evidencias: esa autorización la decide AccessControlService.
# ─────────────────────────────────────────────────────────────────────────────

import asyncio
import logging
from typing import Any, Dict, List, Set

from app.repositories.alerta_temprana_repository import AlertaTempranaRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.services.push_notifications import NotificadorPush

logger = logging.getLogger("apoyar.alertas")

# Referencias fuertes a las tareas en segundo plano (evita su recolección prematura).
_tareas_en_curso: Set[asyncio.Task] = set()


def lanzar_en_segundo_plano(corrutina) -> asyncio.Task:
    tarea = asyncio.create_task(corrutina)
    _tareas_en_curso.add(tarea)
    tarea.add_done_callback(_tareas_en_curso.discard)
    return tarea


class AlertaService:

    def __init__(
        self,
        red_apoyo: RedApoyoRepository,
        alertas: AlertaTempranaRepository,
        notificador: NotificadorPush,
    ):
        self._red_apoyo = red_apoyo
        self._alertas = alertas
        self._notificador = notificador

    def desencadenar_alertas(
        self,
        incidente_id: str,
        victima_id: str,
        latitud: float,
        longitud: float,
    ) -> Dict[str, Any]:
        """
        Devuelve {"alertas_encoladas": n} y, si no hay destinatarios, "detalle". El envío push se
        lanza con asyncio.create_task y no bloquea la respuesta HTTP 202.
        """
        contactos = self._red_apoyo.listar_contactos_activos(victima_id)
        if not contactos:
            return {"alertas_encoladas": 0, "detalle": "Sin contactos activos."}

        # La víctima nunca es destinataria de su propia alerta
        contacto_ids = [
            str(row["usu_id_contacto"])
            for row in contactos
            if str(row["usu_id_contacto"]) != victima_id
        ]
        if not contacto_ids:
            return {"alertas_encoladas": 0, "detalle": "Sin contactos válidos distintos de la víctima."}

        dispositivos = self._red_apoyo.listar_tokens_push_activos(contacto_ids)

        self._alertas.registrar_alertas([
            {
                "inc_id_incidente": incidente_id,
                "usu_id_contacto": cid,
                "aletem_tipo_alerta": "in_app",
            }
            for cid in contacto_ids
        ])

        tokens: List[str] = [row["disusu_expo_push_token"] for row in dispositivos if row.get("disusu_expo_push_token")]
        if tokens:
            lanzar_en_segundo_plano(
                self._notificador.desencadenar_alertas_incidente(
                    incidente_id=incidente_id,
                    victima_id=victima_id,
                    latitud=latitud,
                    longitud=longitud,
                    tokens_contactos=tokens,
                )
            )

        return {"alertas_encoladas": len(tokens)}
