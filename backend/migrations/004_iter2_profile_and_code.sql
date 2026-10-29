-- backend/migrations/004_iter2_profile_and_code.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Actualización de Permisos, Columna codigo_vinculacion y RPC de Vinculación
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Agregar columna para código de vinculación personalizado si no existe
ALTER TABLE public.persona 
  ADD COLUMN IF NOT EXISTS codigo_vinculacion VARCHAR(20) UNIQUE;

-- 2. Asegurar privilegios de acceso a la tabla persona
GRANT ALL ON TABLE public.persona TO authenticated;
GRANT SELECT ON TABLE public.persona TO anon;

-- 3. Habilitar RLS y políticas seguras para lectura y edición
ALTER TABLE public.persona ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "persona_select_own" ON public.persona;
CREATE POLICY "persona_select_own" ON public.persona
  FOR SELECT TO authenticated
  USING (true); -- Permite leer el propio perfil y el de contactos vinculados

DROP POLICY IF EXISTS "persona_update_own" ON public.persona;
CREATE POLICY "persona_update_own" ON public.persona
  FOR UPDATE TO authenticated
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

DROP POLICY IF EXISTS "persona_insert_own" ON public.persona;
CREATE POLICY "persona_insert_own" ON public.persona
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = usuario_id);

-- 4. Actualizar función RPC para agregar contacto por código personalizado o ID
CREATE OR REPLACE FUNCTION public.agregar_contacto_por_codigo(
  p_victima_id UUID,
  p_codigo TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contacto_id UUID;
BEGIN
  -- Buscar primero por codigo_vinculacion en persona
  SELECT usuario_id INTO v_contacto_id
  FROM public.persona
  WHERE LOWER(TRIM(codigo_vinculacion)) = LOWER(TRIM(p_codigo))
  LIMIT 1;

  -- Si no se encontró por código personalizado, buscar por prefijo de usuario_id
  IF v_contacto_id IS NULL THEN
    SELECT id INTO v_contacto_id
    FROM auth.users
    WHERE LOWER(SUBSTRING(id::text, 1, LENGTH(TRIM(p_codigo)))) = LOWER(TRIM(p_codigo))
    LIMIT 1;
  END IF;

  -- Si no existe o intenta agregarse a sí mismo
  IF v_contacto_id IS NULL OR v_contacto_id = p_victima_id THEN
    RETURN FALSE;
  END IF;

  -- Insertar vínculo bidireccional en red_apoyo
  INSERT INTO public.red_apoyo (victima_id, contacto_id, estado)
  VALUES (p_victima_id, v_contacto_id, 'activo')
  ON CONFLICT (victima_id, contacto_id) DO UPDATE SET estado = 'activo';

  INSERT INTO public.red_apoyo (victima_id, contacto_id, estado)
  VALUES (v_contacto_id, p_victima_id, 'activo')
  ON CONFLICT (victima_id, contacto_id) DO UPDATE SET estado = 'activo';

  RETURN TRUE;
END;
$$;
