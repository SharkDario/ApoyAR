// src/lib/temporizadorAudio.ts
// ─────────────────────────────────────────────────────────────────────────────
// Con la pantalla bloqueada, React Native detiene setTimeout y setInterval en
// Android, pero los eventos del micrófono siguen llegando cada ~100 ms. Mientras
// la Escucha en vivo está activa, esos eventos hacen de reloj.
// ─────────────────────────────────────────────────────────────────────────────

type Pendiente = {
  vence: number;
  accion: () => void;
  temporizador: ReturnType<typeof setTimeout>;
};

const pendientes = new Set<Pendiente>();

function ejecutar(pendiente: Pendiente): void {
  if (!pendientes.delete(pendiente)) return;
  clearTimeout(pendiente.temporizador);
  pendiente.accion();
}

/** Como setTimeout, pero también vence con el pulso del audio. Devuelve la función que lo cancela. */
export function programar(accion: () => void, ms: number): () => void {
  const pendiente: Pendiente = {
    vence: Date.now() + ms,
    accion,
    temporizador: setTimeout(() => ejecutar(pendiente), ms),
  };
  pendientes.add(pendiente);

  return () => {
    pendientes.delete(pendiente);
    clearTimeout(pendiente.temporizador);
  };
}

export function esperarAsync(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    programar(resolve, ms);
  });
}

/** Se llama con cada evento del micrófono. */
export function pulsoDeAudio(): void {
  const ahora = Date.now();
  pendientes.forEach((pendiente) => {
    if (pendiente.vence <= ahora) ejecutar(pendiente);
  });
}
