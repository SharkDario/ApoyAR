// src/theme/tokens.ts
// ─────────────────────────────────────────────────────────────────────────────
// Design tokens derivados de /docs/08-diseño.md
// Todos los valores de contraste fueron verificados con la fórmula WCAG 2.2
// de luminancia relativa. Todos los colores semánticos cumplen AAA (≥ 7:1).
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
      primary:  '#F5F0EB',
      secondary: '#9DB3B4',
      disabled: '#587983',
      inverse:  '#1A1F22',
    },
    semantic: {
      danger:     '#FF8A80',  // CR vs #121A1D = 7.73:1 ✅ AAA
      dangerBg:   '#2D1214',
      success:    '#6BCB77',  // CR vs #121A1D = 8.77:1 ✅ AAA
      successBg:  '#0F2213',
      warning:    '#FFB74D',  // CR vs #121A1D = 10.19:1 ✅ AAA
      warningBg:  '#2D1F0A',
      info:       '#64B5F6',  // CR vs #121A1D = 7.97:1 ✅ AAA
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
      primary:  '#1A1F22',
      secondary: '#344B52',
      disabled: '#9DB3B4',
      inverse:  '#F5F0EB',
    },
    semantic: {
      danger:     '#7A1F1F',  // CR vs #FAE8DA = 8.63:1 ✅ AAA
      dangerBg:   '#FDEAEA',
      success:    '#145420',  // CR vs #FAE8DA = 7.60:1 ✅ AAA
      successBg:  '#E8F5E9',
      warning:    '#664000',  // CR vs #FAE8DA = 7.66:1 ✅ AAA
      warningBg:  '#FFF3E0',
      info:       '#0D47A1',  // CR vs #FAE8DA = 7.24:1 ✅ AAA
      infoBg:     '#E3F2FD',
    },
    border: {
      default: '#CFD3CA',
      focus:   '#0D47A1',
    },
  },
} as const;

// ── Tipografía ────────────────────────────────────────────────────────────────
export const typography = {
  fontFamily: {
    regular:    'Inter_400Regular',
    medium:     'Inter_500Medium',
    semibold:   'Inter_600SemiBold',
    bold:       'Inter_700Bold',
    extrabold:  'Inter_800ExtraBold',
  },
  scale: {
    sos:       { fontSize: 40, lineHeight: 48, fontWeight: '800' as const },
    display:   { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
    h1:        { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
    h2:        { fontSize: 24, lineHeight: 32, fontWeight: '600' as const },
    h3:        { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
    bodyLg:    { fontSize: 18, lineHeight: 26, fontWeight: '400' as const },
    body:      { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
    bodyBold:  { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
    // ⚠ caption (14px) solo para metadatos no críticos. Nunca en emergencias.
    caption:   { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  },
} as const;

// ── Espaciado (escala 8pt) ───────────────────────────────────────────────────
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

// ── Radios de borde ──────────────────────────────────────────────────────────
export const radii = {
  sm:   8,
  md:   12,
  lg:   16,
  full: 9999,
} as const;

// ── Tamaños táctiles (dp) — mínimo 48×48 sin excepción ─────────────────────
export const touchTargets = {
  min:         48,
  comfortable: 56,
  sos:         120,
  sosExpanded: 160,
} as const;

// ── Animaciones ───────────────────────────────────────────────────────────────
export const animation = {
  sosPulseDuration:  2000,
  countdownStepMs:   1000,
  feedbackHapticMs:  10,
  transitionDefault: 200,
  transitionSlow:    350,
} as const;
