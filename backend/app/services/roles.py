# backend/app/services/roles.py
# ─────────────────────────────────────────────────────────────────────────────
# Perfiles y permisos de ApoyAR (RBAC dinámico).
#
# Los permisos viven en la base de datos (modulo, accion, permiso y
# perfil_tiene_permiso, migración 021) y CuentaService los carga en
# usuario["permisos"]. Este módulo define los nombres de los permisos, los
# perfiles de sistema y un respaldo con los permisos de esos perfiles, que se
# usa solo si la base no devuelve permisos (por ejemplo, antes de aplicar la
# migración o en las pruebas unitarias).
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, FrozenSet, Iterable, List, Set

# ── Perfiles de sistema ──────────────────────────────────────────────────────
ROL_CIVIL = "Civil"
ROL_AUTORIDAD = "Autoridad"
ROL_ADMINISTRADOR = "Administrador"
ROLES_INSTITUCIONALES = (ROL_AUTORIDAD, ROL_ADMINISTRADOR)
PERFILES_SISTEMA = (ROL_CIVIL, ROL_AUTORIDAD, ROL_ADMINISTRADOR)

# Compatibilidad: 'Víctima', 'Contacto' y 'Testigo' eran perfiles sueltos de la
# base. Ahora son situaciones del mismo usuario civil y se normalizan a 'Civil'.
ROL_VICTIMA = ROL_CIVIL

# ── Permisos (modulo.accion) ─────────────────────────────────────────────────
# Civiles (app móvil)
P_INCIDENTE_CREAR = "incidente.crear"
P_ALERTA_EMITIR = "alerta.emitir"
P_ALERTA_LEER = "alerta.leer"
P_CONTACTO_GESTIONAR = "contacto.gestionar"
P_EVIDENCIA_CREAR = "evidencia.crear"
P_EVIDENCIA_LEER = "evidencia.leer"
P_EVIDENCIA_CONSENTIR = "evidencia.consentir"
# Institucionales (panel web)
P_INCIDENTE_MONITOREAR = "incidente.monitorear"
P_INCIDENTE_ACTUALIZAR = "incidente.actualizar"
P_INCIDENTE_CORRELACIONAR = "incidente.correlacionar"
# Solo totales anónimos: no da acceso a casos individuales ni a evidencias (migración 023)
P_INCIDENTE_ESTADISTICAS = "incidente.estadisticas"
P_EVIDENCIA_AUDITAR = "evidencia.auditar"
P_EVIDENCIA_EXPORTAR = "evidencia.exportar"
P_USUARIO_GESTIONAR = "usuario.gestionar"
P_PERFIL_GESTIONAR = "perfil.gestionar"

PERMISOS_CIVILES: FrozenSet[str] = frozenset({
    P_INCIDENTE_CREAR, P_ALERTA_EMITIR, P_ALERTA_LEER, P_CONTACTO_GESTIONAR,
    P_EVIDENCIA_CREAR, P_EVIDENCIA_LEER, P_EVIDENCIA_CONSENTIR,
})
PERMISOS_INSTITUCIONALES: FrozenSet[str] = frozenset({
    P_INCIDENTE_MONITOREAR, P_INCIDENTE_ACTUALIZAR, P_INCIDENTE_CORRELACIONAR, P_INCIDENTE_ESTADISTICAS,
    P_EVIDENCIA_AUDITAR, P_EVIDENCIA_EXPORTAR, P_USUARIO_GESTIONAR, P_PERFIL_GESTIONAR,
})

# Respaldo: mismo contenido que siembran las migraciones 021 y 023
PERMISOS_POR_DEFECTO: Dict[str, FrozenSet[str]] = {
    ROL_CIVIL: PERMISOS_CIVILES,
    ROL_ADMINISTRADOR: frozenset({
        P_INCIDENTE_MONITOREAR, P_INCIDENTE_ACTUALIZAR, P_INCIDENTE_ESTADISTICAS,
        P_USUARIO_GESTIONAR, P_PERFIL_GESTIONAR,
    }),
    ROL_AUTORIDAD: frozenset({
        P_INCIDENTE_MONITOREAR, P_INCIDENTE_ACTUALIZAR, P_INCIDENTE_CORRELACIONAR, P_INCIDENTE_ESTADISTICAS,
        P_EVIDENCIA_AUDITAR, P_EVIDENCIA_EXPORTAR,
    }),
}


def normalizar_rol(nombre_rol: str) -> str:
    """
    Unifica los nombres heredados:
    - 'Administrativo' -> 'Administrador'
    - 'Víctima', 'Contacto', 'Contacto de Emergencia', 'Testigo' -> 'Civil'
    Los perfiles personalizados conservan su nombre.
    """
    limpio = (nombre_rol or "").strip()
    bajo = limpio.lower()
    if bajo in ("administrativo", "administrador"):
        return ROL_ADMINISTRADOR
    if bajo in ("civil", "victima", "víctima", "contacto", "contacto de emergencia", "testigo"):
        return ROL_CIVIL
    if bajo == "autoridad":
        return ROL_AUTORIDAD
    return limpio


def roles_de(usuario: Dict[str, Any]) -> set:
    return set(usuario.get("roles", []))


def tiene_algun_rol(usuario: Dict[str, Any], roles: Iterable[str]) -> bool:
    return bool(roles_de(usuario).intersection(roles))


def permisos_por_defecto(roles: Iterable[str]) -> Set[str]:
    permisos: Set[str] = set()
    for rol in roles:
        permisos |= PERMISOS_POR_DEFECTO.get(rol, frozenset())
    return permisos


def permisos_de(usuario: Dict[str, Any]) -> Set[str]:
    """Permisos cargados desde la base; si no vinieron, los de sus perfiles de sistema."""
    permisos = usuario.get("permisos")
    if permisos is not None:
        return set(permisos)
    return permisos_por_defecto(roles_de(usuario))


def tiene_permiso(usuario: Dict[str, Any], permiso: str) -> bool:
    return permiso in permisos_de(usuario)


def es_operador_institucional(usuario: Dict[str, Any]) -> bool:
    """Usuario del panel web: tiene al menos un permiso institucional."""
    return bool(permisos_de(usuario) & PERMISOS_INSTITUCIONALES)


def rol_actor_auditoria(roles: List[str], por_defecto: str) -> str:
    """Rol que se registra en la auditoría: prioriza el rol institucional del operador."""
    for rol in (ROL_AUTORIDAD, ROL_ADMINISTRADOR):
        if rol in roles:
            return rol
    institucionales = [r for r in roles if r != ROL_CIVIL]
    if institucionales:
        return institucionales[0]
    return roles[0] if roles else por_defecto


def es_administrador_puro(usuario: Dict[str, Any]) -> bool:
    """Operador sin permiso de auditar evidencias (sin acceso a contenido íntimo)."""
    return es_operador_institucional(usuario) and not tiene_permiso(usuario, P_EVIDENCIA_AUDITAR)


def leer_perfil_asignado(fila: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza una fila de usuario_tiene_perfil con su perfil embebido:
    {nombre, tipo, activo, estado, permisos}. 'permisos' es None cuando la
    consulta no trajo permisos (base sin la migración 021); un perfil de sistema
    sin permisos cargados toma el respaldo en código.
    """
    perfil = fila.get("perfil") or {}
    nombre = normalizar_rol(perfil.get("prf_nombre") or perfil.get("nombre") or "")
    tipo = perfil.get("prf_tipo") or ("civil" if nombre == ROL_CIVIL else "institucional")
    permisos = None
    if "perfil_tiene_permiso" in perfil:
        permisos = {
            (ptp.get("permiso") or {}).get("prm_nombre")
            for ptp in (perfil.get("perfil_tiene_permiso") or [])
            if (ptp.get("permiso") or {}).get("prm_nombre")
        }
    if not permisos and nombre in PERMISOS_POR_DEFECTO:
        permisos = set(PERMISOS_POR_DEFECTO[nombre])
    return {
        "nombre": nombre,
        "tipo": tipo,
        "activo": perfil.get("prf_activo", True) is not False,
        "estado": fila.get("usuprf_estado_aprobacion") or fila.get("estado_aprobacion") or "activo",
        "permisos": permisos or set(),
    }
