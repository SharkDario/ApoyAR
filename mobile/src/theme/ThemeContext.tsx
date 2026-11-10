// src/theme/ThemeContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Proveedor del sistema de diseño. Detecta automáticamente el esquema del
// sistema operativo (dark/light) y permite override manual.
// Expo el modo oscuro es el esquema prioritario (docs/08-diseño.md §premisa).
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palette, typography, spacing, radii, touchTargets, animation } from './tokens';

const STORAGE_KEY_THEME_OVERRIDE = '@apoyar_theme_override';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type ColorScheme = 'dark' | 'light';

export interface ThemeColors {
  bg: Record<keyof typeof palette.dark.bg, string>;
  text: Record<keyof typeof palette.dark.text, string>;
  semantic: Record<keyof typeof palette.dark.semantic, string>;
  border: Record<keyof typeof palette.dark.border, string>;
}

export interface Theme {
  scheme: ColorScheme;
  isDark: boolean;
  colors: ThemeColors;
  typography: typeof typography;
  spacing: typeof spacing;
  radii: typeof radii;
  touchTargets: typeof touchTargets;
  animation: typeof animation;
  /** Override manual del esquema: null = seguir al SO */
  setSchemeOverride: (scheme: ColorScheme | null) => void;
  /** Alterna manualmente entre modo claro y modo oscuro */
  toggleTheme: () => void;
}

// ── Contexto ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<Theme | null>(null);

// ── Proveedor ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode;
  /** Para storybook/testing: forzar un esquema inicial */
  initialOverride?: ColorScheme | null;
}

export function ThemeProvider({ children, initialOverride = null }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<ColorScheme | null>(initialOverride);

  // Cargar preferencia persistida del usuario
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_THEME_OVERRIDE)
      .then((saved) => {
        if (saved === 'dark' || saved === 'light') {
          setOverride(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setSchemeOverride = useCallback((scheme: ColorScheme | null) => {
    setOverride(scheme);
    if (scheme) {
      AsyncStorage.setItem(STORAGE_KEY_THEME_OVERRIDE, scheme).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEY_THEME_OVERRIDE).catch(() => {});
    }
  }, []);

  // Si no hay override manual, adaptarse al esquema del sistema operativo (por defecto dark si es null)
  const scheme: ColorScheme = override ?? (systemScheme === 'dark' ? 'dark' : 'light');
  const isDark = scheme === 'dark';

  const toggleTheme = useCallback(() => {
    const nextScheme: ColorScheme = isDark ? 'light' : 'dark';
    setSchemeOverride(nextScheme);
  }, [isDark, setSchemeOverride]);

  const colors: ThemeColors = useMemo(
    () => (isDark ? palette.dark : palette.light),
    [isDark],
  );

  const theme = useMemo<Theme>(
    () => ({
      scheme,
      isDark,
      colors,
      typography,
      spacing,
      radii,
      touchTargets,
      animation,
      setSchemeOverride,
      toggleTheme,
    }),
    [scheme, isDark, colors, setSchemeOverride, toggleTheme],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

// ── Hook de consumo ───────────────────────────────────────────────────────────

/**
 * Devuelve el tema activo (dark o light) con todos los tokens.
 * Lanza si se usa fuera de ThemeProvider.
 *
 * @example
 * const { colors, spacing, typography } = useTheme();
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  }
  return ctx;
}
