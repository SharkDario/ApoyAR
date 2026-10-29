# backend/app/services/persona_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Perfil personal del usuario (tabla `persona`) y código de vinculación de la
# red de apoyo, con verificación Anti-IDOR de titularidad.
# ─────────────────────────────────────────────────────────────────────────────

import secrets
import uuid
from typing import Any, Dict, Optional

from app.errors import AccesoDenegadoError, RecursoNoEncontradoError
from app.repositories.auth_gateway import SupabaseAuthGateway
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.incidentes import ActualizarPersonaRequest
from app.services.roles import ROL_ADMINISTRADOR, ROL_AUTORIDAD, roles_de

# Sin O/0 ni I/1 para evitar ambigüedades al dictarlo
ALFABETO_CODIGO_VINCULACION = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class PersonaService:

    def __init__(self, usuarios: UsuarioRepository, auth_gateway: SupabaseAuthGateway):
        self._usuarios = usuarios
        self._auth = auth_gateway

    def obtener_perfil(self, usuario_id: str, solicitante: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """El usuario solo consulta sus propios datos, salvo Autoridad/Administrador o acceso interno con API Secret."""
        if solicitante is not None:
            if usuario_id != solicitante["id"] and not ({ROL_AUTORIDAD, ROL_ADMINISTRADOR} & roles_de(solicitante)):
                raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No puede consultar datos personales de otro usuario.")

        persona = self._usuarios.obtener_persona(usuario_id)
        if not persona:
            return self._perfil_inicial_desde_auth(usuario_id)

        # Alias para compatibilidad frontend/móvil
        persona["usuario_id"] = usuario_id
        persona["usu_id_usuario"] = usuario_id
        persona["nombre"] = persona.get("per_nombre")
        persona["apellido"] = persona.get("per_apellido")
        persona["dni"] = persona.get("per_dni")
        persona["telefono"] = persona.get("per_telefono")
        persona["direccion"] = persona.get("per_direccion")
        persona["genero"] = persona.get("per_genero")
        return persona

    def _perfil_inicial_desde_auth(self, usuario_id: str) -> Dict[str, Any]:
        """Sin fila `persona`: datos iniciales derivados del email de auth.users."""
        try:
            usuario_auth = self._auth.obtener_usuario(usuario_id)
            if usuario_auth:
                email = usuario_auth.email or ""
                nombre_def = email.split("@")[0] if "@" in email else "Usuario"
                return {
                    "usuario_id": usuario_id,
                    "usu_id_usuario": usuario_id,
                    "nombre": nombre_def,
                    "per_nombre": nombre_def,
                    "apellido": "",
                    "per_apellido": "",
                    "dni": None,
                    "per_dni": None,
                    "telefono": None,
                    "per_telefono": None,
                    "direccion": None,
                    "per_direccion": None,
                    "genero": None,
                    "per_genero": None,
                }
        except Exception:
            pass
        raise RecursoNoEncontradoError("Persona no encontrada")

    def actualizar_perfil(self, usuario_id: str, solicitud: ActualizarPersonaRequest, solicitante: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Solo el propio usuario modifica su perfil; crea la `persona` si no existe."""
        if solicitante is not None and usuario_id != solicitante["id"]:
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No puede modificar el perfil de otro usuario.")

        campos: Dict[str, Any] = {}
        for atributo, columna in (
            ("nombre", "per_nombre"),
            ("apellido", "per_apellido"),
            ("dni", "per_dni"),
            ("telefono", "per_telefono"),
            ("direccion", "per_direccion"),
            ("genero", "per_genero"),
        ):
            valor = getattr(solicitud, atributo)
            if valor is not None:
                campos[columna] = valor.strip()

        persona_id = self._usuarios.obtener_id_persona(usuario_id)
        if persona_id:
            fila = self._usuarios.actualizar_persona(persona_id, campos)
        else:
            if "per_nombre" not in campos or not campos["per_nombre"]:
                campos["per_nombre"] = "Usuario"
            if "per_apellido" not in campos:
                campos["per_apellido"] = ""
            if "per_dni" not in campos or not campos["per_dni"]:
                campos["per_dni"] = str(uuid.uuid4())[:8]
            fila = self._usuarios.insertar_persona(campos)
            if fila and fila.get("per_id_persona"):
                self._usuarios.vincular_persona(usuario_id, fila["per_id_persona"])

        out = fila if fila else campos
        out["usuario_id"] = out.get("usu_id_usuario", usuario_id)
        out["nombre"] = out.get("per_nombre", campos.get("per_nombre"))
        out["apellido"] = out.get("per_apellido", campos.get("per_apellido"))
        out["dni"] = out.get("per_dni", campos.get("per_dni"))
        out["telefono"] = out.get("per_telefono", campos.get("per_telefono"))
        out["direccion"] = out.get("per_direccion", campos.get("per_direccion"))
        out["genero"] = out.get("per_genero", campos.get("per_genero"))
        return out

    def regenerar_codigo_vinculacion(self, usuario_id: str, solicitante: Optional[Dict[str, Any]] = None) -> str:
        """Genera un código alfanumérico de 6 caracteres y lo guarda en `persona`."""
        if solicitante is not None and usuario_id != solicitante["id"]:
            raise AccesoDenegadoError("Acceso denegado (Anti-IDOR): No puede regenerar el código de vinculación de otro usuario.")

        nuevo_codigo = "".join(secrets.choice(ALFABETO_CODIGO_VINCULACION) for _ in range(6))
        try:
            persona_id = self._usuarios.obtener_id_persona(usuario_id)
            if persona_id:
                self._usuarios.actualizar_persona(persona_id, {"per_codigo_vinculacion": nuevo_codigo})
        except Exception:
            pass
        return nuevo_codigo
