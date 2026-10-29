-- =============================================================================
-- MIGRACIÓN 005: NORMALIZACIÓN INSTITUCIONAL 3FN (CU-06 / CU-09 / DER)
-- Institución -> Dependencia -> Sede -> Cargo Institucional -> Autoridad
-- =============================================================================

-- 1. TABLA: institucion
CREATE TABLE IF NOT EXISTS public.institucion (
    id_institucion INT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    tipo_organismo VARCHAR(80) NOT NULL,
    sitio_web VARCHAR(150)
);

-- 2. TABLA: dependencia
CREATE TABLE IF NOT EXISTS public.dependencia (
    id_dependencia INT PRIMARY KEY,
    id_institucion INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    tipo_unidad VARCHAR(80) NOT NULL,
    telefono_contacto VARCHAR(50),
    CONSTRAINT fk_dependencia_institucion
        FOREIGN KEY (id_institucion) REFERENCES public.institucion(id_institucion)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 3. TABLA: sede
CREATE TABLE IF NOT EXISTS public.sede (
    id_sede INT PRIMARY KEY,
    id_dependencia INT NOT NULL,
    nombre_sede VARCHAR(150) NOT NULL,
    direccion VARCHAR(200) NOT NULL,
    localidad VARCHAR(100) NOT NULL,
    codigo_postal VARCHAR(20) NOT NULL,
    CONSTRAINT fk_sede_dependencia
        FOREIGN KEY (id_dependencia) REFERENCES public.dependencia(id_dependencia)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 4. TABLA: cargo_institucional (3FN estricta: 1:1 con auth.users, FK id_sede)
CREATE TABLE IF NOT EXISTS public.cargo_institucional (
    id_cargo SERIAL PRIMARY KEY,
    usuario_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    id_sede INT NOT NULL REFERENCES public.sede(id_sede) ON DELETE RESTRICT ON UPDATE CASCADE,
    nombre_cargo VARCHAR(120) NOT NULL,
    legajo_o_matricula VARCHAR(50) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.institucion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dependencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sede ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_institucional ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura pública/autenticada para catálogos institucionales
DROP POLICY IF EXISTS "institucion_select_policy" ON public.institucion;
CREATE POLICY "institucion_select_policy" ON public.institucion FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "dependencia_select_policy" ON public.dependencia;
CREATE POLICY "dependencia_select_policy" ON public.dependencia FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "sede_select_policy" ON public.sede;
CREATE POLICY "sede_select_policy" ON public.sede FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "cargo_institucional_select_policy" ON public.cargo_institucional;
CREATE POLICY "cargo_institucional_select_policy" ON public.cargo_institucional FOR SELECT TO authenticated, anon USING (true);

-- =============================================================================
-- INSERCIÓN DE DATOS SEMILLA: PROVINCIA DE FORMOSA
-- =============================================================================

-- Instituciones
INSERT INTO public.institucion (id_institucion, nombre, tipo_organismo, sitio_web) VALUES
(1, 'Policía de la Provincia de Formosa', 'Fuerza de Seguridad Provincial', 'https://www.formosa.gob.ar/policia'),
(2, 'Poder Judicial de la Provincia de Formosa', 'Órgano Judicial Provincial', 'http://www.jusformosa.gov.ar/'),
(3, 'Secretaría de la Mujer de la Provincia de Formosa', 'Organismo Ejecutivo de Asistencia y Género', 'https://www.formosa.gob.ar/mujer'),
(4, 'Ministerio de Gobierno, Justicia, Seguridad y Trabajo', 'Ministerio del Poder Ejecutivo Provincial', 'https://www.formosa.gob.ar/'),
(5, 'Municipalidad de la Ciudad de Formosa', 'Gobierno Municipal Local', 'https://www.formosatuciudad.gob.ar/')
ON CONFLICT (id_institucion) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    tipo_organismo = EXCLUDED.tipo_organismo,
    sitio_web = EXCLUDED.sitio_web;

-- Dependencias
INSERT INTO public.dependencia (id_dependencia, id_institucion, nombre, tipo_unidad, telefono_contacto) VALUES
(101, 1, 'Jefatura de Policía', 'Unidad de Conducción Superior', '+54 370 442-7313'),
(102, 1, 'Dirección de Policía Científica', 'Unidad Pericial y Cadena de Custodia', NULL),
(103, 1, 'Comisaría Seccional Primera', 'Comisaría Jurisdiccional', '+54 370 442-6189'),
(104, 1, 'Comisaría Seccional Segunda', 'Comisaría Jurisdiccional', '+54 370 442-0777'),
(105, 1, 'Comisaría Seccional Sexta', 'Comisaría Jurisdiccional', '+54 370 445-2111'),
(201, 2, 'Edificio Central de Tribunales y OVI Capital', 'Unidad Judicial y Recepción de Denuncias', '+54 370 443-6301'),
(202, 2, 'Tribunal de Familia', 'Juzgado de Familia y Medidas Cautelares', '+54 370 444-5442'),
(203, 2, 'Dirección de Sistemas Informáticos', 'Unidad Técnica y Resguardo Digital', NULL),
(204, 2, 'Delegación Vecinal N° 2 - Circuito Cinco', 'Oficina Descentralizada de Orientación', NULL),
(205, 2, 'Oficina de Violencia Familiar (OVI Clorinda)', 'Unidad Operativa Interior', '+54 3718 42-1750'),
(301, 3, 'Dirección de Atención a Víctimas de Violencia de Género', 'Área de Contención y Asesoría Legal', '+54 370 443-6372'),
(401, 4, 'Dirección de Patronato de Liberados y Excarcelados', 'Unidad de Control de Medidas Judiciales', '+54 370 443-6196'),
(501, 5, 'Dirección de Cuidado Ciudadano y Género Municipal', 'Área Operativa Municipal', '+54 370 480-4556'),
(502, 5, 'Secretaría de Gobierno Municipal', 'Unidad Administrativa Central', '+54 800-999-9147')
ON CONFLICT (id_dependencia) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    tipo_unidad = EXCLUDED.tipo_unidad,
    telefono_contacto = EXCLUDED.telefono_contacto;

-- Sedes
INSERT INTO public.sede (id_sede, id_dependencia, nombre_sede, direccion, localidad, codigo_postal) VALUES
(1001, 101, 'Sede Central Jefatura', 'Saavedra 325', 'Formosa Capital', 'P3600'),
(1002, 101, 'Base Operativa Coronel Bogado', 'Coronel Bogado 767', 'Formosa Capital', 'P3600FZJ'),
(1003, 102, 'Laboratorio y División Informática Forense', 'Junín 849', 'Formosa Capital', 'P3600'),
(1004, 103, 'Edificio Comisaría 1ra', 'Saavedra 317', 'Formosa Capital', 'P3600'),
(1005, 104, 'Edificio Comisaría 2da', 'Libertad 800-898 (esq. 17 de Octubre)', 'Formosa Capital', 'P3600LMJ'),
(1006, 105, 'Edificio Comisaría 6ta', 'Av. Dr. Luis Gutnisky 4010', 'Formosa Capital', 'P3600CNA'),
(2001, 201, 'Palacio de Tribunales Formosa', 'San Martín 641', 'Formosa Capital', 'P3600ENI'),
(2002, 201, 'Sede Superior Tribunal de Justicia', 'Juan José Silva 856', 'Formosa Capital', 'P3600KRR'),
(2003, 202, 'Edificio Fuero de Familia', 'Saavedra 389', 'Formosa Capital', 'P3600'),
(2004, 203, 'Centro de Cómputos y Sistemas', 'Belgrano 420', 'Formosa Capital', 'P3600ENF'),
(2005, 204, 'Sede Barrio Simón Bolívar', 'Av. Soldado Formoseño en Malvinas, B° Simón Bolívar Mz 49 C 29', 'Formosa Capital', 'P3600'),
(2006, 205, 'Sede Judicial Clorinda', 'Av. San Martín s/n', 'Clorinda', 'P3610'),
(3001, 301, 'Sede Central Secretaría de la Mujer', 'España 735', 'Formosa Capital', 'P3600'),
(4001, 401, 'Sede Patronato de Liberados', 'Rivadavia 925', 'Formosa Capital', 'P3600'),
(5001, 501, 'Complejo Municipal Fotheringham', 'Fotheringham 1300-1398', 'Formosa Capital', 'P3600HWF'),
(5002, 502, 'Palacio Municipal Central', '9 de Julio 631', 'Formosa Capital', 'P3600AHP'),
(5003, 502, 'Anexo Operativo Pringles', 'Pringles 100-198', 'Formosa Capital', 'P3600')
ON CONFLICT (id_sede) DO UPDATE SET
    nombre_sede = EXCLUDED.nombre_sede,
    direccion = EXCLUDED.direccion,
    localidad = EXCLUDED.localidad,
    codigo_postal = EXCLUDED.codigo_postal;

-- =============================================================================
-- ASIGNACIÓN DE CARGO INSTITUCIONAL 3FN (OFICIAL CARLOS ALBERTO PÉREZ)
-- =============================================================================

-- Actualizar Persona para oficial.guardia@policia.gob.ar
UPDATE public.persona
SET nombre = 'Carlos Alberto',
    apellido = 'Pérez',
    dni = '28456789',
    genero = 'Masculino',
    fecha_nacimiento = '1982-04-15',
    telefono = '+54 370 442-6189',
    direccion = 'Saavedra 317, Formosa Capital'
WHERE usuario_id = '0ccd59a9-7d72-438a-af1e-378a842153ba';

-- Asignar cargo institucional 3FN directo a la Autoridad si existe la columna usuario_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'cargo_institucional' 
          AND column_name = 'usuario_id'
    ) THEN
        INSERT INTO public.cargo_institucional (
            usuario_id,
            id_sede,
            nombre_cargo,
            legajo_o_matricula,
            activo
        ) VALUES (
            '0ccd59a9-7d72-438a-af1e-378a842153ba',
            1004, -- Edificio Comisaría 1ra (Saavedra 317)
            'Oficial de Guardia en Comisaría',
            'LP-POL-30415',
            true
        )
        ON CONFLICT (usuario_id) DO UPDATE SET
            id_sede = EXCLUDED.id_sede,
            nombre_cargo = EXCLUDED.nombre_cargo,
            legajo_o_matricula = EXCLUDED.legajo_o_matricula,
            activo = EXCLUDED.activo;
    END IF;
END $$;

-- =============================================================================
-- ASIGNACIÓN DE ROL ADMINISTRADOR A mdarioc1998@gmail.com Y ELIMINACIÓN DE MOCK
-- =============================================================================

-- 1. Asignar perfil 'Administrador' a Miguel Dario Coronel (5fbbf4ee-da82-45d4-bc76-46528164ab35)
INSERT INTO public.usuario_tiene_perfil (
    usuario_id,
    perfil_id,
    estado_aprobacion,
    aprobado_por,
    aprobado_en,
    notas
)
SELECT 
    '5fbbf4ee-da82-45d4-bc76-46528164ab35',
    p.id,
    'activo',
    '5fbbf4ee-da82-45d4-bc76-46528164ab35',
    NOW(),
    'Administrador Global del Sistema asignado a cuenta principal'
FROM public.perfil p
WHERE LOWER(p.nombre) = 'administrador'
ON CONFLICT (usuario_id, perfil_id) DO UPDATE SET
    estado_aprobacion = 'activo',
    aprobado_en = NOW(),
    notas = 'Administrador Global del Sistema asignado a cuenta principal';

-- 2. Eliminar cuenta de prueba admin@apoyar.gob.ar (0a52bfaf-5228-4786-939f-0b217b2692bc)
DELETE FROM public.usuario_tiene_perfil WHERE usuario_id = '0a52bfaf-5228-4786-939f-0b217b2692bc';
DELETE FROM public.persona WHERE usuario_id = '0a52bfaf-5228-4786-939f-0b217b2692bc';
DELETE FROM auth.users WHERE id = '0a52bfaf-5228-4786-939f-0b217b2692bc';
