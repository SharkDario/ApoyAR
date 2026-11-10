import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';

export const LOCATION_TASK_NAME = 'background-location-task';

// Definir la tarea en el scope global, fuera de cualquier componente de React
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Error en location task:', error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (locations && locations.length > 0) {
      const location = locations[0];
      // Obtener el ID del incidente actual desde AsyncStorage o pasando metadata
      // Sin embargo, TaskManager no comparte estado con React fácilmente.
      // Una forma de bypassear esto es guardar el incidenteId en AsyncStorage o enviarlo directo si tenemos auth.
      // Como Supabase Auth persiste la sesión, podemos obtener el usuario:
      
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      // Buscar el incidente activo más reciente del usuario
      const { data: incidentes } = await supabase
        .from('incidente')
        .select('inc_id_incidente')
        .eq('usu_id_victima', authData.user.id)
        .eq('inc_estado', 'en_curso')
        .order('inc_fecha_hora', { ascending: false })
        .limit(1);

      if (incidentes && incidentes.length > 0) {
        const incidenteId = (incidentes[0] as any).inc_id_incidente;
        // Actualizar la latitud y longitud en la base de datos
        // Esto gatillará un evento de postgres_changes en los receptores
        await supabase
          .from('incidente')
          .update({
            inc_latitud: location.coords.latitude,
            inc_longitud: location.coords.longitude,
            inc_ultima_ubicacion_en: new Date().toISOString(),
          })
          .eq('inc_id_incidente', incidenteId);
      }
    }
  }
});
