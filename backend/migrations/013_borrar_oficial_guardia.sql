-- =============================================================================
-- MIGRACIÓN 013: DEPURACIÓN DE USUARIO FICTICIO (OFICIAL DE GUARDIA / CARLOS PÉREZ)
-- Y LIMPIEZA RESIDUAL DE DARIO TEST
-- =============================================================================

-- 1. Eliminar referencias de cargo_institucional
DELETE FROM public.cargo_institucional 
WHERE usuario_id = '0ccd59a9-7d72-438a-af1e-378a842153ba';

-- 2. Eliminar referencias de usuario_tiene_perfil
DELETE FROM public.usuario_tiene_perfil 
WHERE usuario_id = '0ccd59a9-7d72-438a-af1e-378a842153ba';

-- 3. Eliminar persona asociada (Carlos Alberto Pérez)
DELETE FROM public.persona 
WHERE usuario_id = '0ccd59a9-7d72-438a-af1e-378a842153ba' 
   OR id = '6d12533d-f81f-4cc5-a230-68006d5e7784'
   OR nombre ILIKE '%Dario Test%';

-- 4. Eliminar de public.usuario
DELETE FROM public.usuario 
WHERE id = '0ccd59a9-7d72-438a-af1e-378a842153ba'
   OR email = 'oficial.guardia@policia.gob.ar';

-- 5. Eliminar cuenta de auth.users en Supabase Auth
DELETE FROM auth.users 
WHERE id = '0ccd59a9-7d72-438a-af1e-378a842153ba'
   OR email = 'oficial.guardia@policia.gob.ar';
