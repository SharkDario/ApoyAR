# backend/app/services/geocoding.py
# ─────────────────────────────────────────────────────────────────────────────
# Integración con OpenStreetMap Nominatim para geocodificación inversa
# (coordenadas GPS → dirección legible de calle).
# ─────────────────────────────────────────────────────────────────────────────

from typing import Optional

import httpx

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"


class NominatimGeocoder:

    def __init__(self, timeout_seconds: float = 4.0):
        self.timeout_seconds = timeout_seconds

    async def resolver_direccion(self, latitud: float, longitud: float) -> Optional[str]:
        """Devuelve 'Calle Nro, Barrio, Ciudad' o None si no hay un resultado útil."""
        url = f"{NOMINATIM_REVERSE_URL}?format=json&lat={latitud}&lon={longitud}&zoom=18&addressdetails=1"
        headers = {"User-Agent": "ApoyAR-Emergency/1.0 (Backend Service)"}
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            return None

        data = resp.json()
        addr = data.get("address", {})
        calle = addr.get("road") or addr.get("pedestrian") or addr.get("street") or ""
        num = addr.get("house_number", "")
        barrio = addr.get("neighbourhood") or addr.get("suburb") or ""
        ciudad = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""

        parte_calle = f"{calle} {num}".strip()
        parte_loc = f"{barrio}, {ciudad}".strip(", ")
        direccion = f"{parte_calle}, {parte_loc}".strip(", ")
        if not direccion or len(direccion) < 4:
            raw_dn = data.get("display_name", "")
            direccion = ", ".join([p.strip() for p in raw_dn.split(",")[:3]]) if raw_dn else ""

        return direccion if direccion and len(direccion) > 3 else None
