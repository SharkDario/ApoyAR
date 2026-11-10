# backend/app/services/estadistica_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Estadísticas anónimas de las emergencias en Modo Resguardo (RF-4.4 / CU-11).
#
# Trabaja solo con totales: duración entre el inicio y el cierre registrado en
# `historial_incidente`, horarios y meses, activación manual o automática,
# departamentos, localidades y barrios, rangos de edad y parentescos de la
# red de apoyo. Nunca devuelve nombres, DNI,
# teléfonos, direcciones exactas, identificadores ni evidencias.
#
# Los incidentes de cuentas suprimidas (Ley 25.326) quedan sin víctima: suman
# en los totales y entran en "Sin dato" para la edad y el género.
# ─────────────────────────────────────────────────────────────────────────────

import csv
import io
import json
import math
import re
import statistics
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.errors import SolicitudInvalidaError
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.admin import FiltroEstadisticasQuery, ResumenEstadisticasResponse
from app.services.exportacion_forense_service import ArchivoExportado
from app.services.pdf_generator import generar_pdf_estadisticas

ART = timezone(timedelta(hours=-3))
DIAS_SEMANA = ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")
NOMBRES_MES = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")
SIN_DATO = "Sin dato"

# Celda del mapa de calor: unos 500 m. Ningún punto marca un domicilio.
PASO_CALOR_GRADOS = 0.005

# Franja nocturna (20:00 a 05:59, hora argentina)
HORAS_NOCTURNAS = set(range(20, 24)) | set(range(0, 6))

# Rangos de edad (etiqueta, mínima, máxima): los mismos cortes que usa la estadística
# judicial de la provincia, para que los resultados se puedan leer con esa escala.
RANGOS_ETARIOS: Tuple[Tuple[str, int, int], ...] = (
    # La app es para mayores de 16: no hay rangos infantiles
    ("15-17", 15, 17), ("18-21", 18, 21),
    ("22-29", 22, 29), ("30-39", 30, 39), ("40-49", 40, 49), ("50-59", 50, 59), ("60-74", 60, 74), (">74", 75, 200),
)

# Opciones de género del registro en la app. Si no se eligió ninguna es "Sin dato".
GENEROS: Tuple[str, ...] = ("Femenino", "Masculino", "No binario")

DEPARTAMENTOS = ("Formosa", "Pilcomayo", "Patiño", "Pirané", "Laishí", "Pilagás", "Matacos", "Bermejo", "Ramón Lista")

# Límites oficiales de los 9 departamentos (IGN) y localidades oficiales (Georef, datos.gob.ar).
# Se leen una vez y el cálculo se hace en memoria, sin consultar servicios externos.
_DATOS = Path(__file__).resolve().parent.parent / "data"
_DEPARTAMENTOS_GEO: List[Tuple[str, Tuple[float, float, float, float], List[List[List[Tuple[float, float]]]]]] = []
for _f in json.loads((_DATOS / "formosa_departamentos.geojson").read_text(encoding="utf-8"))["features"]:
    _poligonos = [[[(float(x), float(y)) for x, y in anillo] for anillo in poligono] for poligono in _f["geometry"]["coordinates"]]
    _xs = [x for pol in _poligonos for x, _ in pol[0]]
    _ys = [y for pol in _poligonos for _, y in pol[0]]
    _DEPARTAMENTOS_GEO.append((_f["properties"]["departamento"], (min(_xs), min(_ys), max(_xs), max(_ys)), _poligonos))
LOCALIDADES_OFICIALES: List[Dict[str, Any]] = json.loads((_DATOS / "formosa_localidades.json").read_text(encoding="utf-8"))["localidades"]

# Un punto a más de esta distancia de toda localidad de su departamento se cuenta como zona rural
RADIO_LOCALIDAD_KM = 10.0
ZONA_RURAL = "Zona rural"

# Barrios de OpenStreetMap (los mismos datos del mapa): con límite cuando OSM lo tiene,
# si no, un punto con el nombre. Sin límite, vale el barrio más cercano hasta 600 m.
_BARRIOS_POLIGONO: List[Tuple[str, Tuple[float, float, float, float], float, List[List[Tuple[float, float]]]]] = []
_BARRIOS_PUNTO: List[Tuple[str, float, float]] = []
for _b in json.loads((_DATOS / "formosa_barrios.json").read_text(encoding="utf-8"))["barrios"]:
    if "poligonos" in _b:
        _anillos = [[(float(x), float(y)) for x, y in anillo] for anillo in _b["poligonos"]]
        _xs = [x for a in _anillos for x, _ in a]
        _ys = [y for a in _anillos for _, y in a]
        _caja = (min(_xs), min(_ys), max(_xs), max(_ys))
        _BARRIOS_POLIGONO.append((_b["nombre"], _caja, (_caja[2] - _caja[0]) * (_caja[3] - _caja[1]), _anillos))
    else:
        _BARRIOS_PUNTO.append((_b["nombre"], float(_b["punto"][1]), float(_b["punto"][0])))
RADIO_BARRIO_KM = 0.6

TRAMOS_DURACION = ((0, 10, "Menos de 10 min"), (10, 30, "10 a 29 min"), (30, 60, "30 a 59 min"),
                   (60, 180, "1 a 3 h"), (180, None, "Más de 3 h"))


def _normalizar(texto: Optional[str]) -> str:
    sin_tildes = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn").lower()


def _parse_fecha(valor: Any) -> Optional[datetime]:
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(str(valor).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _distancia_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _punto_en_anillo(lat: float, lon: float, anillo: List[Tuple[float, float]]) -> bool:
    """Cruce de rayos: True si el punto queda dentro del anillo (lista de lon, lat)."""
    adentro = False
    for (x1, y1), (x2, y2) in zip(anillo, anillo[1:] + anillo[:1]):
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            adentro = not adentro
    return adentro


def _coordenadas(inc: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    try:
        lat, lon = float(inc.get("inc_latitud")), float(inc.get("inc_longitud"))
    except (TypeError, ValueError):
        return None
    if lat == 0 and lon == 0 or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def _porcentaje(parte: int, total: int) -> float:
    return round(parte * 100 / total, 1) if total else 0.0


def _contar(valores: Iterable[str]) -> List[Dict[str, Any]]:
    conteo: Dict[str, int] = {}
    for v in valores:
        conteo[v] = conteo.get(v, 0) + 1
    total = sum(conteo.values())
    return [
        {"nombre": nombre, "cantidad": cantidad, "porcentaje": _porcentaje(cantidad, total)}
        for nombre, cantidad in sorted(conteo.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


class EstadisticaService:

    def __init__(self, incidentes: IncidenteRepository, usuarios: UsuarioRepository, red_apoyo: RedApoyoRepository):
        self._incidentes = incidentes
        self._usuarios = usuarios
        self._red_apoyo = red_apoyo

    # ── Tablero ──────────────────────────────────────────────────────────────

    def obtener_resumen_estadistico(self, filtros: FiltroEstadisticasQuery) -> ResumenEstadisticasResponse:
        if filtros.fecha_desde and filtros.fecha_hasta and filtros.fecha_desde > filtros.fecha_hasta:
            raise SolicitudInvalidaError("La fecha 'desde' no puede ser posterior a la fecha 'hasta'.")
        # Días calendario de Argentina expresados en UTC, como se guardan las fechas
        desde_iso = datetime.combine(filtros.fecha_desde, time.min, ART).astimezone(timezone.utc).isoformat() if filtros.fecha_desde else None
        hasta_iso = datetime.combine(filtros.fecha_hasta, time.max, ART).astimezone(timezone.utc).isoformat() if filtros.fecha_hasta else None
        incidentes = self._incidentes.listar_para_estadisticas(desde_iso, hasta_iso, filtros.origen)

        for inc in incidentes:
            inc["_fecha"] = _parse_fecha(inc.get("inc_fecha_hora"))
            inc["_ubicacion"] = self._ubicar(inc)
        incidentes = [i for i in incidentes if i["_fecha"] and self._coincide_zona(i["_ubicacion"], filtros)]

        cerrados = [i for i in incidentes if i.get("inc_estado") != "en_curso"]
        cierres = self._incidentes.obtener_fechas_cierre_historial([str(i["inc_id_incidente"]) for i in cerrados])
        duracion = self.calcular_metricas_duracion(incidentes, cierres)
        geografia = self.agrupar_distribucion_geoespacial(incidentes)
        demografia = self.calcular_perfil_demografico_anonimizado(incidentes)
        temporal = self._distribucion_temporal(incidentes)

        total = len(incidentes)
        automaticos = sum(1 for i in incidentes if i.get("inc_origen") == "automatico")
        return ResumenEstadisticasResponse(
            generado_en=datetime.now(ART).isoformat(timespec="seconds"),
            filtros=self._describir_filtros(filtros),
            total_incidentes=total,
            incidentes_en_curso=total - len(cerrados),
            incidentes_cerrados=len(cerrados),
            victimas_distintas=len({i["usu_id_victima"] for i in incidentes if i.get("usu_id_victima")}),
            porcentaje_automatico=_porcentaje(automaticos, total),
            porcentaje_manual=_porcentaje(total - automaticos, total) if total else 0.0,
            por_origen=self._por_origen(incidentes, duracion["por_incidente"]),
            **{k: v for k, v in duracion.items() if k != "por_incidente"},
            **temporal,
            **geografia,
            **demografia,
        )

    # ── Duración del episodio ────────────────────────────────────────────────

    def calcular_metricas_duracion(self, incidentes: List[Dict[str, Any]], cierres: Dict[str, str]) -> Dict[str, Any]:
        """Minutos entre el inicio y el cierre. Los casos en curso o sin cierre registrado no entran."""
        por_incidente: Dict[str, float] = {}
        for inc in incidentes:
            if inc.get("inc_estado") == "en_curso":
                continue
            inicio = _parse_fecha(inc.get("inc_fecha_hora"))
            fin = _parse_fecha(cierres.get(str(inc["inc_id_incidente"])))
            if inicio and fin and fin >= inicio:
                por_incidente[str(inc["inc_id_incidente"])] = (fin - inicio).total_seconds() / 60

        minutos = sorted(por_incidente.values())
        distribucion = []
        for minimo, maximo, etiqueta in TRAMOS_DURACION:
            cantidad = sum(1 for m in minutos if m >= minimo and (maximo is None or m < maximo))
            distribucion.append({"tramo": etiqueta, "cantidad": cantidad, "porcentaje": _porcentaje(cantidad, len(minutos))})

        p90 = None
        if minutos:
            p90 = minutos[min(len(minutos) - 1, math.ceil(0.9 * len(minutos)) - 1)]
        return {
            "por_incidente": por_incidente,
            "duracion_promedio_min": round(statistics.fmean(minutos), 1) if minutos else None,
            "duracion_mediana_min": round(statistics.median(minutos), 1) if minutos else None,
            "duracion_p90_min": round(p90, 1) if p90 is not None else None,
            "casos_con_duracion": len(minutos),
            "distribucion_duracion": distribucion,
        }

    # ── Territorio ───────────────────────────────────────────────────────────

    def agrupar_distribucion_geoespacial(self, incidentes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Totales por departamento, localidad y barrio, y celdas de unos 500 m para el mapa de calor."""
        total = len(incidentes)
        departamentos: Dict[str, int] = {}
        localidades: Dict[Tuple[str, str], int] = {}
        barrios: Dict[Tuple[str, str], int] = {}
        celdas: Dict[Tuple[float, float], int] = {}
        sin_ubicacion = 0

        for inc in incidentes:
            ubicacion = inc.get("_ubicacion") or self._ubicar(inc)
            if ubicacion["departamento"] == SIN_DATO:
                sin_ubicacion += 1
            departamentos[ubicacion["departamento"]] = departamentos.get(ubicacion["departamento"], 0) + 1
            clave_localidad = (ubicacion["departamento"], ubicacion["localidad"])
            localidades[clave_localidad] = localidades.get(clave_localidad, 0) + 1
            if ubicacion["barrio"]:
                clave_barrio = (ubicacion["localidad"], ubicacion["barrio"])
                barrios[clave_barrio] = barrios.get(clave_barrio, 0) + 1
            coords = _coordenadas(inc)
            if coords:
                celda = (round(round(coords[0] / PASO_CALOR_GRADOS) * PASO_CALOR_GRADOS, 4),
                         round(round(coords[1] / PASO_CALOR_GRADOS) * PASO_CALOR_GRADOS, 4))
                celdas[celda] = celdas.get(celda, 0) + 1

        return {
            "por_departamento": [
                {"departamento": d, "cantidad": c, "porcentaje": _porcentaje(c, total)}
                for d, c in sorted(departamentos.items(), key=lambda kv: (-kv[1], kv[0]))
            ],
            "por_localidad": [
                {"departamento": d, "localidad": l, "cantidad": c, "porcentaje": _porcentaje(c, total)}
                for (d, l), c in sorted(localidades.items(), key=lambda kv: (-kv[1], kv[0]))
            ],
            "por_barrio": [
                {"localidad": l, "barrio": b, "cantidad": c}
                for (l, b), c in sorted(barrios.items(), key=lambda kv: (-kv[1], kv[0]))
            ],
            "sin_ubicacion": sin_ubicacion,
            "puntos_calor": [{"lat": lat, "lng": lng, "cantidad": c} for (lat, lng), c in celdas.items()],
        }

    def _ubicar(self, inc: Dict[str, Any]) -> Dict[str, Optional[str]]:
        """
        Departamento y localidad. Primero por coordenadas: el departamento es el polígono
        oficial que contiene el punto y la localidad, la oficial más cercana de ese
        departamento (a más de 10 km, zona rural). Solo si no hay coordenadas válidas
        dentro de la provincia se busca el nombre en el texto de la dirección.
        """
        direcciones = [inc.get("inc_direccion") or "", inc.get("inc_direccion_aprox") or ""]
        departamento = localidad = None

        coords = _coordenadas(inc)
        if coords:
            departamento = self._departamento_por_coordenadas(coords[0], coords[1])
            if departamento:
                cercanas = [l for l in LOCALIDADES_OFICIALES if l["departamento"] == departamento]
                if cercanas:
                    mas_cercana = min(cercanas, key=lambda l: _distancia_km(coords[0], coords[1], l["lat"], l["lon"]))
                    if _distancia_km(coords[0], coords[1], mas_cercana["lat"], mas_cercana["lon"]) <= RADIO_LOCALIDAD_KM:
                        localidad = mas_cercana["nombre"]
                localidad = localidad or ZONA_RURAL

        if not departamento:
            departamento, localidad = self._ubicar_por_texto(_normalizar(", ".join(direcciones)))

        # Barrio: primero por coordenadas; si no hay barrio cerca, el que nombra la dirección
        barrio = self._barrio_por_coordenadas(coords[0], coords[1]) if coords else None
        return {
            "departamento": departamento or SIN_DATO,
            "localidad": localidad or SIN_DATO,
            "barrio": barrio or self._barrio(direcciones, localidad),
        }

    @staticmethod
    def _departamento_por_coordenadas(lat: float, lon: float) -> Optional[str]:
        """Departamento cuyo polígono oficial contiene el punto."""
        for nombre, (xmin, ymin, xmax, ymax), poligonos in _DEPARTAMENTOS_GEO:
            if not (xmin <= lon <= xmax and ymin <= lat <= ymax):
                continue
            for exterior, *huecos in poligonos:
                if _punto_en_anillo(lat, lon, exterior) and not any(_punto_en_anillo(lat, lon, h) for h in huecos):
                    return nombre
        return None

    @staticmethod
    def _barrio_por_coordenadas(lat: float, lon: float) -> Optional[str]:
        """Barrio de OpenStreetMap que contiene el punto (el más chico si hay varios) o el más cercano hasta 600 m."""
        contienen = [
            (area, nombre) for nombre, (xmin, ymin, xmax, ymax), area, anillos in _BARRIOS_POLIGONO
            if xmin <= lon <= xmax and ymin <= lat <= ymax and any(_punto_en_anillo(lat, lon, a) for a in anillos)
        ]
        if contienen:
            return min(contienen)[1]
        cercanos = [(_distancia_km(lat, lon, b_lat, b_lon), nombre) for nombre, b_lat, b_lon in _BARRIOS_PUNTO
                    if abs(b_lat - lat) < 0.02 and abs(b_lon - lon) < 0.02]
        distancia, nombre = min(cercanos, default=(None, None))
        return nombre if distancia is not None and distancia <= RADIO_BARRIO_KM else None

    @staticmethod
    def _ubicar_por_texto(normal: str) -> Tuple[Optional[str], Optional[str]]:
        """Respaldo sin coordenadas: 'Departamento X' o el nombre de una localidad oficial en la dirección."""
        departamento = next((d for d in DEPARTAMENTOS
                             if re.search(rf"(departamento|dpto\.?)\s+{re.escape(_normalizar(d))}\b", normal)), None)
        # "Formosa" también es el nombre de la provincia: la capital no se reconoce por texto
        for l in sorted(LOCALIDADES_OFICIALES, key=lambda l: -len(l["nombre"])):
            if l["nombre"] == "Formosa" or (departamento and l["departamento"] != departamento):
                continue
            if re.search(rf"\b{re.escape(_normalizar(l['nombre']))}\b", normal):
                return l["departamento"], l["nombre"]
        return departamento, None

    @staticmethod
    def _barrio(direcciones: List[str], localidad: Optional[str]) -> Optional[str]:
        """
        Barrio del incidente. Primero busca "B°" o "Barrio" en la dirección; si no,
        toma la parte que va antes de la ciudad en el formato de la geocodificación
        ("Calle Nro, Barrio, Ciudad"), que sale de OpenStreetMap, los mismos datos del mapa.
        """
        def limpiar(nombre: str) -> Optional[str]:
            nombre = re.sub(r"^(?:B°|Bº|Barrio)\s*", "", nombre.strip(), flags=re.IGNORECASE)
            nombre = " ".join(nombre.split("(")[0].split())
            return nombre[:60] or None

        def descartar(parte: str) -> bool:
            normal = _normalizar(parte)
            return (not re.search(r"[a-z]", normal)
                    or normal in ("formosa", "argentina")
                    or normal.startswith(("departamento", "dpto", "municipio", "provincia")))

        for texto in direcciones:
            coincidencia = re.search(r"(?:B°|Bº|\bBarrio\b)\s*([^,(]+)", texto, re.IGNORECASE)
            if coincidencia:
                return limpiar(coincidencia.group(1))

        principal = _normalizar(localidad.split(" (")[0]) if localidad else None
        for texto in direcciones:
            partes = [p.strip() for p in texto.split(",") if p.strip()]
            if len(partes) < 3:
                continue  # "Calle Nro, Ciudad": la dirección no trae barrio
            ciudad = next((i for i, p in enumerate(partes) if principal and _normalizar(p) == principal), len(partes) - 1)
            if ciudad >= 2 and not descartar(partes[ciudad - 1]):
                return limpiar(partes[ciudad - 1])
        return None

    @staticmethod
    def _coincide_zona(ubicacion: Dict[str, Optional[str]], filtros: FiltroEstadisticasQuery) -> bool:
        if filtros.departamento and _normalizar(ubicacion["departamento"]) != _normalizar(filtros.departamento):
            return False
        if filtros.localidad and _normalizar(ubicacion["localidad"]) != _normalizar(filtros.localidad):
            return False
        return True

    # ── Edad, género y red de apoyo ──────────────────────────────────────────

    def calcular_perfil_demografico_anonimizado(self, incidentes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Edad al momento del incidente por rangos, género y parentescos de la red."""
        victima_ids = sorted({str(i["usu_id_victima"]) for i in incidentes if i.get("usu_id_victima")})
        personas: Dict[str, Dict[str, Any]] = {}
        for i in range(0, len(victima_ids), 150):
            for p in self._usuarios.listar_personas_de_usuarios(victima_ids[i:i + 150]):
                # Solo se conservan los dos datos que se agregan; el resto de la persona se descarta
                personas[str(p.get("usuario_id"))] = {
                    "nacimiento": p.get("per_fecha_nacimiento"),
                    "genero": p.get("per_genero"),
                }

        rangos = {etiqueta: 0 for etiqueta, _, _ in RANGOS_ETARIOS}
        sin_edad = 0
        generos: List[str] = []
        for inc in incidentes:
            if inc.get("usu_id_victima"):
                persona = personas.get(str(inc["usu_id_victima"])) or {}
                edad = self._edad(persona.get("nacimiento"), inc["_fecha"] if inc.get("_fecha") else _parse_fecha(inc.get("inc_fecha_hora")))
                etiqueta = next((e for e, minimo, maximo in RANGOS_ETARIOS if edad is not None and minimo <= edad <= maximo), None)
                genero = persona.get("genero")
            else:
                # Cuenta eliminada: la supresión dejó en la nota solo el rango de edad y el género
                etiqueta, genero = self._datos_anonimizados(inc.get("inc_notas"))
            if etiqueta:
                rangos[etiqueta] += 1
            else:
                sin_edad += 1
            generos.append(self._genero(genero))

        con_edad = sum(rangos.values())
        piramide = [
            {"rango": etiqueta, "cantidad": rangos[etiqueta], "porcentaje": _porcentaje(rangos[etiqueta], con_edad)}
            for etiqueta, _, _ in RANGOS_ETARIOS
        ]
        piramide.append({"rango": SIN_DATO, "cantidad": sin_edad, "porcentaje": None})

        vinculos = self._red_apoyo.listar_vinculos_de_victimas(victima_ids) if victima_ids else []
        parentescos = [(" ".join((v.get("redapo_parentesco") or "").split()) or "Sin especificar") for v in vinculos]
        return {
            "piramide_etaria": piramide,
            # Siempre las mismas opciones del registro, aunque alguna tenga cero
            "por_genero": [
                {"nombre": g, "cantidad": generos.count(g), "porcentaje": _porcentaje(generos.count(g), len(generos))}
                for g in GENEROS + (SIN_DATO,)
            ],
            "vinculos_red_apoyo": _contar(p[:1].upper() + p[1:] for p in parentescos),
            "red_promedio_contactos": round(len(vinculos) / len(victima_ids), 1) if victima_ids else None,
        }

    @staticmethod
    def _datos_anonimizados(nota: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
        """Lee '[Anonimizado] Edad: 30-39 · Género: Femenino' (migración 024). Sin esa nota, no hay dato."""
        coincidencia = re.search(r"\[Anonimizado\] Edad: (.+?) · Género: (.+)$", nota or "")
        if not coincidencia:
            return None, None
        rango = coincidencia.group(1).strip()
        return (rango if rango in {e for e, _, _ in RANGOS_ETARIOS} else None), coincidencia.group(2).strip()

    @staticmethod
    def _genero(valor: Optional[str]) -> str:
        """Unifica mayúsculas y variantes ('no binario', 'No Binario', 'no-binario') con las opciones del registro."""
        normal = _normalizar(valor).replace("-", " ")
        return next((g for g in GENEROS if _normalizar(g) == " ".join(normal.split())), SIN_DATO)

    @staticmethod
    def _edad(nacimiento: Any, al_momento: Optional[datetime]) -> Optional[int]:
        if not nacimiento or not al_momento:
            return None
        try:
            fecha = date.fromisoformat(str(nacimiento)[:10])
        except ValueError:
            return None
        dia = al_momento.astimezone(ART).date()
        edad = dia.year - fecha.year - ((dia.month, dia.day) < (fecha.month, fecha.day))
        return edad if 0 <= edad <= 120 else None

    # ── Tiempo y modalidad de activación ─────────────────────────────────────

    @staticmethod
    def _distribucion_temporal(incidentes: List[Dict[str, Any]]) -> Dict[str, Any]:
        meses: Dict[str, int] = {}
        horas = [0] * 24
        dias = [0] * 7
        matriz: Dict[Tuple[int, int], int] = {}
        for inc in incidentes:
            local = inc["_fecha"].astimezone(ART)
            clave_mes = f"{local.year}-{local.month:02d}"
            meses[clave_mes] = meses.get(clave_mes, 0) + 1
            horas[local.hour] += 1
            dias[local.weekday()] += 1
            matriz[(local.weekday(), local.hour)] = matriz.get((local.weekday(), local.hour), 0) + 1

        serie = []
        if meses:
            # Meses consecutivos, incluidos los que no tuvieron alertas
            anio, mes = map(int, min(meses).split("-"))
            fin_anio, fin_mes = map(int, max(meses).split("-"))
            while (anio, mes) <= (fin_anio, fin_mes):
                clave = f"{anio}-{mes:02d}"
                serie.append({"mes": clave, "etiqueta": f"{NOMBRES_MES[mes - 1]} {anio}", "cantidad": meses.get(clave, 0)})
                anio, mes = (anio + 1, 1) if mes == 12 else (anio, mes + 1)

        return {
            "serie_mensual": serie,
            "por_hora": [{"hora": h, "cantidad": horas[h]} for h in range(24)],
            "por_dia_semana": [{"dia": d, "nombre": DIAS_SEMANA[d], "cantidad": dias[d]} for d in range(7)],
            "matriz_horaria": [
                {"dia": d, "hora": h, "cantidad": c} for (d, h), c in sorted(matriz.items())
            ],
        }

    @staticmethod
    def _por_origen(incidentes: List[Dict[str, Any]], duraciones: Dict[str, float]) -> List[Dict[str, Any]]:
        """Manual frente a automático (voz o sonido), cruzado con la noche y la duración."""
        total = len(incidentes)
        resultado = []
        for origen, etiqueta in (("automatico", "Automática (voz o sonido)"), ("manual", "Manual (botón)")):
            grupo = [i for i in incidentes if (i.get("inc_origen") == "automatico") == (origen == "automatico")]
            nocturnos = sum(1 for i in grupo if i["_fecha"].astimezone(ART).hour in HORAS_NOCTURNAS)
            minutos = [duraciones[str(i["inc_id_incidente"])] for i in grupo if str(i["inc_id_incidente"]) in duraciones]
            resultado.append({
                "origen": origen,
                "etiqueta": etiqueta,
                "cantidad": len(grupo),
                "porcentaje": _porcentaje(len(grupo), total),
                "porcentaje_nocturno": _porcentaje(nocturnos, len(grupo)),
                "duracion_promedio_min": round(statistics.fmean(minutos), 1) if minutos else None,
            })
        return resultado

    @staticmethod
    def _describir_filtros(filtros: FiltroEstadisticasQuery) -> Dict[str, Any]:
        return {
            "fecha_desde": filtros.fecha_desde.isoformat() if filtros.fecha_desde else None,
            "fecha_hasta": filtros.fecha_hasta.isoformat() if filtros.fecha_hasta else None,
            "departamento": filtros.departamento,
            "localidad": filtros.localidad,
            "origen": filtros.origen,
        }

    # ── Descarga ─────────────────────────────────────────────────────────────

    def exportar_reporte_agregado(self, filtros: FiltroEstadisticasQuery, formato: str) -> ArchivoExportado:
        """Mismo resumen en planilla Excel (.xlsx), en PDF o en CSV separado por punto y coma."""
        resumen = self.obtener_resumen_estadistico(filtros)
        sello = datetime.now(ART).strftime("%Y%m%d_%H%M")
        if formato == "pdf":
            pdf = generar_pdf_estadisticas(resumen.generado_en, self.secciones_reporte(resumen))
            return ArchivoExportado(pdf, f"estadisticas_apoyar_{sello}.pdf")
        if formato == "xlsx":
            return ArchivoExportado(self._xlsx(resumen), f"estadisticas_apoyar_{sello}.xlsx")
        return ArchivoExportado(self._csv(resumen).encode("utf-8-sig"), f"estadisticas_apoyar_{sello}.csv")

    @staticmethod
    def secciones_reporte(resumen: ResumenEstadisticasResponse) -> List[Tuple[str, List[str], List[List[Any]]]]:
        """Tablas del reporte (título, encabezados, filas), compartidas por el CSV y el PDF."""
        def valor(v: Any) -> Any:
            return "—" if v is None else v

        filtros = resumen.filtros
        return [
            ("Filtros aplicados", ["Filtro", "Valor"], [
                ["Desde", valor(filtros.get("fecha_desde"))], ["Hasta", valor(filtros.get("fecha_hasta"))],
                ["Departamento", valor(filtros.get("departamento"))], ["Localidad", valor(filtros.get("localidad"))],
                ["Activación", valor(filtros.get("origen"))],
            ]),
            ("Resumen", ["Indicador", "Valor"], [
                ["Emergencias registradas", resumen.total_incidentes],
                ["En curso", resumen.incidentes_en_curso],
                ["Cerradas", resumen.incidentes_cerrados],
                ["Personas que activaron el Modo Resguardo", resumen.victimas_distintas],
                ["Contactos de emergencia activos por persona (promedio)", valor(resumen.red_promedio_contactos)],
                ["Duración promedio hasta finalizar el Modo Resguardo (min)", valor(resumen.duracion_promedio_min)],
                ["Duración mediana (min)", valor(resumen.duracion_mediana_min)],
                ["Duración percentil 90 (min)", valor(resumen.duracion_p90_min)],
                ["Casos con hora de cierre", resumen.casos_con_duracion],
                ["Activación automática (%)", resumen.porcentaje_automatico],
                ["Activación manual (%)", resumen.porcentaje_manual],
                ["Sin ubicación determinada", resumen.sin_ubicacion],
            ]),
            ("Duración de las emergencias (de la activación al fin del Modo Resguardo)", ["Tramo", "Cantidad", "%"],
             [[d["tramo"], d["cantidad"], d["porcentaje"]] for d in resumen.distribucion_duracion]),
            ("Emergencias por modalidad de activación", ["Activación", "Cantidad", "%", "% nocturno (20 a 6 h)", "Duración promedio (min)"],
             [[o["etiqueta"], o["cantidad"], o["porcentaje"], o["porcentaje_nocturno"], valor(o["duracion_promedio_min"])]
              for o in resumen.por_origen]),
            ("Emergencias por mes", ["Mes", "Cantidad"], [[m["etiqueta"], m["cantidad"]] for m in resumen.serie_mensual]),
            ("Emergencias por día de la semana", ["Día", "Cantidad"], [[d["nombre"], d["cantidad"]] for d in resumen.por_dia_semana]),
            ("Emergencias por hora del día", ["Hora", "Cantidad"], [[f"{h['hora']:02d}:00", h["cantidad"]] for h in resumen.por_hora]),
            ("Emergencias por departamento", ["Departamento", "Cantidad", "%"],
             [[d["departamento"], d["cantidad"], d["porcentaje"]] for d in resumen.por_departamento]),
            ("Emergencias por localidad", ["Departamento", "Localidad", "Cantidad", "%"],
             [[l["departamento"], l["localidad"], l["cantidad"], l["porcentaje"]] for l in resumen.por_localidad]),
            ("Emergencias por barrio", ["Localidad", "Barrio", "Cantidad"],
             [[b["localidad"], b["barrio"], b["cantidad"]] for b in resumen.por_barrio]),
            ("Emergencias por edad de la víctima", ["Rango", "Cantidad", "%"],
             [[r["rango"], r["cantidad"], valor(r["porcentaje"])] for r in resumen.piramide_etaria]),
            ("Emergencias por género de la víctima", ["Género", "Cantidad", "%"], [[g["nombre"], g["cantidad"], g["porcentaje"]] for g in resumen.por_genero]),
            ("Red de apoyo: parentesco de los contactos", ["Parentesco", "Cantidad", "%"],
             [[v["nombre"], v["cantidad"], v["porcentaje"]] for v in resumen.vinculos_red_apoyo]),
        ]

    def _csv(self, resumen: ResumenEstadisticasResponse) -> str:
        salida = io.StringIO()
        escritor = csv.writer(salida, delimiter=";", lineterminator="\r\n")
        escritor.writerow(["ApoyAR - Estadísticas de emergencias (Modo Resguardo)"])
        escritor.writerow([f"Generado el {resumen.generado_en}. Sin datos personales ni evidencias (Ley 25.326)."])
        for titulo, encabezados, filas in self.secciones_reporte(resumen):
            escritor.writerow([])
            escritor.writerow([titulo])
            escritor.writerow(encabezados)
            escritor.writerows([[str(c).replace(".", ",") if isinstance(c, float) else c for c in fila] for fila in filas])
        return salida.getvalue()

    def _xlsx(self, resumen: ResumenEstadisticasResponse) -> bytes:
        """
        Planilla Excel con formato: una hoja de resumen y una hoja por tabla, con
        encabezados, filtros de columna, porcentajes como porcentaje y gráficos de
        barras en las series de tiempo, territorio y edad.
        """
        # Se importa acá para que el resto del backend funcione aunque falte la dependencia
        from openpyxl import Workbook
        from openpyxl.chart import BarChart, Reference
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.table import Table, TableStyleInfo

        azul, gris = "1E3A8A", "475569"
        borde = Border(*(Side(style="thin", color="CBD5E1"),) * 4)
        hojas = {
            "Duración de las emergencias (de la activación al fin del Modo Resguardo)": "Duración",
            "Emergencias por modalidad de activación": "Activación",
            "Emergencias por mes": "Por mes",
            "Emergencias por día de la semana": "Por día",
            "Emergencias por hora del día": "Por hora",
            "Emergencias por departamento": "Departamentos",
            "Emergencias por localidad": "Localidades",
            "Emergencias por barrio": "Barrios",
            "Emergencias por edad de la víctima": "Edad",
            "Emergencias por género de la víctima": "Género",
            "Red de apoyo: parentesco de los contactos": "Red de apoyo",
        }
        con_grafico = {"Por mes", "Por día", "Por hora", "Departamentos", "Edad"}
        generado = _parse_fecha(resumen.generado_en)
        fecha_texto = generado.astimezone(ART).strftime("%d/%m/%Y %H:%M") if generado else resumen.generado_en

        def celda_valor(encabezado: str, valor: Any) -> Tuple[Any, Optional[str]]:
            if valor in (None, "—"):
                return None, None
            if isinstance(valor, (int, float)) and "%" in encabezado:
                return valor / 100, "0.0%"
            if isinstance(valor, float):
                return valor, "0.0"
            return valor, None

        def encabezado_de_hoja(hoja, titulo: str) -> None:
            hoja["A1"] = titulo
            hoja["A1"].font = Font(bold=True, size=14, color=azul)
            hoja["A2"] = f"ApoyAR · Generado el {fecha_texto} (hora argentina) · Totales sin datos personales ni evidencias (Ley 25.326)"
            hoja["A2"].font = Font(italic=True, size=9, color=gris)
            hoja.sheet_view.showGridLines = False

        def escribir_tabla(hoja, fila: int, encabezados: List[str], filas: List[List[Any]], nombre: Optional[str]) -> int:
            for c, texto in enumerate(encabezados, start=1):
                celda = hoja.cell(row=fila, column=c, value=texto)
                celda.font = Font(bold=True, color="FFFFFF")
                celda.fill = PatternFill("solid", fgColor=azul)
                celda.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                celda.border = borde
            for r, datos in enumerate(filas, start=fila + 1):
                for c, (texto, valor) in enumerate(zip(encabezados, datos), start=1):
                    contenido, formato = celda_valor(texto, valor)
                    celda = hoja.cell(row=r, column=c, value=contenido)
                    celda.border = borde
                    if formato:
                        celda.number_format = formato
                    if isinstance(contenido, (int, float)):
                        celda.alignment = Alignment(horizontal="right")
            ultima = fila + max(1, len(filas))
            if nombre and filas:
                tabla = Table(displayName=nombre, ref=f"A{fila}:{get_column_letter(len(encabezados))}{ultima}")
                tabla.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
                hoja.add_table(tabla)
            return ultima

        def ajustar_columnas(hoja) -> None:
            for columna in hoja.iter_cols(min_row=4):
                largo = max((len(str(c.value)) for c in columna if c.value is not None), default=8)
                hoja.column_dimensions[columna[0].column_letter].width = min(48, max(12, largo + 3))

        libro = Workbook()
        secciones = self.secciones_reporte(resumen)

        # Hoja de resumen: filtros aplicados e indicadores principales
        portada = libro.active
        portada.title = "Resumen"
        encabezado_de_hoja(portada, "ApoyAR · Estadísticas de emergencias (Modo Resguardo)")
        portada["A1"].font = Font(bold=True, size=16, color=azul)
        fila = 4
        for titulo, encabezados, filas in secciones[:2]:
            portada.cell(row=fila, column=1, value=titulo).font = Font(bold=True, size=12, color=azul)
            fila = escribir_tabla(portada, fila + 1, encabezados, filas, None) + 2
        portada.column_dimensions["A"].width = 58
        portada.column_dimensions["B"].width = 18

        # Una hoja por tabla
        for n, (titulo, encabezados, filas) in enumerate(secciones[2:], start=1):
            nombre_hoja = hojas.get(titulo, titulo[:31])
            hoja = libro.create_sheet(nombre_hoja)
            encabezado_de_hoja(hoja, titulo)
            if not filas:
                hoja["A4"] = "Sin datos para los filtros elegidos."
                continue
            ultima = escribir_tabla(hoja, 4, encabezados, filas, f"Tabla{n}")
            hoja.freeze_panes = "A5"
            ajustar_columnas(hoja)
            if nombre_hoja in con_grafico:
                columna = encabezados.index("Cantidad") + 1
                grafico = BarChart()
                grafico.type = "col" if nombre_hoja != "Departamentos" else "bar"
                grafico.title = titulo
                grafico.legend = None
                grafico.height, grafico.width = 8, 16
                grafico.add_data(Reference(hoja, min_col=columna, min_row=5, max_row=ultima), titles_from_data=False)
                grafico.set_categories(Reference(hoja, min_col=1, min_row=5, max_row=ultima))
                grafico.series[0].graphicalProperties.solidFill = "2A78D6"
                grafico.series[0].graphicalProperties.line.solidFill = "2A78D6"
                hoja.add_chart(grafico, f"{get_column_letter(len(encabezados) + 2)}4")

        salida = io.BytesIO()
        libro.save(salida)
        return salida.getvalue()
