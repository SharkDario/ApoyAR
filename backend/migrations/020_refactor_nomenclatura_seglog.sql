BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'seguridad_intento_login' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.seguridad_intento_login RENAME COLUMN id TO seglog_id_seguridad;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'seguridad_intento_login' AND column_name = 'email_normalizado'
    ) THEN
        ALTER TABLE public.seguridad_intento_login RENAME COLUMN email_normalizado TO seglog_email_normalizado;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'seguridad_intento_login' AND column_name = 'intentos_fallidos'
    ) THEN
        ALTER TABLE public.seguridad_intento_login RENAME COLUMN intentos_fallidos TO seglog_intentos_fallidos;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'seguridad_intento_login' AND column_name = 'bloqueado_hasta'
    ) THEN
        ALTER TABLE public.seguridad_intento_login RENAME COLUMN bloqueado_hasta TO seglog_bloqueado_hasta;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'seguridad_intento_login' AND column_name = 'ultimo_intento'
    ) THEN
        ALTER TABLE public.seguridad_intento_login RENAME COLUMN ultimo_intento TO seglog_ultimo_intento;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'seguridad_intento_login' AND column_name = 'creado_en'
    ) THEN
        ALTER TABLE public.seguridad_intento_login RENAME COLUMN creado_en TO seglog_creado_en;
    END IF;
END $$;

DROP INDEX IF EXISTS public.idx_seguridad_intento_login_email;
CREATE INDEX IF NOT EXISTS idx_seguridad_intento_login_email 
    ON public.seguridad_intento_login (seglog_email_normalizado);

ALTER TABLE public.seguridad_intento_login DROP CONSTRAINT IF EXISTS uq_seguridad_intento_login_email;
ALTER TABLE public.seguridad_intento_login 
    ADD CONSTRAINT uq_seguridad_intento_login_email UNIQUE (seglog_email_normalizado);

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
        INSERT INTO public.seguridad_intento_login (seglog_email_normalizado, seglog_intentos_fallidos, seglog_bloqueado_hasta, seglog_ultimo_intento)
        VALUES (v_email_norm, 0, NULL, now())
        ON CONFLICT (seglog_email_normalizado) DO UPDATE
        SET seglog_intentos_fallidos = 0,
            seglog_bloqueado_hasta = NULL,
            seglog_ultimo_intento = now();

        RETURN QUERY SELECT false, 0, 0, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    SELECT s.seglog_intentos_fallidos, s.seglog_bloqueado_hasta
    INTO v_record
    FROM public.seguridad_intento_login s
    WHERE s.seglog_email_normalizado = v_email_norm
    FOR UPDATE;

    IF FOUND THEN
        IF v_record.seglog_bloqueado_hasta IS NOT NULL AND v_record.seglog_bloqueado_hasta > now() THEN
            v_seg_rest := GREATEST(0, EXTRACT(EPOCH FROM (v_record.seglog_bloqueado_hasta - now()))::INTEGER);
            RETURN QUERY SELECT true, v_seg_rest, v_record.seglog_intentos_fallidos, v_record.seglog_bloqueado_hasta;
            RETURN;
        END IF;

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
        v_nuevos_intentos := 1;
        INSERT INTO public.seguridad_intento_login (seglog_email_normalizado, seglog_intentos_fallidos, seglog_bloqueado_hasta, seglog_ultimo_intento)
        VALUES (v_email_norm, 1, NULL, now());

        RETURN QUERY SELECT false, 0, 1, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_consultar_estado_bloqueo(TEXT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.fn_registrar_intento_login(TEXT, BOOLEAN) TO service_role, postgres;

COMMIT;

