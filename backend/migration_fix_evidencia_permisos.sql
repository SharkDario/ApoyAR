-- =============================================================================
-- ApoyAR - Fix de permisos de lectura sobre `evidencia` ("Mis Pruebas")
-- Error resuelto: "permission denied for table evidencia"
--
-- Causa: el rol `authenticated` no tenía GRANT SELECT sobre la tabla (el error
-- es de privilegios de tabla, anterior a RLS) y tampoco existía una política
-- que deje a la dueña leer sus propias evidencias.
--
-- Mantiene la inmutabilidad: NO se otorga UPDATE ni DELETE.
-- Ejecutar en Supabase > SQL Editor.
-- =============================================================================

-- 1. Privilegio de tabla: solo lectura (la inserción ya la hace el backend).
GRANT SELECT ON public.evidencia TO authenticated;

-- 2. RLS activo (idempotente).
ALTER TABLE public.evidencia ENABLE ROW LEVEL SECURITY;

-- 3. La dueña de la evidencia puede leerla.
DROP POLICY IF EXISTS "evidencia_select_propia" ON public.evidencia;
CREATE POLICY "evidencia_select_propia"
    ON public.evidencia FOR SELECT
    TO authenticated
    USING (usuario_id = auth.uid());

-- 4. La víctima dueña del incidente también puede leer las evidencias de su
--    incidente (aunque las haya subido otra persona).
DROP POLICY IF EXISTS "evidencia_select_victima_incidente" ON public.evidencia;
CREATE POLICY "evidencia_select_victima_incidente"
    ON public.evidencia FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.incidente i
            WHERE i.id = evidencia.incidente_id
              AND i.victima_id = auth.uid()
        )
    );

-- 5. La consulta de la app trae también datos del incidente (origen, fecha,
--    dirección): la víctima debe poder leer sus propios incidentes.
GRANT SELECT ON public.incidente TO authenticated;

DROP POLICY IF EXISTS "incidente_select_propio" ON public.incidente;
CREATE POLICY "incidente_select_propio"
    ON public.incidente FOR SELECT
    TO authenticated
    USING (victima_id = auth.uid());

-- Verificación (opcional): debe listar las políticas nuevas.
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE tablename IN ('evidencia', 'incidente');
