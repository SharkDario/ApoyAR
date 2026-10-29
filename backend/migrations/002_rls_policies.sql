-- =============================================================================
-- ApoyAR — Migración 002: Políticas de Row Level Security (RLS)
-- Compatibilidad: Supabase (PostgreSQL 15+)
-- Ejecutar DESPUÉS de 001_schema_iter1.sql
--
-- PRINCIPIO: "Deny by default". RLS se habilita en cada tabla y solo se
-- otorgan los accesos mínimos necesarios para el flujo de Iter 1.
-- La función auth.uid() retorna el UUID del usuario autenticado por Supabase.
-- =============================================================================

-- =============================================================================
-- TABLA: persona
-- Un usuario solo puede leer y actualizar su PROPIO registro de persona.
-- El INSERT lo hace la función de registro (trigger o edge function).
-- =============================================================================
ALTER TABLE public.persona ENABLE ROW LEVEL SECURITY;

CREATE POLICY "persona_select_own"
    ON public.persona FOR SELECT
    USING (usuario_id = auth.uid());

CREATE POLICY "persona_update_own"
    ON public.persona FOR UPDATE
    USING (usuario_id = auth.uid())
    WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "persona_insert_own"
    ON public.persona FOR INSERT
    WITH CHECK (usuario_id = auth.uid());

-- =============================================================================
-- TABLA: dispositivo_usuario
-- Un usuario solo puede gestionar sus propios tokens de dispositivo.
-- =============================================================================
ALTER TABLE public.dispositivo_usuario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dispositivo_select_own"
    ON public.dispositivo_usuario FOR SELECT
    USING (usuario_id = auth.uid());

CREATE POLICY "dispositivo_insert_own"
    ON public.dispositivo_usuario FOR INSERT
    WITH CHECK (usuario_id = auth.uid());

CREATE POLICY "dispositivo_update_own"
    ON public.dispositivo_usuario FOR UPDATE
    USING (usuario_id = auth.uid());

CREATE POLICY "dispositivo_delete_own"
    ON public.dispositivo_usuario FOR DELETE
    USING (usuario_id = auth.uid());

-- =============================================================================
-- TABLAS RBAC: perfil, modulo, accion, permiso, perfil_tiene_permiso
-- Datos de solo lectura para todos los usuarios autenticados.
-- Solo el servicio backend (service_role key) puede modificarlos.
-- =============================================================================
ALTER TABLE public.perfil ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perfil_select_all_authenticated"
    ON public.perfil FOR SELECT
    TO authenticated USING (true);

ALTER TABLE public.modulo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "modulo_select_all_authenticated"
    ON public.modulo FOR SELECT
    TO authenticated USING (true);

ALTER TABLE public.accion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accion_select_all_authenticated"
    ON public.accion FOR SELECT
    TO authenticated USING (true);

ALTER TABLE public.permiso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "permiso_select_all_authenticated"
    ON public.permiso FOR SELECT
    TO authenticated USING (true);

ALTER TABLE public.perfil_tiene_permiso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perfil_permiso_select_all_authenticated"
    ON public.perfil_tiene_permiso FOR SELECT
    TO authenticated USING (true);

-- =============================================================================
-- TABLA: usuario_tiene_perfil
-- Un usuario puede leer sus propios perfiles asignados.
-- Solo el backend (service_role) puede asignar perfiles.
-- =============================================================================
ALTER TABLE public.usuario_tiene_perfil ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario_perfil_select_own"
    ON public.usuario_tiene_perfil FOR SELECT
    USING (usuario_id = auth.uid());

-- =============================================================================
-- TABLA: red_apoyo
-- - Una víctima puede ver, agregar y eliminar vínculos donde es la víctima.
-- - Un contacto puede leer los vínculos donde es el contacto (para saber
--   quién lo tiene como contacto y poder recibir su alerta).
-- =============================================================================
ALTER TABLE public.red_apoyo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "red_apoyo_select_victima"
    ON public.red_apoyo FOR SELECT
    USING (victima_id = auth.uid() OR contacto_id = auth.uid());

CREATE POLICY "red_apoyo_insert_victima"
    ON public.red_apoyo FOR INSERT
    WITH CHECK (victima_id = auth.uid());

CREATE POLICY "red_apoyo_delete_victima"
    ON public.red_apoyo FOR DELETE
    USING (victima_id = auth.uid());

-- =============================================================================
-- TABLA: incidente
-- - Una víctima puede crear y leer sus propios incidentes.
-- - Un contacto vinculado puede leer los incidentes de las víctimas que lo
--   tienen en su red de apoyo.
-- =============================================================================
ALTER TABLE public.incidente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incidente_select_victima_own"
    ON public.incidente FOR SELECT
    USING (victima_id = auth.uid());

CREATE POLICY "incidente_select_contacto_vinculado"
    ON public.incidente FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.red_apoyo
            WHERE red_apoyo.victima_id = incidente.victima_id
              AND red_apoyo.contacto_id = auth.uid()
              AND red_apoyo.estado = 'activo'
        )
    );

CREATE POLICY "incidente_insert_victima"
    ON public.incidente FOR INSERT
    WITH CHECK (victima_id = auth.uid());

CREATE POLICY "incidente_update_victima_own"
    ON public.incidente FOR UPDATE
    USING (victima_id = auth.uid());

-- =============================================================================
-- TABLA: historial_incidente
-- Solo lectura para la víctima dueña del incidente.
-- El INSERT lo hace el backend (service_role) vía triggers en Iter 2.
-- =============================================================================
ALTER TABLE public.historial_incidente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "historial_select_victima"
    ON public.historial_incidente FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.incidente
            WHERE incidente.id = historial_incidente.incidente_id
              AND incidente.victima_id = auth.uid()
        )
    );

-- =============================================================================
-- TABLA: evidencia
-- - La víctima puede insertar y leer evidencia de sus propios incidentes.
-- - Un contacto vinculado puede leer la evidencia de los incidentes de su red.
-- =============================================================================
ALTER TABLE public.evidencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "evidencia_select_victima"
    ON public.evidencia FOR SELECT
    USING (usuario_id = auth.uid());

CREATE POLICY "evidencia_select_contacto"
    ON public.evidencia FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.incidente
            JOIN public.red_apoyo ON red_apoyo.victima_id = incidente.victima_id
            WHERE incidente.id = evidencia.incidente_id
              AND red_apoyo.contacto_id = auth.uid()
              AND red_apoyo.estado = 'activo'
        )
    );

CREATE POLICY "evidencia_insert_victima"
    ON public.evidencia FOR INSERT
    WITH CHECK (usuario_id = auth.uid());

-- =============================================================================
-- TABLA: alerta_temprana
-- - El contacto receptor puede leer sus propias alertas y marcarlas como leídas.
-- - La víctima puede leer las alertas de sus incidentes (para ver confirmaciones).
-- - El INSERT es realizado por el backend (service_role) al desencadenar alertas.
-- =============================================================================
ALTER TABLE public.alerta_temprana ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerta_select_contacto"
    ON public.alerta_temprana FOR SELECT
    USING (contacto_id = auth.uid());

CREATE POLICY "alerta_select_victima"
    ON public.alerta_temprana FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.incidente
            WHERE incidente.id = alerta_temprana.incidente_id
              AND incidente.victima_id = auth.uid()
        )
    );

-- El contacto puede marcar como leída su propia alerta (UPDATE solo de leida_en)
CREATE POLICY "alerta_update_contacto_leer"
    ON public.alerta_temprana FOR UPDATE
    USING (contacto_id = auth.uid())
    WITH CHECK (contacto_id = auth.uid());

-- =============================================================================
-- STORAGE: Bucket de evidencias
-- Las instrucciones de CLI/Supabase Dashboard para crear el bucket se 
-- documentan en /docs/09-setup-backend.md.
-- Las políticas de Storage se gestionan desde el Dashboard o así:
-- =============================================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('evidencias', 'evidencias', false);
--
-- CREATE POLICY "evidencias_upload_victima"
--     ON storage.objects FOR INSERT
--     TO authenticated
--     WITH CHECK (bucket_id = 'evidencias' AND auth.uid()::text = (storage.foldername(name))[1]);
--
-- CREATE POLICY "evidencias_read_owner"
--     ON storage.objects FOR SELECT
--     TO authenticated
--     USING (bucket_id = 'evidencias' AND auth.uid()::text = (storage.foldername(name))[1]);
