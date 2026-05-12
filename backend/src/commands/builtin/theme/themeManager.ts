import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * /theme 命令 - 主题管理
 * 基于CC源码 commands/theme/theme.tsx 模式
 */

export type ThemeName = 'dark' | 'light' | 'system' | 'custom';

export interface ThemeConfig {
  name: ThemeName;
  colors: Record<string, string>;
}

const THEMES: Record<ThemeName, ThemeConfig> = {
  dark: {
    name: 'dark',
    colors: {
      bg: '#1a1a2e',
      fg: '#e0e0e0',
      accent: '#6c63ff',
      error: '#ff4444',
      success: '#44ff44',
      warning: '#ffaa44',
    },
  },
  light: {
    name: 'light',
    colors: {
      bg: '#ffffff',
      fg: '#1a1a2e',
      accent: '#6c63ff',
      error: '#cc0000',
      success: '#00aa00',
      warning: '#cc7700',
    },
  },
  system: {
    name: 'system',
    colors: {
      bg: '#1a1a2e',
      fg: '#e0e0e0',
      accent: '#6c63ff',
      error: '#ff4444',
      success: '#44ff44',
      warning: '#ffaa44',
    },
  },
  custom: {
    name: 'custom',
    colors: {
      bg: '#1a1a2e',
      fg: '#e0e0e0',
      accent: '#6c63ff',
      error: '#ff4444',
      success: '#44ff44',
      warning: '#ffaa44',
    },
  },
};

let currentTheme: ThemeName = 'dark';

export function getTheme(): ThemeConfig {
  return THEMES[currentTheme];
}

export function setTheme(name: ThemeName): ThemeConfig {
  if (!THEMES[name]) throw new AppError(`Unknown theme: ${name}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
  currentTheme = name;
  return THEMES[name];
}

export function listThemes(): ThemeName[] {
  return Object.keys(THEMES) as ThemeName[];
}

export function getThemeColor(key: keyof ThemeConfig['colors']): string {
  return getTheme().colors[key];
}
