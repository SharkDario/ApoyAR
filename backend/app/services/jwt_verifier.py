# backend/app/services/jwt_verifier.py
# ─────────────────────────────────────────────────────────────────────────────
# Verificación criptográfica de los JWT emitidos por Supabase Auth.
#
#   1. Firma: JWKS (ES256 / RS256) o secreto simétrico HS256.
#   2. Vigencia temporal (exp), emisor (iss) y audiencia (aud) según el caso.
#   3. Sujeto (sub) = UUID del usuario.
# ─────────────────────────────────────────────────────────────────────────────

import logging
import uuid
from typing import Any, Dict, Optional

import jwt
from jwt import PyJWKClient, PyJWKClientError

from app.config import Settings
from app.errors import NoAutenticadoError

logger = logging.getLogger("apoyar.auth")


class JwtVerifier:
    """Valida tokens Bearer. Mantiene en memoria el cliente JWKS (con caché)."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._jwk_client: Optional[PyJWKClient] = None
        # Clave local inyectable por la suite de pruebas (sin red)
        self._clave_test: Optional[str] = None
        self._algoritmo_test: Optional[str] = None

    def configurar_clave_test(self, clave: Optional[str], algoritmo: Optional[str] = "HS256") -> None:
        self._clave_test = clave
        self._algoritmo_test = algoritmo

    def _get_jwk_client(self) -> PyJWKClient:
        if self._jwk_client is None:
            self._jwk_client = PyJWKClient(self._settings.jwks_url, cache_jwk_set=True, lifespan=3600)
        return self._jwk_client

    def verificar(self, token: str) -> Dict[str, Any]:
        """Devuelve {"id", "email", "role", "claims"} o lanza NoAutenticadoError."""
        try:
            unverified_header = jwt.get_unverified_header(token)
        except Exception as exc:
            logger.warning("Error leyendo header de JWT: %s", exc)
            raise NoAutenticadoError("Token de autenticación malformado o no decodificable.")

        alg = unverified_header.get("alg")

        if self._clave_test is not None and alg == self._algoritmo_test:
            payload = self._decodificar_con_verificacion_completa(
                token, self._clave_test, [self._algoritmo_test], "Token inválido: {}"
            )
        elif alg == "HS256":
            payload = self._decodificar_hs256(token)
        elif alg in ("ES256", "RS256"):
            try:
                signing_key = self._get_jwk_client().get_signing_key_from_jwt(token)
            except PyJWKClientError as exc:
                logger.error("Error obteniendo clave desde JWKS: %s", exc)
                raise NoAutenticadoError("No se pudo verificar la clave pública del emisor en JWKS.")
            except jwt.PyJWTError as exc:
                raise NoAutenticadoError(f"Fallo en verificación criptográfica de token: {str(exc)}")
            payload = self._decodificar_con_verificacion_completa(
                token, signing_key.key, ["ES256", "RS256"], "Fallo en verificación criptográfica de token: {}"
            )
        else:
            raise NoAutenticadoError(f"Algoritmo de firma no soportado o clave no disponible: {alg}")

        return self._identidad_desde_payload(payload)

    def _decodificar_con_verificacion_completa(self, token: str, clave: Any, algoritmos: list, plantilla_error: str) -> Dict[str, Any]:
        try:
            return jwt.decode(
                token,
                clave,
                algorithms=algoritmos,
                audience=self._settings.supabase_jwt_audience,
                issuer=self._settings.jwt_issuer,
                options={"verify_exp": True, "verify_iss": True, "verify_aud": True},
            )
        except jwt.ExpiredSignatureError:
            raise NoAutenticadoError("El token de autenticación ha expirado.")
        except jwt.InvalidAudienceError:
            raise NoAutenticadoError("Audiencia (aud) del token inválida.")
        except jwt.InvalidIssuerError:
            raise NoAutenticadoError("Emisor (iss) del token inválido.")
        except jwt.InvalidSignatureError:
            raise NoAutenticadoError("Firma criptográfica del token inválida.")
        except PyJWKClientError as exc:
            logger.error("Error obteniendo clave desde JWKS: %s", exc)
            raise NoAutenticadoError("No se pudo verificar la clave pública del emisor en JWKS.")
        except jwt.PyJWTError as exc:
            raise NoAutenticadoError(plantilla_error.format(str(exc)))

    def _decodificar_hs256(self, token: str) -> Dict[str, Any]:
        """HS256 con SUPABASE_JWT_SECRET o API_SECRET_KEY (tokens del login institucional)."""
        candidatos = [s for s in [self._settings.supabase_jwt_secret, self._settings.api_secret_key] if s]
        ultimo_error = None
        for secreto in candidatos:
            try:
                return jwt.decode(
                    token,
                    secreto,
                    algorithms=["HS256"],
                    options={"verify_exp": True, "verify_iss": False, "verify_aud": False},
                )
            except Exception as err:
                ultimo_error = err
        raise NoAutenticadoError(f"Token inválido o expirado: {ultimo_error}")

    @staticmethod
    def _identidad_desde_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise NoAutenticadoError("El token no contiene claim de sujeto (sub).")
        try:
            user_uuid = uuid.UUID(user_id_str)
        except ValueError:
            raise NoAutenticadoError("Identificador de sujeto (sub) no es un UUID válido.")

        return {
            "id": str(user_uuid),
            "email": payload.get("email"),
            "role": payload.get("role", "authenticated"),
            "claims": payload,
        }
