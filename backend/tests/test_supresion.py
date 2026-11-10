# backend/tests/test_supresion.py
# Derecho de supresión (Art. 16 Ley 25.326): los archivos se borran de Storage y
# la base ejecuta fn_eliminar_cuenta_usuario, que conserva los incidentes anonimizados.

import unittest
from unittest.mock import MagicMock

from app.errors import ErrorInternoError
from app.repositories.evidencia_repository import EvidenciaRepository
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.perfil_repository import PerfilRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.services.cuenta_service import CuentaService
from tests.fake_supabase import FakeClient, FakeDB

USUARIO = "11111111-1111-4111-8111-111111111111"


def servicio(db, usuarios=None):
    cliente = FakeClient(db)
    return CuentaService(MagicMock(), PerfilRepository(cliente), usuarios or UsuarioRepository(cliente),
                         EvidenciaRepository(cliente), EvidenciaStorage(cliente))


class SupresionDeCuentaTest(unittest.TestCase):

    def test_borra_archivos_y_ejecuta_la_funcion_de_la_base(self):
        db = FakeDB()
        db.tables["evidencia"] = [{"evi_id_evidencia": "e1", "usu_id_usuario": USUARIO,
                                   "evi_url_almacenamiento": f"{USUARIO}/audio/segmento_1.enc"}]
        servicio(db).eliminar_cuenta(USUARIO)

        self.assertIn({"storage_remove": [f"{USUARIO}/audio/segmento_1.enc"]}, db.log)
        self.assertIn({"rpc": "fn_eliminar_cuenta_usuario", "params": {"p_usuario_id": USUARIO}}, db.log)
        # El backend ya no toca los incidentes por su cuenta: lo hace la función de la base
        self.assertFalse([e for e in db.log if e.get("table") == "incidente"])

    def test_si_la_base_falla_no_informa_exito(self):
        usuarios = MagicMock()
        usuarios.eliminar_cuenta_en_cascada.side_effect = RuntimeError("violates foreign key constraint")
        with self.assertRaises(ErrorInternoError):
            servicio(FakeDB(), usuarios).eliminar_cuenta(USUARIO)


if __name__ == "__main__":
    unittest.main()
