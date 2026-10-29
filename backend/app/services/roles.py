# backend/app/services/roles.py
# ─────────────────────────────────────────────────────────────────────────────
# Taxonomía de roles (perfiles) de ApoyAR y su normalización.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, Iterable, List

ROL_VICTIMA = "Víctima"
ROL_TESTIGO = "Testigo"
ROL_CONTACTO = "Contacto"
ROL_AUTORIDAD = "Autoridad"
ROL_ADMINISTRADOR = "Administrador"
ROLES_INSTITUCIONALES = (ROL_AUTORIDAD, ROL_ADMINISTRADOR)


def normalizar_rol(nombre_rol: str) -> str:
    """
    Resuelve discrepancias taxonómicas de roles de forma transparente:
    - 'Administrativo' -> 'Administrador'
    - 'Contacto de Emergencia' -> 'Contacto'
    """
    limpio = (nombre_rol or "").strip()
    if limpio.lower() in ("administrativo", "administrador"):
        return ROL_ADMINISTRADOR
    if limpio.lower() in ("contacto", "contacto de emergencia"):
        return ROL_CONTACTO
    if limpio.lower() in ("victima", "víctima"):
        return ROL_VICTIMA
    if limpio.lower() == "testigo":
        return ROL_TESTIGO
    if limpio.lower() == "autoridad":
        return ROL_AUTORIDAD
    return limpio


def roles_de(usuario: Dict[str, Any]) -> set:
    return set(usuario.get("roles", []))


def tiene_algun_rol(usuario: Dict[str, Any], roles: Iterable[str]) -> bool:
    return bool(roles_de(usuario).intersection(roles))


def rol_actor_auditoria(roles: List[str], por_defecto: str) -> str:
    """Rol que se registra en la auditoría: prioriza el rol institucional del operador."""
    for rol in (ROL_AUTORIDAD, ROL_ADMINISTRADOR):
        if rol in roles:
            return rol
    return roles[0] if roles else por_defecto


def es_administrador_puro(usuario: Dict[str, Any]) -> bool:
    """Administrador de TI sin rol de Autoridad (sin acceso a contenido íntimo)."""
    roles = roles_de(usuario)
    return ROL_ADMINISTRADOR in roles and ROL_AUTORIDAD not in roles
