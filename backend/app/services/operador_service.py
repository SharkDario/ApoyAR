# backend/app/services/operador_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Gestión de operadores institucionales por el Administrador (CU-09 / RF-1.1):
# búsqueda de ciudadanos, alta multi-rol, roles irreversibles por auditoría,
# suspensión y reactivación sin afectar la cuenta civil de la App Móvil.
# ─────────────────────────────────────────────────────────────────────────────

import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.errors import ErrorInternoError, RecursoNoEncontradoError, SolicitudInvalidaError
from app.repositories.auth_gateway import SupabaseAuthGateway
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.perfil_repository import PerfilRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.admin import AgregarRolRequest, CrearOperadorRequest
from app.services.catalogo_service import nombre_cargo_estandar, resolver_id_cargo
from app.services.password_policy import hash_institutional_password
from app.services.roles import ROL_AUTORIDAD, ROL_VICTIMA, ROLES_INSTITUCIONALES, normalizar_rol

logger = logging.getLogger("apoyar.admin_autoridad")

# Perfil 'Víctima' que los triggers de base de datos asignan automáticamente
ID_PERFIL_VICTIMA_AUTOASIGNADO = "41909988-8cb7-44db-81c6-4699c2401d40"


def _uuid_valido(usuario_id: str) -> str:
    try:
        return str(uuid.UUID(usuario_id))
    except ValueError:
        raise SolicitudInvalidaError("Identificador de usuario inválido.")


def _ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resultado_busqueda(uid: str, email: Optional[str], nombre: str, apellido: str, dni: str, genero: str,
                        fecha_nacimiento: Any, telefono: str, direccion: str) -> Dict[str, Any]:
    return {
        "id": uid,
        "usuario_id": uid,
        "usu_id_usuario": uid,
        "email": email,
        "nombre": nombre,
        "per_nombre": nombre,
        "apellido": apellido,
        "per_apellido": apellido,
        "dni": dni,
        "per_dni": dni,
        "genero": genero,
        "per_genero": genero,
        "fecha_nacimiento": fecha_nacimiento,
        "per_fecha_nacimiento": fecha_nacimiento,
        "telefono": telefono,
        "per_telefono": telefono,
        "direccion": direccion,
        "per_direccion": direccion,
        "roles": [],
    }


def _primer_usuario(relacion: Any) -> Dict[str, Any]:
    """PostgREST devuelve la relación inversa `usuario` como lista o como objeto."""
    if isinstance(relacion, list) and len(relacion) > 0:
        return relacion[0]
    return relacion if isinstance(relacion, dict) else {}


class OperadorService:

    def __init__(
        self,
        usuarios: UsuarioRepository,
        perfiles: PerfilRepository,
        cargos: CargoInstitucionalRepository,
        auth_gateway: SupabaseAuthGateway,
    ):
        self._usuarios = usuarios
        self._perfiles = perfiles
        self._cargos = cargos
        self._auth = auth_gateway

    # ── Búsqueda de ciudadanos para vincular ─────────────────────────────────

    def buscar_usuarios(self, q: str) -> List[Dict[str, Any]]:
        """Por DNI, nombre, apellido o teléfono (persona) y por email (auth.users)."""
        termino = q.strip().lower()
        resultados: Dict[str, Dict[str, Any]] = {}

        try:
            for p in self._usuarios.buscar_personas(termino):
                u_obj = _primer_usuario(p.get("usuario"))
                uid = str(u_obj.get("usu_id_usuario") or p.get("per_id_persona"))
                if uid:
                    resultados[uid] = _resultado_busqueda(
                        uid,
                        u_obj.get("usu_email"),
                        p.get("per_nombre") or p.get("nombre") or "",
                        p.get("per_apellido") or p.get("apellido") or "",
                        p.get("per_dni") or p.get("dni") or "",
                        p.get("per_genero") or p.get("genero") or "No especificado",
                        p.get("per_fecha_nacimiento") or p.get("fecha_nacimiento"),
                        p.get("per_telefono") or p.get("telefono") or "",
                        p.get("per_direccion") or p.get("direccion") or "",
                    )
        except Exception as exc:
            logger.warning("Aviso buscando en tabla persona: %s", exc)

        try:
            for u in self._auth.listar_usuarios():
                uid = str(getattr(u, "id", ""))
                uemail = str(getattr(u, "email", ""))
                if termino in uemail.lower():
                    if uid in resultados:
                        resultados[uid]["email"] = uemail
                    else:
                        meta = getattr(u, "user_metadata", {}) or {}
                        resultados[uid] = _resultado_busqueda(
                            uid, uemail, meta.get("nombre", ""), meta.get("apellido", ""), meta.get("dni", ""),
                            "No especificado", None, "", "",
                        )
                elif uid in resultados:
                    resultados[uid]["email"] = uemail
        except Exception as exc:
            logger.warning("Aviso buscando en auth.users: %s", exc)

        if resultados:
            try:
                for row in self._perfiles.listar_asignaciones_de_usuarios(list(resultados.keys())):
                    uid = str(row.get("usu_id_usuario") or row.get("usuario_id"))
                    if uid in resultados:
                        p = row.get("perfil") or {}
                        r_nom = normalizar_rol(p.get("prf_nombre") or p.get("nombre", ""))
                        if r_nom:
                            r_label = "Civil" if r_nom == ROL_VICTIMA else r_nom
                            if r_label not in resultados[uid]["roles"]:
                                resultados[uid]["roles"].append(r_label)
            except Exception as exc:
                logger.warning("Aviso consultando roles para búsqueda: %s", exc)

        return list(resultados.values())

    # ── Listado de operadores ────────────────────────────────────────────────

    def listar_operadores(self, page: int, limit: int, estado: Optional[str]) -> Dict[str, Any]:
        """Operadores con al menos un rol institucional, agrupados por usuario y paginados."""
        try:
            asignaciones = self._perfiles.listar_todas_las_asignaciones()

            email_map: Dict[str, str] = {}
            try:
                for u in self._auth.listar_usuarios():
                    uid = getattr(u, "id", None)
                    uemail = getattr(u, "email", None)
                    if uid and uemail:
                        email_map[str(uid)] = str(uemail)
            except Exception as auth_err:
                logger.warning("No se pudo listar emails de auth: %s", auth_err)

            user_ids = list({row.get("usu_id_usuario") or row.get("usuario_id") for row in asignaciones if (row.get("usu_id_usuario") or row.get("usuario_id"))})
            persona_map: Dict[str, Dict[str, Any]] = {}
            if user_ids:
                try:
                    for p in self._usuarios.listar_personas_de_usuarios(user_ids):
                        persona_map[str(p.get("usu_id_usuario") or p.get("usuario_id"))] = p
                except Exception as p_err:
                    logger.warning("Aviso consultando persona: %s", p_err)

            cargo_map: Dict[str, Dict[str, Any]] = {}
            try:
                for c in self._cargos.listar_adscripciones():
                    cargo_map[str(c.get("usu_id_usuario") or c.get("usuario_id"))] = c
            except Exception as cargo_err:
                logger.warning("Aviso consultando cargo_institucional: %s", cargo_err)

            operadores = self._agrupar_por_usuario(asignaciones, email_map, persona_map, cargo_map)

            # Solo usuarios con al menos un rol institucional (los civiles puros no son operadores)
            todos = [op for op in operadores.values() if any(r in ROLES_INSTITUCIONALES for r in op.get("roles", []))]

            for op in todos:
                roles_institucionales = [r for r in op.get("roles", []) if r in ROLES_INSTITUCIONALES]
                any_active = any(op.get("estados_roles", {}).get(r) == "activo" for r in roles_institucionales)
                op["estado_aprobacion"] = "activo" if any_active else "suspendido"

                # En la tarjeta institucional se presenta 'Civil' en lugar de 'Víctima'
                op["roles"] = ["Civil" if r == ROL_VICTIMA else r for r in op.get("roles", [])]
                if "estados_roles" in op and ROL_VICTIMA in op["estados_roles"]:
                    op["estados_roles"]["Civil"] = op["estados_roles"].pop(ROL_VICTIMA)
                if ROL_VICTIMA in op.get("rol", ""):
                    op["rol"] = op["rol"].replace(ROL_VICTIMA, "Civil")

            if estado in ("activo", "activos"):
                todos = [op for op in todos if op["estado_aprobacion"] == "activo"]
            elif estado in ("inactivo", "inactivos", "suspendido", "suspendidos"):
                todos = [op for op in todos if op["estado_aprobacion"] != "activo"]

            todos.sort(key=lambda x: str(x.get("aprobado_en") or ""), reverse=True)

            total_registros = len(todos)
            offset = max(0, (page - 1) * limit)
            return {
                "status": "ok",
                "total_registros": total_registros,
                "total_paginas": max(1, math.ceil(total_registros / limit)),
                "pagina_actual": page,
                "limite": limit,
                "usuarios_perfiles": todos[offset : offset + limit],
            }
        except Exception as exc:
            logger.error("Error listando usuarios en admin: %s", exc)
            raise ErrorInternoError(f"Error consultando usuarios: {exc}")

    @staticmethod
    def _agrupar_por_usuario(asignaciones, email_map, persona_map, cargo_map) -> Dict[str, Dict[str, Any]]:
        operadores: Dict[str, Dict[str, Any]] = {}
        for row in asignaciones:
            uid = str(row.get("usu_id_usuario") or row.get("usuario_id"))
            p_info = persona_map.get(uid, {})
            perfil_obj = row.get("perfil") or {}
            rol_nombre = normalizar_rol(perfil_obj.get("prf_nombre") or perfil_obj.get("nombre") or "Operador")
            est_ap = row.get("usuprf_estado_aprobacion") or row.get("estado_aprobacion") or "activo"

            if uid in operadores:
                if rol_nombre not in operadores[uid]["roles"]:
                    operadores[uid]["roles"].append(rol_nombre)
                operadores[uid]["estados_roles"][rol_nombre] = est_ap
                if len(operadores[uid]["roles"]) > 1:
                    operadores[uid]["rol"] = " / ".join(operadores[uid]["roles"])
                continue

            institucion = dependencia = sede = cargo = legajo = cargo_activo = None
            cargo_info = cargo_map.get(uid)
            if cargo_info:
                sede_obj = cargo_info.get("sede") or {}
                dep_obj = sede_obj.get("dependencia") or {}
                inst_obj = dep_obj.get("institucion") or {}
                cargo_obj = cargo_info.get("cargo") or {}
                institucion = inst_obj.get("ins_nombre") or inst_obj.get("nombre")
                dependencia = dep_obj.get("dep_nombre") or dep_obj.get("nombre")
                s_nom = sede_obj.get("sed_nombre_sede") or sede_obj.get("nombre_sede", "")
                s_dir = sede_obj.get("sed_direccion") or sede_obj.get("direccion", "")
                sede = f"{s_nom} ({s_dir})".strip() if sede_obj else None
                cargo = cargo_obj.get("car_nombre_cargo") or cargo_obj.get("nombre_cargo") or cargo_info.get("car_nombre_cargo")
                cid = cargo_info.get("car_id_cargo") or cargo_info.get("id_cargo")
                if not cargo and cid:
                    cargo = nombre_cargo_estandar(cid)
                legajo = cargo_info.get("carins_legajo_o_matricula") or cargo_info.get("legajo_o_matricula")
                cargo_activo = cargo_info.get("carins_activo") if "carins_activo" in cargo_info else cargo_info.get("activo", True)

            operadores[uid] = {
                "usuario_id": uid,
                "usu_id_usuario": uid,
                "email": email_map.get(uid, "Desconocido"),
                "nombre": p_info.get("per_nombre") or p_info.get("nombre") or "Operador",
                "apellido": p_info.get("per_apellido") or p_info.get("apellido") or "",
                "dni": p_info.get("per_dni") or p_info.get("dni") or "Sin DNI registrado",
                "genero": p_info.get("per_genero") or p_info.get("genero") or "No especificado",
                "fecha_nacimiento": p_info.get("per_fecha_nacimiento") or p_info.get("fecha_nacimiento"),
                "telefono": p_info.get("per_telefono") or p_info.get("telefono") or "Sin teléfono",
                "direccion": p_info.get("per_direccion") or p_info.get("direccion") or "Sin dirección declarada",
                "rol": rol_nombre,
                "roles": [rol_nombre],
                "estado_aprobacion": est_ap,
                "estados_roles": {rol_nombre: est_ap},
                "notas": row.get("usuprf_notas") or row.get("notas"),
                "aprobado_en": row.get("usuprf_aprobado_en") or row.get("aprobado_en"),
                "institucion": institucion,
                "dependencia": dependencia,
                "sede": sede,
                "cargo": cargo,
                "legajo": legajo,
                "cargo_activo": cargo_activo,
            }
        return operadores

    # ── Alta de operador ─────────────────────────────────────────────────────

    def crear_operador(self, solicitud: CrearOperadorRequest, admin: Dict[str, Any]) -> Dict[str, Any]:
        """
        Registra desde cero o vincula un usuario civil existente, asigna los
        roles institucionales y, para Autoridad, su adscripción en `cargo_institucional`.
        """
        roles_a_asignar = solicitud.roles or ([solicitud.rol] if solicitud.rol else [ROL_AUTORIDAD])
        for r in roles_a_asignar:
            if r not in ROLES_INSTITUCIONALES:
                raise SolicitudInvalidaError(f"Rol institucional '{r}' no permitido. Opciones: 'Autoridad', 'Administrador'.")

        dni_limpio = solicitud.dni.strip().replace(".", "").replace(" ", "")
        if len(dni_limpio) < 6:
            raise SolicitudInvalidaError("El DNI debe contener al menos 6 números sin puntos.")

        email = solicitud.email.strip().lower()
        user_id: Optional[str] = solicitud.usuario_id_existente
        now_iso = _ahora_iso()

        if not user_id:
            user_id = self._usuario_por_dni(dni_limpio) or self._crear_o_reutilizar_cuenta_auth(solicitud, email, dni_limpio, roles_a_asignar)

        usuario_payload: Dict[str, Any] = {"usu_id_usuario": user_id, "usu_email": email, "usu_activo": True}
        if not solicitud.usuario_id_existente:
            usuario_payload["usu_password_hash"] = hash_institutional_password(solicitud.password)
        try:
            self._usuarios.upsert(usuario_payload)
        except Exception as u_err:
            logger.warning("No se pudo actualizar usuario en tabla pública: %s", u_err)

        self._registrar_persona(user_id, solicitud, dni_limpio, now_iso)

        for r_nom in roles_a_asignar:
            try:
                ids = self._perfiles.buscar_ids_perfil(r_nom)
                if ids:
                    self._perfiles.upsert_asignacion({
                        "usu_id_usuario": user_id,
                        "prf_id_perfil": ids[0],
                        "usuprf_estado_aprobacion": "activo",
                        "usu_id_aprobado_por": admin["id"],
                        "usuprf_aprobado_en": now_iso,
                        "usuprf_notas": f"Rol {r_nom} asignado por Administrador {admin.get('email', 'admin')}",
                    })
            except Exception as utp_err:
                logger.error("Error asignando rol %s: %s", r_nom, utp_err)

        if not solicitud.usuario_id_existente:
            # Alta institucional desde cero: se purga el perfil civil auto-asignado por triggers
            try:
                ids_victima = self._perfiles.buscar_ids_perfil("Victima")
                ids_victima.append(ID_PERFIL_VICTIMA_AUTOASIGNADO)
                for vid in dict.fromkeys(ids_victima):
                    self._perfiles.eliminar_asignacion(user_id, vid)
            except Exception as rm_err:
                logger.warning("Aviso limpiando perfil civil auto-asignado en alta de operador: %s", rm_err)

        if ROL_AUTORIDAD in roles_a_asignar:
            if not solicitud.id_sede:
                raise SolicitudInvalidaError("Para el perfil Autoridad se debe seleccionar una Sede física válida.")
            legajo = (solicitud.legajo_o_matricula or solicitud.legajo_personal or "").strip()
            if not legajo:
                raise SolicitudInvalidaError("El legajo o matrícula profesional es obligatorio para el perfil Autoridad y debe ser único.")
            try:
                self._cargos.upsert({
                    "usu_id_usuario": user_id,
                    "sed_id_sede": solicitud.id_sede,
                    "car_id_cargo": resolver_id_cargo(solicitud.id_cargo, solicitud.nombre_cargo),
                    "carins_legajo_o_matricula": legajo,
                    "carins_activo": True,
                })
            except Exception as cargo_err:
                logger.error("Error guardando cargo_institucional: %s", cargo_err)

        return {
            "status": "ok",
            "message": f"Operador configurado exitosamente con roles {roles_a_asignar}.",
            "usuario_id": user_id,
            "email": solicitud.email,
            "roles": roles_a_asignar,
            "estado_aprobacion": "activo",
        }

    def _usuario_por_dni(self, dni: str) -> Optional[str]:
        """Unicidad de DNI: reutiliza el usuario de una persona ya registrada."""
        try:
            personas = self._usuarios.buscar_personas_por_dni(dni)
            if personas:
                return _primer_usuario(personas[0].get("usuario")).get("usu_id_usuario")
        except Exception:
            pass
        return None

    def _crear_o_reutilizar_cuenta_auth(self, solicitud: CrearOperadorRequest, email: str, dni: str, roles: List[str]) -> str:
        try:
            return self._auth.crear_usuario({
                "email": email,
                "password": solicitud.password,
                "email_confirm": True,
                "user_metadata": {
                    "nombre": solicitud.nombre.strip(),
                    "apellido": solicitud.apellido.strip(),
                    "dni": dni,
                    "telefono": solicitud.telefono.strip() if solicitud.telefono else "",
                    "genero": solicitud.genero or "No especificado",
                    "fecha_nacimiento": solicitud.fecha_nacimiento if solicitud.fecha_nacimiento else "",
                    "direccion": solicitud.direccion.strip() if solicitud.direccion else "",
                    "roles": roles,
                    "es_operador_institucional": True,
                },
            })
        except Exception as exc:
            # Si el email ya existía en Auth, se reutiliza esa cuenta
            try:
                for u in self._auth.listar_usuarios():
                    if getattr(u, "email", "").lower() == email:
                        return str(getattr(u, "id"))
            except Exception:
                pass
            raise SolicitudInvalidaError(f"No se pudo crear la cuenta del operador: {exc}")

    def _registrar_persona(self, user_id: str, solicitud: CrearOperadorRequest, dni: str, now_iso: str) -> None:
        try:
            persona_id = self._usuarios.obtener_id_persona(user_id)
            datos_persona = {
                "per_nombre": solicitud.nombre.strip(),
                "per_apellido": solicitud.apellido.strip(),
                "per_dni": dni,
                "per_genero": solicitud.genero or "No especificado",
                "per_fecha_nacimiento": solicitud.fecha_nacimiento if solicitud.fecha_nacimiento else None,
                "per_telefono": solicitud.telefono.strip() if solicitud.telefono else None,
                "per_direccion": solicitud.direccion.strip() if solicitud.direccion else None,
                "per_terminos_aceptados_en": now_iso,
                "per_terminos_version": "1.0",
                "per_politica_aceptada_en": now_iso,
                "per_politica_version": "1.0",
            }
            if persona_id:
                self._usuarios.actualizar_persona(persona_id, datos_persona)
            else:
                fila = self._usuarios.insertar_persona(datos_persona)
                if fila:
                    persona_id = fila.get("per_id_persona") or fila.get("id")
                if persona_id:
                    self._usuarios.vincular_persona(user_id, persona_id)
        except Exception as p_err:
            logger.error("Error registrando Persona: %s", p_err)

    # ── Roles y estado operativo ─────────────────────────────────────────────

    def agregar_rol(self, usuario_id: str, solicitud: AgregarRolRequest, admin: Dict[str, Any]) -> Dict[str, Any]:
        """Asignación irreversible (trazabilidad de auditoría)."""
        user_uuid = _uuid_valido(usuario_id)
        if solicitud.rol not in ROLES_INSTITUCIONALES:
            raise SolicitudInvalidaError("Solo se pueden agregar los roles 'Autoridad' o 'Administrador'.")

        ids = self._perfiles.buscar_ids_perfil(solicitud.rol)
        if not ids:
            raise RecursoNoEncontradoError(f"Perfil '{solicitud.rol}' no encontrado.")
        perfil_id = ids[0]

        if self._perfiles.existe_asignacion(user_uuid, perfil_id):
            raise SolicitudInvalidaError(f"El operador ya posee el rol '{solicitud.rol}'.")

        try:
            self._perfiles.insertar_asignacion({
                "usu_id_usuario": user_uuid,
                "prf_id_perfil": perfil_id,
                "usuprf_estado_aprobacion": "activo",
                "usu_id_aprobado_por": admin["id"],
                "usuprf_aprobado_en": _ahora_iso(),
                "usuprf_notas": f"Rol {solicitud.rol} asignado irreversiblemente para auditoría por Administrador {admin.get('email', 'admin')}",
            })
        except Exception as exc:
            logger.error("Error agregando rol en usuario_tiene_perfil: %s", exc)
            raise ErrorInternoError(f"Error asignando rol: {exc}")

        if solicitud.rol == ROL_AUTORIDAD:
            if not solicitud.id_sede:
                raise SolicitudInvalidaError("Se requiere seleccionar una Sede física para el rol Autoridad.")
            legajo = (solicitud.legajo_o_matricula or "").strip()
            if not legajo:
                raise SolicitudInvalidaError("El legajo o matrícula institucional es obligatorio.")
            try:
                if self._cargos.existe_legajo(legajo):
                    raise SolicitudInvalidaError(f"El legajo '{legajo}' ya se encuentra registrado por otra autoridad.")
            except SolicitudInvalidaError:
                raise
            except Exception:
                pass
            try:
                self._cargos.upsert({
                    "usu_id_usuario": user_uuid,
                    "sed_id_sede": solicitud.id_sede,
                    "car_id_cargo": resolver_id_cargo(solicitud.id_cargo, solicitud.nombre_cargo),
                    "carins_legajo_o_matricula": legajo,
                    "carins_activo": True,
                })
            except Exception as c_err:
                logger.error("Error registrando cargo_institucional al agregar rol: %s", c_err)

        return {
            "status": "ok",
            "message": f"Rol {solicitud.rol} asignado irreversiblemente con fines de auditoría y trazabilidad.",
            "usuario_id": user_uuid,
            "rol_agregado": solicitud.rol,
        }

    def suspender(self, usuario_id: str, notas: Optional[str], admin: Dict[str, Any]) -> Dict[str, Any]:
        """Suspende perfiles institucionales y cargo; la cuenta civil sigue operativa."""
        user_uuid = _uuid_valido(usuario_id)
        motivo = notas or f"Suspendido desde Panel Web por {admin.get('email', 'admin')}"
        try:
            self._perfiles.actualizar_asignaciones_de_usuario(user_uuid, {"usuprf_estado_aprobacion": "suspendido", "usuprf_notas": motivo})
        except Exception as exc:
            logger.warning("Aviso actualizando usuario_tiene_perfil en suspension: %s", exc)
        try:
            self._cargos.establecer_activo(user_uuid, False)
        except Exception as exc:
            logger.warning("Aviso actualizando cargo_institucional en suspension: %s", exc)
        return {
            "status": "ok",
            "message": "Operador institucional suspendido correctamente. Su acceso civil a la App Móvil no ha sido afectado.",
            "usuario_id": user_uuid,
            "estado": "suspendido",
        }

    def reactivar(self, usuario_id: str, admin: Dict[str, Any]) -> Dict[str, Any]:
        user_uuid = _uuid_valido(usuario_id)
        try:
            self._perfiles.actualizar_asignaciones_de_usuario(user_uuid, {
                "usuprf_estado_aprobacion": "activo",
                "usu_id_aprobado_por": admin["id"],
                "usuprf_aprobado_en": _ahora_iso(),
                "usuprf_notas": f"Reactivado por Administrador {admin.get('email', 'admin')}",
            })
        except Exception as exc:
            logger.warning("Aviso reactivando usuario_tiene_perfil: %s", exc)
        try:
            self._cargos.establecer_activo(user_uuid, True)
        except Exception as exc:
            logger.warning("Aviso reactivando cargo_institucional: %s", exc)
        return {
            "status": "ok",
            "message": "Operador institucional reactivado exitosamente.",
            "usuario_id": user_uuid,
            "estado": "activo",
        }

    def cambiar_cargo_activo(self, usuario_id: str, activo: bool) -> Dict[str, Any]:
        user_uuid = _uuid_valido(usuario_id)
        try:
            self._cargos.establecer_activo(user_uuid, activo)
        except Exception as exc:
            raise ErrorInternoError(f"Error actualizando estado del cargo: {exc}")
        return {
            "status": "ok",
            "usuario_id": user_uuid,
            "cargo_activo": activo,
            "mensaje": f"Cargo institucional {'habilitado' if activo else 'deshabilitado'} exitosamente.",
        }

    def cambiar_estado(self, usuario_id: str, estado: str, notas: Optional[str], admin: Dict[str, Any]) -> Dict[str, Any]:
        user_uuid = _uuid_valido(usuario_id)
        if estado in ("suspendido", "revocado", "activo"):
            try:
                self._cargos.establecer_activo(user_uuid, estado == "activo")
            except Exception:
                pass
        try:
            self._perfiles.actualizar_asignaciones_de_usuario(user_uuid, {
                "usuprf_estado_aprobacion": estado,
                "usuprf_notas": notas or f"Actualizado a {estado} por {admin.get('email', 'admin')}",
            })
        except Exception:
            pass
        return {"status": "ok", "usuario_id": user_uuid, "nuevo_estado": estado}
