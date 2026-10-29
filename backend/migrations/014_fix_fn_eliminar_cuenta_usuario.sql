-- ==============================================================================
-- MIGRACIÓN 014: CORRECCIÓN DE TIPO EN fn_eliminar_cuenta_usuario (LEY 25.326)
-- Corrige el error 42883 (operator does not exist: uuid = text) en la consulta
-- sobre public.exportacion_evidencia y agrega limpieza en alerta_temprana,
-- alert_dismissals y public.persona.
-- ==============================================================================

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
    -- 0. Habilitar bandera de supresión de datos bajo Ley 25.326 en la sesión local
    PERFORM set_config('app.derecho_supresion', 'true', true);

    -- 1. Eliminar evidencias vinculadas al usuario o a sus incidentes
    DELETE FROM public.evidencia
    WHERE usuario_id = p_usuario_id
       OR incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id);
    GET DIAGNOSTICS v_evidencias_eliminadas = ROW_COUNT;

    -- 2. Eliminar reportes judiciales asociados al incidente o generados por el usuario
    DELETE FROM public.reporte_judicial
    WHERE incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id)
       OR generado_por_id = p_usuario_id;

    -- 3. Eliminar auditoría de exportación de evidencia (referencia_id es UUID, sin casteo a text)
    DELETE FROM public.exportacion_evidencia
    WHERE solicitado_por = p_usuario_id
       OR referencia_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id);

    -- 4. Eliminar alertas tempranas asociadas a los incidentes o al contacto
    DELETE FROM public.alerta_temprana
    WHERE incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id)
       OR contacto_id = p_usuario_id;

    -- 5. Eliminar descartes de alertas
    DELETE FROM public.alert_dismissals
    WHERE user_id = p_usuario_id
       OR alert_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id);

    -- 6. Eliminar historiales de incidentes
    DELETE FROM public.historial_incidente
    WHERE incidente_id IN (SELECT id FROM public.incidente WHERE victima_id = p_usuario_id);

    -- 7. Eliminar incidentes de la víctima
    DELETE FROM public.incidente
    WHERE victima_id = p_usuario_id;
    GET DIAGNOSTICS v_incidentes_eliminados = ROW_COUNT;

    -- 8. Eliminar red de apoyo (tanto como víctima como contacto)
    DELETE FROM public.red_apoyo
    WHERE victima_id = p_usuario_id OR contacto_id = p_usuario_id;

    -- 9. Eliminar dispositivos
    DELETE FROM public.dispositivo_usuario
    WHERE usuario_id = p_usuario_id;

    -- 10. Eliminar perfiles y cargos institucionales
    DELETE FROM public.cargo_institucional
    WHERE usuario_id = p_usuario_id;

    DELETE FROM public.usuario_tiene_perfil
    WHERE usuario_id = p_usuario_id;

    -- 11. Eliminar persona asociada al usuario
    DELETE FROM public.persona
    WHERE usuario_id = p_usuario_id;

    -- 12. Eliminar usuario en public.usuario
    DELETE FROM public.usuario
    WHERE id = p_usuario_id;

    -- 13. Eliminar cuenta de auth.users
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
