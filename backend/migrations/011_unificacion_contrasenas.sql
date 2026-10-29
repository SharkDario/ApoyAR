-- ==============================================================================
-- MIGRACIÓN 011: UNIFICACIÓN GENERAL DE CONTRASEÑAS Y CENTRALIZACIÓN
-- Revierte la separación de contraseñas para unificar en un solo atributo/sistema
-- de contraseña general para cualquier tipo de usuario (App Móvil y Panel Web),
-- centralizando el acceso y el flujo de recuperación de contraseña por correo.
-- ==============================================================================

-- 1. Eliminar columnas redundantes o separadas de contraseña institucional si existieran
ALTER TABLE public.usuario DROP COLUMN IF EXISTS password_institucional_hash;
ALTER TABLE public.persona DROP COLUMN IF EXISTS password_institucional_hash;

-- 2. Asegurar y documentar el atributo único unificado password_hash en public.usuario
COMMENT ON COLUMN public.usuario.password_hash IS 'Hash de credencial unificada y general para todos los usuarios (App Móvil y Panel Web), sincronizado con Supabase Auth y modificable exclusivamente mediante el flujo de recuperación de contraseña por correo electrónico.';
