-- ============================================================================
-- 024 — Datos personales visibles sólo para su titular (RNF-02, Ley N.º 25.326)
--
-- Hasta ahora (migraciones 017 y 018):
--   · persona:  SELECT ... USING (true) para el rol public  → cualquiera con la clave
--               pública de Supabase podía leer nombre, DNI, teléfono y domicilio de todos.
--               INSERT ... WITH CHECK (true) → cualquiera podía insertar filas.
--   · usuario:  FOR ALL TO authenticated USING (true) → cualquier usuario autenticado podía
--               leer, modificar o borrar cualquier fila; además SELECT para anon.
--   · vw_usuario: vista sobre usuario que se ejecuta con los permisos de su dueño, por lo
--               que saltea las políticas de la tabla.
--   · evidencia: la Autoridad podía insertar filas de evidencia directamente.
--
-- Con esta migración cada persona sólo lee y actualiza su propia fila. Todo lo demás ya
-- pasa por caminos que no dependen de estas políticas y siguen funcionando igual:
--   · la red de apoyo se consulta con las funciones obtener_red, obtener_mi_nombre,
--     agregar_contacto_por_codigo y actualizar_contacto_red (SECURITY DEFINER);
--   · el alta de cuentas la hace el disparador handle_new_user (SECURITY DEFINER);
--   · el backend y el panel de operadores usan la clave de servicio.
-- La Autoridad conserva la lectura de los metadatos de evidencia (auditoría de integridad),
-- que es parte del diseño; el contenido sigue exigiendo consentimiento en el backend.
--
-- ANTES DE APLICAR: listar las políticas vigentes, por si alguna se creó desde el panel
-- de Supabase con otro nombre y hay que quitarla a mano:
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('persona', 'usuario', 'evidencia');
--
-- DESPUÉS DE APLICAR, probar: iniciar sesión, ver y editar el perfil, listar y vincular
-- contactos, activar una emergencia (el contacto debe ver el nombre) y el panel web.
-- ============================================================================

-- ── persona ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Usuarios pueden leer cualquier persona" ON public.persona;
DROP POLICY IF EXISTS "persona_select_own" ON public.persona;
DROP POLICY IF EXISTS "persona_insert_own" ON public.persona;
DROP POLICY IF EXISTS "persona_insert_policy" ON public.persona;

DROP POLICY IF EXISTS "persona_select_titular" ON public.persona;
CREATE POLICY "persona_select_titular"
ON public.persona FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.usuario u
    WHERE u.per_id_persona = persona.per_id_persona
      AND u.usu_id_usuario = (SELECT auth.uid())
  )
);
-- "persona_update_own" (migración 018) ya limita la actualización a la fila propia.
-- No hay política de INSERT: las filas las crean el disparador de alta y el backend.

-- ── usuario ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "usuario_all_admin" ON public.usuario;
DROP POLICY IF EXISTS "usuario_select_policy" ON public.usuario;

DROP POLICY IF EXISTS "usuario_select_titular" ON public.usuario;
CREATE POLICY "usuario_select_titular"
ON public.usuario FOR SELECT TO authenticated
USING (usu_id_usuario = (SELECT auth.uid()));
-- Sin políticas de INSERT, UPDATE ni DELETE: esas operaciones las hace el backend.

-- ── vw_usuario ───────────────────────────────────────────────────────────────
-- La vista pasa a respetar las políticas de la tabla y deja de ser legible sin sesión.
ALTER VIEW public.vw_usuario SET (security_invoker = true);
REVOKE ALL ON public.vw_usuario FROM anon;

-- ── evidencia ────────────────────────────────────────────────────────────────
-- Sólo quien captura registra evidencia; la Autoridad la asocia a través del backend.
DROP POLICY IF EXISTS "evidencia_insert_autoridad" ON public.evidencia;

-- ============================================================================
-- VUELTA ATRÁS (sólo si algo deja de funcionar; restaura el comportamiento anterior):
--
--   DROP POLICY IF EXISTS "persona_select_titular" ON public.persona;
--   CREATE POLICY "persona_select_own" ON public.persona FOR SELECT TO public USING (true);
--   CREATE POLICY "persona_insert_policy" ON public.persona FOR INSERT TO public WITH CHECK (true);
--   DROP POLICY IF EXISTS "usuario_select_titular" ON public.usuario;
--   CREATE POLICY "usuario_all_admin" ON public.usuario FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY "usuario_select_policy" ON public.usuario FOR SELECT TO anon, authenticated USING (true);
--   ALTER VIEW public.vw_usuario SET (security_invoker = false);
--   GRANT SELECT ON public.vw_usuario TO anon;
--   CREATE POLICY "evidencia_insert_autoridad" ON public.evidencia FOR INSERT TO public
--     WITH CHECK (usuario_tiene_rol(auth.uid(), 'Autoridad'::character varying));
-- ============================================================================
