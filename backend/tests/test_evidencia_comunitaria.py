# backend/tests/test_evidencia_comunitaria.py
# Evidencias de testigos, asociación, coordenadas, firma verificable y custodia de la DEK.

import asyncio
import base64
import datetime
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, MagicMock, patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.x509.oid import NameOID

from app.errors import AccesoDenegadoError
from app.repositories.cargo_institucional_repository import CargoInstitucionalRepository
from app.repositories.evidencia_repository import EvidenciaRepository, prefijo_expediente
from app.repositories.evidencia_storage import EvidenciaStorage
from app.repositories.incidente_repository import IncidenteRepository
from app.repositories.red_apoyo_repository import RedApoyoRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.schemas.admin import AsociarEvidenciaRequest, SugerenciasQuery
from app.schemas.evidencias import SellarEvidenciaComunitariaRequest
from app.services import atestacion_hardware, evidencia_cripto
from app.services.access_control import AccessControlService
from app.services.evidencia_service import EvidenciaService
from app.services.supervision_service import SupervisionService
from tests.fake_supabase import FakeClient, FakeDB

TESTIGO = "11111111-1111-4111-8111-111111111111"
OTRO = "22222222-2222-4222-8222-222222222222"
AUTORIDAD = "44444444-4444-4444-8444-444444444444"
INCIDENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
EVIDENCIA = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1"
HASH = "ab" * 32


def servicio_evidencias(db, tsa=None):
    client = FakeClient(db)
    acceso = AccessControlService(IncidenteRepository(client), EvidenciaRepository(client),
                                  RedApoyoRepository(client), CargoInstitucionalRepository(client))
    return EvidenciaService(EvidenciaRepository(client), IncidenteRepository(client), EvidenciaStorage(client), acceso, tsa or MagicMock())


def solicitud_testigo(usuario_id=TESTIGO):
    return SellarEvidenciaComunitariaRequest(
        usuario_id=usuario_id, tipo_archivo="imagen", url_almacenamiento=f"{usuario_id}/testigo/foto.jpg",
        hash_sha256=HASH, firma_hardware="c2ln", fecha_captura="2026-05-01T12:00:00Z",
        metadata_dispositivo={"latitud": -26.18, "longitud": -58.17},
    )


class SelladoComunitarioTest(unittest.IsolatedAsyncioTestCase):

    async def test_registra_evidencia_aislada_con_origen_testigo(self):
        db = FakeDB()
        tsa = MagicMock()
        tsa.obtener_sello_tiempo = AsyncMock(return_value={"token_rfc3161_b64": "VE9LRU4=", "tsa_estado": "valido"})

        respuesta = await servicio_evidencias(db, tsa).sellar_forense(solicitud_testigo(), {"id": TESTIGO, "roles": ["Víctima"]})

        fila = db.tables["evidencia"][0]
        self.assertIsNone(fila["inc_id_incidente"])
        self.assertEqual(fila["evi_origen_captura"], "testigo")
        self.assertIsNone(respuesta["incidente_id"])

    async def test_no_se_puede_atribuir_a_otro_usuario(self):
        with self.assertRaises(AccesoDenegadoError):
            await servicio_evidencias(FakeDB()).sellar_forense(solicitud_testigo(OTRO), {"id": TESTIGO, "roles": ["Autoridad"]})


class FormatosDeAudioTest(unittest.TestCase):

    def test_cada_audio_se_entrega_con_su_tipo_real(self):
        self.assertEqual(evidencia_cripto.tipo_medio_reproduccion("audio", "m4a"), ("audio/mp4", "m4a"))
        self.assertEqual(evidencia_cripto.tipo_medio_reproduccion("audio", "wav"), ("audio/wav", "wav"))

    def test_la_exportacion_conserva_la_extension_real(self):
        self.assertEqual(evidencia_cripto.extension_exportacion("audio", "wav"), "wav")
        self.assertEqual(evidencia_cripto.extension_exportacion("audio", "m4a"), "m4a")

    def test_amr_se_convierte_con_las_tramas_del_contenedor(self):
        ftyp = (24).to_bytes(4, "big") + b"ftyp3gp4" + bytes(12)
        tramas = b"\x3c" + bytes(31)
        moov = (16).to_bytes(4, "big") + b"moov" + b"samr" + bytes(4)
        cortos = (8 + len(tramas)).to_bytes(4, "big") + b"mdat" + tramas
        extendido = (1).to_bytes(4, "big") + b"mdat" + (16 + len(tramas)).to_bytes(8, "big") + tramas

        for mdat in (cortos, extendido):  # Android usa el tamaño extendido de 64 bits
            contenido = ftyp + mdat + moov
            self.assertTrue(evidencia_cripto.es_audio_amr(contenido))
            with patch("app.services.evidencia_cripto.subprocess.run", return_value=MagicMock(stdout=bytes(160))) as ffmpeg:
                wav = evidencia_cripto.amr_a_wav(contenido)

            self.assertEqual(ffmpeg.call_args.kwargs["input"], b"#!AMR\n" + tramas)
            self.assertEqual(wav[:4], b"RIFF")

    def test_una_conversion_vacia_es_un_error(self):
        contenido = (8).to_bytes(4, "big") + b"ftyp" + (8).to_bytes(4, "big") + b"mdat" + b"samr"
        with patch("app.services.evidencia_cripto.subprocess.run", return_value=MagicMock(stdout=b"")):
            with self.assertRaises(ValueError):
                evidencia_cripto.amr_a_wav(contenido)

    def test_wav_y_m4a_no_se_convierten(self):
        self.assertFalse(evidencia_cripto.es_audio_amr(b"RIFF" + bytes(40)))
        self.assertFalse(evidencia_cripto.es_audio_amr(bytes(4) + b"ftypM4A " + b"mp4a"))


class ListadoTestigosTest(unittest.TestCase):

    def setUp(self):
        self.db = FakeDB()
        self.db.tables["evidencia"] = [
            {"evi_id_evidencia": EVIDENCIA, "inc_id_incidente": None, "usu_id_usuario": TESTIGO, "evi_tipo_archivo": "imagen",
             "evi_origen_captura": "testigo", "evi_fecha_captura": "2026-05-01T12:00:00+00:00", "evi_consentimiento_exportacion": False,
             "evi_url_almacenamiento": "ruta/secreta.jpg", "evi_metadata_dispositivo": {"latitud": -26.18, "longitud": -58.17, "modelo": "X"}},
            {"evi_id_evidencia": "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", "inc_id_incidente": INCIDENTE, "usu_id_usuario": OTRO,
             "evi_tipo_archivo": "audio", "evi_origen_captura": "victima", "evi_fecha_captura": "2026-05-01T12:00:00+00:00"},
        ]
        self.servicio = servicio_evidencias(self.db)

    def listar(self, roles=("Autoridad",), **filtros):
        return self.servicio.listar_evidencias_incidente("testigos", 1, 10, {"id": AUTORIDAD, "roles": list(roles)}, **filtros)

    def test_devuelve_solo_testigos_y_sin_datos_del_autor(self):
        respuesta = self.listar()
        self.assertEqual(respuesta["total_registros"], 1)
        self.assertEqual(set(respuesta["evidencias"][0]), {
            "id", "incidente_id", "tipo_archivo", "fecha_captura", "latitud", "longitud", "hash_sha256", "prev_hash",
            "token_rfc3161", "consentimiento_exportacion", "fecha_consentimiento",
        })
        self.assertEqual(respuesta["evidencias"][0]["latitud"], -26.18)

    def test_filtra_por_fecha_de_captura(self):
        self.assertEqual(self.listar(desde="2026-05-01T11:00:00.000Z", hasta="2026-05-01T13:00:00.000Z")["total_registros"], 1)
        self.assertEqual(self.listar(desde="2026-05-02T00:00:00.000Z")["total_registros"], 0)

    def test_el_administrador_de_ti_no_accede(self):
        with self.assertRaises(AccesoDenegadoError):
            self.listar(roles=("Administrador",))


class CorrelacionTest(unittest.TestCase):

    def setUp(self):
        self.db = FakeDB()
        self.db.tables["incidente"] = [
            {"inc_id_incidente": INCIDENTE, "inc_latitud": -26.18, "inc_longitud": -58.17, "inc_estado": "en_curso",
             "inc_fecha_hora": "2026-05-01T12:00:00+00:00", "inc_notas": None},
            {"inc_id_incidente": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "inc_latitud": 0, "inc_longitud": 0, "inc_estado": "en_curso",
             "inc_fecha_hora": "2026-05-01T12:01:00+00:00", "inc_notas": None},
        ]
        self.db.tables["evidencia"] = [
            {"evi_id_evidencia": EVIDENCIA, "inc_id_incidente": None, "usu_id_usuario": TESTIGO, "evi_tipo_archivo": "imagen",
             "evi_fecha_captura": "2026-05-01T12:05:00+00:00", "evi_metadata_dispositivo": {"latitud": -26.1801, "longitud": -58.1701}},
        ]
        client = FakeClient(self.db)
        self.servicio = SupervisionService(IncidenteRepository(client), EvidenciaRepository(client), UsuarioRepository(client))

    def consulta(self, **extra):
        return SugerenciasQuery(latitud=-26.18, longitud=-58.17, fecha_hora="2026-05-01T12:00:00Z", radio_metros=500, **extra)

    def test_evidencia_aislada_se_ubica_por_sus_propias_coordenadas(self):
        sugerencias = self.servicio.sugerir_coincidencias(self.consulta(incidente_id=INCIDENTE))["sugerencias"]
        self.assertEqual([s.get("evidencia_id") for s in sugerencias], [EVIDENCIA])

    def test_evidencia_de_otro_incidente_informa_su_incidente_y_consentimiento(self):
        otro_incidente = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        self.db.tables["incidente"].append(
            {"inc_id_incidente": otro_incidente, "inc_victima_nombre": "Persona", "inc_latitud": -26.18, "inc_longitud": -58.17,
             "inc_origen": "manual", "inc_estado": "cerrado", "inc_fecha_hora": "2026-05-01T09:00:00+00:00",
             "inc_consentimiento_exportacion": False})
        fila = self.db.tables["evidencia"][0]
        fila.update({"inc_id_incidente": otro_incidente, "evi_origen_captura": "testigo", "evi_consentimiento_exportacion": True})

        sugerencia = self.servicio.sugerir_coincidencias(self.consulta(incidente_id=INCIDENTE))["sugerencias"][0]

        self.assertEqual(sugerencia["origen_captura"], "testigo")
        self.assertEqual(sugerencia["incidente"]["victima_nombre"], "Persona")
        self.assertIs(sugerencia["incidente"]["consentimiento_exportacion"], False)

    def test_incidente_sin_gps_no_genera_coincidencias(self):
        cerca_de_cero = SugerenciasQuery(latitud=0, longitud=0, fecha_hora="2026-05-01T12:00:00Z", radio_metros=500)
        self.assertEqual(self.servicio.sugerir_coincidencias(cerca_de_cero)["sugerencias"], [])

    def test_asociar_vincula_inc_id_incidente_y_la_evidencia_aparece_en_el_expediente(self):
        solicitud = AsociarEvidenciaRequest(evidencia_id=EVIDENCIA, incidente_id=INCIDENTE, justificacion_operativa="Misma hora y lugar")
        self.servicio.asociar_evidencia(solicitud, {"id": AUTORIDAD, "email": "op@apoyar.local"})

        fila = self.db.tables["evidencia"][0]
        self.assertEqual(fila["inc_id_incidente"], INCIDENTE)
        self.assertTrue(fila["evi_motivo_asociacion"].startswith(prefijo_expediente(INCIDENTE)))
        self.assertEqual(fila["usu_id_asociado_por"], AUTORIDAD)
        self.assertIn(EVIDENCIA, self.db.tables["incidente"][0]["inc_notas"])

        listado = EvidenciaRepository(FakeClient(self.db)).listar_por_incidente(INCIDENTE)
        self.assertEqual([e["evi_id_evidencia"] for e in listado], [EVIDENCIA])

        repetida = self.servicio.sugerir_coincidencias(self.consulta(incidente_id=INCIDENTE))["sugerencias"]
        self.assertEqual(repetida, [])


def certificado(sujeto, clave_publica, firmante, emisor=None, extension=None):
    ahora = datetime.datetime.now(datetime.timezone.utc)
    nombre = lambda texto: x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, texto)])
    constructor = (
        x509.CertificateBuilder().subject_name(nombre(sujeto)).issuer_name(nombre(emisor or sujeto))
        .public_key(clave_publica).serial_number(x509.random_serial_number())
        .not_valid_before(ahora - datetime.timedelta(days=1)).not_valid_after(ahora + datetime.timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=extension is None, path_length=None), critical=True)
    )
    if extension is not None:
        constructor = constructor.add_extension(
            x509.UnrecognizedExtension(atestacion_hardware.OID_ATESTACION_ANDROID, extension), critical=False)
    return constructor.sign(firmante, hashes.SHA256())


class FirmaHardwareTest(unittest.TestCase):

    def setUp(self):
        self.raiz = ec.generate_private_key(ec.SECP256R1())
        self.clave_dispositivo = ec.generate_private_key(ec.SECP256R1())
        # KeyDescription: SEQUENCE { attestationVersion 4, attestationSecurityLevel 1 (TEE) }
        extension = bytes([0x30, 0x06, 0x02, 0x01, 0x04, 0x0A, 0x01, 0x01])
        hoja = certificado("Android Keystore Key", self.clave_dispositivo.public_key(), self.raiz, "Raiz de prueba", extension)
        cert_raiz = certificado("Raiz de prueba", self.raiz.public_key(), self.raiz)
        self.datos = {"cadena_certificados_b64": [base64.b64encode(c.public_bytes(serialization.Encoding.DER)).decode() for c in (hoja, cert_raiz)]}

        self.temporal = TemporaryDirectory()
        ruta = Path(self.temporal.name) / "raices.pem"
        ruta.write_bytes(cert_raiz.public_bytes(serialization.Encoding.PEM))
        self.parche = patch.object(atestacion_hardware, "RUTA_RAICES_GOOGLE", ruta)
        self.parche.start()

    def tearDown(self):
        self.parche.stop()
        self.temporal.cleanup()

    def firmar(self, hash_hex):
        return base64.b64encode(self.clave_dispositivo.sign(bytes.fromhex(hash_hex), ec.ECDSA(hashes.SHA256()))).decode()

    def test_firma_atestada_por_hardware_es_valida(self):
        resultado = atestacion_hardware.verificar_firma_evidencia(self.firmar(HASH), HASH, self.datos)
        self.assertTrue(resultado["valido"])
        self.assertEqual(resultado["nivel_seguridad"], "tee")

    def test_firma_de_otro_hash_es_rechazada(self):
        resultado = atestacion_hardware.verificar_firma_evidencia(self.firmar("cd" * 32), HASH, self.datos)
        self.assertFalse(resultado["valido"])
        self.assertFalse(resultado["firma_verificada"])

    def test_cadena_que_no_llega_a_la_raiz_es_rechazada(self):
        with patch.object(atestacion_hardware, "_raices_google", return_value=[]):
            resultado = atestacion_hardware.verificar_firma_evidencia(self.firmar(HASH), HASH, self.datos)
        self.assertTrue(resultado["firma_verificada"])
        self.assertFalse(resultado["valido"])

    def test_evidencia_anterior_sin_certificados_no_se_da_por_valida(self):
        firma_simulada = base64.b64encode(b"x" * 72).decode()
        self.assertFalse(atestacion_hardware.verificar_firma_evidencia(firma_simulada, HASH, None)["valido"])


class CustodiaDekTest(unittest.TestCase):

    def test_el_backend_abre_la_dek_envuelta_con_su_clave_de_custodia(self):
        clave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = clave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        dek, iv, plano = bytes(range(32)), bytes(range(12)), b"audio-de-prueba"
        envuelta = clave.public_key().encrypt(
            dek, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        sobre = {"dek_custodia_b64": base64.b64encode(envuelta).decode(), "iv_hex": iv.hex()}
        paquete = iv + AESGCM(dek).encrypt(iv, plano, None)

        with patch.object(evidencia_cripto.settings, "dek_custodia_private_key_b64", base64.b64encode(pem).decode()):
            self.assertEqual(evidencia_cripto.descifrar_para_reproduccion(paquete, sobre), plano)
            self.assertEqual(evidencia_cripto.descifrar_para_exportacion(paquete, sobre), plano)

    def test_evidencia_anterior_con_dek_en_claro_sigue_legible(self):
        dek, iv, plano = bytes(range(32)), bytes(range(12)), b"audio-antiguo"
        paquete = iv + AESGCM(dek).encrypt(iv, plano, None)
        self.assertEqual(evidencia_cripto.descifrar_para_reproduccion(paquete, {"dek_hex": dek.hex(), "iv_hex": iv.hex()}), plano)


if __name__ == "__main__":
    unittest.main()
