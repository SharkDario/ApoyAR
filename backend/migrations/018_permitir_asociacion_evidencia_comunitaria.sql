-- 1. Actualizar fn_prevent_evidencia_tampering para permitir asociación formal de evidencias comunitarias
CREATE OR REPLACE FUNCTION public.fn_prevent_evidencia_tampering()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.derecho_supresion', true) = 'true' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Violación de custodia forense: Se prohíbe la eliminación de registros en la tabla evidencia (Append-Only Log).'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Integridad estricta de campos forenses y criptográficos
        IF NEW.evi_id_evidencia = OLD.evi_id_evidencia AND
           NEW.usu_id_usuario = OLD.usu_id_usuario AND
           NEW.evi_tipo_archivo = OLD.evi_tipo_archivo AND
           NEW.evi_url_almacenamiento = OLD.evi_url_almacenamiento AND
           NEW.evi_hash_sha256 = OLD.evi_hash_sha256 AND
           NEW.evi_firma_hardware IS NOT DISTINCT FROM OLD.evi_firma_hardware AND
           NEW.evi_prev_hash IS NOT DISTINCT FROM OLD.evi_prev_hash AND
           NEW.evi_fecha_captura = OLD.evi_fecha_captura AND
           NEW.evi_metadata_dispositivo IS NOT DISTINCT FROM OLD.evi_metadata_dispositivo AND
           (NEW.evi_token_rfc3161 IS NOT DISTINCT FROM OLD.evi_token_rfc3161 OR (OLD.evi_token_rfc3161 IS NULL AND NEW.evi_token_rfc3161 IS NOT NULL)) AND
           (
             -- Caso 1: Actualización conservando expediente original
             (
               NEW.inc_id_incidente IS NOT DISTINCT FROM OLD.inc_id_incidente AND
               NEW.usu_id_asociado_por IS NOT DISTINCT FROM OLD.usu_id_asociado_por AND
               NEW.evi_asociado_en IS NOT DISTINCT FROM OLD.evi_asociado_en AND
               NEW.evi_motivo_asociacion IS NOT DISTINCT FROM OLD.evi_motivo_asociacion
             )
             OR
             -- Caso 2: Vinculación formal pericial (RF-3.6 / CU-10): transición única de NULL a expediente
             (
               OLD.inc_id_incidente IS NULL AND
               NEW.inc_id_incidente IS NOT NULL AND
               NEW.usu_id_asociado_por IS NOT NULL AND
               NEW.evi_asociado_en IS NOT NULL AND
               NEW.evi_motivo_asociacion IS NOT NULL
             )
           ) THEN
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Violación de custodia forense: El registro de evidencia es estrictamente inmutable y solo admite estampado diferido RFC 3161, actualización de consentimiento o vinculación formal fundada de evidencia comunitaria aislada.'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Actualizar fn_proteger_inmutabilidad_evidencia en concordancia
CREATE OR REPLACE FUNCTION public.fn_proteger_inmutabilidad_evidencia()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.derecho_supresion', true) = 'true' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: La tabla evidencia es un log inmutable de solo adición (Append-Only Log). No se permite eliminar registros probatorios.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.evi_id_evidencia = OLD.evi_id_evidencia AND
           NEW.usu_id_usuario = OLD.usu_id_usuario AND
           NEW.evi_tipo_archivo = OLD.evi_tipo_archivo AND
           NEW.evi_url_almacenamiento = OLD.evi_url_almacenamiento AND
           NEW.evi_hash_sha256 = OLD.evi_hash_sha256 AND
           NEW.evi_firma_hardware IS NOT DISTINCT FROM OLD.evi_firma_hardware AND
           NEW.evi_prev_hash IS NOT DISTINCT FROM OLD.evi_prev_hash AND
           (NEW.evi_token_rfc3161 IS NOT DISTINCT FROM OLD.evi_token_rfc3161 OR (OLD.evi_token_rfc3161 IS NULL AND NEW.evi_token_rfc3161 IS NOT NULL)) AND
           (
             -- Caso 1: Expediente ya asignado permanece inalterable
             (
               NEW.inc_id_incidente IS NOT DISTINCT FROM OLD.inc_id_incidente AND
               NEW.usu_id_asociado_por IS NOT DISTINCT FROM OLD.usu_id_asociado_por AND
               NEW.evi_asociado_en IS NOT DISTINCT FROM OLD.evi_asociado_en AND
               NEW.evi_motivo_asociacion IS NOT DISTINCT FROM OLD.evi_motivo_asociacion
             )
             OR
             -- Caso 2: Vinculación formal fundada de evidencia comunitaria aislada
             (
               OLD.inc_id_incidente IS NULL AND
               NEW.inc_id_incidente IS NOT NULL AND
               NEW.usu_id_asociado_por IS NOT NULL AND
               NEW.evi_asociado_en IS NOT NULL AND
               NEW.evi_motivo_asociacion IS NOT NULL
             )
           ) THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: Los registros de evidencia no pueden ser alterados una vez consolidados.';
    END IF;

    RETURN NEW;
END;
$$;
