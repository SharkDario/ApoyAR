# backend/tests/__init__.py
# ─────────────────────────────────────────────────────────────────────────────
# Pruebas unitarias de servicios, repositorios y routers (sin red ni Supabase real).
#
# Ejecutar desde backend/:
#   .venv/Scripts/python.exe -m unittest discover -s tests -t . -v
# ─────────────────────────────────────────────────────────────────────────────

import os
import socket
import sys
import types

# Configuración ficticia: las pruebas nunca usan las credenciales reales del .env
os.environ.update({
    "SUPABASE_URL": "https://proyecto-de-prueba.supabase.co",
    "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.cHJ1ZWJh",
    "SUPABASE_SERVICE_ROLE_KEY": "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.cHJ1ZWJh",
    "API_SECRET_KEY": "api-secret-de-prueba",
    "SUPABASE_JWT_SECRET": "jwt-secret-de-prueba",
})

# Bloqueo de red: solo se permite loopback (lo usa el event loop en Windows)
_connect_original = socket.socket.connect


def _solo_loopback(self, address, *args, **kwargs):
    host = address[0] if isinstance(address, tuple) else address
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise RuntimeError(f"Acceso de red bloqueado en pruebas: {address}")
    return _connect_original(self, address, *args, **kwargs)


socket.socket.connect = _solo_loopback

# Motor acústico simulado: evita cargar (o descargar) los modelos Vosk / YAMNet
import app.services  # noqa: E402

if "app.services.acoustic_ai" not in sys.modules:
    _acustico = types.ModuleType("app.services.acoustic_ai")
    _acustico.acoustic_ai_service = types.SimpleNamespace(analizar_audio=lambda audio, palabra: {"simulado": True})
    sys.modules["app.services.acoustic_ai"] = _acustico
