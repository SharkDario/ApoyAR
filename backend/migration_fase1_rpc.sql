-- migration_fase1_rpc.sql
CREATE OR REPLACE FUNCTION obtener_mi_nombre()
RETURNS TABLE (nombre VARCHAR, apellido VARCHAR)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT p.nombre, p.apellido 
  FROM persona p 
  WHERE p.usuario_id = auth.uid();
$$;
