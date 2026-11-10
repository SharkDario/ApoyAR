// src/navigation/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tipado central de todos los stacks y sus params.
// React Navigation 7 exige ParamList para type-safety en navigate().
// ─────────────────────────────────────────────────────────────────────────────

// ── Stack de Autenticación (sin sesión activa) ────────────────────────────────
export type AuthStackParamList = {
  Login: undefined;
};

// ── Stack Principal (sesión activa — rol Víctima) ────────────────────────────
export type VictimStackParamList = {
  Home: undefined;
  Countdown: { origen?: 'manual' | 'automatico' | 'palabra_clave' | 'violencia_ambiental' | 'amenaza_verbal_vosk' | 'botones_fisicos' } | undefined;
  Contacts: undefined;
  AlertReceived:
    | {
        incidenteId?: string | null;
        victimName?: string;
        victimPhone?: string;
        address?: string;
        timestamp?: string;
        latitude?: number;
        longitude?: number;
        origen?: string;
        estado?: string;
      }
    | undefined;
  FakeCalculator: undefined;
};

// ── Stack del Contacto de Emergencia (sesión activa — rol Contacto) ──────────
export type ContactStackParamList = {
  AlertReceived: {
    incidentId?: string;
    incidenteId?: string | null;
    victimName: string;
    latitude: number;
    longitude: number;
    estado?: string;
  };
  Home: undefined;
};

// ── Root Navigator (decide qué stack montar según estado de sesión) ──────────
export type RootStackParamList = {
  Auth: undefined;
  VictimMain: undefined;
  ContactMain: undefined;
  FakeCalculator: undefined;
};
