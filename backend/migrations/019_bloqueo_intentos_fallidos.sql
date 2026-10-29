-- ==============================================================================
-- MIGRACIÓN 019: BLOQUEO TEMPORAL POR INTENTOS FALLIDOS DE INICIO DE SESIÓN
-- ==============================================================================
-- Política de Seguridad (Estándar 3FN Canónica con prefijo seglog_):
-- - Hasta 3 intentos consecutivos fallidos de autenticación.
-- - Bloqueo de 15 minutos (900 segundos) al alcanzar el límite.
-- - Restablecimiento automático tras autenticación exitosa o al expirar los 15 minutos.
-- - Compatible con Password Verification Hook de Supabase Auth y FastAPI Backend.
-- - RLS estricto: sin acceso directo a clientes anon/authenticated.
-- ==============================================================================

BEGIN;

-- 1. TABLA AISLADA DE REGISTRO DE INTENTOS Y BLOQUEO TEMPORAL
-- Nomenclatura 3FN Canónica: entidad seguridad_intento_login -> prefijo seglog_
CREATE TABLE IF NOT EXISTS public.seguridad_intento_login (
    seglog_id_seguridad UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seglog_email_normalizado TEXT NOT NULL,
    seglog_intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    seglog_bloqueado_hasta TIMESTAMPTZ NULL,
    seglog_ultimo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
    seglog_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_seguridad_intento_login_email UNIQUE (seglog_email_normalizado)
);

CREATE INDEX IF NOT EXISTS idx_seguridad_intento_login_email
    ON public.seguridad_intento_login (seglog_email_normalizado);

-- 2. POLÍTICAS DE ACCESO Y RLS ESTRICTO
ALTER TABLE public.seguridad_intento_login ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seguridad_intento_login FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seguridad_intento_login TO service_role, postgres;

-- 3. FUNCIÓN ATÓMICA DE CONSULTA DE ESTADO DE BLOQUEO
CREATE OR REPLACE FUNCTION public.fn_consultar_estado_bloqueo(p_email TEXT)
RETURNS TABLE (
    bloqueado BOOLEAN,
    segundos_restantes INTEGER,
    intentos_fallidos INTEGER,
    bloqueado_hasta TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_email_norm TEXT;
    v_record RECORD;
    v_seg_rest INTEGER;
BEGIN
    v_email_norm := lower(trim(p_email));

    SELECT s.seglog_intentos_fallidos, s.seglog_bloqueado_hasta
    INTO v_record
    FROM public.seguridad_intento_login s
    WHERE s.seglog_email_normalizado = v_email_norm;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0, 0, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    IF v_record.seglog_bloqueado_hasta IS NOT NULL THEN
        IF v_record.seglog_bloqueado_hasta > now() THEN
            v_seg_rest := GREATEST(0, EXTRACT(EPOCH FROM (v_record.seglog_bloqueado_hasta - now()))::INTEGER);
            RETURN QUERY SELECT true, v_seg_rest, v_record.seglog_intentos_fallidos, v_record.seglog_bloqueado_hasta;
            RETURN;
        ELSE
            -- El bloqueo ha expirado automáticamente: limpiar estado
            UPDATE public.seguridad_intento_login
            SET seglog_bloqueado_hasta = NULL,
                seglog_intentos_fallidos = 0,
                seglog_ultimo_intento = now()
            WHERE seglog_email_normalizado = v_email_norm;

            RETURN QUERY SELECT false, 0, 0, NULL::TIMESTAMPTZ;
            RETURN;
        END IF;
    END IF;

    RETURN QUERY SELECT false, 0, v_record.seglog_intentos_fallidos, NULL::TIMESTAMPTZ;
END;
$$;

-- 4. FUNCIÓN ATÓMICA DE REGISTRO DE INTENTO DE INICIO DE SESIÓN
CREATE OR REPLACE FUNCTION public.fn_registrar_intento_login(p_email TEXT, p_exitoso BOOLEAN)
RETURNS TABLE (
    bloqueado BOOLEAN,
    segundos_restantes INTEGER,
    intentos_fallidos INTEGER,
    bloqueado_hasta TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_email_norm TEXT;
    v_record RECORD;
    v_nuevos_intentos INTEGER;
    v_bloqueo_hasta TIMESTAMPTZ;
    v_seg_rest INTEGER;
BEGIN
    v_email_norm := lower(trim(p_email));

    IF p_exitoso THEN
        -- Restablecer contador a 0 ante login exitoso
        INSERT INTO public.seguridad_intento_login (seglog_email_normalizado, seglog_intentos_fallidos, seglog_bloqueado_hasta, seglog_ultimo_intento)
        VALUES (v_email_norm, 0, NULL, now())
        ON CONFLICT (seglog_email_normalizado) DO UPDATE
        SET seglog_intentos_fallidos = 0,
            seglog_bloqueado_hasta = NULL,
            seglog_ultimo_intento = now();

        RETURN QUERY SELECT false, 0, 0, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    -- Intento FALLIDO:
    SELECT s.seglog_intentos_fallidos, s.seglog_bloqueado_hasta
    INTO v_record
    FROM public.seguridad_intento_login s
    WHERE s.seglog_email_normalizado = v_email_norm
    FOR UPDATE;

    IF FOUND THEN
        -- Si estaba bloqueado y el bloqueo aún sigue vigente
        IF v_record.seglog_bloqueado_hasta IS NOT NULL AND v_record.seglog_bloqueado_hasta > now() THEN
            v_seg_rest := GREATEST(0, EXTRACT(EPOCH FROM (v_record.seglog_bloqueado_hasta - now()))::INTEGER);
            RETURN QUERY SELECT true, v_seg_rest, v_record.seglog_intentos_fallidos, v_record.seglog_bloqueado_hasta;
            RETURN;
        END IF;

        -- Si el bloqueo anterior ya expiró, reinicia el ciclo desde 1
        IF v_record.seglog_bloqueado_hasta IS NOT NULL AND v_record.seglog_bloqueado_hasta <= now() THEN
            v_nuevos_intentos := 1;
        ELSE
            v_nuevos_intentos := v_record.seglog_intentos_fallidos + 1;
        END IF;

        IF v_nuevos_intentos >= 3 THEN
            v_bloqueo_hasta := now() + INTERVAL '15 minutes';
            v_seg_rest := 900;

            UPDATE public.seguridad_intento_login
            SET seglog_intentos_fallidos = v_nuevos_intentos,
                seglog_bloqueado_hasta = v_bloqueo_hasta,
                seglog_ultimo_intento = now()
            WHERE seglog_email_normalizado = v_email_norm;

            RETURN QUERY SELECT true, v_seg_rest, v_nuevos_intentos, v_bloqueo_hasta;
            RETURN;
        ELSE
            UPDATE public.seguridad_intento_login
            SET seglog_intentos_fallidos = v_nuevos_intentos,
                seglog_bloqueado_hasta = NULL,
                seglog_ultimo_intento = now()
            WHERE seglog_email_normalizado = v_email_norm;

            RETURN QUERY SELECT false, 0, v_nuevos_intentos, NULL::TIMESTAMPTZ;
            RETURN;
        END IF;
    ELSE
        -- Primera vez que falla para este email
        v_nuevos_intentos := 1;
        INSERT INTO public.seguridad_intento_login (seglog_email_normalizado, seglog_intentos_fallidos, seglog_bloqueado_hasta, seglog_ultimo_intento)
        VALUES (v_email_norm, 1, NULL, now());

        RETURN QUERY SELECT false, 0, 1, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;
END;
$$;

-- 5. PASSWORD VERIFICATION HOOK (ESTÁNDAR SUPABASE AUTH GOTRUE)
CREATE OR REPLACE FUNCTION public.hook_password_verification(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_valid BOOLEAN;
    v_email TEXT;
    v_estado RECORD;
    v_minutos INTEGER;
BEGIN
    v_user_id := (event->>'user_id')::UUID;
    v_valid := COALESCE((event->>'valid')::BOOLEAN, false);

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('decision', 'continue');
    END IF;

    SELECT email INTO v_email
    FROM auth.users
    WHERE id = v_user_id;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('decision', 'continue');
    END IF;

    -- 1. Si el usuario ya está bloqueado, rechazar de inmediato
    SELECT * INTO v_estado
    FROM public.fn_consultar_estado_bloqueo(v_email);

    IF v_estado.bloqueado THEN
        v_minutos := GREATEST(1, CEIL(v_estado.segundos_restantes / 60.0)::INTEGER);
        RETURN jsonb_build_object(
            'decision', 'reject',
            'message', 'Demasiados intentos fallidos. Su cuenta se encuentra bloqueada temporalmente. Intente nuevamente en ' || v_minutos || ' minuto(s).',
            'should_logout_user', true
        );
    END IF;

    -- 2. Registrar el intento atómico (éxito o fallo)
    SELECT * INTO v_estado
    FROM public.fn_registrar_intento_login(v_email, v_valid);

    -- 3. Si como resultado de este intento quedó bloqueado (alcanzó el 3er fallo)
    IF v_estado.bloqueado THEN
        RETURN jsonb_build_object(
            'decision', 'reject',
            'message', 'Ha superado el límite de 3 intentos fallidos de autenticación. Su cuenta ha sido bloqueada temporalmente durante 15 minutos.',
            'should_logout_user', true
        );
    END IF;

    RETURN jsonb_build_object('decision', 'continue');
END;
$$;

-- 6. PERMISOS DE EJECUCIÓN
GRANT EXECUTE ON FUNCTION public.fn_consultar_estado_bloqueo(TEXT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.fn_registrar_intento_login(TEXT, BOOLEAN) TO service_role, postgres;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        GRANT EXECUTE ON FUNCTION public.hook_password_verification(JSONB) TO supabase_auth_admin;
    END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.hook_password_verification(JSONB) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.hook_password_verification(JSONB) FROM PUBLIC, anon, authenticated;

COMMIT;
