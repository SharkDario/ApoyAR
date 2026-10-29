-- ==============================================================================
-- MIGRACIÓN 021: RESTAURAR SECURITY DEFINER EN TRIGGERS DE AUDITORÍA Y CIERRE
-- ==============================================================================
-- Garantiza que cuando la Víctima actualiza inc_estado = 'cerrado' desde la app
-- móvil (rol authenticated), el trigger tr_auditar_incidente pueda insertar en
-- public.historial_incidente sin ser rechazado por RLS.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_auditar_incidente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

CREATE OR REPLACE FUNCTION public.fn_cerrar_incidentes_previos_victima()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.inc_estado = 'en_curso' THEN
        UPDATE public.incidente
        SET inc_estado = 'cerrado',
            inc_notas = COALESCE(inc_notas, '') || ' [Reemplazado por nuevo incidente ' || NEW.inc_id_incidente || ']'
        WHERE usu_id_victima = NEW.usu_id_victima
          AND inc_estado = 'en_curso'
          AND inc_id_incidente <> NEW.inc_id_incidente;
    END IF;

    IF NEW.inc_ultima_ubicacion_en IS NULL THEN
        NEW.inc_ultima_ubicacion_en := now();
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;

