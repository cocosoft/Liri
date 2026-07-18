/**
 * 主题响应式上下文桥接
 *
 * 连接 ThemeManager（终端主题）与 Ink/React 组件树，
 * 使组件能通过 useThemeContext() 实时获取当前主题的 UI 配色。
 *
 * 用法：
 * ```tsx
 * // 在应用根组件包裹
 * <ThemeBridgeProvider>
 *   <App />
 * </ThemeBridgeProvider>
 *
 * // 在任意组件中消费
 * const { uiColors, isDark } = useThemeContext();
 * <Text color={uiColors.primary}>Hello</Text>
 * ```
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { ThemeManager } from '../ThemeManager';
import type { ThemeUIColorPalette } from './ThemeSchema';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'ui:theme:ThemeContext', level: LogLevel.INFO });

export interface ThemeContextValue {
  /** UI 组件配色 */
  uiColors: ThemeUIColorPalette;
  /** 是否为深色主题 */
  isDark: boolean;
  /** 当前主题名称 */
  themeName: string;
  /** 获取指定 UI 颜色值 */
  getColor(key: keyof ThemeUIColorPalette): string;
}

const FALLBACK_LIGHT: ThemeUIColorPalette = {
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
  highlight: '#E8F0FE',
};

const FALLBACK_DARK: ThemeUIColorPalette = {
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
  highlight: '#264F78',
};

const ThemeBridgeContext = createContext<ThemeContextValue | null>(null);

interface ThemeBridgeProviderProps {
  children: React.ReactNode;
}

export function ThemeBridgeProvider({ children }: ThemeBridgeProviderProps) {
  const managerRef = useRef(ThemeManager.getInstance());
  const [state, setState] = useState(() => {
    const mgr = managerRef.current;
    const name = mgr.getThemeName();
    return {
      uiColors: loadUiColors(mgr, name),
      isDark: isDarkName(name),
      themeName: name,
    };
  });

  useEffect(() => {
    const mgr = managerRef.current;
    const listener = () => {
      const name = mgr.getThemeName();
      setState({
        uiColors: loadUiColors(mgr, name),
        isDark: isDarkName(name),
        themeName: name,
      });
    };
    mgr.addListener(listener);
    return () => mgr.removeListener(listener);
  }, []);

  const getColor = useCallback(
    (key: keyof ThemeUIColorPalette): string => {
      return state.uiColors[key];
    },
    [state.uiColors]
  );

  return (
    <ThemeBridgeContext.Provider value={{ ...state, getColor }}>
      {children}
    </ThemeBridgeContext.Provider>
  );
}

function loadUiColors(
  mgr: ThemeManager,
  themeName: string
): ThemeUIColorPalette {
  try {
    const loader = mgr.getThemeLoader();
    if (!loader.isInitialized()) {
      return isDarkName(themeName) ? FALLBACK_DARK : FALLBACK_LIGHT;
    }
    const def = loader.getTheme(themeName);
    if (def?.ui) return { ...def.ui };
  } catch (err) {

    // 忽略加载异常，使用后备配色

    logger.debug("Operation skipped", { context: "忽略加载异常，使用后备配色", error: err instanceof Error ? err.message : String(err) });

  }
  return isDarkName(themeName) ? FALLBACK_DARK : FALLBACK_LIGHT;
}

function isDarkName(themeName: string): boolean {
  return themeName !== 'default' && themeName !== 'light';
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeBridgeContext);
  if (!context) {
    throw new Error('useThemeContext 必须在 ThemeBridgeProvider 内部使用');
  }
  return context;
}
