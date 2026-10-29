-- ==============================================================================
-- Migración 016: No asignar rol civil automáticamente a operadores institucionales
-- ==============================================================================
-- Modifica public.handle_new_user() para que cuando un usuario sea dado de alta
-- con metadatos institucionales (es_operador_institucional = true o roles presentes),
-- NO se le asigne automáticamente el perfil 'Víctima' / Civil.
-- Solo los usuarios civiles registrados libremente desde la App Móvil reciben 'Víctima'.
-- ==============================================================================

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
  -- Verificar si es operador institucional creado desde el Panel Web
  v_es_operador := COALESCE((NEW.raw_user_meta_data->>'es_operador_institucional')::boolean, false)
                   OR (NEW.raw_user_meta_data->'roles') IS NOT NULL;

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

  -- 3. Asignar perfil civil (Víctima) automáticamente SOLO si NO es un operador institucional
  IF NOT v_es_operador THEN
    SELECT id INTO v_perfil_victima_id FROM public.perfil WHERE nombre ILIKE 'Victima' LIMIT 1;
    IF v_perfil_victima_id IS NULL THEN
      v_perfil_victima_id := '41909988-8cb7-44db-81c6-4699c2401d40';
    END IF;

    INSERT INTO public.usuario_tiene_perfil (usuario_id, perfil_id, estado_aprobacion, notas)
    VALUES (
      NEW.id,
      v_perfil_victima_id,
      'activo',
      'Perfil civil asignado automáticamente al registrarse en App Móvil'
    )
    ON CONFLICT (usuario_id, perfil_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_new_user error para %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;
