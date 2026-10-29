-- migration_fase1_rls.sql
DROP POLICY IF EXISTS "Usuarios pueden leer su propia persona" ON persona;
CREATE POLICY "Usuarios pueden leer cualquier persona" ON persona FOR SELECT USING (true);
