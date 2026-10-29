-- migration_fase1_telefono.sql
CREATE OR REPLACE FUNCTION obtener_telefono_victima(p_victima_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT telefono 
  FROM persona 
  WHERE usuario_id = p_victima_id;
$$;
