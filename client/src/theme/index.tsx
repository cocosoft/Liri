import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { getColors } from './colors';
import { getTokens } from './tokens';
import type { Theme, ThemeMode } from './types';

const ThemeContext = createContext<Theme | undefined>(undefined);

interface ThemeProviderProps {
  mode: ThemeMode;
  children: ReactNode;
}

export function ThemeProvider({ mode, children }: ThemeProviderProps) {
  const theme = useMemo<Theme>(() => ({
    mode,
    colors: getColors(mode),
    tokens: getTokens(mode),
  }), [mode]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export { lightColors, darkColors } from './colors';
export { baseTokens, darkTokens } from './tokens';
export type { Theme, ThemeColors, ThemeToken, ThemeMode } from './types';