-- migration_fase1.sql
ALTER TABLE incidente ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE incidente ADD COLUMN IF NOT EXISTS victima_nombre TEXT;

-- Verify RLS (Since these are columns on an existing table, the current RLS policies 
-- for INSERT and SELECT will automatically apply to them).
