# backend/app/services/password_policy.py
# ─────────────────────────────────────────────────────────────────────────────
# Política de contraseñas y hash PBKDF2-SHA256 de la credencial institucional
# replicada en `usuario.usu_password_hash`.
# ─────────────────────────────────────────────────────────────────────────────

import hashlib
import hmac
import os
import re
from typing import Optional

from app.errors import SolicitudInvalidaError


def hash_institutional_password(password: str) -> str:
    salt = os.urandom(16)
    iterations = 100_000
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${derived.hex()}"


def verify_institutional_password(password: str, hashed: Optional[str]) -> bool:
    if not hashed or not hashed.startswith("pbkdf2_sha256$"):
        return False
    try:
        parts = hashed.split("$")
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected = bytes.fromhex(parts[3])
        derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


def validar_complejidad_password(password: str) -> None:
    if len(password) < 8:
        raise SolicitudInvalidaError("La contraseña debe tener un mínimo de 8 caracteres.")
    if not any(c.isupper() for c in password):
        raise SolicitudInvalidaError("La contraseña debe incluir al menos una letra mayúscula.")
    if not any(c.isdigit() for c in password):
        raise SolicitudInvalidaError("La contraseña debe incluir al menos un número.")
    if not re.search(r'[!@#$%^&*(),.?":{}|<>_\-]', password):
        raise SolicitudInvalidaError("La contraseña debe incluir al menos un carácter especial (!@#$%^&*...).")
