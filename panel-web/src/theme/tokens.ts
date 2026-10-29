// panel-web/src/theme/tokens.ts
// ─────────────────────────────────────────────────────────────────────────────
// Design tokens compartidos de ApoyAR (derivados de docs/08-diseño.md).
// Mantiene estricta coherencia cromática, tipográfica y de contraste con la app móvil.
// ─────────────────────────────────────────────────────────────────────────────

export const palette = {
  // ── Fondos/Superficies (Modo Oscuro) ─────────────────────────────────────
  dark: {
    bg: {
      base:     '#121A1D',
      surface:  '#1C2A2E',
      elevated: '#263538',
      overlay:  '#344B52',
    },
    text: {
      primary:   '#F5F0EB',
      secondary: '#9DB3B4',
      disabled:  '#587983',
      inverse:   '#1A1F22',
    },
    semantic: {
      danger:     '#FF8A80',
      dangerBg:   '#2D1214',
      success:    '#6BCB77',
      successBg:  '#0F2213',
      warning:    '#FFB74D',
      warningBg:  '#2D1F0A',
      info:       '#64B5F6',
      infoBg:     '#0A1A2D',
    },
    border: {
      default: '#344B52',
      focus:   '#64B5F6',
    },
  },

  // ── Fondos/Superficies (Modo Claro) ──────────────────────────────────────
  light: {
    bg: {
      base:     '#FAE8DA',
      surface:  '#FFFFFF',
      elevated: '#F5F0EB',
      overlay:  '#CFD3CA',
    },
    text: {
      primary:   '#1A1F22',
      secondary: '#344B52',
      disabled:  '#9DB3B4',
      inverse:   '#F5F0EB',
    },
    semantic: {
      danger:     '#7A1F1F',
      dangerBg:   '#FDEAEA',
      success:    '#145420',
      successBg:  '#E8F5E9',
      warning:    '#664000',
      warningBg:  '#FFF3E0',
      info:       '#0D47A1',
      infoBg:     '#E3F2FD',
    },
    border: {
      default: '#CFD3CA',
      focus:   '#0D47A1',
    },
  },
} as const;

export const spacing = {
  '2xs': 4,
  xs:    8,
  sm:    12,
  md:    16,
  lg:    24,
  xl:    32,
  '2xl': 48,
  '3xl': 64,
} as const;

export const radii = {
  sm:   8,
  md:   12,
  lg:   16,
  full: 9999,
} as const;
