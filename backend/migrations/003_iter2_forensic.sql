-- =============================================================================
-- ApoyAR — Migración 003: Esquema Forense Multicapa e Integridad de Fase 2
-- Homólogo a backend/migration_fase2.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- SECCIÓN 1: AJUSTES Y COLUMNAS DE INTEGRIDAD
-- =============================================================================

ALTER TABLE public.evidencia ADD COLUMN IF NOT EXISTS hash_sha256 VARCHAR(64);
ALTER TABLE public.evidencia ADD COLUMN IF NOT EXISTS firma_hardware TEXT;
ALTER TABLE public.evidencia ADD COLUMN IF NOT EXISTS token_rfc3161 TEXT;
ALTER TABLE public.evidencia ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(64);
ALTER TABLE public.evidencia ADD COLUMN IF NOT EXISTS metadata_dispositivo JSONB;

ALTER TABLE public.incidente ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE public.incidente ADD COLUMN IF NOT EXISTS victima_nombre TEXT;

CREATE INDEX IF NOT EXISTS idx_evidencia_sincronizado_en ON public.evidencia(sincronizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_evidencia_hash_sha256 ON public.evidencia(hash_sha256);
CREATE INDEX IF NOT EXISTS idx_evidencia_incidente_id ON public.evidencia(incidente_id);
CREATE INDEX IF NOT EXISTS idx_evidencia_usuario_id ON public.evidencia(usuario_id);
CREATE INDEX IF NOT EXISTS idx_historial_incidente_incidente_id ON public.historial_incidente(incidente_id);
CREATE INDEX IF NOT EXISTS idx_incidente_estado ON public.incidente(estado);
CREATE INDEX IF NOT EXISTS idx_incidente_victima_id ON public.incidente(victima_id);

-- =============================================================================
-- SECCIÓN 2: DISPARADOR DE AUDITORÍA AUTOMÁTICA DE INCIDENTES (CP-IT2-07)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_auditar_incidente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_actor_id UUID;
    v_nota TEXT;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        v_actor_id := COALESCE(NEW.victima_id, OLD.victima_id);
    END IF;

    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        v_nota := COALESCE(
            NEW.notas,
            FORMAT('Transición de estado: de "%s" a "%s"', OLD.estado, NEW.estado)
        );

        INSERT INTO public.historial_incidente (
            incidente_id,
            cambiado_por_id,
            estado_anterior,
            estado_nuevo,
            notas,
            creado_en
        ) VALUES (
            NEW.id,
            v_actor_id,
            OLD.estado,
            NEW.estado,
            v_nota,
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auditar_incidente ON public.incidente;
CREATE TRIGGER tr_auditar_incidente
AFTER UPDATE OF estado ON public.incidente
FOR EACH ROW
EXECUTE FUNCTION public.fn_auditar_incidente();

-- =============================================================================
-- SECCIÓN 3: ENCADENAMIENTO SEGURO ATÓMICO (prev_hash - CP-IT2-06)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.obtener_ultimo_hash_evidencia()
RETURNS VARCHAR(64)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ultimo_hash VARCHAR(64);
BEGIN
    SELECT hash_sha256 INTO v_ultimo_hash
    FROM public.evidencia
    WHERE hash_sha256 IS NOT NULL
    ORDER BY sincronizado_en DESC, id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_ultimo_hash IS NULL THEN
        v_ultimo_hash := '0000000000000000000000000000000000000000000000000000000000000000';
    END IF;

    RETURN v_ultimo_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_asignar_prev_hash_evidencia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_ultimo VARCHAR(64);
BEGIN
    IF NEW.prev_hash IS NULL OR NEW.prev_hash = '' THEN
        SELECT hash_sha256 INTO v_ultimo
        FROM public.evidencia
        WHERE hash_sha256 IS NOT NULL
          AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
        ORDER BY sincronizado_en DESC, id DESC
        LIMIT 1;

        NEW.prev_hash := COALESCE(v_ultimo, '0000000000000000000000000000000000000000000000000000000000000000');
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_asignar_prev_hash_evidencia ON public.evidencia;
CREATE TRIGGER tr_asignar_prev_hash_evidencia
BEFORE INSERT ON public.evidencia
FOR EACH ROW
EXECUTE FUNCTION public.fn_asignar_prev_hash_evidencia();

-- =============================================================================
-- SECCIÓN 4: INMUTABILIDAD ESTRICTA (APPEND-ONLY LOG - ISO/IEC 27037)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_proteger_inmutabilidad_evidencia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Operación rechazada: La tabla evidencia es un log inmutable de solo adición (Append-Only Log). No se permite eliminar registros probatorios.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.token_rfc3161 IS NULL AND NEW.token_rfc3161 IS NOT NULL
           AND OLD.id = NEW.id
           AND OLD.incidente_id = NEW.incidente_id
           AND OLD.usuario_id = NEW.usuario_id
           AND OLD.tipo_archivo = NEW.tipo_archivo
           AND OLD.url_almacenamiento = NEW.url_almacenamiento
           AND OLD.hash_sha256 = NEW.hash_sha256
           AND OLD.firma_hardware IS NOT DISTINCT FROM NEW.firma_hardware
           AND OLD.prev_hash IS NOT DISTINCT FROM NEW.prev_hash THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: Los registros de evidencia no pueden ser alterados una vez consolidados.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_proteger_inmutabilidad_evidencia ON public.evidencia;
CREATE TRIGGER tr_proteger_inmutabilidad_evidencia
BEFORE UPDATE OR DELETE ON public.evidencia
FOR EACH ROW
EXECUTE FUNCTION public.fn_proteger_inmutabilidad_evidencia();

-- =============================================================================
-- SECCIÓN 5: PERFILES RBAC Y DATOS SEMILLA AMPLIADOS
-- =============================================================================

INSERT INTO public.perfil (nombre, descripcion, activo) VALUES
    ('Victima', 'Persona que registra incidentes y gestiona su red de apoyo.', true),
    ('Contacto', 'Persona de confianza que recibe alertas de una víctima vinculada.', true),
    ('Contacto de Emergencia', 'Persona de confianza que recibe alertas de una víctima vinculada.', true),
    ('Testigo', 'Persona que presencia o reporta un hecho y aporta evidencia colaborativa.', true),
    ('Administrativo', 'Operador con acceso a gestión y reportes. Sin datos sensibles.', true),
    ('Autoridad', 'Funcionario policial, judicial o de emergencia con acceso pericial auditado.', true)
ON CONFLICT (nombre) DO UPDATE SET
    descripcion = EXCLUDED.descripcion,
    activo = true;

CREATE OR REPLACE FUNCTION public.usuario_tiene_rol(p_usuario_id UUID, p_rol_nombre VARCHAR)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_tiene_perfil utp
    JOIN public.perfil p ON p.id = utp.perfil_id
    WHERE utp.usuario_id = p_usuario_id
      AND p.nombre = p_rol_nombre
      AND p.activo = true
  );
$$;

-- =============================================================================
-- SECCIÓN 6: POLÍTICAS RLS MULTICAPA REFORZADAS
-- =============================================================================

REVOKE UPDATE, DELETE ON public.evidencia FROM anon, authenticated;

DROP POLICY IF EXISTS "incidente_select_autoridad" ON public.incidente;
CREATE POLICY "incidente_select_autoridad"
    ON public.incidente FOR SELECT
    USING (public.usuario_tiene_rol(auth.uid(), 'Autoridad'));

DROP POLICY IF EXISTS "incidente_insert_testigo" ON public.incidente;
CREATE POLICY "incidente_insert_testigo"
    ON public.incidente FOR INSERT
    WITH CHECK (
        auth.uid() = victima_id 
        OR public.usuario_tiene_rol(auth.uid(), 'Testigo')
    );

DROP POLICY IF EXISTS "evidencia_select_autoridad" ON public.evidencia;
CREATE POLICY "evidencia_select_autoridad"
    ON public.evidencia FOR SELECT
    USING (public.usuario_tiene_rol(auth.uid(), 'Autoridad'));

DROP POLICY IF EXISTS "evidencia_insert_testigo" ON public.evidencia;
CREATE POLICY "evidencia_insert_testigo"
    ON public.evidencia FOR INSERT
    WITH CHECK (
        usuario_id = auth.uid() 
        AND (
            usuario_id = auth.uid()
            OR public.usuario_tiene_rol(auth.uid(), 'Testigo')
        )
    );

DROP POLICY IF EXISTS "historial_select_autoridad" ON public.historial_incidente;
CREATE POLICY "historial_select_autoridad"
    ON public.historial_incidente FOR SELECT
    USING (public.usuario_tiene_rol(auth.uid(), 'Autoridad'));

-- =============================================================================
-- SECCIÓN 7: STORAGE BUCKET 'evidencias' Y POLÍTICAS DE ACCESO
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'evidencias',
    'evidencias',
    false,
    52428800,
    ARRAY[
        'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 
        'audio/wav', 'audio/x-m4a', 'video/mp4', 'image/jpeg', 
        'image/png', 'application/octet-stream'
    ]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800;

DROP POLICY IF EXISTS "evidencias_upload_authenticated" ON storage.objects;
CREATE POLICY "evidencias_upload_authenticated"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'evidencias');

DROP POLICY IF EXISTS "evidencias_select_authenticated" ON storage.objects;
CREATE POLICY "evidencias_select_authenticated"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'evidencias');

-- =============================================================================
-- SECCIÓN 8: REPLICACIÓN SUPABASE REALTIME (TELEMETRÍA GPS Y ALERTAS)
-- =============================================================================

ALTER TABLE public.incidente REPLICA IDENTITY FULL;
ALTER TABLE public.alerta_temprana REPLICA IDENTITY FULL;
ALTER TABLE public.evidencia REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'incidente'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.incidente;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'alerta_temprana'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.alerta_temprana;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'evidencia'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.evidencia;
    END IF;
END;
$$;
