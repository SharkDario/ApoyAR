-- =============================================================================
-- MIGRACIÓN 007: GOBERNANZA DE DATOS, CONSENTIMIENTO INFORMADO Y VISIBILIDAD (3FN)
-- Marco Legal y Forense: Ley 25.326, ISO/IEC 27037:2012, RFC 3161 y Ley 25.506
-- =============================================================================

-- 1. Control Soberano de Consentimiento en 'incidente'
ALTER TABLE public.incidente
    ADD COLUMN IF NOT EXISTS consentimiento_exportacion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fecha_consentimiento TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.incidente.consentimiento_exportacion IS
'Autorización explícita, libre e informada otorgada por la víctima/testigo para que las autoridades policiales y judiciales competentes puedan visualizar, reproducir y exportar el material probatorio multimedia (Ley 25.326).';

COMMENT ON COLUMN public.incidente.fecha_consentimiento IS
'Marca temporal exacta en la que el titular de los datos habilitó el acceso y exportación judicial.';

-- 2. Asegurar columnas de Consentimiento en 'evidencia'
ALTER TABLE public.evidencia
    ADD COLUMN IF NOT EXISTS consentimiento_exportacion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS fecha_consentimiento TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.evidencia.consentimiento_exportacion IS
'Consentimiento informado específico sobre la pieza probatoria multimedia.';

-- 3. Fortalecer trazabilidad inmutable en 'reporte_judicial'
ALTER TABLE public.reporte_judicial
    ADD COLUMN IF NOT EXISTS legajo_snapshot VARCHAR(50) NULL,
    ADD COLUMN IF NOT EXISTS cargo_snapshot VARCHAR(120) NULL,
    ADD COLUMN IF NOT EXISTS sede_snapshot VARCHAR(150) NULL,
    ADD COLUMN IF NOT EXISTS justificacion TEXT NULL,
    ADD COLUMN IF NOT EXISTS destino_declarado VARCHAR(255) NULL;

COMMENT ON TABLE public.reporte_judicial IS
'Registro inmutable de emisión y exportación de paquetes probatorios bajo cadena de custodia forense (ISO 27037).';

COMMENT ON COLUMN public.reporte_judicial.generado_por_id IS
'UUID del funcionario autoridad que emitió el reporte, vinculado 1:1 con su cargo_institucional.';

COMMENT ON COLUMN public.reporte_judicial.legajo_snapshot IS
'Legajo profesional o número de matrícula inmutable del funcionario emisor al momento exacto de la exportación.';

-- 4. Índices para agilizar consultas con filtro de consentimiento y estado
CREATE INDEX IF NOT EXISTS idx_incidente_consentimiento ON public.incidente(consentimiento_exportacion);
CREATE INDEX IF NOT EXISTS idx_evidencia_consentimiento ON public.evidencia(consentimiento_exportacion);
CREATE INDEX IF NOT EXISTS idx_incidente_estado_activo ON public.incidente(estado) WHERE estado = 'en_curso';
