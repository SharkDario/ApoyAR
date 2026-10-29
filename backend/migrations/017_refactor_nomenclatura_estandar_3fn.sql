-- ==============================================================================
-- MIGRACIÓN 017: REFACTORIZACIÓN INTEGRAL DE NOMENCLATURA EN BASE DE DATOS (3FN PURA)
-- Estándar de nomenclatura: Prefijos por entidad, nombres descriptivos, zero data loss.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. ELIMINAR VISTAS DEPENDIENTES TEMPORALMENTE (SE RECREARÁN AL FINAL)
-- ==============================================================================
DROP VIEW IF EXISTS public.vw_usuario CASCADE;

-- ==============================================================================
-- 2. ELIMINAR POLÍTICAS RLS TEMPORALMENTE PARA EVITAR CONFLICTOS DE RENOMBRADO
-- ==============================================================================
DROP POLICY IF EXISTS "Usuarios pueden actualizar consentimiento de sus propias evidencias" ON public.evidencia;
DROP POLICY IF EXISTS "evidencia_insert_autoridad" ON public.evidencia;
DROP POLICY IF EXISTS "evidencia_insert_victima" ON public.evidencia;
DROP POLICY IF EXISTS "evidencia_select_autoridad" ON public.evidencia;
DROP POLICY IF EXISTS "evidencia_select_own" ON public.evidencia;
DROP POLICY IF EXISTS "evidencia_select_victima" ON public.evidencia;
DROP POLICY IF EXISTS "evidencia_select_victima_incidente" ON public.evidencia;

DROP POLICY IF EXISTS "incidente_insert_testigo" ON public.incidente;
DROP POLICY IF EXISTS "incidente_insert_victima" ON public.incidente;
DROP POLICY IF EXISTS "incidente_select_autoridad" ON public.incidente;
DROP POLICY IF EXISTS "incidente_select_contacto_vinculado" ON public.incidente;
DROP POLICY IF EXISTS "incidente_select_propio" ON public.incidente;
DROP POLICY IF EXISTS "incidente_select_victima_own" ON public.incidente;
DROP POLICY IF EXISTS "incidente_update_victima_own" ON public.incidente;
DROP POLICY IF EXISTS "Usuarios pueden actualizar consentimiento de sus propios incidentes" ON public.incidente;

DROP POLICY IF EXISTS "historial_select_autoridad" ON public.historial_incidente;
DROP POLICY IF EXISTS "historial_select_victima" ON public.historial_incidente;

DROP POLICY IF EXISTS "Usuarios pueden leer cualquier persona" ON public.persona;
DROP POLICY IF EXISTS "persona_insert_own" ON public.persona;
DROP POLICY IF EXISTS "persona_select_own" ON public.persona;
DROP POLICY IF EXISTS "persona_update_own" ON public.persona;

DROP POLICY IF EXISTS "red_apoyo_delete_victima" ON public.red_apoyo;
DROP POLICY IF EXISTS "red_apoyo_insert_victima" ON public.red_apoyo;
DROP POLICY IF EXISTS "red_apoyo_select_victima" ON public.red_apoyo;

DROP POLICY IF EXISTS "reporte_judicial_insert_autoridad" ON public.reporte_judicial;
DROP POLICY IF EXISTS "reporte_judicial_select_participantes" ON public.reporte_judicial;

DROP POLICY IF EXISTS "usuario_all_admin" ON public.usuario;
DROP POLICY IF EXISTS "usuario_select_policy" ON public.usuario;

DROP POLICY IF EXISTS "usuario_perfil_select_own" ON public.usuario_tiene_perfil;

DROP POLICY IF EXISTS "cargo_institucional_select_policy" ON public.cargo_institucional;
DROP POLICY IF EXISTS "cargo_institucional_admin_write_policy" ON public.cargo_institucional;

-- ==============================================================================
-- 3. RENOMBRADO TRANSACCIONAL DE COLUMNAS (19 ENTIDADES + 2 CATÁLOGOS + HELPER)
-- ==============================================================================

-- 1. modulo (mod_)
ALTER TABLE public.modulo RENAME COLUMN id TO mod_id_modulo;
ALTER TABLE public.modulo RENAME COLUMN nombre TO mod_nombre;

-- 2. accion (acc_)
ALTER TABLE public.accion RENAME COLUMN id TO acc_id_accion;
ALTER TABLE public.accion RENAME COLUMN nombre TO acc_nombre;

-- 3. permiso (prm_)
ALTER TABLE public.permiso RENAME COLUMN id TO prm_id_permiso;
ALTER TABLE public.permiso RENAME COLUMN nombre TO prm_nombre;
ALTER TABLE public.permiso RENAME COLUMN descripcion TO prm_descripcion;
ALTER TABLE public.permiso RENAME COLUMN modulo_id TO mod_id_modulo;
ALTER TABLE public.permiso RENAME COLUMN accion_id TO acc_id_accion;

-- 4. perfil (prf_)
ALTER TABLE public.perfil RENAME COLUMN id TO prf_id_perfil;
ALTER TABLE public.perfil RENAME COLUMN nombre TO prf_nombre;
ALTER TABLE public.perfil RENAME COLUMN descripcion TO prf_descripcion;
ALTER TABLE public.perfil RENAME COLUMN activo TO prf_activo;

-- 5. perfil_tiene_permiso (prfprm_)
ALTER TABLE public.perfil_tiene_permiso RENAME COLUMN perfil_id TO prf_id_perfil;
ALTER TABLE public.perfil_tiene_permiso RENAME COLUMN permiso_id TO prm_id_permiso;

-- 6. usuario_tiene_perfil (usuprf_)
ALTER TABLE public.usuario_tiene_perfil RENAME COLUMN usuario_id TO usu_id_usuario;
ALTER TABLE public.usuario_tiene_perfil RENAME COLUMN perfil_id TO prf_id_perfil;
ALTER TABLE public.usuario_tiene_perfil RENAME COLUMN estado_aprobacion TO usuprf_estado_aprobacion;
ALTER TABLE public.usuario_tiene_perfil RENAME COLUMN aprobado_por TO usu_id_aprobado_por;
ALTER TABLE public.usuario_tiene_perfil RENAME COLUMN aprobado_en TO usuprf_aprobado_en;
ALTER TABLE public.usuario_tiene_perfil RENAME COLUMN notas TO usuprf_notas;

-- 7. persona (per_)
ALTER TABLE public.persona RENAME COLUMN id TO per_id_persona;
ALTER TABLE public.persona RENAME COLUMN usuario_id TO usu_id_usuario;
ALTER TABLE public.persona RENAME COLUMN nombre TO per_nombre;
ALTER TABLE public.persona RENAME COLUMN apellido TO per_apellido;
ALTER TABLE public.persona RENAME COLUMN dni TO per_dni;
ALTER TABLE public.persona RENAME COLUMN genero TO per_genero;
ALTER TABLE public.persona RENAME COLUMN fecha_nacimiento TO per_fecha_nacimiento;
ALTER TABLE public.persona RENAME COLUMN telefono TO per_telefono;
ALTER TABLE public.persona RENAME COLUMN direccion TO per_direccion;
ALTER TABLE public.persona RENAME COLUMN palabraclave_encriptada TO per_palabra_clave_encriptada;
ALTER TABLE public.persona RENAME COLUMN creado_en TO per_creado_en;
ALTER TABLE public.persona RENAME COLUMN codigo_vinculacion TO per_codigo_vinculacion;
ALTER TABLE public.persona RENAME COLUMN terminos_aceptados_en TO per_terminos_aceptados_en;
ALTER TABLE public.persona RENAME COLUMN terminos_version TO per_terminos_version;
ALTER TABLE public.persona RENAME COLUMN politica_aceptada_en TO per_politica_aceptada_en;
ALTER TABLE public.persona RENAME COLUMN politica_version TO per_politica_version;

-- 8. usuario (usu_)
ALTER TABLE public.usuario RENAME COLUMN id TO usu_id_usuario;
ALTER TABLE public.usuario RENAME COLUMN persona_id TO per_id_persona;
ALTER TABLE public.usuario RENAME COLUMN email TO usu_email;
ALTER TABLE public.usuario RENAME COLUMN password_hash TO usu_password_hash;
ALTER TABLE public.usuario RENAME COLUMN palabraclave_encriptada TO usu_palabra_clave_encriptada;
ALTER TABLE public.usuario RENAME COLUMN activo TO usu_activo;
ALTER TABLE public.usuario RENAME COLUMN ultimo_acceso TO usu_ultimo_acceso;
ALTER TABLE public.usuario RENAME COLUMN creado_en TO usu_creado_en;

-- 9. dispositivo_usuario (disusu_)
ALTER TABLE public.dispositivo_usuario RENAME COLUMN id TO disusu_id_dispositivo;
ALTER TABLE public.dispositivo_usuario RENAME COLUMN usuario_id TO usu_id_usuario;
ALTER TABLE public.dispositivo_usuario RENAME COLUMN expo_push_token TO disusu_expo_push_token;
ALTER TABLE public.dispositivo_usuario RENAME COLUMN fcm_token TO disusu_fcm_token;
ALTER TABLE public.dispositivo_usuario RENAME COLUMN plataforma TO disusu_plataforma;
ALTER TABLE public.dispositivo_usuario RENAME COLUMN activo TO disusu_activo;
ALTER TABLE public.dispositivo_usuario RENAME COLUMN registrado_en TO disusu_registrado_en;

-- 10. red_apoyo (redapo_)
ALTER TABLE public.red_apoyo RENAME COLUMN id TO redapo_id_red;
ALTER TABLE public.red_apoyo RENAME COLUMN victima_id TO usu_id_victima;
ALTER TABLE public.red_apoyo RENAME COLUMN contacto_id TO usu_id_contacto;
ALTER TABLE public.red_apoyo RENAME COLUMN parentesco TO redapo_parentesco;
ALTER TABLE public.red_apoyo RENAME COLUMN estado TO redapo_estado;
ALTER TABLE public.red_apoyo RENAME COLUMN creado_en TO redapo_creado_en;

-- 11. incidente (inc_)
ALTER TABLE public.incidente RENAME COLUMN id TO inc_id_incidente;
ALTER TABLE public.incidente RENAME COLUMN victima_id TO usu_id_victima;
ALTER TABLE public.incidente RENAME COLUMN latitud TO inc_latitud;
ALTER TABLE public.incidente RENAME COLUMN longitud TO inc_longitud;
ALTER TABLE public.incidente RENAME COLUMN direccion_aprox TO inc_direccion_aprox;
ALTER TABLE public.incidente RENAME COLUMN origen TO inc_origen;
ALTER TABLE public.incidente RENAME COLUMN estado TO inc_estado;
ALTER TABLE public.incidente RENAME COLUMN notas TO inc_notas;
ALTER TABLE public.incidente RENAME COLUMN fecha_hora TO inc_fecha_hora;
ALTER TABLE public.incidente RENAME COLUMN direccion TO inc_direccion;
ALTER TABLE public.incidente RENAME COLUMN victima_nombre TO inc_victima_nombre;
ALTER TABLE public.incidente RENAME COLUMN last_location_at TO inc_last_location_at;
ALTER TABLE public.incidente RENAME COLUMN consentimiento_exportacion TO inc_consentimiento_exportacion;
ALTER TABLE public.incidente RENAME COLUMN fecha_consentimiento TO inc_fecha_consentimiento;

-- 12. evidencia (evi_)
ALTER TABLE public.evidencia RENAME COLUMN id TO evi_id_evidencia;
ALTER TABLE public.evidencia RENAME COLUMN incidente_id TO inc_id_incidente;
ALTER TABLE public.evidencia RENAME COLUMN usuario_id TO usu_id_usuario;
ALTER TABLE public.evidencia RENAME COLUMN tipo_archivo TO evi_tipo_archivo;
ALTER TABLE public.evidencia RENAME COLUMN url_almacenamiento TO evi_url_almacenamiento;
ALTER TABLE public.evidencia RENAME COLUMN hash_sha256 TO evi_hash_sha256;
ALTER TABLE public.evidencia RENAME COLUMN metadata_dispositivo TO evi_metadata_dispositivo;
ALTER TABLE public.evidencia RENAME COLUMN fecha_captura TO evi_fecha_captura;
ALTER TABLE public.evidencia RENAME COLUMN sincronizado_en TO evi_sincronizado_en;
ALTER TABLE public.evidencia RENAME COLUMN firma_hardware TO evi_firma_hardware;
ALTER TABLE public.evidencia RENAME COLUMN token_rfc3161 TO evi_token_rfc3161;
ALTER TABLE public.evidencia RENAME COLUMN prev_hash TO evi_prev_hash;
ALTER TABLE public.evidencia RENAME COLUMN origen_captura TO evi_origen_captura;
ALTER TABLE public.evidencia RENAME COLUMN tsa_estado TO evi_tsa_estado;
ALTER TABLE public.evidencia RENAME COLUMN asociado_por TO usu_id_asociado_por;
ALTER TABLE public.evidencia RENAME COLUMN asociado_en TO evi_asociado_en;
ALTER TABLE public.evidencia RENAME COLUMN motivo_asociacion TO evi_motivo_asociacion;
ALTER TABLE public.evidencia RENAME COLUMN consentimiento_exportacion TO evi_consentimiento_exportacion;
ALTER TABLE public.evidencia RENAME COLUMN fecha_consentimiento TO evi_fecha_consentimiento;

-- 13. alerta_temprana (aletem_)
ALTER TABLE public.alerta_temprana RENAME COLUMN id TO aletem_id_alerta;
ALTER TABLE public.alerta_temprana RENAME COLUMN incidente_id TO inc_id_incidente;
ALTER TABLE public.alerta_temprana RENAME COLUMN contacto_id TO usu_id_contacto;
ALTER TABLE public.alerta_temprana RENAME COLUMN tipo_alerta TO aletem_tipo_alerta;
ALTER TABLE public.alerta_temprana RENAME COLUMN enviada_en TO aletem_enviada_en;
ALTER TABLE public.alerta_temprana RENAME COLUMN leida_en TO aletem_leida_en;

-- 14. reporte_judicial (repjud_)
ALTER TABLE public.reporte_judicial RENAME COLUMN id TO repjud_id_reporte;
ALTER TABLE public.reporte_judicial RENAME COLUMN incidente_id TO inc_id_incidente;
ALTER TABLE public.reporte_judicial RENAME COLUMN generado_por_id TO usu_id_generado_por;
ALTER TABLE public.reporte_judicial RENAME COLUMN url_documento TO repjud_url_documento;
ALTER TABLE public.reporte_judicial RENAME COLUMN hash_documento TO repjud_hash_documento;
ALTER TABLE public.reporte_judicial RENAME COLUMN fecha_generacion TO repjud_fecha_generacion;
ALTER TABLE public.reporte_judicial RENAME COLUMN legajo_snapshot TO repjud_legajo_snapshot;
ALTER TABLE public.reporte_judicial RENAME COLUMN cargo_snapshot TO repjud_cargo_snapshot;
ALTER TABLE public.reporte_judicial RENAME COLUMN sede_snapshot TO repjud_sede_snapshot;
ALTER TABLE public.reporte_judicial RENAME COLUMN justificacion TO repjud_justificacion;
ALTER TABLE public.reporte_judicial RENAME COLUMN destino_declarado TO repjud_destino_declarado;

-- 15. historial_incidente (hisinc_)
ALTER TABLE public.historial_incidente RENAME COLUMN id TO hisinc_id_historial;
ALTER TABLE public.historial_incidente RENAME COLUMN incidente_id TO inc_id_incidente;
ALTER TABLE public.historial_incidente RENAME COLUMN cambiado_por_id TO usu_id_cambiado_por;
ALTER TABLE public.historial_incidente RENAME COLUMN estado_anterior TO hisinc_estado_anterior;
ALTER TABLE public.historial_incidente RENAME COLUMN estado_nuevo TO hisinc_estado_nuevo;
ALTER TABLE public.historial_incidente RENAME COLUMN notas TO hisinc_notas;
ALTER TABLE public.historial_incidente RENAME COLUMN creado_en TO hisinc_creado_en;

-- 16. exportacion_evidencia (expevi_)
ALTER TABLE public.exportacion_evidencia RENAME COLUMN id TO expevi_id_exportacion;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN tipo_exportacion TO expevi_tipo_exportacion;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN referencia_id TO evi_id_referencia;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN solicitado_por TO usu_id_solicitado_por;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN rol_actor TO expevi_rol_actor;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN destino_declarado TO expevi_destino_declarado;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN justificacion TO expevi_justificacion;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN hash_manifiesto TO expevi_hash_manifiesto;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN cantidad_archivos TO expevi_cantidad_archivos;
ALTER TABLE public.exportacion_evidencia RENAME COLUMN exportado_en TO expevi_exportado_en;

-- 17. institucion (ins_)
ALTER TABLE public.institucion RENAME COLUMN id_institucion TO ins_id_institucion;
ALTER TABLE public.institucion RENAME COLUMN nombre TO ins_nombre;
ALTER TABLE public.institucion RENAME COLUMN tipo_organismo TO ins_tipo_organismo;
ALTER TABLE public.institucion RENAME COLUMN sitio_web TO ins_sitio_web;

-- 18. dependencia (dep_)
ALTER TABLE public.dependencia RENAME COLUMN id_dependencia TO dep_id_dependencia;
ALTER TABLE public.dependencia RENAME COLUMN id_institucion TO ins_id_institucion;
ALTER TABLE public.dependencia RENAME COLUMN nombre TO dep_nombre;
ALTER TABLE public.dependencia RENAME COLUMN tipo_unidad TO dep_tipo_unidad;
ALTER TABLE public.dependencia RENAME COLUMN telefono_contacto TO dep_telefono_contacto;

-- 19. sede (sed_)
ALTER TABLE public.sede RENAME COLUMN id_sede TO sed_id_sede;
ALTER TABLE public.sede RENAME COLUMN id_dependencia TO dep_id_dependencia;
ALTER TABLE public.sede RENAME COLUMN nombre_sede TO sed_nombre_sede;
ALTER TABLE public.sede RENAME COLUMN direccion TO sed_direccion;
ALTER TABLE public.sede RENAME COLUMN localidad TO sed_localidad;
ALTER TABLE public.sede RENAME COLUMN codigo_postal TO sed_codigo_postal;

-- 20. cargo_institucional (carins_)
ALTER TABLE public.cargo_institucional RENAME COLUMN id_cargo_institucional TO carins_id_cargo_institucional;
ALTER TABLE public.cargo_institucional RENAME COLUMN usuario_id TO usu_id_usuario;
ALTER TABLE public.cargo_institucional RENAME COLUMN id_sede TO sed_id_sede;
ALTER TABLE public.cargo_institucional RENAME COLUMN id_cargo TO car_id_cargo;
ALTER TABLE public.cargo_institucional RENAME COLUMN legajo_o_matricula TO carins_legajo_o_matricula;
ALTER TABLE public.cargo_institucional RENAME COLUMN activo TO carins_activo;
ALTER TABLE public.cargo_institucional RENAME COLUMN creado_en TO carins_creado_en;

-- 21. cargo (car_)
ALTER TABLE public.cargo RENAME COLUMN id_cargo TO car_id_cargo;
ALTER TABLE public.cargo RENAME COLUMN nombre_cargo TO car_nombre_cargo;

-- Helper: alert_dismissals
ALTER TABLE public.alert_dismissals RENAME COLUMN user_id TO usu_id_usuario;
ALTER TABLE public.alert_dismissals RENAME COLUMN alert_id TO inc_id_incidente;
ALTER TABLE public.alert_dismissals RENAME COLUMN dismissed_at TO altdis_dismissed_at;

-- ==============================================================================
-- 4. RECREAR VISTA vw_usuario
-- ==============================================================================
CREATE OR REPLACE VIEW public.vw_usuario AS
SELECT 
    u.id AS usu_id_usuario,
    p.per_id_persona,
    u.email AS usu_email,
    u.encrypted_password AS usu_password_hash,
    p.per_palabra_clave_encriptada AS usu_palabra_clave_encriptada,
    COALESCE((u.banned_until IS NULL), true) AS usu_activo,
    u.last_sign_in_at AS usu_ultimo_acceso,
    u.created_at AS usu_creado_en
FROM auth.users u
LEFT JOIN public.persona p ON p.usu_id_usuario = u.id;

-- ==============================================================================
-- 5. RECREAR POLÍTICAS RLS ACTUALIZADAS A LA NUEVA NOMENCLATURA
-- ==============================================================================

-- public.evidencia
CREATE POLICY "Usuarios pueden actualizar consentimiento de sus propias evidencias"
ON public.evidencia FOR UPDATE TO authenticated
USING (
  usu_id_usuario = auth.uid() OR EXISTS (
    SELECT 1 FROM public.incidente i
    WHERE i.inc_id_incidente = evidencia.inc_id_incidente
      AND i.usu_id_victima = auth.uid()
  )
)
WITH CHECK (
  usu_id_usuario = auth.uid() OR EXISTS (
    SELECT 1 FROM public.incidente i
    WHERE i.inc_id_incidente = evidencia.inc_id_incidente
      AND i.usu_id_victima = auth.uid()
  )
);

CREATE POLICY "evidencia_insert_autoridad"
ON public.evidencia FOR INSERT TO public
WITH CHECK (usuario_tiene_rol(auth.uid(), 'Autoridad'::character varying));

CREATE POLICY "evidencia_insert_victima"
ON public.evidencia FOR INSERT TO public
WITH CHECK (usu_id_usuario = auth.uid());

CREATE POLICY "evidencia_select_autoridad"
ON public.evidencia FOR SELECT TO public
USING (usuario_tiene_rol(auth.uid(), 'Autoridad'::character varying));

CREATE POLICY "evidencia_select_own"
ON public.evidencia FOR SELECT TO authenticated
USING (usu_id_usuario = auth.uid());

CREATE POLICY "evidencia_select_victima"
ON public.evidencia FOR SELECT TO public
USING (usu_id_usuario = auth.uid());

CREATE POLICY "evidencia_select_victima_incidente"
ON public.evidencia FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.incidente i
    WHERE i.inc_id_incidente = evidencia.inc_id_incidente
      AND i.usu_id_victima = auth.uid()
  )
);

-- public.incidente
CREATE POLICY "incidente_insert_testigo"
ON public.incidente FOR INSERT TO public
WITH CHECK (
  (auth.uid() = usu_id_victima) OR usuario_tiene_rol(auth.uid(), 'Testigo'::character varying)
);

CREATE POLICY "incidente_insert_victima"
ON public.incidente FOR INSERT TO public
WITH CHECK (usu_id_victima = auth.uid());

CREATE POLICY "incidente_select_autoridad"
ON public.incidente FOR SELECT TO public
USING (usuario_tiene_rol(auth.uid(), 'Autoridad'::character varying));

CREATE POLICY "incidente_select_contacto_vinculado"
ON public.incidente FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.red_apoyo
    WHERE red_apoyo.usu_id_victima = incidente.usu_id_victima
      AND red_apoyo.usu_id_contacto = auth.uid()
      AND red_apoyo.redapo_estado = 'activo'
  )
);

CREATE POLICY "incidente_select_propio"
ON public.incidente FOR SELECT TO authenticated
USING (usu_id_victima = auth.uid());

CREATE POLICY "incidente_select_victima_own"
ON public.incidente FOR SELECT TO public
USING (usu_id_victima = auth.uid());

CREATE POLICY "incidente_update_victima_own"
ON public.incidente FOR UPDATE TO authenticated
USING (usu_id_victima = auth.uid())
WITH CHECK (usu_id_victima = auth.uid());

-- public.historial_incidente
CREATE POLICY "historial_select_autoridad"
ON public.historial_incidente FOR SELECT TO public
USING (usuario_tiene_rol(auth.uid(), 'Autoridad'::character varying));

CREATE POLICY "historial_select_victima"
ON public.historial_incidente FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.incidente
    WHERE incidente.inc_id_incidente = historial_incidente.inc_id_incidente
      AND incidente.usu_id_victima = auth.uid()
  )
);

-- public.persona
CREATE POLICY "Usuarios pueden leer cualquier persona"
ON public.persona FOR SELECT TO public
USING (true);

CREATE POLICY "persona_insert_own"
ON public.persona FOR INSERT TO public
WITH CHECK (usu_id_usuario = auth.uid());

CREATE POLICY "persona_select_own"
ON public.persona FOR SELECT TO authenticated
USING (true);

CREATE POLICY "persona_update_own"
ON public.persona FOR UPDATE TO authenticated
USING (auth.uid() = usu_id_usuario)
WITH CHECK (auth.uid() = usu_id_usuario);

-- public.red_apoyo
CREATE POLICY "red_apoyo_delete_victima"
ON public.red_apoyo FOR DELETE TO public
USING (usu_id_victima = auth.uid());

CREATE POLICY "red_apoyo_insert_victima"
ON public.red_apoyo FOR INSERT TO public
WITH CHECK (usu_id_victima = auth.uid());

CREATE POLICY "red_apoyo_select_victima"
ON public.red_apoyo FOR SELECT TO public
USING (usu_id_victima = auth.uid() OR usu_id_contacto = auth.uid());

-- public.reporte_judicial
CREATE POLICY "reporte_judicial_insert_autoridad"
ON public.reporte_judicial FOR INSERT TO public
WITH CHECK (usu_id_generado_por = auth.uid());

CREATE POLICY "reporte_judicial_select_participantes"
ON public.reporte_judicial FOR SELECT TO public
USING (
  (usu_id_generado_por = auth.uid()) OR EXISTS (
    SELECT 1 FROM public.incidente
    WHERE incidente.inc_id_incidente = reporte_judicial.inc_id_incidente
      AND incidente.usu_id_victima = auth.uid()
  )
);

-- public.usuario
CREATE POLICY "usuario_all_admin"
ON public.usuario FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "usuario_select_policy"
ON public.usuario FOR SELECT TO anon, authenticated
USING (true);

-- public.usuario_tiene_perfil
CREATE POLICY "usuario_perfil_select_own"
ON public.usuario_tiene_perfil FOR SELECT TO public
USING (usu_id_usuario = auth.uid());

-- public.cargo_institucional
CREATE POLICY "cargo_institucional_select_policy"
ON public.cargo_institucional FOR SELECT TO authenticated, anon
USING (true);

CREATE POLICY "cargo_institucional_admin_write_policy"
ON public.cargo_institucional FOR ALL TO authenticated
USING (auth.uid() = usu_id_usuario OR public.usuario_tiene_rol(auth.uid(), 'Administrador'))
WITH CHECK (auth.uid() = usu_id_usuario OR public.usuario_tiene_rol(auth.uid(), 'Administrador'));

-- ==============================================================================
-- 6. ACTUALIZAR FUNCIONES Y TRIGGERS A LA NUEVA NOMENCLATURA
-- ==============================================================================

DROP FUNCTION IF EXISTS public.obtener_telefono_victima(uuid);
DROP FUNCTION IF EXISTS public.obtener_red(uuid);
DROP FUNCTION IF EXISTS public.obtener_mi_nombre();
DROP FUNCTION IF EXISTS public.buscar_posibles_coincidencias(numeric, numeric, timestamp with time zone, double precision, integer);

-- 6.1 agregar_contacto
CREATE OR REPLACE FUNCTION public.agregar_contacto(p_victima_id uuid, p_telefono character varying)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_contacto_id UUID;
BEGIN
  SELECT usu_id_usuario INTO v_contacto_id 
  FROM public.persona 
  WHERE REPLACE(per_telefono, ' ', '') = REPLACE(p_telefono, ' ', '') 
  LIMIT 1;

  IF v_contacto_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  INSERT INTO public.red_apoyo (usu_id_victima, usu_id_contacto, redapo_estado)
  VALUES (p_victima_id, v_contacto_id, 'activo')
  ON CONFLICT (usu_id_victima, usu_id_contacto) DO UPDATE SET redapo_estado = 'activo';
  
  RETURN TRUE;
END;
$$;

-- 6.2 agregar_contacto_por_codigo
CREATE OR REPLACE FUNCTION public.agregar_contacto_por_codigo(p_victima_id uuid, p_codigo character varying)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_contacto_id UUID;
BEGIN
  SELECT usu_id_usuario INTO v_contacto_id 
  FROM public.persona 
  WHERE CAST(usu_id_usuario AS TEXT) ILIKE (p_codigo || '%')
  LIMIT 1;

  IF v_contacto_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  INSERT INTO public.red_apoyo (usu_id_victima, usu_id_contacto, redapo_estado)
  VALUES (p_victima_id, v_contacto_id, 'activo')
  ON CONFLICT (usu_id_victima, usu_id_contacto) DO UPDATE SET redapo_estado = 'activo';
  
  INSERT INTO public.red_apoyo (usu_id_victima, usu_id_contacto, redapo_estado)
  VALUES (v_contacto_id, p_victima_id, 'activo')
  ON CONFLICT (usu_id_victima, usu_id_contacto) DO UPDATE SET redapo_estado = 'activo';

  RETURN TRUE;
END;
$$;

-- 6.3 fn_actualizar_heartbeat_incidente
CREATE OR REPLACE FUNCTION public.fn_actualizar_heartbeat_incidente()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF (NEW.inc_latitud IS DISTINCT FROM OLD.inc_latitud) 
       OR (NEW.inc_longitud IS DISTINCT FROM OLD.inc_longitud) 
       OR (NEW.inc_direccion IS DISTINCT FROM OLD.inc_direccion) THEN
        NEW.inc_last_location_at := now();
    END IF;
    RETURN NEW;
END;
$$;

-- 6.4 fn_asignar_prev_hash_evidencia
CREATE OR REPLACE FUNCTION public.fn_asignar_prev_hash_evidencia()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_ultimo VARCHAR(64);
BEGIN
    IF NEW.evi_prev_hash IS NULL OR NEW.evi_prev_hash = '' THEN
        SELECT evi_hash_sha256 INTO v_ultimo
        FROM public.evidencia
        WHERE evi_hash_sha256 IS NOT NULL
          AND evi_id_evidencia <> COALESCE(NEW.evi_id_evidencia, '00000000-0000-0000-0000-000000000000'::UUID)
        ORDER BY evi_sincronizado_en DESC, evi_id_evidencia DESC
        LIMIT 1;

        NEW.evi_prev_hash := COALESCE(v_ultimo, '0000000000000000000000000000000000000000000000000000000000000000');
    END IF;

    RETURN NEW;
END;
$$;

-- 6.5 fn_auditar_incidente
CREATE OR REPLACE FUNCTION public.fn_auditar_incidente()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_actor_id UUID;
    v_nota TEXT;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        v_actor_id := COALESCE(NEW.usu_id_victima, OLD.usu_id_victima);
    END IF;

    IF OLD.inc_estado IS DISTINCT FROM NEW.inc_estado THEN
        v_nota := COALESCE(
            NEW.inc_notas,
            FORMAT('Transición de estado: de "%s" a "%s"', OLD.inc_estado, NEW.inc_estado)
        );

        INSERT INTO public.historial_incidente (
            inc_id_incidente,
            usu_id_cambiado_por,
            hisinc_estado_anterior,
            hisinc_estado_nuevo,
            hisinc_notas,
            hisinc_creado_en
        ) VALUES (
            NEW.inc_id_incidente,
            v_actor_id,
            OLD.inc_estado,
            NEW.inc_estado,
            v_nota,
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$;

-- 6.6 fn_cerrar_incidentes_previos_victima
CREATE OR REPLACE FUNCTION public.fn_cerrar_incidentes_previos_victima()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.inc_estado = 'en_curso' THEN
        UPDATE public.incidente
        SET inc_estado = 'cerrado',
            inc_notas = COALESCE(inc_notas, '') || ' [Reemplazado por nuevo incidente ' || NEW.inc_id_incidente || ']'
        WHERE usu_id_victima = NEW.usu_id_victima
          AND inc_estado = 'en_curso'
          AND inc_id_incidente <> NEW.inc_id_incidente;
    END IF;

    IF NEW.inc_last_location_at IS NULL THEN
        NEW.inc_last_location_at := now();
    END IF;

    RETURN NEW;
END;
$$;

-- 6.7 fn_prevent_evidencia_tampering
CREATE OR REPLACE FUNCTION public.fn_prevent_evidencia_tampering()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.derecho_supresion', true) = 'true' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Violación de custodia forense: Se prohíbe la eliminación de registros en la tabla evidencia (Append-Only Log).'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.evi_id_evidencia = OLD.evi_id_evidencia AND
           NEW.inc_id_incidente IS NOT DISTINCT FROM OLD.inc_id_incidente AND
           NEW.usu_id_usuario = OLD.usu_id_usuario AND
           NEW.evi_tipo_archivo = OLD.evi_tipo_archivo AND
           NEW.evi_url_almacenamiento = OLD.evi_url_almacenamiento AND
           NEW.evi_hash_sha256 = OLD.evi_hash_sha256 AND
           NEW.evi_firma_hardware IS NOT DISTINCT FROM OLD.evi_firma_hardware AND
           NEW.evi_prev_hash IS NOT DISTINCT FROM OLD.evi_prev_hash AND
           NEW.evi_fecha_captura = OLD.evi_fecha_captura AND
           NEW.evi_metadata_dispositivo IS NOT DISTINCT FROM OLD.evi_metadata_dispositivo AND
           (NEW.evi_token_rfc3161 IS NOT DISTINCT FROM OLD.evi_token_rfc3161 OR (OLD.evi_token_rfc3161 IS NULL AND NEW.evi_token_rfc3161 IS NOT NULL)) THEN
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Violación de custodia forense: El registro de evidencia es estrictamente inmutable y solo admite estampado diferido RFC 3161 o actualización de consentimiento (Ley 25.326).'
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 6.8 fn_proteger_inmutabilidad_evidencia
CREATE OR REPLACE FUNCTION public.fn_proteger_inmutabilidad_evidencia()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('app.derecho_supresion', true) = 'true' THEN
            RETURN OLD;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: La tabla evidencia es un log inmutable de solo adición (Append-Only Log). No se permite eliminar registros probatorios.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.evi_id_evidencia = OLD.evi_id_evidencia AND
           NEW.inc_id_incidente IS NOT DISTINCT FROM OLD.inc_id_incidente AND
           NEW.usu_id_usuario = OLD.usu_id_usuario AND
           NEW.evi_tipo_archivo = OLD.evi_tipo_archivo AND
           NEW.evi_url_almacenamiento = OLD.evi_url_almacenamiento AND
           NEW.evi_hash_sha256 = OLD.evi_hash_sha256 AND
           NEW.evi_firma_hardware IS NOT DISTINCT FROM OLD.evi_firma_hardware AND
           NEW.evi_prev_hash IS NOT DISTINCT FROM OLD.evi_prev_hash AND
           (NEW.evi_token_rfc3161 IS NOT DISTINCT FROM OLD.evi_token_rfc3161 OR (OLD.evi_token_rfc3161 IS NULL AND NEW.evi_token_rfc3161 IS NOT NULL)) THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Operación rechazada: Los registros de evidencia no pueden ser alterados una vez consolidados.';
    END IF;

    RETURN NEW;
END;
$$;

-- 6.9 fn_sync_persona_to_usuario
CREATE OR REPLACE FUNCTION public.fn_sync_persona_to_usuario()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.usu_id_usuario IS NOT NULL THEN
    UPDATE public.usuario
    SET per_id_persona = NEW.per_id_persona
    WHERE usu_id_usuario = NEW.usu_id_usuario AND (per_id_persona IS NULL OR per_id_persona != NEW.per_id_persona);
  END IF;
  RETURN NEW;
END;
$$;

-- 6.10 handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_persona_id UUID;
  v_nombre TEXT;
  v_apellido TEXT;
  v_dni TEXT;
  v_telefono TEXT;
  v_genero TEXT;
  v_fecha_nac DATE;
  v_direccion TEXT;
  v_perfil_victima_id UUID;
  v_es_operador BOOLEAN;
BEGIN
  v_es_operador := COALESCE((NEW.raw_user_meta_data->>'es_operador_institucional')::boolean, false)
                   OR (NEW.raw_user_meta_data->'roles') IS NOT NULL;

  v_nombre := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'nombre'), ''),
    NULLIF(trim(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''), ' ', 1)), ''),
    NULLIF(trim(split_part(NEW.email, '@', 1)), ''),
    'Usuario'
  );

  v_apellido := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'apellido'), ''),
    NULLIF(trim(substring(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '') from '^[^\s]+\s+(.*)$')), ''),
    'Civil'
  );

  v_dni := regexp_replace(COALESCE(NEW.raw_user_meta_data->>'dni', ''), '[^0-9]', '', 'g');
  IF v_dni = '' THEN
    v_dni := NULL;
  END IF;

  IF v_dni IS NOT NULL AND EXISTS (SELECT 1 FROM public.persona WHERE per_dni = v_dni AND usu_id_usuario != NEW.id) THEN
    v_dni := NULL;
  END IF;

  v_fecha_nac := public.fn_parse_fecha_segura(NEW.raw_user_meta_data->>'fecha_nacimiento');
  v_telefono := NULLIF(trim(NEW.raw_user_meta_data->>'telefono'), '');
  v_genero := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'genero'), ''), 'No especificado');
  v_direccion := NULLIF(trim(NEW.raw_user_meta_data->>'direccion'), '');

  -- 1. Insertar o actualizar persona vinculada al usuario
  INSERT INTO public.persona (
    usu_id_usuario, per_nombre, per_apellido, per_dni,
    per_telefono, per_genero, per_fecha_nacimiento, per_direccion
  )
  VALUES (
    NEW.id,
    v_nombre,
    v_apellido,
    v_dni,
    v_telefono,
    v_genero,
    v_fecha_nac,
    v_direccion
  )
  ON CONFLICT (usu_id_usuario) DO UPDATE SET
    per_nombre = EXCLUDED.per_nombre,
    per_apellido = EXCLUDED.per_apellido,
    per_dni = COALESCE(EXCLUDED.per_dni, public.persona.per_dni),
    per_telefono = COALESCE(EXCLUDED.per_telefono, public.persona.per_telefono),
    per_genero = COALESCE(EXCLUDED.per_genero, public.persona.per_genero),
    per_fecha_nacimiento = COALESCE(EXCLUDED.per_fecha_nacimiento, public.persona.per_fecha_nacimiento),
    per_direccion = COALESCE(EXCLUDED.per_direccion, public.persona.per_direccion)
  RETURNING per_id_persona INTO v_persona_id;

  IF v_persona_id IS NULL THEN
    SELECT per_id_persona INTO v_persona_id FROM public.persona WHERE usu_id_usuario = NEW.id;
  END IF;

  -- 2. Sincronizar en public.usuario garantizando el enlace per_id_persona
  INSERT INTO public.usuario (usu_id_usuario, per_id_persona, usu_email, usu_activo, usu_creado_en)
  VALUES (NEW.id, v_persona_id, NEW.email, true, NEW.created_at)
  ON CONFLICT (usu_id_usuario) DO UPDATE SET
    per_id_persona = COALESCE(EXCLUDED.per_id_persona, public.usuario.per_id_persona),
    usu_email = EXCLUDED.usu_email;

  -- 3. Asignar perfil civil (Víctima) automáticamente SOLO si NO es un operador institucional
  IF NOT v_es_operador THEN
    SELECT prf_id_perfil INTO v_perfil_victima_id FROM public.perfil WHERE prf_nombre ILIKE 'Victima' LIMIT 1;
    IF v_perfil_victima_id IS NULL THEN
      v_perfil_victima_id := '41909988-8cb7-44db-81c6-4699c2401d40';
    END IF;

    INSERT INTO public.usuario_tiene_perfil (usu_id_usuario, prf_id_perfil, usuprf_estado_aprobacion, usuprf_notas)
    VALUES (
      NEW.id,
      v_perfil_victima_id,
      'activo',
      'Perfil civil asignado automáticamente al registrarse'
    )
    ON CONFLICT (usu_id_usuario, prf_id_perfil) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_new_user error para %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

-- 6.11 fn_eliminar_cuenta_usuario
CREATE OR REPLACE FUNCTION public.fn_eliminar_cuenta_usuario(p_usuario_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_evidencias_eliminadas INT := 0;
    v_incidentes_eliminados INT := 0;
BEGIN
    PERFORM set_config('app.derecho_supresion', 'true', true);

    DELETE FROM public.evidencia
    WHERE usu_id_usuario = p_usuario_id
       OR inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);
    GET DIAGNOSTICS v_evidencias_eliminadas = ROW_COUNT;

    DELETE FROM public.reporte_judicial
    WHERE inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id)
       OR usu_id_generado_por = p_usuario_id;

    DELETE FROM public.exportacion_evidencia
    WHERE usu_id_solicitado_por = p_usuario_id
       OR evi_id_referencia IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);

    DELETE FROM public.alerta_temprana
    WHERE inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id)
       OR usu_id_contacto = p_usuario_id;

    DELETE FROM public.alert_dismissals
    WHERE usu_id_usuario = p_usuario_id
       OR inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);

    DELETE FROM public.historial_incidente
    WHERE inc_id_incidente IN (SELECT inc_id_incidente FROM public.incidente WHERE usu_id_victima = p_usuario_id);

    DELETE FROM public.incidente
    WHERE usu_id_victima = p_usuario_id;
    GET DIAGNOSTICS v_incidentes_eliminados = ROW_COUNT;

    DELETE FROM public.red_apoyo
    WHERE usu_id_victima = p_usuario_id OR usu_id_contacto = p_usuario_id;

    DELETE FROM public.dispositivo_usuario
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.cargo_institucional
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.usuario_tiene_perfil
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.persona
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM public.usuario
    WHERE usu_id_usuario = p_usuario_id;

    DELETE FROM auth.users
    WHERE id = p_usuario_id;

    RETURN jsonb_build_object(
        'success', true,
        'usuario_id', p_usuario_id,
        'evidencias_eliminadas', v_evidencias_eliminadas,
        'incidentes_eliminados', v_incidentes_eliminados,
        'mensaje', 'Cuenta y datos personales eliminados permanentemente (Art. 16 Ley 25.326).'
    );
END;
$$;

-- 6.12 obtener_mi_nombre
CREATE OR REPLACE FUNCTION public.obtener_mi_nombre()
RETURNS TABLE(nombre character varying, apellido character varying)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT p.per_nombre, p.per_apellido FROM public.persona p WHERE p.usu_id_usuario = auth.uid();
$$;

-- 6.13 obtener_red
CREATE OR REPLACE FUNCTION public.obtener_red(p_victima_id uuid)
RETURNS TABLE(id uuid, contacto_id uuid, nombre character varying, apellido character varying, telefono character varying)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT r.redapo_id_red, r.usu_id_contacto, p.per_nombre, p.per_apellido, p.per_telefono
  FROM public.red_apoyo r
  JOIN public.persona p ON p.usu_id_usuario = r.usu_id_contacto
  WHERE r.usu_id_victima = p_victima_id AND r.redapo_estado = 'activo';
END;
$$;

-- 6.14 obtener_telefono_victima
CREATE OR REPLACE FUNCTION public.obtener_telefono_victima(p_victima_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT per_telefono::text FROM public.persona WHERE usu_id_usuario = p_victima_id;
$$;

-- 6.15 obtener_ultimo_hash_evidencia
CREATE OR REPLACE FUNCTION public.obtener_ultimo_hash_evidencia()
RETURNS character varying
LANGUAGE plpgsql AS $$
DECLARE
    v_ultimo_hash VARCHAR(64);
BEGIN
    SELECT evi_hash_sha256 INTO v_ultimo_hash
    FROM public.evidencia
    WHERE evi_hash_sha256 IS NOT NULL
    ORDER BY evi_sincronizado_en DESC, evi_id_evidencia DESC
    LIMIT 1
    FOR UPDATE;

    IF v_ultimo_hash IS NULL THEN
        v_ultimo_hash := '0000000000000000000000000000000000000000000000000000000000000000';
    END IF;

    RETURN v_ultimo_hash;
END;
$$;

-- 6.16 usuario_tiene_rol
CREATE OR REPLACE FUNCTION public.usuario_tiene_rol(p_usuario_id uuid, p_rol_nombre character varying)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_tiene_perfil utp
    JOIN public.perfil p ON p.prf_id_perfil = utp.prf_id_perfil
    WHERE utp.usu_id_usuario = p_usuario_id
      AND p.prf_nombre = p_rol_nombre
      AND p.prf_activo = true
  );
$$;

-- 6.17 buscar_posibles_coincidencias
CREATE OR REPLACE FUNCTION public.buscar_posibles_coincidencias(
    p_latitud numeric,
    p_longitud numeric,
    p_fecha_hora timestamp with time zone,
    p_radio_metros double precision DEFAULT 500.0,
    p_ventana_minutos integer DEFAULT 30
)
RETURNS TABLE(
    incidente_id uuid,
    victima_nombre text,
    latitud numeric,
    longitud numeric,
    distancia_metros double precision,
    diferencia_minutos double precision,
    fecha_hora timestamp with time zone,
    estado character varying
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.inc_id_incidente,
        COALESCE(i.inc_victima_nombre, 'Anónimo'),
        i.inc_latitud,
        i.inc_longitud,
        (6371000 * acos(
            LEAST(1.0::double precision, GREATEST(-1.0::double precision,
                (cos(radians(p_latitud::double precision)) * cos(radians(i.inc_latitud::double precision)) * 
                cos(radians(i.inc_longitud::double precision) - radians(p_longitud::double precision)) + 
                sin(radians(p_latitud::double precision)) * sin(radians(i.inc_latitud::double precision)))::double precision
            ))
        )) AS distancia_metros,
        (ABS(EXTRACT(EPOCH FROM (i.inc_fecha_hora - p_fecha_hora))) / 60.0)::double precision AS diferencia_minutos,
        i.inc_fecha_hora,
        i.inc_estado
    FROM public.incidente i
    WHERE i.inc_fecha_hora BETWEEN (p_fecha_hora - (p_ventana_minutos || ' minutes')::interval)
                               AND (p_fecha_hora + (p_ventana_minutos || ' minutes')::interval)
      AND (6371000 * acos(
            LEAST(1.0::double precision, GREATEST(-1.0::double precision,
                (cos(radians(p_latitud::double precision)) * cos(radians(i.inc_latitud::double precision)) * 
                cos(radians(i.inc_longitud::double precision) - radians(p_longitud::double precision)) + 
                sin(radians(p_latitud::double precision)) * sin(radians(i.inc_latitud::double precision)))::double precision
            ))
        )) <= p_radio_metros
    ORDER BY distancia_metros ASC, diferencia_minutos ASC;
END;
$$;

COMMIT;
