# backend/app/database.py
# ─────────────────────────────────────────────────────────────────────────────
# Clientes Supabase del backend.
#
# - `supabase_admin`: service_role key, bypass de RLS. Lo consumen los
#   repositorios (inyectado vía app.dependencies) y los scripts de soporte.
# - `crear_cliente_anonimo()`: anon key, respeta RLS; se crea por llamada para
#   no compartir la sesión del usuario final entre solicitudes.
# ─────────────────────────────────────────────────────────────────────────────

from supabase import create_client, Client
from app.config import settings

# Cliente con service_role key — bypass de RLS.
# SOLO usar en el backend. NUNCA exponer al cliente móvil.
supabase_admin: Client = create_client(
    settings.supabase_url,
    settings.supabase_service_role_key,
)


def crear_cliente_anonimo() -> Client:
    """Instancia anónima de Supabase por llamada para evitar polución de sesión."""
    return create_client(settings.supabase_url, settings.supabase_anon_key)
