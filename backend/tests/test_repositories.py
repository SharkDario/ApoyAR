# backend/tests/test_repositories.py
# Repositorios: consultas a Supabase encapsuladas (cliente falso en memoria).

import unittest
from unittest.mock import MagicMock

from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.repositories.usuario_repository import UsuarioRepository
from tests.fake_supabase import FakeClient, FakeDB


class IncidenteRepositoryTest(unittest.TestCase):

    def setUp(self):
        self.db = FakeDB()
        self.db.tables["incidente"] = [
            {"inc_id_incidente": "i1", "usu_id_victima": "v", "inc_estado": "en_curso"},
            {"inc_id_incidente": "i2", "usu_id_victima": "v", "inc_estado": "en_curso"},
            {"inc_id_incidente": "i3", "usu_id_victima": "v", "inc_estado": "cerrado"},
        ]
        self.repo = IncidenteRepository(FakeClient(self.db))

    def test_actualizar_si_en_curso_no_modifica_incidentes_cerrados(self):
        self.assertEqual(self.repo.actualizar_si_en_curso("i3", {"inc_latitud": 1.0}), [])
        self.assertEqual(len(self.repo.actualizar_si_en_curso("i1", {"inc_latitud": 1.0})), 1)

    def test_cerrar_en_curso_de_victima_respeta_el_incidente_nuevo(self):
        self.repo.cerrar_en_curso_de_victima("v", "i2", "Reemplazado")
        estados = {r["inc_id_incidente"]: r["inc_estado"] for r in self.db.tables["incidente"]}
        self.assertEqual(estados, {"i1": "cerrado", "i2": "en_curso", "i3": "cerrado"})

    def test_contar_por_estado(self):
        self.assertEqual(self.repo.contar("en_curso"), 2)
        self.assertEqual(self.repo.contar(), 3)


class EvidenciaRepositoryTest(unittest.TestCase):

    def setUp(self):
        self.db = FakeDB()
        self.db.tables["evidencia"] = [
            {"evi_id_evidencia": "e1", "evi_hash_sha256": "a" * 64, "evi_sincronizado_en": "2026-01-01T00:00:00+00:00"},
            {"evi_id_evidencia": "e2", "evi_hash_sha256": "b" * 64, "evi_sincronizado_en": "2026-01-02T00:00:00+00:00"},
        ]
        self.repo = EvidenciaRepository(FakeClient(self.db))

    def test_ultimo_hash_usa_la_funcion_rpc(self):
        self.db.rpc_hash_valor = "c" * 64
        self.assertEqual(self.repo.obtener_ultimo_hash(), "c" * 64)

    def test_ultimo_hash_recurre_a_consulta_ordenada_si_falla_la_rpc(self):
        self.db.rpc_hash_falla = True
        self.assertEqual(self.repo.obtener_ultimo_hash(), "b" * 64)

    def test_ultimo_hash_es_none_con_log_vacio(self):
        self.db.tables["evidencia"] = []
        self.assertIsNone(self.repo.obtener_ultimo_hash())

    def test_registro_anterior_en_la_cadena(self):
        anterior = self.repo.obtener_registro_anterior("2026-01-02T00:00:00+00:00")
        self.assertEqual(anterior["evi_hash_sha256"], "a" * 64)


class RedApoyoRepositoryTest(unittest.TestCase):

    def test_tokens_push_excluye_dispositivos_inactivos_y_tokens_nulos(self):
        db = FakeDB()
        db.tables["dispositivo_usuario"] = [
            {"usu_id_usuario": "c1", "disusu_expo_push_token": "ExponentPushToken[a]", "disusu_activo": True},
            {"usu_id_usuario": "c1", "disusu_expo_push_token": None, "disusu_activo": True},
            {"usu_id_usuario": "c2", "disusu_expo_push_token": "ExponentPushToken[b]", "disusu_activo": False},
            {"usu_id_usuario": "c3", "disusu_expo_push_token": "ExponentPushToken[c]", "disusu_activo": True},
        ]
        tokens = RedApoyoRepository(FakeClient(db)).listar_tokens_push_activos(["c1", "c2"])
        self.assertEqual([t["disusu_expo_push_token"] for t in tokens], ["ExponentPushToken[a]"])


class UsuarioRepositoryTest(unittest.TestCase):

    def test_busqueda_neutraliza_sintaxis_de_filtros_postgrest(self):
        client = MagicMock()
        UsuarioRepository(client).buscar_personas("an),usu_activo.eq.(true")
        expresion = client.table.return_value.select.return_value.or_.call_args.args[0]
        # Cuatro condiciones fijas: el término no puede agregar ni cerrar grupos
        self.assertEqual(expresion.count(","), 3)
        self.assertNotIn("(", expresion)
        self.assertNotIn(")", expresion)

    def test_obtener_persona_devuelve_none_sin_vinculo(self):
        db = FakeDB()
        db.tables["usuario"] = [{"usu_id_usuario": "u1", "per_id_persona": None, "persona": None}]
        self.assertIsNone(UsuarioRepository(FakeClient(db)).obtener_persona("u1"))


class EvidenciaStorageTest(unittest.TestCase):

    def test_normalizacion_de_rutas(self):
        self.assertEqual(EvidenciaStorage.ruta_sin_prefijo(" evidencias/u/a.enc "), "u/a.enc")
        self.assertEqual(EvidenciaStorage.ruta_relativa("https://x.supabase.co/storage/v1/object/evidencias/u/a.enc"), "u/a.enc")
        self.assertEqual(EvidenciaStorage.ruta_relativa("/u/a.enc"), "u/a.enc")


if __name__ == "__main__":
    unittest.main()
