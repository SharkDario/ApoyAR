-- ============================================================================
-- 023 — Bucket «evidencias»: cada persona sólo accede a su propia carpeta (RNF-02)
--
-- Hasta ahora cualquier usuario autenticado podía leer y subir objetos del bucket
-- (políticas de la migración 003). Los archivos están cifrados en sobre, pero el
-- permiso era más amplio de lo necesario.
--
-- La app guarda cada archivo en  <id del usuario>/<id del incidente>/<archivo>,
-- así que alcanza con comparar la primera carpeta con auth.uid().
-- El backend usa la clave de servicio y no depende de estas políticas: la
-- exportación judicial y la auditoría con consentimiento siguen funcionando igual.
--
-- No se agrega política de UPDATE ni de DELETE: un archivo subido no se puede
-- sobrescribir ni borrar desde la app.
--
-- Antes de aplicar, conviene listar las políticas vigentes por si hay alguna
-- creada desde el panel de Supabase con otro nombre:
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects';
-- ============================================================================

DROP POLICY IF EXISTS "evidencias_upload_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "evidencias_select_authenticated" ON storage.objects;

DROP POLICY IF EXISTS "evidencias_subir_titular" ON storage.objects;
CREATE POLICY "evidencias_subir_titular"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'evidencias'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    );

DROP POLICY IF EXISTS "evidencias_leer_titular" ON storage.objects;
CREATE POLICY "evidencias_leer_titular"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'evidencias'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    );
