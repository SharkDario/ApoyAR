// src/lib/presencia.ts
// ─────────────────────────────────────────────────────────────────────────────
// Estado "En línea" de la red de apoyo con Supabase Realtime Presence (CU-02).
// La presencia viaja por el canal y no se guarda en ninguna tabla. Cada persona
// publica en su propio canal mientras tiene la app abierta, y quien la tiene en
// su red escucha ese canal: nadie ve la lista completa de usuarios conectados.
// ─────────────────────────────────────────────────────────────────────────────

import { AppState } from 'react-native';
import { supabase } from './supabase';

const canalDe = (usuarioId: string) => `presencia:${usuarioId}`;

/** Publica la presencia propia. Devuelve la función que la detiene al cerrar sesión. */
export function iniciarPresencia(usuarioId: string): () => void {
  const canal = supabase.channel(canalDe(usuarioId), {
    config: { presence: { key: usuarioId, enabled: true } },
  });
  let suscripto = false;

  const publicar = () => {
    if (!suscripto) return;
    const operacion = AppState.currentState === 'active' ? canal.track({ en_linea: true }) : canal.untrack();
    operacion.catch((err) => console.warn('[Presencia] No se pudo actualizar el estado:', err));
  };

  // Al volver la conexión el canal se une de nuevo y hay que publicar otra vez
  canal.subscribe((estado) => {
    suscripto = estado === 'SUBSCRIBED';
    publicar();
  });
  const suscripcionApp = AppState.addEventListener('change', publicar);

  return () => {
    suscripcionApp.remove();
    supabase.removeChannel(canal);
  };
}

/** Escucha la presencia de varias personas. Devuelve la función que deja de escuchar. */
export function observarPresencia(
  usuarioIds: string[],
  alCambiar: (usuarioId: string, enLinea: boolean) => void
): () => void {
  const canales = usuarioIds.map((usuarioId) => {
    const canal = supabase.channel(canalDe(usuarioId), { config: { presence: { enabled: true } } });
    canal
      .on('presence', { event: 'sync' }, () => {
        alCambiar(usuarioId, Object.keys(canal.presenceState()).length > 0);
      })
      .subscribe();
    return canal;
  });

  return () => canales.forEach((canal) => supabase.removeChannel(canal));
}
