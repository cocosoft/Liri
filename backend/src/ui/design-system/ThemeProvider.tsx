/**
 * 主题提供者组件（基于CC源码）
 * 提供主题上下文和主题管理功能
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ThemeName,
  ThemeSetting,
  ThemeContextValue,
  UITheme,
} from '../types/UITypes';

/**
 * 默认主题配置（基于CC源码）
 */
const defaultTheme: UITheme = {
  colors: {
    primary: '#007AFF',
    secondary: '#5856D6',
    success: '#34C759',
    warning: '#FF9500',
    error: '#FF3B30',
    info: '#5AC8FA',
    text: '#000000',
    textSecondary: '#8E8E93',
    background: '#FFFFFF',
    border: '#C6C6C8',
    accent: '#007AFF',
    muted: '#F2F2F7',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
  },
  typography: {
    fontSize: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 18,
      xl: 20,
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 700,
    },
  },
};

/**
 * 深色主题配置（基于CC源码）
 */
const darkTheme: UITheme = {
  ...defaultTheme,
  colors: {
    primary: '#0A84FF',
    secondary: '#5E5CE6',
    success: '#30D158',
    warning: '#FF9F0A',
    error: '#FF453A',
    info: '#64D2FF',
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    background: '#000000',
    border: '#38383A',
    accent: '#0A84FF',
    muted: '#1C1C1E',
  },
};

/**
 * 主题映射（基于CC源码）
 */
const themeMap: Record<ThemeName, UITheme> = {
  light: defaultTheme,
  dark: darkTheme,
  auto: defaultTheme, // 自动模式根据系统设置决定
};

/**
 * 主题上下文（基于CC源码）
 */
const ThemeContext = createContext<ThemeContextValue>({
  themeSetting: 'light',
  setThemeSetting: () => {},
  setPreviewTheme: () => {},
  savePreview: () => {},
  cancelPreview: () => {},
  currentTheme: 'light',
});

/**
 * 主题提供者属性类型
 */
interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: ThemeSetting;
  onThemeChange?: (theme: ThemeSetting) => void;
}

/**
 * 主题提供者组件（基于CC源码）
 */
export function ThemeProvider({
  children,
  initialTheme = 'light',
  onThemeChange,
}: ThemeProviderProps) {
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(initialTheme);
  const [previewTheme, setPreviewTheme] = useState<ThemeSetting | null>(null);

  /**
   * 解析当前主题（基于CC源码）
   */
  const currentTheme: ThemeName = useMemo(() => {
    if (previewTheme && previewTheme !== 'auto') {
      return previewTheme;
    }

    if (themeSetting === 'auto') {
      // 自动模式：根据系统设置决定
      // 这里简化处理，实际应该检测系统主题
      return 'light';
    }

    return themeSetting;
  }, [themeSetting, previewTheme]);

  /**
   * 获取当前主题配置（基于CC源码）
   */
  const theme = useMemo(() => {
    return themeMap[currentTheme];
  }, [currentTheme]);

  /**
   * 设置主题（基于CC源码）
   */
  const handleSetThemeSetting = (setting: ThemeSetting) => {
    setThemeSetting(setting);
    onThemeChange?.(setting);
  };

  /**
   * 设置预览主题（基于CC源码）
   */
  const handleSetPreviewTheme = (setting: ThemeSetting) => {
    setPreviewTheme(setting);
  };

  /**
   * 保存预览主题（基于CC源码）
   */
  const savePreview = () => {
    if (previewTheme) {
      handleSetThemeSetting(previewTheme);
      setPreviewTheme(null);
    }
  };

  /**
   * 取消预览主题（基于CC源码）
   */
  const cancelPreview = () => {
    setPreviewTheme(null);
  };

  /**
   * 主题上下文值（基于CC源码）
   */
  const contextValue: ThemeContextValue = {
    themeSetting,
    setThemeSetting: handleSetThemeSetting,
    setPreviewTheme: handleSetPreviewTheme,
    savePreview,
    cancelPreview,
    currentTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * 使用主题Hook（基于CC源码）
 */
export function useTheme(): { theme: UITheme } & ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new AppError(
      ErrorCodes.INTERNAL.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'CONTEXT_NOT_AVAILABLE',
      { hook: 'useTheme', provider: 'ThemeProvider' }
    );
  }

  const theme = themeMap[context.currentTheme];

  return {
    ...context,
    theme,
  };
}

/**
 * 使用主题颜色Hook（基于CC源码）
 */
export function useThemeColor(color: keyof UITheme['colors']): string {
  const { theme } = useTheme();
  return theme.colors[color];
}

/**
 * 使用主题间距Hook（基于CC源码）
 */
export function useThemeSpacing(size: keyof UITheme['spacing']): number {
  const { theme } = useTheme();
  return theme.spacing[size];
}

/**
 * 使用主题字体大小Hook（基于CC源码）
 */
export function useThemeFontSize(
  size: keyof UITheme['typography']['fontSize']
): number {
  const { theme } = useTheme();
  return theme.typography.fontSize[size];
}

export { ThemeContext };
export default ThemeProvider;
