-- ============================================================================
-- 025 — Audio en vivo del incidente para la red de apoyo (CU-06 / RF-4.2)
--
-- Durante el Modo Resguardo, el teléfono de la víctima emite el audio del entorno
-- por un canal privado de Supabase Realtime llamado  audio_vivo:<id del incidente>.
-- El audio es efímero: no se guarda en ninguna tabla ni en Storage.
--
-- No se crean tablas, columnas ni funciones. Sólo se agregan dos políticas sobre
-- realtime.messages (Realtime Authorization) para que:
--   · únicamente la víctima titular pueda emitir en el canal de su incidente, y
--   · únicamente sus contactos activos y no pausados puedan escucharlo,
--     y sólo mientras el incidente siga en curso.
-- Autoridades y Administradores no tienen política: no pueden unirse al canal.
-- ============================================================================

DROP POLICY IF EXISTS "audio_vivo_emitir_victima" ON realtime.messages;
CREATE POLICY "audio_vivo_emitir_victima"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'audio_vivo:%'
  AND EXISTS (
    SELECT 1
    FROM public.incidente i
    WHERE i.inc_id_incidente::text = split_part((SELECT realtime.topic()), ':', 2)
      AND i.usu_id_victima = (SELECT auth.uid())
      AND i.inc_estado = 'en_curso'
  )
);

DROP POLICY IF EXISTS "audio_vivo_escuchar_red_apoyo" ON realtime.messages;
CREATE POLICY "audio_vivo_escuchar_red_apoyo"
ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'audio_vivo:%'
  AND EXISTS (
    SELECT 1
    FROM public.incidente i
    JOIN public.red_apoyo r ON r.usu_id_victima = i.usu_id_victima
    WHERE i.inc_id_incidente::text = split_part((SELECT realtime.topic()), ':', 2)
      AND i.inc_estado = 'en_curso'
      AND r.usu_id_contacto = (SELECT auth.uid())
      AND r.redapo_estado = 'activo'
      AND r.redapo_avisos_pausados = false
  )
);
