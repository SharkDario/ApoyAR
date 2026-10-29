-- ==============================================================================
-- MIGRACIÓN 010: DERECHO DE SUPRESIÓN Y OLVIDO DE DATOS PERSONALES (ART. 16 LEY 25.326)
-- Implementa la eliminación soberana e irreversible de cuenta y datos probatorios
-- preservando el control de custodia forense ante borrados no autorizados.
-- ==============================================================================

-- 1. Actualizar fn_prevent_evidencia_tampering para admitir supresión soberana autorizada
CREATE OR REPLACE FUNCTION public.fn_prevent_evidencia_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Permitir supresión bajo Derecho al Olvido / Supresión de Datos Personales (Art. 16 Ley 25.326)
        IF current_setting('app.derecho_supresion', true) = 'true' THEN
            RETURN OLD;
        END IF;

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

-- 2. Actualizar fn_proteger_inmutabilidad_evidencia para admitir supresión soberana autorizada
CREATE OR REPLACE FUNCTION public.fn_proteger_inmutabilidad_evidencia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.derecho_supresion', true) = 'true' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: La tabla evidencia es un log inmutable de solo adición (Append-Only Log). No se permite eliminar registros probatorios.';
    ELSIF TG_OP = 'UPDATE' THEN
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

-- 3. Procedimiento almacenado atómico con SECURITY DEFINER para eliminación de cuenta
CREATE OR REPLACE FUNCTION public.fn_eliminar_cuenta_usuario(p_usuario_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_evidencias_eliminadas INT := 0;
    v_incidentes_eliminados INT := 0;
BEGIN
    -- Habilitar bandera de supresión de datos bajo Ley 25.326 en la sesión local
    PERFORM set_config('app.derecho_supresion', 'true', true);

    -- 1. Eliminar evidencias vinculadas al usuario o a sus incidentes
    DELETE FROM public.evidencia
    WHERE usuario_id = p_usuario_id
       OR incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id);
    GET DIAGNOSTICS v_evidencias_eliminadas = ROW_COUNT;

    -- 2. Eliminar reportes judiciales y auditoría de exportación asociados
    DELETE FROM public.reporte_judicial
    WHERE incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id)
       OR generado_por_id = p_usuario_id;

    DELETE FROM public.exportacion_evidencia
    WHERE solicitado_por = p_usuario_id
       OR referencia_id IN (SELECT id::text FROM public.incidente WHERE victima_id = p_usuario_id);

    -- 3. Eliminar historiales de incidentes
    DELETE FROM public.historial_incidente
    WHERE incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id);

    -- 4. Eliminar incidentes de la víctima
    DELETE FROM public.incidente
    WHERE victima_id = p_usuario_id;
    GET DIAGNOSTICS v_incidentes_eliminados = ROW_COUNT;

    -- 5. Eliminar red de apoyo (tanto como víctima como contacto)
    DELETE FROM public.red_apoyo
    WHERE victima_id = p_usuario_id OR contacto_id = p_usuario_id;

    -- 6. Eliminar dispositivos
    DELETE FROM public.dispositivo_usuario
    WHERE usuario_id = p_usuario_id;

    -- 7. Eliminar perfiles y cargos
    DELETE FROM public.cargo_institucional
    WHERE usuario_id = p_usuario_id;

    DELETE FROM public.usuario_tiene_perfil
    WHERE usuario_id = p_usuario_id;

    -- 8. Eliminar perfil de usuario
    DELETE FROM public.usuario
    WHERE id = p_usuario_id;

    -- 9. Eliminar de auth.users
    DELETE FROM auth.users
    WHERE id = p_usuario_id;

    RETURN jsonb_build_object(
        'success', true,
        'usuario_id', p_usuario_id,
        'evidencias_eliminadas', v_evidencias_eliminadas,
        'incidentes_eliminados', v_incidentes_eliminados,
        'mensaje', 'Cuenta y datos personales eliminados permanentemente (Art. 16 Ley 25.326).'
    );
END;
$$;

-- Otorgar ejecución a authenticated y service_role
GRANT EXECUTE ON FUNCTION public.fn_eliminar_cuenta_usuario(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_eliminar_cuenta_usuario(UUID) TO authenticated;
