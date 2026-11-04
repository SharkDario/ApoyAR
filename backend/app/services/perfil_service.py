# backend/app/services/perfil_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Gestión de perfiles y permisos desde el panel web (RBAC dinámico).
#
# - Perfiles de sistema (Civil, Administrador, Autoridad): se listan, pero no se
#   modifican ni se borran. Sus permisos son fijos (migración 021).
# - Perfiles personalizados: los crea el Administrador, solo con permisos
#   institucionales, y los asigna a usuarios del panel al darlos de alta o
#   editarlos.
# ─────────────────────────────────────────────────────────────────────────────

import logging
import uuid
from typing import Any, Dict, List, Optional

from app.errors import ErrorInternoError, RecursoNoEncontradoError, SolicitudInvalidaError
from app.repositories.perfil_repository import PerfilRepository
from app.schemas.admin import ActualizarPerfilRequest, PerfilRequest
from app.services.roles import PERFILES_SISTEMA, normalizar_rol

logger = logging.getLogger("apoyar.perfiles")

# Nombres reservados: perfiles de sistema y alias heredados que normalizar_rol unifica
_NOMBRES_RESERVADOS = {"civil", "victima", "víctima", "contacto", "contacto de emergencia", "testigo",
                       "autoridad", "administrador", "administrativo"}


def _uuid(valor: str) -> str:
    try:
        return str(uuid.UUID(valor))
    except ValueError:
        raise SolicitudInvalidaError("Identificador de perfil inválido.")


def _permisos_de_fila(fila: Dict[str, Any]) -> List[str]:
    return sorted(
        (ptp.get("permiso") or {}).get("prm_nombre")
        for ptp in (fila.get("perfil_tiene_permiso") or [])
        if (ptp.get("permiso") or {}).get("prm_nombre")
    )


class PerfilService:

    def __init__(self, perfiles: PerfilRepository):
        self._perfiles = perfiles

    # ── Consultas ────────────────────────────────────────────────────────────

    def listar_permisos(self) -> List[Dict[str, Any]]:
        permisos = []
        for p in self._perfiles.listar_permisos():
            permisos.append({
                "id": p["prm_id_permiso"],
                "nombre": p["prm_nombre"],
                "descripcion": p.get("prm_descripcion"),
                "ambito": p.get("prm_ambito"),
                "modulo": (p.get("modulo") or {}).get("mod_nombre"),
                "accion": (p.get("accion") or {}).get("acc_nombre"),
            })
        return permisos

    def listar_perfiles(self) -> List[Dict[str, Any]]:
        perfiles = []
        for f in self._perfiles.listar_perfiles():
            perfiles.append({
                "id": f["prf_id_perfil"],
                "nombre": f["prf_nombre"],
                "descripcion": f.get("prf_descripcion"),
                "activo": f.get("prf_activo", True),
                "tipo": f.get("prf_tipo"),
                "sistema": bool(f.get("prf_sistema")),
                "permisos": _permisos_de_fila(f),
                "usuarios": self._perfiles.contar_asignaciones_de_perfil(f["prf_id_perfil"]),
            })
        return perfiles

    def perfiles_institucionales_asignables(self) -> Dict[str, Dict[str, Any]]:
        """Perfiles institucionales activos que se pueden asignar a un usuario del panel."""
        return {
            p["nombre"]: p for p in self.listar_perfiles()
            if p["tipo"] == "institucional" and p["activo"]
        }

    # ── Alta, edición y baja ─────────────────────────────────────────────────

    def crear_perfil(self, solicitud: PerfilRequest) -> Dict[str, Any]:
        nombre = self._validar_nombre(solicitud.nombre)
        permiso_ids = self._ids_permisos_institucionales(solicitud.permisos)
        try:
            fila = self._perfiles.insertar_perfil({
                "prf_nombre": nombre,
                "prf_descripcion": (solicitud.descripcion or "").strip() or None,
                "prf_tipo": "institucional",
                "prf_sistema": False,
                "prf_activo": True,
            })
        except Exception as exc:
            if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
                raise SolicitudInvalidaError(f"Ya existe un perfil llamado '{nombre}'.")
            logger.error("Error creando perfil %s: %s", nombre, exc)
            raise ErrorInternoError("No se pudo crear el perfil.")
        if not fila:
            raise ErrorInternoError("No se pudo crear el perfil.")
        self._perfiles.reemplazar_permisos_de_perfil(fila["prf_id_perfil"], permiso_ids)
        return {"status": "ok", "message": f"Perfil '{nombre}' creado.", "id": fila["prf_id_perfil"]}

    def actualizar_perfil(self, perfil_id: str, solicitud: ActualizarPerfilRequest) -> Dict[str, Any]:
        perfil = self._perfil_editable(perfil_id)
        campos: Dict[str, Any] = {}
        if solicitud.nombre is not None and solicitud.nombre.strip() != perfil["prf_nombre"]:
            campos["prf_nombre"] = self._validar_nombre(solicitud.nombre)
        if solicitud.descripcion is not None:
            campos["prf_descripcion"] = solicitud.descripcion.strip() or None
        if solicitud.activo is not None:
            campos["prf_activo"] = solicitud.activo
        if campos:
            try:
                self._perfiles.actualizar_perfil(perfil["prf_id_perfil"], campos)
            except Exception as exc:
                if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
                    raise SolicitudInvalidaError(f"Ya existe un perfil llamado '{campos.get('prf_nombre')}'.")
                raise ErrorInternoError(f"No se pudo actualizar el perfil: {exc}")
        if solicitud.permisos is not None:
            self._perfiles.reemplazar_permisos_de_perfil(
                perfil["prf_id_perfil"], self._ids_permisos_institucionales(solicitud.permisos)
            )
        return {"status": "ok", "message": "Perfil actualizado."}

    def eliminar_perfil(self, perfil_id: str) -> Dict[str, Any]:
        """Se borra si nadie lo tiene asignado; si no, se desactiva para conservar la auditoría."""
        perfil = self._perfil_editable(perfil_id)
        if self._perfiles.contar_asignaciones_de_perfil(perfil["prf_id_perfil"]) > 0:
            self._perfiles.actualizar_perfil(perfil["prf_id_perfil"], {"prf_activo": False})
            return {"status": "ok", "message": "El perfil tiene usuarios asignados: quedó desactivado.", "desactivado": True}
        self._perfiles.eliminar_perfil(perfil["prf_id_perfil"])
        return {"status": "ok", "message": "Perfil eliminado.", "desactivado": False}

    # ── Validaciones ─────────────────────────────────────────────────────────

    def _perfil_editable(self, perfil_id: str) -> Dict[str, Any]:
        perfil = self._perfiles.obtener_perfil(_uuid(perfil_id))
        if not perfil:
            raise RecursoNoEncontradoError("Perfil no encontrado.")
        if perfil.get("prf_sistema") or normalizar_rol(perfil["prf_nombre"]) in PERFILES_SISTEMA:
            raise SolicitudInvalidaError("Los perfiles Civil, Administrador y Autoridad son de sistema y no se modifican.")
        return perfil

    @staticmethod
    def _validar_nombre(nombre: str) -> str:
        limpio = " ".join((nombre or "").split())
        if len(limpio) < 3:
            raise SolicitudInvalidaError("El nombre del perfil debe tener al menos 3 caracteres.")
        if limpio.lower() in _NOMBRES_RESERVADOS:
            raise SolicitudInvalidaError(f"'{limpio}' es un nombre reservado del sistema.")
        return limpio

    def _ids_permisos_institucionales(self, nombres: Optional[List[str]]) -> List[str]:
        pedidos = set(nombres or [])
        catalogo = {p["nombre"]: p for p in self.listar_permisos()}
        desconocidos = pedidos - set(catalogo)
        if desconocidos:
            raise SolicitudInvalidaError(f"Permisos inexistentes: {', '.join(sorted(desconocidos))}.")
        civiles = [n for n in pedidos if catalogo[n]["ambito"] != "institucional"]
        if civiles:
            raise SolicitudInvalidaError(f"Un perfil del panel no puede tener permisos civiles: {', '.join(sorted(civiles))}.")
        return [catalogo[n]["id"] for n in sorted(pedidos)]
