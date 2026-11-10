// src/lib/pushNotifications.ts
// ─────────────────────────────────────────────────────────────────────────────
// Registro del Expo Push Token y guardado en Supabase (tabla dispositivo_usuario).
// Se llama una vez por sesión, después del login exitoso.
// ─────────────────────────────────────────────────────────────────────────────

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { resolverDireccionAsync, esSoloCoordenadas } from './geoUtils';

// Configurar cómo se muestran las notificaciones cuando la app está en primer plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Variable de control para evitar spam de avisos en consola durante desarrollo
let hasLoggedPushDevNotice = false;

/**
 * Solicita permisos de notificaciones y registra el token en Supabase.
 * Implementa Dispositivo.registrarToken() del diagrama de clases.
 *
 * @param usuarioId UUID del usuario autenticado actualmente.
 */
export async function registrarPushToken(usuarioId: string): Promise<void> {
  // Los emuladores no soportan push notifications reales
  if (!Device.isDevice) {
    if (!hasLoggedPushDevNotice) {
      console.log('[Push] Corriendo en emulador — notificaciones push deshabilitadas.');
      hasLoggedPushDevNotice = true;
    }
    return;
  }

  // Solicitar permisos
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    if (!hasLoggedPushDevNotice) {
      console.log('[Push] Permiso de notificaciones no concedido por el usuario.');
      hasLoggedPushDevNotice = true;
    }
    return;
  }

  // Obtener token de Expo Push
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      // projectId se obtiene del app.json o app.config.js de Expo (campo extra.eas.projectId)
    });
    const expoPushToken = tokenData.data;

    const plataforma = Platform.OS; // 'ios' | 'android'

    // Upsert: si ya existe un token para este usuario en este dispositivo, lo actualiza.
    const { error } = await supabase
      .from('dispositivo_usuario')
      .upsert(
        {
          usu_id_usuario: usuarioId,
          disusu_expo_push_token: expoPushToken,
          disusu_plataforma: plataforma,
          disusu_activo: true,
        },
        {
          onConflict: 'disusu_expo_push_token', // columna UNIQUE del esquema
        }
      );

    if (error) {
      console.error('[Push] Error al registrar token en base de datos:', error.message);
    } else {
      console.log('[Push] Token push registrado con éxito:', expoPushToken);
    }
  } catch (pushErr: any) {
    // Captura controlada sin bucle de reintentos: en desarrollo local sin google-services.json
    // se opera normalmente con WebSockets y notificaciones locales.
    if (!hasLoggedPushDevNotice) {
      console.log(
        '[Push] Entorno de desarrollo sin Firebase Cloud Messaging (google-services.json no configurado). Se opera con notificaciones locales y canal WebSocket Supabase Realtime.'
      );
      hasLoggedPushDevNotice = true;
    }
  }

  // Canal de notificación de alta prioridad para Android (requerido en Android 8+)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('emergencias', {
      name: 'Alertas de Emergencia',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF8A80',
      enableVibrate: true,
      // Omitir sound o dejarlo por defecto de Android para no buscar recurso nativo inexistente
    });
  }
}

/**
 * Descarta de la barra de notificaciones cualquier alerta activa previa de un usuario emisor.
 */
export async function descartarNotificacionesUsuario(victimaId: string): Promise<void> {
  try {
    if (!victimaId) return;
    await Notifications.dismissNotificationAsync(`alerta_usuario_${victimaId}`);
  } catch (e) {
    // Silencioso ante errores de descarte
  }
}

/**
 * Emite una notificación nativa local inmediata en el terminal (barra de estado, sonido y banner)
 * vinculada a una alerta o incidente de resguardo detectado en tiempo real.
 * Utiliza un identificador estable por emisor para que una nueva alerta reemplace la anterior
 * sin saturar la barra de estado con múltiples tarjetas.
 */
export async function emitirNotificacionLocal(alerta: {
  incidenteId: string;
  victimaId?: string;
  victimaNombre: string;
  direccion: string;
  latitud?: number;
  longitud?: number;
  origen?: string;
}): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('emergencias', {
        name: 'Alertas de Emergencia',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF8A80',
        enableVibrate: true,
      });
    }

    const stableId = alerta.victimaId
      ? `alerta_usuario_${alerta.victimaId}`
      : `incidente_${alerta.incidenteId}`;

    // Descartar notificación previa del mismo usuario para evitar duplicación
    let dirTexto = alerta.direccion || 'Ubicación de emergencia';
    if (
      esSoloCoordenadas(dirTexto) &&
      typeof alerta.latitud === 'number' &&
      typeof alerta.longitud === 'number' &&
      !isNaN(alerta.latitud) &&
      !isNaN(alerta.longitud)
    ) {
      try {
        const resuelta = await resolverDireccionAsync(alerta.latitud, alerta.longitud);
        if (resuelta && !esSoloCoordenadas(resuelta)) {
          dirTexto = resuelta;
        }
      } catch (_) { }
    }

    await Notifications.scheduleNotificationAsync({
      identifier: stableId,
      content: {
        title: '🚨 Alerta de Emergencia',
        body: `${alerta.victimaNombre || 'Tu contacto'} activó una alerta en ${dirTexto}`,
        data: {
          incidenteId: alerta.incidenteId,
          victimId: alerta.victimaId,
          victimName: alerta.victimaNombre || 'Tu contacto',
          address: dirTexto,
          latitude: alerta.latitud || -26.1852,
          longitude: alerta.longitud || -58.1756,
          origen: alerta.origen || 'automatico',
        },
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#E53935',
      },
      trigger: Platform.OS === 'android' ? { channelId: 'emergencias' } : null,
    });
  } catch (err) {
    console.warn('[Push] Error emitiendo notificación local:', err);
  }
}
