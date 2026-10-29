-- =============================================================================
-- ApoyAR — Migración: Heartbeat de Ubicación y Unicidad de Alertas Activas
-- Compatibilidad: Supabase (PostgreSQL 15+)
--
-- Objetivos:
-- 1. Asegurar que exista como máximo UNA sola alerta con estado 'en_curso'
--    por cada usuario emisor (víctima).
-- 2. Al registrar un nuevo incidente, pasar automáticamente las anteriores a 'finalizado'.
-- 3. Registrar y actualizar automáticamente 'last_location_at' ante cada cambio
--    de coordenadas GPS (heartbeat de telemetría en tiempo real).
-- =============================================================================

-- 1. Agregar columna last_location_at a la tabla incidente
ALTER TABLE public.incidente 
ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ DEFAULT now();

-- Crear índice para optimizar consultas de alertas recientes y heartbeat
CREATE INDEX IF NOT EXISTS idx_incidente_last_location_at 
ON public.incidente(last_location_at DESC);

-- 2. Función y Trigger: Unicidad de incidente en curso por víctima
CREATE OR REPLACE FUNCTION public.fn_cerrar_incidentes_previos_victima()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Si el nuevo incidente se crea con estado 'en_curso'
    IF NEW.estado = 'en_curso' THEN
        -- Finalizar cualquier incidente previo 'en_curso' de la misma víctima
        UPDATE public.incidente
        SET estado = 'cerrado',
            notas = COALESCE(notas, '') || ' [Reemplazado por nuevo incidente ' || NEW.id || ']'
        WHERE victima_id = NEW.victima_id
          AND estado = 'en_curso'
          AND id <> NEW.id;
    END IF;

    -- Garantizar que last_location_at tenga valor inicial
    IF NEW.last_location_at IS NULL THEN
        NEW.last_location_at := now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_cerrar_incidentes_previos ON public.incidente;
CREATE TRIGGER tr_cerrar_incidentes_previos
    BEFORE INSERT ON public.incidente
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_cerrar_incidentes_previos_victima();

-- 3. Función y Trigger: Actualización automática de heartbeat ante movimiento GPS
CREATE OR REPLACE FUNCTION public.fn_actualizar_heartbeat_incidente()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Si cambian las coordenadas o la dirección, actualizar la estampa de tiempo
    IF (NEW.latitud IS DISTINCT FROM OLD.latitud) 
       OR (NEW.longitud IS DISTINCT FROM OLD.longitud) 
       OR (NEW.direccion IS DISTINCT FROM OLD.direccion) THEN
        NEW.last_location_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_actualizar_heartbeat_incidente ON public.incidente;
CREATE TRIGGER tr_actualizar_heartbeat_incidente
    BEFORE UPDATE ON public.incidente
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_actualizar_heartbeat_incidente();

-- 4. Normalizar incidentes existentes: si un usuario tiene múltiples 'en_curso',
-- dejar únicamente el más reciente y cerrar los antiguos.
WITH incidentes_duplicados AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY victima_id 
               ORDER BY fecha_hora DESC
           ) as rn
    FROM public.incidente
    WHERE estado = 'en_curso'
)
UPDATE public.incidente
SET estado = 'cerrado',
    notas = COALESCE(notas, '') || ' [Normalizado: Alerta antigua cerrada automáticamente]'
WHERE id IN (
    SELECT id FROM incidentes_duplicados WHERE rn > 1
);
