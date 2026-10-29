# backend/tests/test_services.py
# Servicios de negocio con repositorios sobre el cliente Supabase falso.

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.errors import AccesoDenegadoError, RecursoNoEncontradoError, SolicitudInvalidaError
from app.repositories.alerta_temprana_repository import AlertaTempranaRepository
from app.repositories.auditoria_exportacion_repository import AuditoriaExportacionRepository
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.incidentes import ActivarIncidenteRequest, ActualizarPosicionRequest
from app.services.access_control import AccessControlService
from app.services.alerta_service import AlertaService
from app.services.export_service import ExportService
from app.services.exportacion_forense_service import ExportacionForenseService
from app.services.incidente_service import IncidenteService
from app.services.push_notifications import EXPO_PUSH_API_URL, ExpoPushNotifier
from app.services.roles import rol_actor_auditoria
from tests.fake_supabase import FakeClient, FakeDB

VICTIMA = "11111111-1111-4111-8111-111111111111"
OTRA = "22222222-2222-4222-8222-222222222222"
CONTACTO = "33333333-3333-4333-8333-333333333333"
AUTORIDAD = "44444444-4444-4444-8444-444444444444"
INCIDENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
EVIDENCIA = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1"


def base_de_datos(consentimiento=False, estado="en_curso"):
    db = FakeDB()
    db.tables["incidente"] = [{
        "inc_id_incidente": INCIDENTE, "usu_id_victima": VICTIMA, "inc_estado": estado, "inc_origen": "manual",
        "inc_latitud": -26.1, "inc_longitud": -58.1, "inc_consentimiento_exportacion": consentimiento,
        "inc_fecha_consentimiento": None, "inc_victima_nombre": "Tu contacto",
    }]
    db.tables["evidencia"] = [{
        "evi_id_evidencia": EVIDENCIA, "inc_id_incidente": INCIDENTE, "usu_id_usuario": VICTIMA,
        "evi_consentimiento_exportacion": True, "evi_hash_sha256": "a" * 64,
    }]
    db.tables["red_apoyo"] = [
        {"usu_id_victima": VICTIMA, "usu_id_contacto": CONTACTO, "redapo_estado": "activo"},
        {"usu_id_victima": VICTIMA, "usu_id_contacto": VICTIMA, "redapo_estado": "activo"},
    ]
    db.tables["dispositivo_usuario"] = [{"usu_id_usuario": CONTACTO, "disusu_expo_push_token": "ExponentPushToken[c]", "disusu_activo": True}]
    db.tables["cargo_institucional"] = [{"usu_id_usuario": AUTORIDAD, "carins_activo": True}]
    db.tables["usuario"] = [{"usu_id_usuario": VICTIMA, "per_id_persona": "p1", "persona": {"per_nombre": "Ana", "per_apellido": "Pérez"}}]
    return db


def control_de_acceso(client):
    return AccessControlService(IncidenteRepository(client), EvidenciaRepository(client),
                                RedApoyoRepository(client), CargoInstitucionalRepository(client))


class AccessControlServiceTest(unittest.TestCase):

    def setUp(self):
        self.acceso = control_de_acceso(FakeClient(base_de_datos()))

    def test_titular_accede_a_su_incidente(self):
        incidente = self.acceso.verificar_acceso_incidente(INCIDENTE, {"id": VICTIMA, "roles": ["Víctima"]})
        self.assertEqual(incidente["victima_id"], VICTIMA)

    def test_idor_otra_victima_no_accede(self):
        with self.assertRaises(AccesoDenegadoError):
            self.acceso.verificar_acceso_incidente(INCIDENTE, {"id": OTRA, "roles": ["Víctima"]})

    def test_contacto_activo_lee_incidente_en_curso_pero_no_evidencias(self):
        contacto = {"id": CONTACTO, "roles": ["Contacto"]}
        self.acceso.verificar_acceso_incidente(INCIDENTE, contacto)
        with self.assertRaises(AccesoDenegadoError):
            self.acceso.verificar_acceso_evidencia(EVIDENCIA, contacto)

    def test_solo_la_victima_transmite_telemetria(self):
        with self.assertRaises(AccesoDenegadoError):
            self.acceso.verificar_acceso_incidente(INCIDENTE, {"id": AUTORIDAD, "roles": ["Autoridad"]}, "update_posicion")

    def test_administrador_puro_sin_acceso_a_evidencias(self):
        with self.assertRaises(AccesoDenegadoError):
            self.acceso.verificar_acceso_evidencia(EVIDENCIA, {"id": OTRA, "roles": ["Administrador"]})

    def test_autoridad_audita_metadatos_pero_reproduce_solo_con_consentimiento(self):
        autoridad = {"id": AUTORIDAD, "roles": ["Autoridad"]}
        self.acceso.verificar_acceso_evidencia(EVIDENCIA, autoridad, "audit")
        with self.assertRaises(AccesoDenegadoError):
            self.acceso.verificar_acceso_evidencia(EVIDENCIA, autoridad, "play")

    def test_uuid_invalido_y_recurso_inexistente(self):
        with self.assertRaises(SolicitudInvalidaError):
            self.acceso.verificar_acceso_incidente("no-es-uuid", {"id": VICTIMA, "roles": []})
        with self.assertRaises(RecursoNoEncontradoError):
            self.acceso.verificar_acceso_evidencia("99999999-9999-4999-8999-999999999999", {"id": VICTIMA, "roles": []})


class ExpoPushNotifierTest(unittest.IsolatedAsyncioTestCase):

    async def test_envia_cada_alerta_a_la_expo_push_api_y_tolera_fallos(self):
        respuesta_ok = MagicMock(raise_for_status=MagicMock(), json=MagicMock(return_value={"data": {"status": "ok"}}))
        cliente_http = MagicMock()
        cliente_http.post = AsyncMock(side_effect=[respuesta_ok, RuntimeError("timeout")])
        cliente_http.__aenter__ = AsyncMock(return_value=cliente_http)
        cliente_http.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.push_notifications.httpx.AsyncClient", return_value=cliente_http):
            resultados = await ExpoPushNotifier().desencadenar_alertas_incidente(
                INCIDENTE, VICTIMA, -26.1, -58.1, ["ExponentPushToken[a]", "ExponentPushToken[b]"])

        self.assertEqual([r["ok"] for r in resultados], [True, False])
        url, kwargs = cliente_http.post.call_args_list[0].args[0], cliente_http.post.call_args_list[0].kwargs
        self.assertEqual(url, EXPO_PUSH_API_URL)
        self.assertEqual(kwargs["json"]["to"], "ExponentPushToken[a]")
        self.assertEqual(kwargs["json"]["data"]["tipo"], "sos_activado")
        self.assertEqual(kwargs["json"]["priority"], "high")


class AlertaServiceTest(unittest.IsolatedAsyncioTestCase):

    async def test_registra_alertas_sin_incluir_a_la_victima_y_despacha_push(self):
        db = base_de_datos()
        client = FakeClient(db)
        notificador = MagicMock()
        notificador.desencadenar_alertas_incidente = AsyncMock(return_value=[])
        servicio = AlertaService(RedApoyoRepository(client), AlertaTempranaRepository(client), notificador)

        resultado = servicio.desencadenar_alertas(INCIDENTE, VICTIMA, -26.1, -58.1)
        await asyncio.sleep(0)

        self.assertEqual(resultado, {"alertas_encoladas": 1})
        self.assertEqual([a["usu_id_contacto"] for a in db.tables["alerta_temprana"]], [CONTACTO])
        notificador.desencadenar_alertas_incidente.assert_awaited_once()
        self.assertEqual(notificador.desencadenar_alertas_incidente.call_args.kwargs["tokens_contactos"], ["ExponentPushToken[c]"])

    async def test_sin_contactos_no_registra_ni_notifica(self):
        db = base_de_datos()
        db.tables["red_apoyo"] = []
        client = FakeClient(db)
        notificador = MagicMock()
        servicio = AlertaService(RedApoyoRepository(client), AlertaTempranaRepository(client), notificador)
        self.assertEqual(servicio.desencadenar_alertas(INCIDENTE, VICTIMA, 0, 0)["detalle"], "Sin contactos activos.")
        self.assertNotIn("alerta_temprana", db.tables)


class IncidenteServiceTest(unittest.IsolatedAsyncioTestCase):

    def construir(self, db):
        client = FakeClient(db)
        self.alertas = MagicMock()
        self.alertas.desencadenar_alertas.return_value = {"alertas_encoladas": 1}
        geocoder = MagicMock()
        geocoder.resolver_direccion = AsyncMock(return_value="Calle 1, Centro")
        return IncidenteService(IncidenteRepository(client), EvidenciaRepository(client), UsuarioRepository(client),
                                CargoInstitucionalRepository(client), control_de_acceso(client), self.alertas, geocoder)

    async def test_activar_enriquece_incidente_y_delega_alertas(self):
        db = base_de_datos()
        servicio = self.construir(db)
        solicitud = ActivarIncidenteRequest(incidente_id=INCIDENTE, victima_id=VICTIMA, latitud=-26.1, longitud=-58.1, origen="yamnet")
        respuesta = servicio.activar_incidente(solicitud, {"id": VICTIMA, "roles": ["Víctima"]})
        await asyncio.sleep(0)

        self.assertEqual(respuesta["alertas_encoladas"], 1)
        incidente = db.tables["incidente"][0]
        self.assertEqual(incidente["inc_victima_nombre"], "Ana Pérez")
        self.assertEqual(incidente["inc_origen"], "automatico")
        self.assertEqual(incidente["inc_direccion"], "Calle 1, Centro")
        self.alertas.desencadenar_alertas.assert_called_once_with(INCIDENTE, VICTIMA, -26.1, -58.1)

    def test_activar_en_nombre_de_otra_victima_es_rechazado(self):
        servicio = self.construir(base_de_datos())
        solicitud = ActivarIncidenteRequest(incidente_id=INCIDENTE, victima_id=VICTIMA, latitud=0, longitud=0)
        with self.assertRaises(AccesoDenegadoError):
            servicio.activar_incidente(solicitud, {"id": OTRA, "roles": ["Víctima"]})
        self.alertas.desencadenar_alertas.assert_not_called()

    def test_posicion_sobre_incidente_cerrado(self):
        servicio = self.construir(base_de_datos(estado="cerrado"))
        with self.assertRaises(RecursoNoEncontradoError):
            servicio.actualizar_posicion(INCIDENTE, ActualizarPosicionRequest(latitud=1, longitud=1), None)


class ExportacionIndividualTest(unittest.TestCase):

    def construir(self, db):
        client = FakeClient(db)
        return ExportacionForenseService(
            IncidenteRepository(client), EvidenciaRepository(client), UsuarioRepository(client),
            CargoInstitucionalRepository(client), AuditoriaExportacionRepository(client), EvidenciaStorage(client),
            control_de_acceso(client), ExportService())

    def test_tercero_sin_rol_de_autoridad_no_exporta_material_ajeno(self):
        servicio = self.construir(base_de_datos(consentimiento=True))
        with self.assertRaises(AccesoDenegadoError):
            servicio.exportar_evidencia_individual(EVIDENCIA, "Juzgado", "Causa", {"id": CONTACTO, "roles": ["Contacto"]})

    def test_autoridad_con_consentimiento_exporta_y_queda_auditada(self):
        db = base_de_datos(consentimiento=True)
        archivo = self.construir(db).exportar_evidencia_individual(
            EVIDENCIA, "Juzgado", "Causa", {"id": AUTORIDAD, "roles": ["Víctima", "Autoridad"]})
        self.assertTrue(archivo.contenido.startswith(b"PK"))
        self.assertEqual(db.tables["exportacion_evidencia"][0]["expevi_rol_actor"], "Autoridad")

    def test_rol_actor_prioriza_rol_institucional(self):
        self.assertEqual(rol_actor_auditoria(["Víctima", "Autoridad"], "x"), "Autoridad")
        self.assertEqual(rol_actor_auditoria([], "Titular"), "Titular")


if __name__ == "__main__":
    unittest.main()
