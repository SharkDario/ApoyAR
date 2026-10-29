# backend/app/config.py
# ─────────────────────────────────────────────────────────────────────────────
# Configuración centralizada desde variables de entorno.
# Usa pydantic-settings para validación automática al arrancar.
# ─────────────────────────────────────────────────────────────────────────────

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    api_secret_key: str
    port: int = 8000

    # Sellado de tiempo RFC 3161
    tsa_url: str = "https://freetsa.org/tsr"
    tsa_timeout_seconds: float = 5.0

    # Configuración de JWT / Supabase Auth
    supabase_jwt_secret: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwks_url: str | None = None
    supabase_jwt_issuer: str | None = None

    @property
    def jwks_url(self) -> str:
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        if self.supabase_jwt_issuer:
            return self.supabase_jwt_issuer
        return f"{self.supabase_url.rstrip('/')}/auth/v1"


settings = Settings()
