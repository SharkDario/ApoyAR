-- =============================================================================
-- MIGRACIÓN 006: NORMALIZACIÓN ESTRICTA EN TERCERA FORMA NORMAL PURA (3FN)
-- 1. Eliminación total de tabla redundante 'autoridad_institucional'.
-- 2. Creación de tabla catálogo 'cargo' (normalización 3FN pura de nombres de cargo).
-- 3. Reestructuración de 'cargo_institucional' vinculada a:
--    - id_cargo_institucional (SERIAL PRIMARY KEY)
--    - usuario_id (1:1 con auth.users, UNIQUE, NOT NULL)
--    - id_sede (FK a public.sede, NOT NULL - ÚNICA FK institucional/territorial)
--    - id_cargo (FK a public.cargo, NOT NULL - FK a catálogo de cargos)
--    - legajo_o_matricula (VARCHAR(50), UNIQUE, NOT NULL - SIN DEFAULT)
--    - activo (BOOLEAN, NOT NULL, DEFAULT TRUE)
-- 4. Ajustes de integridad en 'evidencia' (tipo_archivo CHECK y consentimiento).
-- =============================================================================

-- 1. ELIMINAR TABLA REDUNDANTE 'autoridad_institucional'
DROP POLICY IF EXISTS "autoridad_institucional_select_policy" ON public.autoridad_institucional;
DROP TABLE IF EXISTS public.autoridad_institucional CASCADE;

-- 2. CREAR TABLA CATÁLOGO 'cargo' (3FN PURA)
CREATE TABLE IF NOT EXISTS public.cargo (
    id_cargo SERIAL PRIMARY KEY,
    nombre_cargo VARCHAR(120) NOT NULL UNIQUE
);

COMMENT ON TABLE public.cargo IS 'Catálogo normalizado en 3FN de denominaciones de cargos institucionales.';

-- Habilitar RLS en 'cargo'
ALTER TABLE public.cargo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cargo_select_policy" ON public.cargo;
CREATE POLICY "cargo_select_policy" ON public.cargo FOR SELECT TO authenticated, anon USING (true);

-- Poblar catálogo de cargos de la Provincia de Formosa
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

-- 3. REESTRUCTURAR TABLA 'cargo_institucional' EN 3FN PURA
DROP POLICY IF EXISTS "cargo_institucional_select_policy" ON public.cargo_institucional;
DROP POLICY IF EXISTS "cargo_institucional_admin_write_policy" ON public.cargo_institucional;
DROP TABLE IF EXISTS public.cargo_institucional CASCADE;

CREATE TABLE public.cargo_institucional (
    id_cargo_institucional SERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    id_sede INT NOT NULL REFERENCES public.sede(id_sede) ON DELETE RESTRICT ON UPDATE CASCADE,
    id_cargo INT NOT NULL REFERENCES public.cargo(id_cargo) ON DELETE RESTRICT ON UPDATE CASCADE,
    legajo_o_matricula VARCHAR(50) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.cargo_institucional IS 
'Tabla normalizada en 3FN pura: representa el cargo y adscripción física/institucional del agente con FK id_cargo e id_sede. No almacena dependencias transitivas.';
COMMENT ON COLUMN public.cargo_institucional.usuario_id IS 
'Vínculo 1:1 único con auth.users. Un usuario autoridad tiene un único cargo activo en una sede.';
COMMENT ON COLUMN public.cargo_institucional.id_sede IS 
'Única clave foránea territorial/institucional requerida en 3FN. Dependencia e Institución se acceden vía JOIN desde Sede.';
COMMENT ON COLUMN public.cargo_institucional.id_cargo IS 
'Clave foránea hacia la tabla catálogo cargo (3FN pura sin redundancia de cadenas).';
COMMENT ON COLUMN public.cargo_institucional.legajo_o_matricula IS 
'Identificador profesional o número de placa/matrícula único por funcionario. Prohibido valor DEFAULT para prevenir colisiones.';
COMMENT ON COLUMN public.cargo_institucional.activo IS 
'Estado operativo del cargo institucional. Totalmente independiente de Usuario.activo y Perfil.activo.';

-- Habilitar RLS en cargo_institucional
ALTER TABLE public.cargo_institucional ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cargo_institucional_select_policy" ON public.cargo_institucional
    FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "cargo_institucional_admin_write_policy" ON public.cargo_institucional
    FOR ALL TO authenticated
    USING (auth.uid() = usuario_id OR public.usuario_tiene_rol(auth.uid(), 'Administrador'))
    WITH CHECK (auth.uid() = usuario_id OR public.usuario_tiene_rol(auth.uid(), 'Administrador'));

-- 4. INSERTAR DATOS SEMILLA PARA LA AUTORIDAD POLICIAL EXISTENTE (FORMOSA CAPITAL)
-- Oficial Carlos Alberto Pérez (usuario_id: '0ccd59a9-7d72-438a-af1e-378a842153ba')
-- Sede: 1004 (Edificio Comisaría 1ra, Saavedra 317, Formosa Capital)
-- Cargo: 1 ('Oficial de Guardia')
-- Legajo explícito único: 'LP-POL-30415'
INSERT INTO public.cargo_institucional (
    usuario_id,
    id_sede,
    id_cargo,
    legajo_o_matricula,
    activo
) VALUES (
    '0ccd59a9-7d72-438a-af1e-378a842153ba',
    1004,
    1,
    'LP-POL-30415',
    true
)
ON CONFLICT (usuario_id) DO UPDATE SET
    id_sede = EXCLUDED.id_sede,
    id_cargo = EXCLUDED.id_cargo,
    legajo_o_matricula = EXCLUDED.legajo_o_matricula,
    activo = EXCLUDED.activo;

-- 5. AJUSTES FINOS EN EVIDENCIA: TIPO_ARCHIVO CHECK Y CONSENTIMIENTO INFORMADO
ALTER TABLE public.evidencia 
    ADD COLUMN IF NOT EXISTS consentimiento_exportacion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fecha_consentimiento TIMESTAMPTZ NULL;

ALTER TABLE public.evidencia 
    DROP CONSTRAINT IF EXISTS chk_evidencia_tipo_archivo;

ALTER TABLE public.evidencia
    ADD CONSTRAINT chk_evidencia_tipo_archivo 
    CHECK (UPPER(tipo_archivo) IN ('AUDIO', 'FOTO', 'IMAGEN', 'VIDEO'));

COMMENT ON COLUMN public.evidencia.tipo_archivo IS 
'Tipo de archivo multimedia capturado, restringido por CHECK a AUDIO, FOTO o VIDEO.';
COMMENT ON COLUMN public.evidencia.consentimiento_exportacion IS 
'Consentimiento informado explícito otorgado por la víctima/testigo para la exportación judicial de la evidencia.';
COMMENT ON COLUMN public.evidencia.fecha_consentimiento IS 
'Momento temporal exacto en el que se otorgó el consentimiento informado.';
