# backend/app/repositories/evidencia_storage.py
# ─────────────────────────────────────────────────────────────────────────────
# Acceso al bucket privado `evidencias` de Supabase Storage, donde la app
# móvil sube los paquetes multimedia cifrados (AES-256-GCM).
# ─────────────────────────────────────────────────────────────────────────────

from typing import List

from supabase import Client

BUCKET_EVIDENCIAS = "evidencias"


class EvidenciaStorage:

    def __init__(self, client: Client):
        self._client = client

    @staticmethod
    def ruta_sin_prefijo(url_almacenamiento: str) -> str:
        """Quita una única vez el prefijo 'evidencias/' (usado por auditoría y reproducción)."""
        ruta = url_almacenamiento.strip()
        if ruta.startswith("evidencias/"):
            ruta = ruta.replace("evidencias/", "", 1)
        return ruta

    @staticmethod
    def ruta_relativa(url_almacenamiento: str) -> str:
        """Extrae la ruta relativa al bucket desde una URL pública o un path con prefijo."""
        ruta = (url_almacenamiento or "").strip()
        if "/evidencias/" in ruta:
            ruta = ruta.split("/evidencias/")[1]
        elif ruta.startswith("evidencias/"):
            ruta = ruta.replace("evidencias/", "")
        return ruta.lstrip("/")

    def descargar(self, ruta: str) -> bytes:
        return self._client.storage.from_(BUCKET_EVIDENCIAS).download(ruta)

    def eliminar(self, rutas: List[str]) -> None:
        self._client.storage.from_(BUCKET_EVIDENCIAS).remove(rutas)
