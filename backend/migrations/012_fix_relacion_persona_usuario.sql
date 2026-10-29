-- =============================================================================
-- MIGRACIÓN 012: CORRECCIÓN DE RELACIÓN PERSONA-USUARIO Y DEPURACIÓN DE CUENTA
-- 1. Sincronización bidireccional persona_id en public.usuario.
-- 2. Trigger en public.persona y actualización de handle_new_user() para persistir persona_id.
-- 3. Asignación explícita del rol Victima a mdarioc1998@gmail.com (unificando app móvil y web admin).
-- 4. Eliminación de la cuenta de prueba obsoleta con typo (mdarioc1998@gmail.comm).
-- =============================================================================

-- 1. Actualizar persona_id en public.usuario con los IDs actuales de public.persona
UPDATE public.usuario u
SET persona_id = p.id
FROM public.persona p
WHERE p.usuario_id = u.id AND (u.persona_id IS NULL OR u.persona_id != p.id);

-- 2. Asegurar que todos los usuarios de auth.users existan en public.usuario con persona_id sincronizado
INSERT INTO public.usuario (id, persona_id, email, activo, creado_en)
SELECT u.id, p.id, u.email, true, u.created_at
FROM auth.users u
LEFT JOIN public.persona p ON p.usuario_id = u.id
ON CONFLICT (id) DO UPDATE SET
  persona_id = COALESCE(EXCLUDED.persona_id, public.usuario.persona_id),
  email = EXCLUDED.email;

-- 3. Trigger para mantener sincronizado public.usuario.persona_id cuando se inserte/modifique persona
CREATE OR REPLACE FUNCTION public.fn_sync_persona_to_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.usuario_id IS NOT NULL THEN
    UPDATE public.usuario
    SET persona_id = NEW.id
    WHERE id = NEW.usuario_id AND (persona_id IS NULL OR persona_id != NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_persona_sync_usuario ON public.persona;
CREATE TRIGGER tr_persona_sync_usuario
AFTER INSERT OR UPDATE OF usuario_id ON public.persona
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_persona_to_usuario();

-- 4. Actualizar trigger handle_new_user() para registrar en persona y en usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_persona_id UUID;
BEGIN
  -- Insertar o actualizar datos de persona
  INSERT INTO public.persona (
    usuario_id, nombre, apellido, dni,
    telefono, genero, fecha_nacimiento, direccion
  )
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'nombre', ''), 'Sin nombre'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'apellido', ''), 'Sin apellido'),
    NULLIF(NEW.raw_user_meta_data->>'dni', ''),
    NULLIF(NEW.raw_user_meta_data->>'telefono', ''),
    NULLIF(NEW.raw_user_meta_data->>'genero', ''),
    CASE 
      WHEN NULLIF(NEW.raw_user_meta_data->>'fecha_nacimiento', '') IS NOT NULL 
      THEN to_date(NEW.raw_user_meta_data->>'fecha_nacimiento', 'YYYY-MM-DD')
      ELSE NULL
    END,
    NULLIF(NEW.raw_user_meta_data->>'direccion', '')
  )
  ON CONFLICT (usuario_id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    apellido = EXCLUDED.apellido
  RETURNING id INTO v_persona_id;

  -- Sincronizar en public.usuario
  INSERT INTO public.usuario (id, persona_id, email, activo, creado_en)
  VALUES (NEW.id, v_persona_id, NEW.email, true, NEW.created_at)
  ON CONFLICT (id) DO UPDATE SET
    persona_id = COALESCE(EXCLUDED.persona_id, public.usuario.persona_id),
    email = EXCLUDED.email;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_new_user error para %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- 5. Asignar perfil Victima (móvil) a mdarioc1998@gmail.com para unificar rol civil y administrativo
INSERT INTO public.usuario_tiene_perfil (usuario_id, perfil_id, estado_aprobacion, notas)
VALUES (
  '5fbbf4ee-da82-45d4-bc76-46528164ab35',
  '41909988-8cb7-44db-81c6-4699c2401d40',
  'activo',
  'Perfil de usuario móvil (Víctima) unificado con Administrador y Autoridad'
)
ON CONFLICT (usuario_id, perfil_id) DO NOTHING;

-- 6. Eliminar usuario de prueba duplicado con typo (mdarioc1998@gmail.comm)
DELETE FROM public.persona WHERE usuario_id = 'd7c9be1b-ad2b-461e-816e-7e48291aa759';
DELETE FROM public.usuario WHERE id = 'd7c9be1b-ad2b-461e-816e-7e48291aa759';
DELETE FROM auth.users WHERE id = 'd7c9be1b-ad2b-461e-816e-7e48291aa759';
