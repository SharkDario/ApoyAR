# backend/app/services/catalogo_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Catálogos institucionales 3FN (institución → dependencia → sede, y cargo)
# con datos semilla de la Provincia de Formosa como respaldo si la consulta falla.
# ─────────────────────────────────────────────────────────────────────────────

import logging
from typing import Any, Dict, List, Optional

from app.repositories.catalogo_repository import CatalogoInstitucionalRepository

logger = logging.getLogger("apoyar.admin_autoridad")

FALLBACK_INSTITUCIONES = [
    {"id_institucion": 1, "nombre": "Policía de la Provincia de Formosa", "tipo_organismo": "Fuerza de Seguridad Provincial", "sitio_web": "https://www.formosa.gob.ar/policia"},
    {"id_institucion": 2, "nombre": "Poder Judicial de la Provincia de Formosa", "tipo_organismo": "Órgano Judicial Provincial", "sitio_web": "http://www.jusformosa.gov.ar/"},
    {"id_institucion": 3, "nombre": "Secretaría de la Mujer de la Provincia de Formosa", "tipo_organismo": "Organismo Ejecutivo de Asistencia y Género", "sitio_web": "https://www.formosa.gob.ar/mujer"},
    {"id_institucion": 4, "nombre": "Ministerio de Gobierno, Justicia, Seguridad y Trabajo", "tipo_organismo": "Ministerio del Poder Ejecutivo Provincial", "sitio_web": "https://www.formosa.gob.ar/"},
    {"id_institucion": 5, "nombre": "Municipalidad de la Ciudad de Formosa", "tipo_organismo": "Gobierno Municipal Local", "sitio_web": "https://www.formosatuciudad.gob.ar/"},
]

FALLBACK_DEPENDENCIAS = [
    {"id_dependencia": 101, "id_institucion": 1, "nombre": "Jefatura de Policía", "tipo_unidad": "Unidad de Conducción Superior", "telefono_contacto": "+54 370 442-7313"},
    {"id_dependencia": 102, "id_institucion": 1, "nombre": "Dirección de Policía Científica", "tipo_unidad": "Unidad Pericial y Cadena de Custodia", "telefono_contacto": None},
    {"id_dependencia": 103, "id_institucion": 1, "nombre": "Comisaría Seccional Primera", "tipo_unidad": "Comisaría Jurisdiccional", "telefono_contacto": "+54 370 442-6189"},
    {"id_dependencia": 104, "id_institucion": 1, "nombre": "Comisaría Seccional Segunda", "tipo_unidad": "Comisaría Jurisdiccional", "telefono_contacto": "+54 370 442-0777"},
    {"id_dependencia": 105, "id_institucion": 1, "nombre": "Comisaría Seccional Sexta", "tipo_unidad": "Comisaría Jurisdiccional", "telefono_contacto": "+54 370 445-2111"},
    {"id_dependencia": 201, "id_institucion": 2, "nombre": "Edificio Central de Tribunales y OVI Capital", "tipo_unidad": "Unidad Judicial y Recepción de Denuncias", "telefono_contacto": "+54 370 443-6301"},
    {"id_dependencia": 202, "id_institucion": 2, "nombre": "Tribunal de Familia", "tipo_unidad": "Juzgado de Familia y Medidas Cautelares", "telefono_contacto": "+54 370 444-5442"},
    {"id_dependencia": 203, "id_institucion": 2, "nombre": "Dirección de Sistemas Informáticos", "tipo_unidad": "Unidad Técnica y Resguardo Digital", "telefono_contacto": None},
    {"id_dependencia": 204, "id_institucion": 2, "nombre": "Delegación Vecinal N° 2 - Circuito Cinco", "tipo_unidad": "Oficina Descentralizada de Orientación", "telefono_contacto": None},
    {"id_dependencia": 205, "id_institucion": 2, "nombre": "Oficina de Violencia Familiar (OVI Clorinda)", "tipo_unidad": "Unidad Operativa Interior", "telefono_contacto": "+54 3718 42-1750"},
    {"id_dependencia": 301, "id_institucion": 3, "nombre": "Dirección de Atención a Víctimas de Violencia de Género", "tipo_unidad": "Área de Contención y Asesoría Legal", "telefono_contacto": "+54 370 443-6372"},
    {"id_dependencia": 401, "id_institucion": 4, "nombre": "Dirección de Patronato de Liberados y Excarcelados", "tipo_unidad": "Unidad de Control de Medidas Judiciales", "telefono_contacto": "+54 370 443-6196"},
    {"id_dependencia": 501, "id_institucion": 5, "nombre": "Dirección de Cuidado Ciudadano y Género Municipal", "tipo_unidad": "Área Operativa Municipal", "telefono_contacto": "+54 370 480-4556"},
    {"id_dependencia": 502, "id_institucion": 5, "nombre": "Secretaría de Gobierno Municipal", "tipo_unidad": "Unidad Administrativa Central", "telefono_contacto": "+54 800-999-9147"},
]

FALLBACK_SEDES = [
    {"id_sede": 1001, "id_dependencia": 101, "nombre_sede": "Sede Central Jefatura", "direccion": "Saavedra 325", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 1002, "id_dependencia": 101, "nombre_sede": "Base Operativa Coronel Bogado", "direccion": "Coronel Bogado 767", "localidad": "Formosa Capital", "codigo_postal": "P3600FZJ"},
    {"id_sede": 1003, "id_dependencia": 102, "nombre_sede": "Laboratorio y División Informática Forense", "direccion": "Junín 849", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 1004, "id_dependencia": 103, "nombre_sede": "Edificio Comisaría 1ra", "direccion": "Saavedra 317", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 1005, "id_dependencia": 104, "nombre_sede": "Edificio Comisaría 2da", "direccion": "Libertad 800-898 (esq. 17 de Octubre)", "localidad": "Formosa Capital", "codigo_postal": "P3600LMJ"},
    {"id_sede": 1006, "id_dependencia": 105, "nombre_sede": "Edificio Comisaría 6ta", "direccion": "Av. Dr. Luis Gutnisky 4010", "localidad": "Formosa Capital", "codigo_postal": "P3600CNA"},
    {"id_sede": 2001, "id_dependencia": 201, "nombre_sede": "Palacio de Tribunales Formosa", "direccion": "San Martín 641", "localidad": "Formosa Capital", "codigo_postal": "P3600ENI"},
    {"id_sede": 2002, "id_dependencia": 201, "nombre_sede": "Sede Superior Tribunal de Justicia", "direccion": "Juan José Silva 856", "localidad": "Formosa Capital", "codigo_postal": "P3600KRR"},
    {"id_sede": 2003, "id_dependencia": 202, "nombre_sede": "Edificio Fuero de Familia", "direccion": "Saavedra 389", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 2004, "id_dependencia": 203, "nombre_sede": "Centro de Cómputos y Sistemas", "direccion": "Belgrano 420", "localidad": "Formosa Capital", "codigo_postal": "P3600ENF"},
    {"id_sede": 2005, "id_dependencia": 204, "nombre_sede": "Sede Barrio Simón Bolívar", "direccion": "Av. Soldado Formoseño en Malvinas, B° Simón Bolívar Mz 49 C 29", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 2006, "id_dependencia": 205, "nombre_sede": "Sede Judicial Clorinda", "direccion": "Av. San Martín s/n", "localidad": "Clorinda", "codigo_postal": "P3610"},
    {"id_sede": 3001, "id_dependencia": 301, "nombre_sede": "Sede Central Secretaría de la Mujer", "direccion": "España 735", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 4001, "id_dependencia": 401, "nombre_sede": "Sede Patronato de Liberados", "direccion": "Rivadavia 925", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
    {"id_sede": 5001, "id_dependencia": 501, "nombre_sede": "Complejo Municipal Fotheringham", "direccion": "Fotheringham 1300-1398", "localidad": "Formosa Capital", "codigo_postal": "P3600HWF"},
    {"id_sede": 5002, "id_dependencia": 502, "nombre_sede": "Palacio Municipal Central", "direccion": "9 de Julio 631", "localidad": "Formosa Capital", "codigo_postal": "P3600AHP"},
    {"id_sede": 5003, "id_dependencia": 502, "nombre_sede": "Anexo Operativo Pringles", "direccion": "Pringles 100-198", "localidad": "Formosa Capital", "codigo_postal": "P3600"},
]

# Catálogo estándar de tipos de cargo (sin claves foráneas transitivas ni DEFAULT de legajo)
FALLBACK_CARGOS = [
    {"id_cargo": 1, "nombre_cargo": "Operador de Despacho y Monitoreo 911"},
    {"id_cargo": 2, "nombre_cargo": "Supervisor de Sala de Monitoreo"},
    {"id_cargo": 3, "nombre_cargo": "Oficial de Guardia en Comisaría"},
    {"id_cargo": 4, "nombre_cargo": "Comisario / Jefe de Dependencia"},
    {"id_cargo": 5, "nombre_cargo": "Perito en Informática y Acústica Forense"},
    {"id_cargo": 6, "nombre_cargo": "Operador Judicial de Turno (OVI)"},
    {"id_cargo": 7, "nombre_cargo": "Secretario de Juzgado / Tribunal de Familia"},
    {"id_cargo": 8, "nombre_cargo": "Agente de Seguimiento y Asistencia en Terreno"},
    {"id_cargo": 9, "nombre_cargo": "Inspector de Control de Medidas Cautelares"},
    {"id_cargo": 10, "nombre_cargo": "Operador de Cuidado Ciudadano y Asistencia Vecinal"},
]

ID_CARGO_POR_DEFECTO = 3  # Oficial de Guardia en Comisaría


def resolver_id_cargo(id_cargo: Optional[int], nombre_cargo: Optional[str]) -> int:
    """ID explícito, o búsqueda por nombre en el catálogo estándar, o el cargo por defecto."""
    if id_cargo:
        return id_cargo
    if nombre_cargo:
        for c in FALLBACK_CARGOS:
            if c["nombre_cargo"].strip().lower() == nombre_cargo.strip().lower():
                return c["id_cargo"]
    return ID_CARGO_POR_DEFECTO


def nombre_cargo_estandar(id_cargo: Any) -> Optional[str]:
    for c in FALLBACK_CARGOS:
        if c["id_cargo"] == id_cargo:
            return c["nombre_cargo"]
    return None


def _con_alias(filas: List[Dict[str, Any]], mapa: Dict[str, str]) -> List[Dict[str, Any]]:
    items = []
    for fila in filas:
        d = dict(fila)
        for alias, columna in mapa.items():
            d[alias] = d.get(columna)
        items.append(d)
    return items


class CatalogoInstitucionalService:

    def __init__(self, catalogo: CatalogoInstitucionalRepository):
        self._catalogo = catalogo

    def listar_instituciones(self) -> List[Dict[str, Any]]:
        try:
            filas = self._catalogo.listar_instituciones()
            if filas:
                return _con_alias(filas, {
                    "id_institucion": "ins_id_institucion",
                    "nombre": "ins_nombre",
                    "tipo_organismo": "ins_tipo_organismo",
                    "sitio_web": "ins_sitio_web",
                })
        except Exception as exc:
            logger.warning("Fallo consultando institucion en DB, usando catálogo semilla: %s", exc)
        return FALLBACK_INSTITUCIONES

    def listar_dependencias(self, institucion_id: Optional[int] = None) -> List[Dict[str, Any]]:
        try:
            filas = self._catalogo.listar_dependencias(institucion_id)
            if filas:
                return _con_alias(filas, {
                    "id_dependencia": "dep_id_dependencia",
                    "id_institucion": "ins_id_institucion",
                    "nombre": "dep_nombre",
                    "tipo_unidad": "dep_tipo_unidad",
                    "telefono_contacto": "dep_telefono_contacto",
                })
        except Exception as exc:
            logger.warning("Fallo consultando dependencia en DB, usando catálogo semilla: %s", exc)
        if institucion_id is not None:
            return [d for d in FALLBACK_DEPENDENCIAS if d["id_institucion"] == institucion_id]
        return FALLBACK_DEPENDENCIAS

    def listar_sedes(self, dependencia_id: Optional[int] = None) -> List[Dict[str, Any]]:
        try:
            filas = self._catalogo.listar_sedes(dependencia_id)
            if filas:
                return _con_alias(filas, {
                    "id_sede": "sed_id_sede",
                    "id_dependencia": "dep_id_dependencia",
                    "nombre_sede": "sed_nombre_sede",
                    "direccion": "sed_direccion",
                    "localidad": "sed_localidad",
                    "codigo_postal": "sed_codigo_postal",
                })
        except Exception as exc:
            logger.warning("Fallo consultando sede en DB, usando catálogo semilla: %s", exc)
        if dependencia_id is not None:
            return [s for s in FALLBACK_SEDES if s["id_dependencia"] == dependencia_id]
        return FALLBACK_SEDES

    def listar_cargos(self) -> List[Dict[str, Any]]:
        try:
            filas = self._catalogo.listar_cargos()
            if filas:
                return _con_alias(filas, {"id_cargo": "car_id_cargo", "nombre_cargo": "car_nombre_cargo"})
        except Exception as exc:
            logger.warning("Fallo consultando tabla cargo, usando catálogo semilla: %s", exc)
        return FALLBACK_CARGOS
