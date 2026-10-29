# backend/app/repositories/seguridad_login_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Repositorio de Seguridad para Control de Intentos Fallidos y Bloqueo Temporal.
#
# Consume las funciones atómicas en PostgreSQL:
# - `fn_consultar_estado_bloqueo`
# - `fn_registrar_intento_login`
#
# RLS estricto: la tabla `public.seguridad_intento_login` solo es accesible
# mediante `service_role` o funciones `SECURITY DEFINER`.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Optional
from datetime import datetime, timezone
import logging

from app.repositories.base import SupabaseRepository

logger = logging.getLogger("apoyar.seguridad_login")


class SeguridadLoginRepository(SupabaseRepository):
    tabla = "seguridad_intento_login"

    def consultar_estado_bloqueo(self, email: str) -> Dict[str, Any]:
        """
        Consulta atómica de estado de bloqueo para un email.
        Retorna diccionario con:
        {
            "bloqueado": bool,
            "segundos_restantes": int,
            "intentos_fallidos": int,
            "bloqueado_hasta": Optional[str]
        }
        """
        email_clean = (email or "").strip().lower()
        if not email_clean:
            return {
                "bloqueado": False,
                "segundos_restantes": 0,
                "intentos_fallidos": 0,
                "bloqueado_hasta": None,
            }

        try:
            res = self._client.rpc(
                "fn_consultar_estado_bloqueo",
                {"p_email": email_clean},
            ).execute()
            if res.data and len(res.data) > 0:
                row = res.data[0]
                return {
                    "bloqueado": bool(row.get("bloqueado", False)),
                    "segundos_restantes": int(row.get("segundos_restantes") or 0),
                    "intentos_fallidos": int(row.get("intentos_fallidos") or 0),
                    "bloqueado_hasta": row.get("bloqueado_hasta"),
                }
        except Exception as exc:
            logger.error("Error consultando estado de bloqueo vía RPC para %s: %s", email_clean, exc)

        # Fallback directo en tabla con service_role si RPC falla
        try:
            res = (
                self._query()
                .select("seglog_intentos_fallidos, seglog_bloqueado_hasta")
                .eq("seglog_email_normalizado", email_clean)
                .maybe_single()
                .execute()
            )
            row = res.data if res else None
            if not row:
                return {
                    "bloqueado": False,
                    "segundos_restantes": 0,
                    "intentos_fallidos": 0,
                    "bloqueado_hasta": None,
                }

            intentos = int(row.get("seglog_intentos_fallidos") or row.get("intentos_fallidos") or 0)
            bloqueado_hasta_raw = row.get("seglog_bloqueado_hasta") or row.get("bloqueado_hasta")
            if bloqueado_hasta_raw:
                # Parsear ISO 8601
                dt_bloqueo = datetime.fromisoformat(bloqueado_hasta_raw.replace("Z", "+00:00"))
                ahora = datetime.now(timezone.utc)
                if dt_bloqueo > ahora:
                    segundos = max(0, int((dt_bloqueo - ahora).total_seconds()))
                    return {
                        "bloqueado": True,
                        "segundos_restantes": segundos,
                        "intentos_fallidos": intentos,
                        "bloqueado_hasta": bloqueado_hasta_raw,
                    }
                else:
                    # Expirado
                    return {
                        "bloqueado": False,
                        "segundos_restantes": 0,
                        "intentos_fallidos": 0,
                        "bloqueado_hasta": None,
                    }

            return {
                "bloqueado": False,
                "segundos_restantes": 0,
                "intentos_fallidos": intentos,
                "bloqueado_hasta": None,
            }
        except Exception as exc2:
            logger.error("Error en fallback de consulta de bloqueo: %s", exc2)

        return {
            "bloqueado": False,
            "segundos_restantes": 0,
            "intentos_fallidos": 0,
            "bloqueado_hasta": None,
        }

    def registrar_intento(self, email: str, exitoso: bool) -> Dict[str, Any]:
        """
        Registra un intento (exitoso o fallido) de forma atómica en PostgreSQL.
        Retorna diccionario con el estado resultante.
        """
        email_clean = (email or "").strip().lower()
        if not email_clean:
            return {
                "bloqueado": False,
                "segundos_restantes": 0,
                "intentos_fallidos": 0,
                "bloqueado_hasta": None,
            }

        try:
            res = self._client.rpc(
                "fn_registrar_intento_login",
                {"p_email": email_clean, "p_exitoso": bool(exitoso)},
            ).execute()
            if res.data and len(res.data) > 0:
                row = res.data[0]
                return {
                    "bloqueado": bool(row.get("bloqueado", False)),
                    "segundos_restantes": int(row.get("segundos_restantes") or 0),
                    "intentos_fallidos": int(row.get("intentos_fallidos") or 0),
                    "bloqueado_hasta": row.get("bloqueado_hasta"),
                }
        except Exception as exc:
            logger.error("Error registrando intento vía RPC para %s: %s", email_clean, exc)

        return self.consultar_estado_bloqueo(email_clean)

