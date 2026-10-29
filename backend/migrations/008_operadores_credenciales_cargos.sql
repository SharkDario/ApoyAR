-- =============================================================================
-- MIGRACIÓN 008: SEPARACIÓN DE CREDENCIALES (MÓVIL VS PANEL WEB), CARGOS Y GESTIÓN
-- 1. Separación de credenciales: password_institucional_hash para Panel Web.
-- 2. Poblado obligatorio del catálogo 'cargo' de la Provincia de Formosa (1 a 10).
-- 3. Tabla 'usuario' normalizada alineada al DER con soporte multi-contexto.
-- =============================================================================

-- 1. Crear tabla 'usuario' en public si no existe, o agregar columna password_institucional_hash
CREATE TABLE IF NOT EXISTS public.usuario (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    persona_id UUID NULL REFERENCES public.persona(id) ON DELETE SET NULL,
    email VARCHAR(100) NULL,
    password_hash VARCHAR(255) NULL,
    password_institucional_hash VARCHAR(255) NULL,
    palabraClave_encriptada VARCHAR(255) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso TIMESTAMPTZ NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Asegurar columna en public.usuario y public.persona para compatibilidad total
ALTER TABLE public.usuario
    ADD COLUMN IF NOT EXISTS password_institucional_hash VARCHAR(255) NULL;

ALTER TABLE public.persona
    ADD COLUMN IF NOT EXISTS password_institucional_hash VARCHAR(255) NULL;

COMMENT ON COLUMN public.usuario.password_institucional_hash IS
'Hash de contraseña exclusivo para acceso institucional al Panel Web (PBKDF2/SHA-256). Independiente del password_hash civil de la App Móvil.';

-- Habilitar RLS en public.usuario
ALTER TABLE public.usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuario_select_policy" ON public.usuario;
CREATE POLICY "usuario_select_policy" ON public.usuario
    FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "usuario_all_admin" ON public.usuario;
CREATE POLICY "usuario_all_admin" ON public.usuario
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Asegurar que tabla catálogo 'cargo' exista y contenga los 10 cargos institucionales de Formosa
CREATE TABLE IF NOT EXISTS public.cargo (
    id_cargo SERIAL PRIMARY KEY,
    nombre_cargo VARCHAR(120) NOT NULL UNIQUE
);

ALTER TABLE public.cargo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cargo_select_policy" ON public.cargo;
CREATE POLICY "cargo_select_policy" ON public.cargo
    FOR SELECT TO authenticated, anon USING (true);

-- Poblado con ON CONFLICT para garantizar idempotencia
INSERT INTO public.cargo (id_cargo, nombre_cargo) VALUES
(1, 'Oficial de Guardia'),
(2, 'Jefe de Turno de Prevención'),
(3, 'Operador de Despacho 911'),
(4, 'Jefe de Comisaría'),
(5, 'Comandante de Escuadrón'),
(6, 'Jefe de Sección Rural'),
(7, 'Juez de Paz'),
(8, 'Secretario Letrado'),
(9, 'Fiscal de Instrucción'),
(10, 'Médico Forense Policial')
ON CONFLICT (id_cargo) DO UPDATE SET
    nombre_cargo = EXCLUDED.nombre_cargo;

-- 3. Sincronizar usuarios existentes de auth.users hacia public.usuario
INSERT INTO public.usuario (id, email, activo, creado_en)
SELECT id, email, true, created_at
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email;

-- 4. Índices para acelerar búsquedas de operadores y paginación
CREATE INDEX IF NOT EXISTS idx_persona_dni_search ON public.persona(dni);
CREATE INDEX IF NOT EXISTS idx_persona_nombre_search ON public.persona(nombre, apellido);
CREATE INDEX IF NOT EXISTS idx_incidente_fecha_desc ON public.incidente(fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_evidencia_fecha_desc ON public.evidencia(fecha_captura DESC);

-- 5. Privilegios explícitos para service_role y roles autenticados
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT ON public.cargo TO authenticated, anon;
GRANT SELECT ON public.institucion TO authenticated, anon;
GRANT SELECT ON public.dependencia TO authenticated, anon;
GRANT SELECT ON public.sede TO authenticated, anon;
