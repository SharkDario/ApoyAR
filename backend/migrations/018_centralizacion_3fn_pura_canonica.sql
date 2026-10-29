-- ==============================================================================
-- MIGRACIÓN 018: CENTRALIZACIÓN EN public.usuario, 3FN PURA CANÓNICA Y ESPAÑOL
-- ==============================================================================
BEGIN;

-- 1. DESACTIVAR POLÍTICAS Y VISTAS DEPENDIENTES TEMPORALMENTE
DROP VIEW IF EXISTS public.vw_usuario CASCADE;

DROP POLICY IF EXISTS "Usuarios pueden leer cualquier persona" ON public.persona;
DROP POLICY IF EXISTS "persona_insert_own" ON public.persona;
DROP POLICY IF EXISTS "persona_select_own" ON public.persona;
DROP POLICY IF EXISTS "persona_update_own" ON public.persona;

DROP POLICY IF EXISTS "Las usuarias pueden consultar sus propias alertas descartadas" ON public.alert_dismissals;
DROP POLICY IF EXISTS "Las usuarias pueden deshacer descartes de alertas" ON public.alert_dismissals;
DROP POLICY IF EXISTS "Las usuarias pueden registrar descartes de alertas" ON public.alert_dismissals;

-- 2. MIGRACIÓN Y LIMPIEZA DE DATOS ENTRE PERSONA Y USUARIO
INSERT INTO public.usuario (usu_id_usuario, usu_email, usu_activo, usu_creado_en)
SELECT id, email, true, created_at
FROM auth.users
ON CONFLICT (usu_id_usuario) DO UPDATE SET
  usu_email = EXCLUDED.usu_email;

UPDATE public.usuario u
SET 
  per_id_persona = COALESCE(u.per_id_persona, p.per_id_persona),
  usu_palabra_clave_encriptada = COALESCE(u.usu_palabra_clave_encriptada, p.per_palabra_clave_encriptada)
FROM public.persona p
WHERE p.usu_id_usuario = u.usu_id_usuario;

ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_per_id_persona_key;
ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_persona_id_fkey;
ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_per_id_persona_fkey;

ALTER TABLE public.usuario
  ADD CONSTRAINT usuario_per_id_persona_key UNIQUE (per_id_persona);

ALTER TABLE public.usuario
  ADD CONSTRAINT usuario_per_id_persona_fkey
  FOREIGN KEY (per_id_persona) REFERENCES public.persona(per_id_persona)
  ON UPDATE CASCADE ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS tr_persona_sync_usuario ON public.persona;
DROP FUNCTION IF EXISTS public.fn_sync_persona_to_usuario();

ALTER TABLE public.persona DROP CONSTRAINT IF EXISTS persona_usuario_id_fkey;
ALTER TABLE public.persona DROP CONSTRAINT IF EXISTS persona_usuario_id_key;
ALTER TABLE public.persona DROP CONSTRAINT IF EXISTS persona_usu_id_usuario_fkey;
ALTER TABLE public.persona DROP CONSTRAINT IF EXISTS persona_usu_id_usuario_key;

ALTER TABLE public.persona DROP COLUMN IF EXISTS usu_id_usuario;
ALTER TABLE public.persona DROP COLUMN IF EXISTS per_palabra_clave_encriptada;

-- 3. RENOMBRAMIENTO Y NORMALIZACIÓN DE TABLAS Y ATRIBUTOS
ALTER TABLE public.alert_dismissals RENAME TO descarte_alerta;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'descarte_alerta' AND column_name = 'altdis_dismissed_at'
  ) THEN
    ALTER TABLE public.descarte_alerta RENAME COLUMN altdis_dismissed_at TO desale_descartado_en;
  END IF;
END $$;

ALTER TABLE public.descarte_alerta DROP CONSTRAINT IF EXISTS alert_dismissals_user_id_fkey;
ALTER TABLE public.descarte_alerta DROP CONSTRAINT IF EXISTS alert_dismissals_alert_id_fkey;
ALTER TABLE public.descarte_alerta DROP CONSTRAINT IF EXISTS alert_dismissals_pkey;
ALTER TABLE public.descarte_alerta DROP CONSTRAINT IF EXISTS descarte_alerta_pkey;

ALTER TABLE public.descarte_alerta
  ADD CONSTRAINT descarte_alerta_pkey PRIMARY KEY (usu_id_usuario, inc_id_incidente);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'exportacion_evidencia' AND column_name = 'evi_id_referencia'
  ) THEN
    ALTER TABLE public.exportacion_evidencia RENAME COLUMN evi_id_referencia TO evi_id_evidencia;
  END IF;
END $$;

ALTER TABLE public.exportacion_evidencia ALTER COLUMN evi_id_evidencia DROP NOT NULL;

UPDATE public.exportacion_evidencia
SET evi_id_evidencia = NULL
WHERE expevi_tipo_exportacion = 'incidente'
  AND NOT EXISTS (SELECT 1 FROM public.evidencia e WHERE e.evi_id_evidencia = exportacion_evidencia.evi_id_evidencia);

ALTER TABLE public.exportacion_evidencia DROP CONSTRAINT IF EXISTS fk_exportacion_evidencia_evidencia;
ALTER TABLE public.exportacion_evidencia
  ADD CONSTRAINT fk_exportacion_evidencia_evidencia
  FOREIGN KEY (evi_id_evidencia) REFERENCES public.evidencia(evi_id_evidencia)
  ON UPDATE CASCADE ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'incidente' AND column_name = 'inc_last_location_at'
  ) THEN
    ALTER TABLE public.incidente RENAME COLUMN inc_last_location_at TO inc_ultima_ubicacion_en;
  END IF;
END $$;

ALTER TABLE public.evidencia ADD COLUMN IF NOT EXISTS evi_hash_cifrado VARCHAR(64);

-- 4. CENTRALIZACIÓN DE TODAS LAS FOREIGN KEYS HACIA public.usuario(usu_id_usuario)
ALTER TABLE public.dispositivo_usuario DROP CONSTRAINT IF EXISTS dispositivo_usuario_usuario_id_fkey;
ALTER TABLE public.dispositivo_usuario
  ADD CONSTRAINT dispositivo_usuario_usuario_id_fkey
  FOREIGN KEY (usu_id_usuario) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.usuario_tiene_perfil DROP CONSTRAINT IF EXISTS usuario_tiene_perfil_usuario_id_fkey;
ALTER TABLE public.usuario_tiene_perfil
  ADD CONSTRAINT usuario_tiene_perfil_usuario_id_fkey
  FOREIGN KEY (usu_id_usuario) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.usuario_tiene_perfil DROP CONSTRAINT IF EXISTS usuario_tiene_perfil_aprobado_por_fkey;
ALTER TABLE public.usuario_tiene_perfil
  ADD CONSTRAINT usuario_tiene_perfil_aprobado_por_fkey
  FOREIGN KEY (usu_id_aprobado_por) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.red_apoyo DROP CONSTRAINT IF EXISTS red_apoyo_victima_id_fkey;
ALTER TABLE public.red_apoyo
  ADD CONSTRAINT red_apoyo_victima_id_fkey
  FOREIGN KEY (usu_id_victima) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.red_apoyo DROP CONSTRAINT IF EXISTS red_apoyo_contacto_id_fkey;
ALTER TABLE public.red_apoyo
  ADD CONSTRAINT red_apoyo_contacto_id_fkey
  FOREIGN KEY (usu_id_contacto) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.incidente DROP CONSTRAINT IF EXISTS incidente_victima_id_fkey;
ALTER TABLE public.incidente
  ADD CONSTRAINT incidente_victima_id_fkey
  FOREIGN KEY (usu_id_victima) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.historial_incidente DROP CONSTRAINT IF EXISTS historial_incidente_cambiado_por_id_fkey;
ALTER TABLE public.historial_incidente
  ADD CONSTRAINT historial_incidente_cambiado_por_id_fkey
  FOREIGN KEY (usu_id_cambiado_por) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.evidencia DROP CONSTRAINT IF EXISTS evidencia_usuario_id_fkey;
ALTER TABLE public.evidencia
  ADD CONSTRAINT evidencia_usuario_id_fkey
  FOREIGN KEY (usu_id_usuario) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.evidencia DROP CONSTRAINT IF EXISTS evidencia_asociado_por_fkey;
ALTER TABLE public.evidencia
  ADD CONSTRAINT evidencia_asociado_por_fkey
  FOREIGN KEY (usu_id_asociado_por) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.alerta_temprana DROP CONSTRAINT IF EXISTS alerta_temprana_contacto_id_fkey;
ALTER TABLE public.alerta_temprana
  ADD CONSTRAINT alerta_temprana_contacto_id_fkey
  FOREIGN KEY (usu_id_contacto) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.reporte_judicial DROP CONSTRAINT IF EXISTS reporte_judicial_generado_por_id_fkey;
ALTER TABLE public.reporte_judicial
  ADD CONSTRAINT reporte_judicial_generado_por_id_fkey
  FOREIGN KEY (usu_id_generado_por) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.descarte_alerta DROP CONSTRAINT IF EXISTS descarte_alerta_usu_id_usuario_fkey;
ALTER TABLE public.descarte_alerta
  ADD CONSTRAINT descarte_alerta_usu_id_usuario_fkey
  FOREIGN KEY (usu_id_usuario) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.descarte_alerta DROP CONSTRAINT IF EXISTS descarte_alerta_inc_id_incidente_fkey;
ALTER TABLE public.descarte_alerta
  ADD CONSTRAINT descarte_alerta_inc_id_incidente_fkey
  FOREIGN KEY (inc_id_incidente) REFERENCES public.incidente(inc_id_incidente)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.exportacion_evidencia DROP CONSTRAINT IF EXISTS exportacion_evidencia_solicitado_por_fkey;
ALTER TABLE public.exportacion_evidencia
  ADD CONSTRAINT exportacion_evidencia_solicitado_por_fkey
  FOREIGN KEY (usu_id_solicitado_por) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.cargo_institucional DROP CONSTRAINT IF EXISTS cargo_institucional_usuario_id_fkey;
ALTER TABLE public.cargo_institucional
  ADD CONSTRAINT cargo_institucional_usuario_id_fkey
  FOREIGN KEY (usu_id_usuario) REFERENCES public.usuario(usu_id_usuario)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- 5. RECREAR VISTA vw_usuario
CREATE OR REPLACE VIEW public.vw_usuario AS
SELECT 
    u.usu_id_usuario,
    u.per_id_persona,
    u.usu_email,
    u.usu_password_hash,
    u.usu_palabra_clave_encriptada,
    u.usu_activo,
    u.usu_ultimo_acceso,
    u.usu_creado_en
FROM public.usuario u;

-- 6. RECREAR POLÍTICAS RLS EN persona Y descarte_alerta
ALTER TABLE public.persona ENABLE ROW LEVEL SECURITY;

CREATE POLICY "persona_select_own"
ON public.persona FOR SELECT TO public
USING (true);

CREATE POLICY "persona_insert_policy"
ON public.persona FOR INSERT TO public
WITH CHECK (true);

CREATE POLICY "persona_update_own"
ON public.persona FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.usuario u
    WHERE u.per_id_persona = persona.per_id_persona
      AND u.usu_id_usuario = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.usuario u
    WHERE u.per_id_persona = persona.per_id_persona
      AND u.usu_id_usuario = auth.uid()
  )
);

ALTER TABLE public.descarte_alerta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "descarte_alerta_select_own" ON public.descarte_alerta;
DROP POLICY IF EXISTS "descarte_alerta_insert_own" ON public.descarte_alerta;
DROP POLICY IF EXISTS "descarte_alerta_delete_own" ON public.descarte_alerta;

CREATE POLICY "descarte_alerta_select_own"
ON public.descarte_alerta FOR SELECT TO authenticated
USING (usu_id_usuario = auth.uid());

CREATE POLICY "descarte_alerta_insert_own"
ON public.descarte_alerta FOR INSERT TO authenticated
WITH CHECK (usu_id_usuario = auth.uid());

CREATE POLICY "descarte_alerta_delete_own"
ON public.descarte_alerta FOR DELETE TO authenticated
USING (usu_id_usuario = auth.uid());

GRANT ALL ON TABLE public.descarte_alerta TO authenticated;
GRANT ALL ON TABLE public.descarte_alerta TO service_role;

-- 7. ACTUALIZAR TRIGGERS Y FUNCIONES RPC
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_persona_id UUID;
  v_nombre TEXT;
  v_apellido TEXT;
  v_dni TEXT;
  v_telefono TEXT;
  v_genero TEXT;
  v_fecha_nac DATE;
  v_direccion TEXT;
  v_perfil_victima_id UUID;
  v_es_operador BOOLEAN;
BEGIN
  v_es_operador := COALESCE((NEW.raw_user_meta_data->>'es_operador_institucional')::boolean, false)
                   OR (NEW.raw_user_meta_data->'roles') IS NOT NULL;

  v_nombre := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'nombre'), ''),
    NULLIF(trim(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''), ' ', 1)), ''),
    NULLIF(trim(split_part(NEW.email, '@', 1)), ''),
    'Usuario'
  );

  v_apellido := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'apellido'), ''),
    NULLIF(trim(substring(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '') from '^[^\s]+\s+(.*)$')), ''),
    'Civil'
  );

  v_dni := regexp_replace(COALESCE(NEW.raw_user_meta_data->>'dni', ''), '[^0-9]', '', 'g');
  IF v_dni = '' THEN
    v_dni := NULL;
  END IF;

  v_fecha_nac := public.fn_parse_fecha_segura(NEW.raw_user_meta_data->>'fecha_nacimiento');
  v_telefono := NULLIF(trim(NEW.raw_user_meta_data->>'telefono'), '');
  v_genero := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'genero'), ''), 'No especificado');
  v_direccion := NULLIF(trim(NEW.raw_user_meta_data->>'direccion'), '');

  INSERT INTO public.persona (
    per_nombre, per_apellido, per_dni,
    per_telefono, per_genero, per_fecha_nacimiento, per_direccion
  )
  VALUES (
    v_nombre,
    v_apellido,
    v_dni,
    v_telefono,
    v_genero,
    v_fecha_nac,
    v_direccion
  )
  RETURNING per_id_persona INTO v_persona_id;

  INSERT INTO public.usuario (usu_id_usuario, per_id_persona, usu_email, usu_activo, usu_creado_en)
  VALUES (NEW.id, v_persona_id, NEW.email, true, NEW.created_at)
  ON CONFLICT (usu_id_usuario) DO UPDATE SET
    per_id_persona = COALESCE(public.usuario.per_id_persona, EXCLUDED.per_id_persona),
    usu_email = EXCLUDED.usu_email;

  IF NOT v_es_operador THEN
    SELECT prf_id_perfil INTO v_perfil_victima_id FROM public.perfil WHERE prf_nombre ILIKE 'Victima' LIMIT 1;
    IF v_perfil_victima_id IS NULL THEN
      v_perfil_victima_id := '41909988-8cb7-44db-81c6-4699c2401d40';
    END IF;

    INSERT INTO public.usuario_tiene_perfil (usu_id_usuario, prf_id_perfil, usuprf_estado_aprobacion, usuprf_notas)
    VALUES (
      NEW.id,
      v_perfil_victima_id,
      'activo',
      'Perfil civil asignado automáticamente al registrarse'
    )
    ON CONFLICT (usu_id_usuario, prf_id_perfil) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_new_user error para %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_actualizar_heartbeat_incidente()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF (NEW.inc_latitud IS DISTINCT FROM OLD.inc_latitud) 
       OR (NEW.inc_longitud IS DISTINCT FROM OLD.inc_longitud) 
       OR (NEW.inc_direccion IS DISTINCT FROM OLD.inc_direccion) THEN
        NEW.inc_ultima_ubicacion_en := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cerrar_incidentes_previos_victima()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.inc_estado = 'en_curso' THEN
        UPDATE public.incidente
        SET inc_estado = 'cerrado',
            inc_notas = COALESCE(inc_notas, '') || ' [Reemplazado por nuevo incidente ' || NEW.inc_id_incidente || ']'
        WHERE usu_id_victima = NEW.usu_id_victima
          AND inc_estado = 'en_curso'
          AND inc_id_incidente <> NEW.inc_id_incidente;
    END IF;

    IF NEW.inc_ultima_ubicacion_en IS NULL THEN
        NEW.inc_ultima_ubicacion_en := now();
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_mi_nombre()
RETURNS TABLE(nombre character varying, apellido character varying)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT p.per_nombre, p.per_apellido 
  FROM public.usuario u
  JOIN public.persona p ON u.per_id_persona = p.per_id_persona 
  WHERE u.usu_id_usuario = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.obtener_red(p_victima_id uuid)
RETURNS TABLE(id uuid, contacto_id uuid, nombre character varying, apellido character varying, telefono character varying)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT r.redapo_id_red, r.usu_id_contacto, p.per_nombre, p.per_apellido, p.per_telefono
  FROM public.red_apoyo r
  JOIN public.usuario u ON u.usu_id_usuario = r.usu_id_contacto
  JOIN public.persona p ON p.per_id_persona = u.per_id_persona
  WHERE r.usu_id_victima = p_victima_id AND r.redapo_estado = 'activo';
END;
$function$;

CREATE OR REPLACE FUNCTION public.obtener_telefono_victima(p_victima_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT p.per_telefono::text 
  FROM public.usuario u
  JOIN public.persona p ON u.per_id_persona = p.per_id_persona
  WHERE u.usu_id_usuario = p_victima_id;
$function$;

CREATE OR REPLACE FUNCTION public.agregar_contacto(p_victima_id uuid, p_telefono character varying)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_contacto_id UUID;
BEGIN
  SELECT u.usu_id_usuario INTO v_contacto_id 
  FROM public.usuario u
  JOIN public.persona p ON u.per_id_persona = p.per_id_persona
  WHERE REPLACE(p.per_telefono, ' ', '') = REPLACE(p_telefono, ' ', '') 
  LIMIT 1;

  IF v_contacto_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  INSERT INTO public.red_apoyo (usu_id_victima, usu_id_contacto, redapo_estado)
  VALUES (p_victima_id, v_contacto_id, 'activo')
  ON CONFLICT (usu_id_victima, usu_id_contacto) DO UPDATE SET redapo_estado = 'activo';
  
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.agregar_contacto_por_codigo(p_victima_id uuid, p_codigo character varying)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_contacto_id UUID;
BEGIN
  SELECT u.usu_id_usuario INTO v_contacto_id 
  FROM public.usuario u
  JOIN public.persona p ON u.per_id_persona = p.per_id_persona
  WHERE p.per_codigo_vinculacion ILIKE (p_codigo || '%')
     OR CAST(u.usu_id_usuario AS TEXT) ILIKE (p_codigo || '%')
  LIMIT 1;

  IF v_contacto_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  INSERT INTO public.red_apoyo (usu_id_victima, usu_id_contacto, redapo_estado)
  VALUES (p_victima_id, v_contacto_id, 'activo')
  ON CONFLICT (usu_id_victima, usu_id_contacto) DO UPDATE SET redapo_estado = 'activo';
  
  INSERT INTO public.red_apoyo (usu_id_victima, usu_id_contacto, redapo_estado)
  VALUES (v_contacto_id, p_victima_id, 'activo')
  ON CONFLICT (usu_id_victima, usu_id_contacto) DO UPDATE SET redapo_estado = 'activo';

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_eliminar_cuenta_usuario(p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_evidencias_eliminadas INT := 0;
    v_incidentes_eliminados INT := 0;
    v_persona_id UUID;
BEGIN
    PERFORM set_config('app.derecho_supresion', 'true', true);

    SELECT per_id_persona INTO v_persona_id FROM public.usuario WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.evidencia
    WHERE usu_id_usuario = p_usuario_id
       OR inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);
    GET DIAGNOSTICS v_evidencias_eliminadas = ROW_COUNT;

    DELETE FROM public.reporte_judicial
    WHERE inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id)
       OR usu_id_generado_por = p_usuario_id;

    DELETE FROM public.exportacion_evidencia
    WHERE usu_id_solicitado_por = p_usuario_id;

    DELETE FROM public.alerta_temprana
    WHERE inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id)
       OR usu_id_contacto = p_usuario_id;

    DELETE FROM public.descarte_alerta
    WHERE usu_id_usuario = p_usuario_id
       OR inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);

    DELETE FROM public.historial_incidente
    WHERE inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);

    DELETE FROM public.incidente
    WHERE usu_id_victima = p_usuario_id;
    GET DIAGNOSTICS v_incidentes_eliminados = ROW_COUNT;

    DELETE FROM public.red_apoyo
    WHERE usu_id_victima = p_usuario_id OR usu_id_contacto = p_usuario_id;

    DELETE FROM public.dispositivo_usuario
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.cargo_institucional
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.usuario_tiene_perfil
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.usuario
    WHERE usu_id_usuario = p_usuario_id;

    IF v_persona_id IS NOT NULL THEN
      DELETE FROM public.persona WHERE per_id_persona = v_persona_id;
    END IF;

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
$function$;

COMMIT;
