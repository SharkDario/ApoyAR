# backend/app/repositories/evidencia_repository.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso a datos del log Append-Only `evidencia`.
# ─────────────────────────────────────────────────────────────────────────────

import logging
from typing import Any, Dict, List, Optional

from app.repositories.base import SupabaseRepository

logger = logging.getLogger("apoyar.repositories.evidencia")

COLUMNAS_LISTADO = (
    "evi_id_evidencia, inc_id_incidente, usu_id_usuario, evi_tipo_archivo, evi_url_almacenamiento, "
    "evi_hash_sha256, evi_prev_hash, evi_token_rfc3161, evi_firma_hardware, evi_fecha_captura, "
    "evi_sincronizado_en, evi_consentimiento_exportacion, evi_fecha_consentimiento"
)


class EvidenciaRepository(SupabaseRepository):
    tabla = "evidencia"

    def obtener_por_id(self, evidencia_id: str, columnas: str = "*") -> Optional[Dict[str, Any]]:
        res = self._query().select(columnas).eq("evi_id_evidencia", evidencia_id).execute()
        return self._primera_fila(res)

    def obtener_ultimo_hash(self) -> Optional[str]:
        """
        Hash SHA-256 del último eslabón del log: primero mediante la función RPC
        atómica `obtener_ultimo_hash_evidencia()` y, si no responde, mediante una
        consulta ordenada por `evi_sincronizado_en`. Devuelve None si el log está vacío.
        """
        try:
            rpc_res = self._client.rpc("obtener_ultimo_hash_evidencia", {}).execute()
            if rpc_res.data and isinstance(rpc_res.data, str):
                return rpc_res.data
        except Exception as e:
            logger.warning("No se pudo invocar RPC obtener_ultimo_hash_evidencia (%s). Usando fallback directo.", e)

        try:
            res = (
                self._query()
                .select("evi_hash_sha256")
                .order("evi_sincronizado_en", desc=True)
                .limit(1)
                .execute()
            )
            fila = self._primera_fila(res)
            if fila:
                return fila.get("evi_hash_sha256") or fila.get("hash_sha256") or None
        except Exception as e:
            logger.error("Error consultando último hash de evidencia: %s", e)
        return None

    def obtener_registro_anterior(self, sincronizado_en: str) -> Optional[Dict[str, Any]]:
        """Registro estrictamente anterior en la cronología del log."""
        res = (
            self._query()
            .select("evi_hash_sha256, evi_sincronizado_en")
            .lt("evi_sincronizado_en", sincronizado_en)
            .order("evi_sincronizado_en", desc=True)
            .limit(1)
            .execute()
        )
        return self._primera_fila(res)

    def insertar(self, datos: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        res = self._query().insert(datos).execute()
        return self._primera_fila(res)

    def listar_por_incidente(self, incidente_id: str, columnas: str = "*", descendente: bool = False) -> List[Dict[str, Any]]:
        res = (
            self._query()
            .select(columnas)
            .eq("inc_id_incidente", incidente_id)
            .order("evi_fecha_captura", desc=descendente)
            .execute()
        )
        return self._filas(res)

    def listar_rutas_de_usuario(self, usuario_id: str) -> List[Dict[str, Any]]:
        res = self._query().select("evi_url_almacenamiento").eq("usu_id_usuario", usuario_id).execute()
        return self._filas(res)

    def actualizar_consentimiento(self, evidencia_id: str, consentimiento: bool, fecha_iso: Optional[str]) -> None:
        self._query().update({
            "evi_consentimiento_exportacion": consentimiento,
            "evi_fecha_consentimiento": fecha_iso,
        }).eq("evi_id_evidencia", evidencia_id).execute()

    def actualizar_consentimiento_de_incidente(self, incidente_id: str, consentimiento: bool, fecha_iso: Optional[str]) -> None:
        self._query().update({
            "evi_consentimiento_exportacion": consentimiento,
            "evi_fecha_consentimiento": fecha_iso,
        }).eq("inc_id_incidente", incidente_id).execute()

    def asociar_a_incidente(self, evidencia_id: str, campos: Dict[str, Any]) -> None:
        self._query().update(campos).eq("evi_id_evidencia", evidencia_id).execute()
