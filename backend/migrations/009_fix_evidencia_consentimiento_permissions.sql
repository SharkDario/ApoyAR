-- ==============================================================================
-- MIGRACIÓN 009: PERMISOS Y RLS DE CONSENTIMIENTO SOBERANO EN EVIDENCIA (LEY 25.326)
-- Permite a víctimas y autores actualizar consentimiento_exportacion y fecha_consentimiento
-- preservando estrictamente la inmutabilidad de la cadena de custodia forense.
-- ==============================================================================

-- 1. Otorgar privilegios UPDATE al rol authenticated en public.evidencia y public.incidente
GRANT UPDATE ON TABLE public.evidencia TO authenticated;
GRANT UPDATE ON TABLE public.incidente TO authenticated;

-- 2. Asegurar RLS en public.evidencia para UPDATE
ALTER TABLE public.evidencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios pueden actualizar consentimiento de sus propias evidencias" ON public.evidencia;

CREATE POLICY "Usuarios pueden actualizar consentimiento de sus propias evidencias"
ON public.evidencia
FOR UPDATE
TO authenticated
USING (
  usuario_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.incidente i
    WHERE i.id = evidencia.incidente_id
    AND i.victima_id = auth.uid()
  )
)
WITH CHECK (
  usuario_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.incidente i
    WHERE i.id = evidencia.incidente_id
    AND i.victima_id = auth.uid()
  )
);

-- 3. Asegurar RLS en public.incidente para UPDATE de la víctima
DROP POLICY IF EXISTS "incidente_update_victima_own" ON public.incidente;
DROP POLICY IF EXISTS "Usuarios pueden actualizar consentimiento de sus propios incidentes" ON public.incidente;

CREATE POLICY "incidente_update_victima_own"
ON public.incidente
FOR UPDATE
TO authenticated
USING (
  victima_id = auth.uid()
)
WITH CHECK (
  victima_id = auth.uid()
);

-- 4. Actualizar función fn_prevent_evidencia_tampering para permitir actualización de consentimiento (Ley 25.326)
CREATE OR REPLACE FUNCTION public.fn_prevent_evidencia_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Violación de custodia forense: Se prohíbe la eliminación de registros en la tabla evidencia (Append-Only Log).'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Verificar que ningún atributo criptográfico ni forense sea alterado
        IF NEW.id = OLD.id AND
           NEW.incidente_id = OLD.incidente_id AND
           NEW.usuario_id = OLD.usuario_id AND
           NEW.tipo_archivo = OLD.tipo_archivo AND
           NEW.url_almacenamiento = OLD.url_almacenamiento AND
           NEW.hash_sha256 = OLD.hash_sha256 AND
           NEW.firma_hardware IS NOT DISTINCT FROM OLD.firma_hardware AND
           NEW.prev_hash IS NOT DISTINCT FROM OLD.prev_hash AND
           NEW.fecha_captura = OLD.fecha_captura AND
           NEW.metadata_dispositivo IS NOT DISTINCT FROM OLD.metadata_dispositivo AND
           (NEW.token_rfc3161 IS NOT DISTINCT FROM OLD.token_rfc3161 OR (OLD.token_rfc3161 IS NULL AND NEW.token_rfc3161 IS NOT NULL)) THEN
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Violación de custodia forense: El registro de evidencia es estrictamente inmutable y solo admite estampado diferido RFC 3161 o actualización de consentimiento (Ley 25.326).'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 5. Actualizar función fn_proteger_inmutabilidad_evidencia para consistencia
CREATE OR REPLACE FUNCTION public.fn_proteger_inmutabilidad_evidencia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Operación rechazada: La tabla evidencia es un log inmutable de solo adición (Append-Only Log). No se permite eliminar registros probatorios.';
    ELSIF TG_OP = 'UPDATE' THEN
        -- Permitir estampado diferido del token RFC 3161 o actualización de consentimiento (Ley 25.326)
        -- preservando estrictamente idénticos todos los atributos forenses.
        IF NEW.id = OLD.id AND
           NEW.incidente_id = OLD.incidente_id AND
           NEW.usuario_id = OLD.usuario_id AND
           NEW.tipo_archivo = OLD.tipo_archivo AND
           NEW.url_almacenamiento = OLD.url_almacenamiento AND
           NEW.hash_sha256 = OLD.hash_sha256 AND
           NEW.firma_hardware IS NOT DISTINCT FROM OLD.firma_hardware AND
           NEW.prev_hash IS NOT DISTINCT FROM OLD.prev_hash AND
           (NEW.token_rfc3161 IS NOT DISTINCT FROM OLD.token_rfc3161 OR (OLD.token_rfc3161 IS NULL AND NEW.token_rfc3161 IS NOT NULL)) THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: Los registros de evidencia no pueden ser alterados una vez consolidados.';
    END IF;

    RETURN NEW;
END;
$$;
