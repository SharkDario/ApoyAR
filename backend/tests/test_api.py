# backend/tests/test_api.py
# Capa de presentación: los routers autentican, delegan en los servicios y
# traducen los errores de aplicación a respuestas HTTP.

import datetime
import unittest
from unittest.mock import MagicMock

import httpx
import jwt

from app import dependencies
from app.config import settings
from app.errors import AccesoDenegadoError
from app.main import app
from app.services import auth_dependencies
from tests.fake_supabase import FakeClient, FakeDB

CLAVE = "clave-de-prueba-tests-api-apoyar-2026"
USUARIO = "11111111-1111-4111-8111-111111111111"
INCIDENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def token(sub=USUARIO):
    ahora = datetime.datetime.now(datetime.timezone.utc)
    return jwt.encode({"sub": sub, "aud": "authenticated", "iss": settings.jwt_issuer,
                       "exp": int(ahora.timestamp()) + 600}, CLAVE, algorithm="HS256")


class ApiTest(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        auth_dependencies.configurar_clave_test(CLAVE, "HS256")
        self.db = FakeDB()
        app.dependency_overrides[dependencies.get_supabase_client] = lambda: FakeClient(self.db)

    def tearDown(self):
        app.dependency_overrides.clear()
        auth_dependencies.configurar_clave_test(None, None)

    async def solicitar(self, metodo, ruta, **kwargs):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as cliente:
            return await cliente.request(metodo, ruta, **kwargs)

    async def test_router_delega_en_el_servicio(self):
        servicio = MagicMock()
        servicio.obtener_incidente.return_value = {"inc_id_incidente": INCIDENTE}
        app.dependency_overrides[dependencies.get_incidente_service] = lambda: servicio

        resp = await self.solicitar("GET", f"/api/v1/incidentes/{INCIDENTE}", headers={"Authorization": f"Bearer {token()}"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"status": "ok", "incidente": {"inc_id_incidente": INCIDENTE}})
        incidente_id, usuario = servicio.obtener_incidente.call_args.args
        self.assertEqual(incidente_id, INCIDENTE)
        self.assertEqual(usuario["roles"], ["Víctima"])

    async def test_error_de_aplicacion_se_traduce_a_http(self):
        servicio = MagicMock()
        servicio.obtener_incidente.side_effect = AccesoDenegadoError("denegado")
        app.dependency_overrides[dependencies.get_incidente_service] = lambda: servicio

        resp = await self.solicitar("GET", f"/api/v1/incidentes/{INCIDENTE}", headers={"Authorization": f"Bearer {token()}"})
        self.assertEqual((resp.status_code, resp.json()), (403, {"detail": "denegado"}))

    async def test_sin_token_401_con_desafio_bearer(self):
        resp = await self.solicitar("GET", f"/api/v1/incidentes/{INCIDENTE}")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.headers.get("www-authenticate"), "Bearer")

    async def test_activar_exige_bearer_o_api_secret(self):
        cuerpo = {"incidente_id": INCIDENTE, "victima_id": USUARIO, "latitud": 0, "longitud": 0}
        self.assertEqual((await self.solicitar("POST", "/api/v1/incidentes/activar", json=cuerpo)).status_code, 401)
        self.assertEqual((await self.solicitar("POST", "/api/v1/incidentes/activar", json=cuerpo, headers={"X-Api-Secret": "x"})).status_code, 401)

    async def test_rbac_de_consola_de_autoridad(self):
        resp = await self.solicitar("GET", "/api/v1/autoridad/incidentes-activos", headers={"Authorization": f"Bearer {token()}"})
        self.assertEqual(resp.status_code, 403)

    async def test_catalogo_usa_semilla_si_la_tabla_no_responde(self):
        self.db.fail_tables.add("cargo")
        resp = await self.solicitar("GET", "/api/v1/cargos")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()["cargos"]), 10)


class ComposicionTest(unittest.TestCase):

    def test_cada_proveedor_construye_su_servicio(self):
        """Resuelve la cadena de dependencias sin ciclos con el cliente falso."""
        cliente = FakeClient(FakeDB())
        proveedores = [p for nombre, p in vars(dependencies).items() if nombre.startswith("get_") and nombre.endswith("_service")]
        self.assertGreaterEqual(len(proveedores), 11)
        for proveedor in proveedores:
            self.assertIsNotNone(_resolver(proveedor, cliente))


def _resolver(proveedor, cliente):
    import inspect
    if proveedor is dependencies.get_supabase_client:
        return cliente
    argumentos = {}
    for nombre, parametro in inspect.signature(proveedor).parameters.items():
        argumentos[nombre] = _resolver(parametro.default.dependency, cliente)
    return proveedor(**argumentos)


if __name__ == "__main__":
    unittest.main()
