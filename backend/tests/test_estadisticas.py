# backend/tests/test_estadisticas.py
# Estadísticas anónimas de emergencias (RF-4.4 / CU-11): cálculos, anonimato,
# descarga y permiso incidente.estadisticas. Todo corre sobre el Supabase falso.

import datetime
import unittest

import httpx
import jwt

from app import dependencies
from app.config import settings
from app.errors import SolicitudInvalidaError
from app.main import app
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.admin import FiltroEstadisticasQuery
from app.services import auth_dependencies
from app.services.estadistica_service import EstadisticaService
from app.services.roles import PERMISOS_INSTITUCIONALES, PERMISOS_POR_DEFECTO, es_operador_institucional
from tests.fake_supabase import FakeClient, FakeDB

VICTIMA_A = "11111111-1111-4111-8111-111111111111"
VICTIMA_B = "22222222-2222-4222-8222-222222222222"
ANALISTA = "33333333-3333-4333-8333-333333333333"
CLAVE = "clave-de-prueba-estadisticas-apoyar-2026"


def incidente(id_, victima, fecha, origen="manual", estado="cerrado", lat=-26.1849, lon=-58.1731, direccion=None):
    return {
        "inc_id_incidente": id_, "usu_id_victima": victima, "inc_victima_nombre": "Nombre Real",
        "inc_notas": "nota privada", "inc_latitud": lat, "inc_longitud": lon,
        "inc_direccion": direccion, "inc_direccion_aprox": direccion, "inc_origen": origen,
        "inc_estado": estado, "inc_fecha_hora": fecha,
    }


def cierre(id_, fecha):
    return {"inc_id_incidente": id_, "hisinc_estado_anterior": "en_curso", "hisinc_estado_nuevo": "cerrado", "hisinc_creado_en": fecha}


def base_de_prueba():
    db = FakeDB()
    db.tables["incidente"] = [
        # Formosa capital, 22:10 hora argentina, 20 minutos
        incidente("i1", VICTIMA_A, "2026-03-07T01:10:00+00:00", "automatico",
                  direccion="B° Eva Perón, Formosa, Departamento Formosa, Formosa"),
        # Clorinda por texto, 14:00 hora argentina, 50 minutos
        incidente("i2", VICTIMA_B, "2026-03-10T17:00:00+00:00", "manual", lat=-25.2813, lon=-57.7206,
                  direccion="B° 1ro de Mayo (Zona 3), Clorinda, Departamento Pilcomayo, Formosa"),
        # Las Lomitas solo por coordenadas, sigue en curso
        incidente("i3", VICTIMA_A, "2026-05-01T03:00:00+00:00", "automatico", estado="en_curso", lat=-24.71, lon=-60.59),
        # Cuenta suprimida: sin víctima ni ubicación
        incidente("i4", None, "2026-05-02T12:00:00+00:00", "manual", lat=0, lon=0),
    ]
    db.tables["historial_incidente"] = [
        cierre("i1", "2026-03-07T01:20:00+00:00"),
        cierre("i1", "2026-03-07T01:30:00+00:00"),  # vale el último cierre
        cierre("i2", "2026-03-10T17:50:00+00:00"),
    ]
    db.tables["usuario"] = [
        {"usu_id_usuario": VICTIMA_A, "per_id_persona": "pa",
         "persona": {"per_nombre": "Ana", "per_dni": "30111222", "per_fecha_nacimiento": "1992-04-14", "per_genero": "Femenino"}},
        {"usu_id_usuario": VICTIMA_B, "per_id_persona": "pb",
         "persona": {"per_nombre": "Bea", "per_dni": "40111222", "per_fecha_nacimiento": "2005-02-18", "per_genero": "Femenino"}},
    ]
    db.tables["red_apoyo"] = [
        {"usu_id_victima": VICTIMA_A, "usu_id_contacto": VICTIMA_B, "redapo_parentesco": "hermana", "redapo_estado": "activo"},
        {"usu_id_victima": VICTIMA_A, "usu_id_contacto": ANALISTA, "redapo_parentesco": None, "redapo_estado": "activo"},
        {"usu_id_victima": VICTIMA_B, "usu_id_contacto": VICTIMA_A, "redapo_parentesco": "Vecina", "redapo_estado": "inactivo"},
    ]
    return db


def servicio(db):
    cliente = FakeClient(db)
    return EstadisticaService(IncidenteRepository(cliente), UsuarioRepository(cliente), RedApoyoRepository(cliente))


class ResumenEstadisticoTest(unittest.TestCase):

    def setUp(self):
        self.resumen = servicio(base_de_prueba()).obtener_resumen_estadistico(FiltroEstadisticasQuery())

    def test_totales_y_duracion_desde_el_historial(self):
        r = self.resumen
        self.assertEqual((r.total_incidentes, r.incidentes_en_curso, r.incidentes_cerrados), (4, 1, 3))
        self.assertEqual(r.victimas_distintas, 2)
        # i1 dura 20 min (último cierre) e i2 50 min; i4 no tiene cierre en el historial
        self.assertEqual(r.casos_con_duracion, 2)
        self.assertEqual(r.duracion_promedio_min, 35.0)
        self.assertEqual(r.duracion_mediana_min, 35.0)
        tramos = {t["tramo"]: t["cantidad"] for t in r.distribucion_duracion}
        self.assertEqual((tramos["10 a 29 min"], tramos["30 a 59 min"]), (1, 1))

    def test_origen_cruzado_con_la_noche(self):
        r = self.resumen
        self.assertEqual((r.porcentaje_automatico, r.porcentaje_manual), (50.0, 50.0))
        automatico = next(o for o in r.por_origen if o["origen"] == "automatico")
        # 22:10 y 00:00 hora argentina: los dos son nocturnos
        self.assertEqual((automatico["cantidad"], automatico["porcentaje_nocturno"], automatico["duracion_promedio_min"]), (2, 100.0, 20.0))

    def test_horario_en_hora_argentina_y_meses_consecutivos(self):
        r = self.resumen
        horas = {h["hora"]: h["cantidad"] for h in r.por_hora}
        self.assertEqual((horas[22], horas[14], horas[0], horas[9]), (1, 1, 1, 1))
        self.assertEqual([m["mes"] for m in r.serie_mensual], ["2026-03", "2026-04", "2026-05"])
        self.assertEqual([m["cantidad"] for m in r.serie_mensual], [2, 0, 2])
        self.assertEqual(sum(c["cantidad"] for c in r.matriz_horaria), 4)

    def test_territorio_por_texto_y_por_coordenadas(self):
        r = self.resumen
        departamentos = {d["departamento"]: d for d in r.por_departamento}
        self.assertEqual(departamentos["Formosa"]["cantidad"], 1)
        self.assertEqual(departamentos["Pilcomayo"]["cantidad"], 1)
        self.assertEqual(departamentos["Patiño"]["cantidad"], 1)
        self.assertEqual(r.sin_ubicacion, 1)
        localidades = {l["localidad"] for l in r.por_localidad}
        self.assertTrue({"Formosa", "Clorinda", "Las Lomitas"} <= localidades)
        # El barrio sale de OpenStreetMap por coordenadas, no del texto de la dirección
        self.assertIn({"localidad": "Clorinda", "barrio": "Libertad", "cantidad": 1}, r.por_barrio)

    def test_mapa_de_calor_en_celdas_sin_coordenadas_exactas(self):
        puntos = self.resumen.puntos_calor
        self.assertEqual(sum(p["cantidad"] for p in puntos), 3)  # el (0, 0) no entra
        for p in puntos:
            self.assertAlmostEqual(p["lat"] / 0.005, round(p["lat"] / 0.005), places=6)
        self.assertNotIn(-25.2813, [p["lat"] for p in puntos])
        self.assertIn(-25.28, [p["lat"] for p in puntos])

    def test_edad_al_momento_del_incidente_por_rangos(self):
        rangos = {r["rango"]: r for r in self.resumen.piramide_etaria}
        # Ana (nacida en 1992) tiene 33 años en sus dos emergencias; Bea (2005) tiene 21
        self.assertEqual(rangos["30-39"]["cantidad"], 2)
        self.assertEqual(rangos["22-29"]["cantidad"], 0)
        self.assertEqual(rangos["30-39"]["porcentaje"], 66.7)
        self.assertEqual(rangos["18-21"]["cantidad"], 1)
        self.assertEqual(rangos["Sin dato"]["cantidad"], 1)

    def test_incidente_de_cuenta_eliminada_conserva_rango_y_genero(self):
        db = FakeDB()
        db.tables["incidente"] = [
            dict(incidente("a1", None, "2026-04-01T12:00:00+00:00"), inc_notas="[Anonimizado] Edad: 30-39 · Género: No binario"),
            dict(incidente("a2", None, "2026-04-02T12:00:00+00:00"), inc_notas="[Anonimizado] Edad: Sin dato · Género: Sin dato"),
        ]
        r = servicio(db).obtener_resumen_estadistico(FiltroEstadisticasQuery())
        rangos = {x["rango"]: x["cantidad"] for x in r.piramide_etaria}
        generos = {g["nombre"]: g["cantidad"] for g in r.por_genero}
        self.assertEqual((rangos["30-39"], rangos["Sin dato"]), (1, 1))
        self.assertEqual((generos["No binario"], generos["Sin dato"]), (1, 1))
        self.assertNotIn("Anonimizado", r.model_dump_json())

    def test_genero_muestra_todas_las_opciones(self):
        generos = {g["nombre"]: g["cantidad"] for g in self.resumen.por_genero}
        self.assertEqual(list(generos), ["Femenino", "Masculino", "No binario", "Sin dato"])
        self.assertEqual((generos["Femenino"], generos["No binario"], generos["Sin dato"]), (3, 0, 1))
        self.assertEqual(EstadisticaService._genero("no-binario"), "No binario")
        self.assertEqual(EstadisticaService._genero("No especificado"), "Sin dato")

    def test_red_de_apoyo_solo_vinculos_activos(self):
        r = self.resumen
        self.assertEqual({v["nombre"]: v["cantidad"] for v in r.vinculos_red_apoyo}, {"Hermana": 1, "Sin especificar": 1})
        self.assertEqual(r.red_promedio_contactos, 1.0)

    def test_no_expone_datos_personales(self):
        texto = self.resumen.model_dump_json()
        for dato in ("Nombre Real", "nota privada", "30111222", "Ana", VICTIMA_A, "i1", "1992-04-14"):
            self.assertNotIn(dato, texto)


class UbicacionPorCoordenadasTest(unittest.TestCase):
    """Departamento por los polígonos oficiales (IGN) y localidad oficial más cercana (Georef)."""

    def ubicar(self, lat, lon, direccion=None):
        return servicio(FakeDB())._ubicar({"inc_latitud": lat, "inc_longitud": lon, "inc_direccion": direccion})

    def test_las_coordenadas_mandan_sobre_el_texto(self):
        # La dirección dice Clorinda, pero el punto está en El Colorado (Pirané)
        ubicacion = self.ubicar(-26.3083, -59.3728, "Calle 1, Clorinda, Departamento Pilcomayo, Formosa")
        self.assertEqual((ubicacion["departamento"], ubicacion["localidad"]), ("Pirané", "El Colorado"))

    def test_lejos_de_toda_localidad_es_zona_rural(self):
        self.assertEqual(self.ubicar(-25.5, -59.0)["localidad"], "Zona rural")

    def test_fuera_de_la_provincia_o_sin_gps_usa_el_texto(self):
        self.assertEqual(self.ubicar(-27.5, -58.9)["departamento"], "Sin dato")
        sin_gps = self.ubicar(0, 0, "Avenida San Martín 10, Laguna Blanca")
        self.assertEqual((sin_gps["departamento"], sin_gps["localidad"]), ("Pilcomayo", "Laguna Blanca"))


class BarrioPorCoordenadasTest(unittest.TestCase):
    """Barrio de OpenStreetMap: el polígono que contiene el punto o el punto con nombre más cercano (600 m)."""

    def barrio(self, lat, lon, direccion=None):
        return servicio(FakeDB())._ubicar({"inc_latitud": lat, "inc_longitud": lon, "inc_direccion": direccion})["barrio"]

    def test_las_coordenadas_mandan_sobre_el_texto(self):
        # La dirección dice 1ro de Mayo, pero el punto de Clorinda está en el barrio Libertad según OSM
        self.assertEqual(self.barrio(-25.2813, -57.7206, "B° 1ro de Mayo (Zona 3), Clorinda"), "Libertad")

    def test_lejos_de_todo_barrio_usa_la_direccion(self):
        self.assertEqual(self.barrio(-26.2249, -58.2131, "Avenida Gutnisky 3200, San Pedro, Formosa"), "San Pedro")
        self.assertIsNone(self.barrio(-25.5, -59.0))


class BarrioDesdeGeocodificacionTest(unittest.TestCase):
    """Sin barrio de OSM cerca: 'Calle Nro, Barrio, Ciudad' (OpenStreetMap) o 'Calle Nro, Ciudad' (sin barrio)."""

    def barrios(self, *direcciones):
        db = FakeDB()
        # Punto de Formosa capital sin barrios de OpenStreetMap a menos de 600 m
        db.tables["incidente"] = [
            incidente(f"b{n}", None, "2026-04-01T12:00:00+00:00", lat=-26.2249, lon=-58.2131, direccion=d)
            for n, d in enumerate(direcciones)
        ]
        return servicio(db).obtener_resumen_estadistico(FiltroEstadisticasQuery()).por_barrio

    def test_toma_el_barrio_que_va_antes_de_la_ciudad(self):
        self.assertEqual(self.barrios("Avenida Gutnisky 3200, San Pedro, Formosa"),
                         [{"localidad": "Formosa", "barrio": "San Pedro", "cantidad": 1}])

    def test_unifica_barrio_con_y_sin_prefijo(self):
        resultado = self.barrios("Calle 12 450, Barrio San Miguel, Formosa", "B° San Miguel, Formosa, Departamento Formosa, Formosa")
        self.assertEqual(resultado, [{"localidad": "Formosa", "barrio": "San Miguel", "cantidad": 2}])

    def test_sin_barrio_en_la_direccion(self):
        self.assertEqual(self.barrios("Avenida 25 de Mayo 120, Formosa", "-26.18490, -58.17310"), [])


class FiltrosEstadisticosTest(unittest.TestCase):

    def test_filtra_por_fecha_origen_y_zona(self):
        s = servicio(base_de_prueba())
        marzo = s.obtener_resumen_estadistico(FiltroEstadisticasQuery(fecha_desde="2026-03-01", fecha_hasta="2026-03-31"))
        self.assertEqual(marzo.total_incidentes, 2)
        # 22:10 del 6 de marzo en Argentina: el día 6 lo incluye aunque en UTC sea el 7
        dia_6 = s.obtener_resumen_estadistico(FiltroEstadisticasQuery(fecha_desde="2026-03-06", fecha_hasta="2026-03-06"))
        self.assertEqual(dia_6.total_incidentes, 1)
        automaticos = s.obtener_resumen_estadistico(FiltroEstadisticasQuery(origen="automatico"))
        self.assertEqual(automaticos.total_incidentes, 2)
        pilcomayo = s.obtener_resumen_estadistico(FiltroEstadisticasQuery(departamento="pilcomayo"))
        self.assertEqual(pilcomayo.total_incidentes, 1)
        lomitas = s.obtener_resumen_estadistico(FiltroEstadisticasQuery(localidad="Las Lomitas"))
        self.assertEqual(lomitas.total_incidentes, 1)

    def test_sin_resultados_devuelve_ceros(self):
        r = servicio(FakeDB()).obtener_resumen_estadistico(FiltroEstadisticasQuery())
        self.assertEqual((r.total_incidentes, r.duracion_promedio_min, r.porcentaje_manual, r.serie_mensual), (0, None, 0.0, []))

    def test_rango_de_fechas_invertido(self):
        with self.assertRaises(SolicitudInvalidaError):
            servicio(FakeDB()).obtener_resumen_estadistico(FiltroEstadisticasQuery(fecha_desde="2026-05-01", fecha_hasta="2026-04-01"))

    def test_lee_mas_de_mil_incidentes_por_lotes(self):
        db = FakeDB()
        db.tables["incidente"] = [incidente(f"x{n:04d}", None, f"2026-01-01T{n % 24:02d}:00:00+00:00") for n in range(1203)]
        self.assertEqual(servicio(db).obtener_resumen_estadistico(FiltroEstadisticasQuery()).total_incidentes, 1203)


class ExportacionEstadisticaTest(unittest.TestCase):

    def test_csv_con_secciones_y_sin_datos_personales(self):
        archivo = servicio(base_de_prueba()).exportar_reporte_agregado(FiltroEstadisticasQuery(), "csv")
        texto = archivo.contenido.decode("utf-8-sig")
        self.assertTrue(archivo.nombre_archivo.endswith(".csv"))
        for seccion in ("Resumen", "Emergencias por departamento", "Emergencias por edad de la víctima", "Personas que activaron"):
            self.assertIn(seccion, texto)
        self.assertIn("Duración promedio hasta finalizar el Modo Resguardo (min);35,0", texto)
        self.assertNotIn("Hestia", texto)
        self.assertNotIn("Nombre Real", texto)

    def test_excel_con_hojas_formato_y_graficos(self):
        import io
        from openpyxl import load_workbook

        archivo = servicio(base_de_prueba()).exportar_reporte_agregado(FiltroEstadisticasQuery(), "xlsx")
        self.assertTrue(archivo.nombre_archivo.endswith(".xlsx"))
        libro = load_workbook(io.BytesIO(archivo.contenido))
        self.assertEqual(libro.sheetnames[:4], ["Resumen", "Duración", "Activación", "Por mes"])
        self.assertEqual(libro["Resumen"]["A1"].value, "ApoyAR · Estadísticas de emergencias (Modo Resguardo)")
        self.assertEqual(libro["Por mes"]["A1"].value, "Emergencias por mes")
        departamentos = libro["Departamentos"]
        self.assertEqual(departamentos["C5"].number_format, "0.0%")
        self.assertLessEqual(departamentos["C5"].value, 1)
        self.assertEqual(len(departamentos._charts), 1)
        texto = " ".join(str(c.value) for hoja in libro for fila in hoja.iter_rows() for c in fila if c.value is not None)
        self.assertNotIn("Nombre Real", texto)

    def test_pdf(self):
        archivo = servicio(base_de_prueba()).exportar_reporte_agregado(FiltroEstadisticasQuery(), "pdf")
        self.assertTrue(archivo.contenido.startswith(b"%PDF"))
        self.assertTrue(archivo.nombre_archivo.endswith(".pdf"))


class PermisoEstadisticasTest(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        auth_dependencies.configurar_clave_test(CLAVE, "HS256")
        self.db = base_de_prueba()
        app.dependency_overrides[dependencies.get_supabase_client] = lambda: FakeClient(self.db)

    def tearDown(self):
        app.dependency_overrides.clear()
        auth_dependencies.configurar_clave_test(None, None)

    def asignar_perfil(self, nombre, permisos):
        self.db.tables["usuario_tiene_perfil"] = [{
            "usu_id_usuario": ANALISTA, "prf_id_perfil": "p1", "usuprf_estado_aprobacion": "activo",
            "perfil": {"prf_nombre": nombre, "prf_activo": True, "prf_tipo": "institucional",
                       "perfil_tiene_permiso": [{"permiso": {"prm_nombre": p}} for p in permisos]},
        }]

    async def solicitar(self, ruta):
        ahora = datetime.datetime.now(datetime.timezone.utc)
        token = jwt.encode({"sub": ANALISTA, "aud": "authenticated", "iss": settings.jwt_issuer,
                            "exp": int(ahora.timestamp()) + 600}, CLAVE, algorithm="HS256")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as cliente:
            return await cliente.get(ruta, headers={"Authorization": f"Bearer {token}"})

    async def test_perfil_analista_solo_con_el_permiso_de_estadisticas(self):
        self.asignar_perfil("Analista Estadístico", ["incidente.estadisticas"])
        resp = await self.solicitar("/api/v1/admin/estadisticas/resumen?origen=manual")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["total_incidentes"], 2)
        # El mismo perfil no ve el listado de casos
        self.assertEqual((await self.solicitar("/api/v1/autoridad/incidentes")).status_code, 403)

    async def test_sin_permiso_403(self):
        self.asignar_perfil("Mesa de Entradas", ["incidente.monitorear"])
        resp = await self.solicitar("/api/v1/admin/estadisticas/resumen")
        self.assertEqual(resp.status_code, 403)
        self.assertIn("incidente.estadisticas", resp.json()["detail"])

    async def test_descarga_csv_y_errores_de_entrada(self):
        self.asignar_perfil("Analista Estadístico", ["incidente.estadisticas"])
        resp = await self.solicitar("/api/v1/admin/estadisticas/exportar?formato=csv&departamento=Formosa")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("attachment; filename=\"estadisticas_apoyar_", resp.headers["content-disposition"])
        self.assertEqual((await self.solicitar("/api/v1/admin/estadisticas/exportar?formato=xls")).status_code, 422)
        self.assertEqual((await self.solicitar("/api/v1/admin/estadisticas/resumen?origen=otro")).status_code, 422)
        invertido = await self.solicitar("/api/v1/admin/estadisticas/resumen?fecha_desde=2026-05-01&fecha_hasta=2026-04-01")
        self.assertEqual(invertido.status_code, 400)

    def test_permiso_institucional_y_perfiles_de_sistema(self):
        self.assertIn("incidente.estadisticas", PERMISOS_INSTITUCIONALES)
        self.assertIn("incidente.estadisticas", PERMISOS_POR_DEFECTO["Administrador"])
        self.assertIn("incidente.estadisticas", PERMISOS_POR_DEFECTO["Autoridad"])
        self.assertTrue(es_operador_institucional({"permisos": ["incidente.estadisticas"]}))


if __name__ == "__main__":
    unittest.main()


class ValidarRegistroTest(unittest.IsolatedAsyncioTestCase):
    """POST /api/v1/usuarios/validar-registro: la app móvil comprueba correo, DNI y teléfono antes de registrar."""

    def setUp(self):
        self.db = FakeDB()
        self.db.tables["usuario"] = [{"usu_id_usuario": VICTIMA_A, "usu_email": "ana@correo.test", "per_id_persona": "pa"}]
        self.db.tables["persona"] = [{"per_id_persona": "pa", "per_dni": "30111222", "per_telefono": "3704123456",
                                      "usuario": [{"usu_id_usuario": VICTIMA_A}]}]
        app.dependency_overrides[dependencies.get_supabase_client] = lambda: FakeClient(self.db)
        self.secreto_original = settings.api_secret_key
        settings.api_secret_key = "secreto-de-prueba"

    def tearDown(self):
        app.dependency_overrides.clear()
        settings.api_secret_key = self.secreto_original

    async def validar(self, cuerpo, secreto="secreto-de-prueba"):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as cliente:
            return await cliente.post("/api/v1/usuarios/validar-registro", json=cuerpo, headers={"X-Api-Secret": secreto} if secreto else {})

    async def test_detecta_correo_dni_y_telefono_en_uso(self):
        resp = await self.validar({"email": "ANA@correo.test", "dni": "30111222", "telefono": "3704123456"})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["disponible"])
        self.assertEqual(set(resp.json()["errores"]), {"email", "dni", "telefono"})
        self.assertIn("iniciá sesión", resp.json()["errores"]["email"])

    async def test_datos_libres(self):
        resp = await self.validar({"email": "nueva@correo.test", "dni": "40999888", "telefono": "3704999888"})
        self.assertEqual(resp.json(), {"disponible": True, "errores": {}})

    async def test_exige_api_secret(self):
        self.assertEqual((await self.validar({"dni": "30111222"}, secreto=None)).status_code, 401)
        self.assertEqual((await self.validar({"dni": "30111222"}, secreto="otro")).status_code, 401)
