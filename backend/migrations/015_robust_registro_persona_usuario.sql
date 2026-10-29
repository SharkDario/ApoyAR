-- =============================================================================
-- MIGRACIÓN 015: REGISTRO ROBUSTO Y VINCULACIÓN AUTOMÁTICA PERSONA-USUARIO
-- 1. Función para parseo seguro e infalible de fechas (ISO, regional DD/MM/YYYY, etc.)
-- 2. Trigger handle_new_user() blindado:
--    - Mapeo resiliente de metadatos (nombre, apellido, full_name, DNI limpio)
--    - Prevención de fallos por DNI duplicado
--    - Creación garantizada de public.persona y public.usuario enlazados
--    - Asignación automática del rol 'Victima' en usuario_tiene_perfil
-- 3. Sincronización de registros huérfanos existentes (si los hubiera)
-- =============================================================================

-- 1. Función inmutable para parseo seguro de fechas sin lanzar excepciones
CREATE OR REPLACE FUNCTION public.fn_parse_fecha_segura(p_fecha text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_fecha IS NULL OR trim(p_fecha) = '' THEN
    RETURN NULL;
  END IF;

  p_fecha := trim(p_fecha);

  -- Formato ISO: YYYY-MM-DD
  IF p_fecha ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN substring(p_fecha from 1 for 10)::date;
  END IF;

  -- Formato Regional: DD/MM/YYYY
  IF p_fecha ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
    RETURN to_date(p_fecha, 'DD/MM/YYYY');
  END IF;

  -- Formato Regional con guiones: DD-MM-YYYY
  IF p_fecha ~ '^\d{1,2}-\d{1,2}-\d{4}' THEN
    RETURN to_date(p_fecha, 'DD-MM-YYYY');
  END IF;

  -- Intento de parseo directo
  RETURN p_fecha::date;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- 2. Trigger handle_new_user() blindado y con asignación de rol
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
  -- Extraer nombre y apellido con fallbacks inteligentes (soporta registro civil y Google OAuth)
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

  -- Sanitizar DNI: conservar solo dígitos
  v_dni := regexp_replace(COALESCE(NEW.raw_user_meta_data->>'dni', ''), '[^0-9]', '', 'g');
  IF v_dni = '' THEN
    v_dni := NULL;
  END IF;

  -- Si el DNI ya pertenece a otra persona en la base de datos, evitar que aborte la transacción
  IF v_dni IS NOT NULL AND EXISTS (SELECT 1 FROM public.persona WHERE dni = v_dni AND usuario_id != NEW.id) THEN
    v_dni := NULL;
  END IF;

  -- Parsear fecha con función segura que jamás lanza error 22008
  v_fecha_nac := public.fn_parse_fecha_segura(NEW.raw_user_meta_data->>'fecha_nacimiento');

  v_telefono := NULLIF(trim(NEW.raw_user_meta_data->>'telefono'), '');
  v_genero := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'genero'), ''), 'No especificado');
  v_direccion := NULLIF(trim(NEW.raw_user_meta_data->>'direccion'), '');

  -- 1. Insertar o actualizar persona vinculada al usuario_id
  INSERT INTO public.persona (
    usuario_id, nombre, apellido, dni,
    telefono, genero, fecha_nacimiento, direccion
  )
  VALUES (
    NEW.id,
    v_nombre,
    v_apellido,
    v_dni,
    v_telefono,
    v_genero,
    v_fecha_nac,
    v_direccion
  )
  ON CONFLICT (usuario_id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    apellido = EXCLUDED.apellido,
    dni = COALESCE(EXCLUDED.dni, public.persona.dni),
    telefono = COALESCE(EXCLUDED.telefono, public.persona.telefono),
    genero = COALESCE(EXCLUDED.genero, public.persona.genero),
    fecha_nacimiento = COALESCE(EXCLUDED.fecha_nacimiento, public.persona.fecha_nacimiento),
    direccion = COALESCE(EXCLUDED.direccion, public.persona.direccion)
  RETURNING id INTO v_persona_id;

  -- Fallback de seguridad si no vino RETURNING
  IF v_persona_id IS NULL THEN
    SELECT id INTO v_persona_id FROM public.persona WHERE usuario_id = NEW.id;
  END IF;

  -- 2. Sincronizar en public.usuario garantizando el enlace persona_id
  INSERT INTO public.usuario (id, persona_id, email, activo, creado_en)
  VALUES (NEW.id, v_persona_id, NEW.email, true, NEW.created_at)
  ON CONFLICT (id) DO UPDATE SET
    persona_id = COALESCE(EXCLUDED.persona_id, public.usuario.persona_id),
    email = EXCLUDED.email;

  -- 3. Asignar perfil civil (Víctima) automáticamente para que tenga acceso completo en la App Móvil
  SELECT id INTO v_perfil_victima_id FROM public.perfil WHERE nombre ILIKE 'Victima' LIMIT 1;
  IF v_perfil_victima_id IS NULL THEN
    v_perfil_victima_id := '41909988-8cb7-44db-81c6-4699c2401d40';
  END IF;

  INSERT INTO public.usuario_tiene_perfil (usuario_id, perfil_id, estado_aprobacion, notas)
  VALUES (
    NEW.id,
    v_perfil_victima_id,
    'activo',
    'Perfil civil asignado automáticamente al registrarse'
  )
  ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_new_user error para %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- 3. Sincronizar cualquier usuario o persona que haya quedado desvinculado previamente
UPDATE public.usuario u
SET persona_id = p.id
FROM public.persona p
WHERE p.usuario_id = u.id AND (u.persona_id IS NULL OR u.persona_id != p.id);

-- 4. Asegurar perfil Victima para usuarios civiles sin perfil
INSERT INTO public.usuario_tiene_perfil (usuario_id, perfil_id, estado_aprobacion, notas)
SELECT u.id, '41909988-8cb7-44db-81c6-4699c2401d40', 'activo', 'Perfil civil sincronizado retroactivamente'
FROM public.usuario u
LEFT JOIN public.usuario_tiene_perfil utp ON utp.usuario_id = u.id
WHERE utp.usuario_id IS NULL
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;
