/**
 * 主题管理器
 *
 * 提供终端主题的定制功能
 */

export interface ThemeColors {
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  ansi256?: Record<number, string>;
}

export interface ThemeConfig {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorStyle?: 'block' | 'underline' | 'beam';
  cursorBlink?: boolean;
  cursorBlinkInterval?: number;
}

const DEFAULT_THEME: Theme = {
  name: 'default',
  colors: {
    foreground: '#ffffff',
    background: '#000000',
    cursor: '#ffffff',
    cursorAccent: '#000000',
    selectionBackground: '#ffffff',
    selectionForeground: '#000000',
    black: '#000000',
    red: '#ff0000',
    green: '#00ff00',
    yellow: '#ffff00',
    blue: '#0000ff',
    magenta: '#ff00ff',
    cyan: '#00ffff',
    white: '#ffffff',
    brightBlack: '#808080',
    brightRed: '#ff8080',
    brightGreen: '#80ff80',
    brightYellow: '#ffff80',
    brightBlue: '#8080ff',
    brightMagenta: '#ff80ff',
    brightCyan: '#80ffff',
    brightWhite: '#ffffff',
  },
};

const DARK_THEME: Theme = {
  name: 'dark',
  colors: {
    foreground: '#d4d4d4',
    background: '#1e1e1e',
    cursor: '#d4d4d4',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    selectionForeground: '#d4d4d4',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
};

const LIGHT_THEME: Theme = {
  name: 'light',
  colors: {
    foreground: '#000000',
    background: '#ffffff',
    cursor: '#000000',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    selectionForeground: '#000000',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#00bc00',
    brightYellow: '#949800',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#ffffff',
  },
};

export class ThemeManager {
  private static instance: ThemeManager | null = null;
  private currentTheme: Theme;
  private config: ThemeConfig;
  private listeners: Set<() => void> = new Set();

  private constructor() {
    this.currentTheme = { ...DEFAULT_THEME };
    this.config = {
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block',
      cursorBlink: true,
      cursorBlinkInterval: 530,
    };
  }

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  /**
   * 获取当前主题
   */
  getTheme(): Theme {
    return { ...this.currentTheme };
  }

  /**
   * 获取颜色
   */
  getColor(name: keyof ThemeColors): string {
    return this.currentTheme.colors[name];
  }

  /**
   * 获取主题名称
   */
  getThemeName(): string {
    return this.currentTheme.name;
  }

  /**
   * 设置主题
   * @param themeName 主题名称
   */
  setTheme(themeName: string): boolean {
    const theme = this.getBuiltInTheme(themeName);
    if (theme) {
      this.currentTheme = { ...theme };
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * 设置自定义主题
   * @param theme 主题
   */
  setCustomTheme(theme: Theme): void {
    this.currentTheme = { ...theme };
    this.notifyListeners();
  }

  /**
   * 获取内置主题
   * @param name 主题名称
   */
  getBuiltInTheme(name: string): Theme | undefined {
    switch (name.toLowerCase()) {
      case 'default':
        return { name: 'default', colors: { ...DEFAULT_THEME.colors } };
      case 'dark':
        return { name: 'dark', colors: { ...DARK_THEME.colors } };
      case 'light':
        return { name: 'light', colors: { ...LIGHT_THEME.colors } };
      default:
        return undefined;
    }
  }

  /**
   * 获取所有内置主题
   */
  getBuiltInThemes(): string[] {
    return ['default', 'dark', 'light'];
  }

  /**
   * 获取配置
   */
  getConfig(): ThemeConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   * @param config 部分配置
   */
  updateConfig(config: Partial<ThemeConfig>): void {
    this.config = { ...this.config, ...config };
    this.notifyListeners();
  }

  /**
   * 添加监听器
   * @param listener 监听器
   */
  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除监听器
   * @param listener 监听器
   */
  removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * 重置为默认主题
   */
  resetToDefault(): void {
    this.currentTheme = { ...DEFAULT_THEME };
    this.config = {
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorStyle: 'block',
      cursorBlink: true,
      cursorBlinkInterval: 530,
    };
    this.notifyListeners();
  }

  /**
   * 导出主题
   */
  exportTheme(): { theme: Theme; config: ThemeConfig } {
    return {
      theme: this.getTheme(),
      config: this.getConfig(),
    };
  }

  /**
   * 导入主题
   * @param data 主题数据
   */
  importTheme(data: { theme: Theme; config: ThemeConfig }): void {
    this.currentTheme = { ...data.theme };
    this.config = { ...data.config };
    this.notifyListeners();
  }

  /**
   * 将主题颜色转换为ANSI转义序列
   * @param colorName 颜色名称
   */
  colorToAnsi(colorName: keyof ThemeColors): string {
    const color = this.getColor(colorName);
    return this.rgbToAnsi(color);
  }

  /**
   * 将RGB颜色转换为ANSI转义序列
   * @param rgb RGB颜色值
   */
  rgbToAnsi(rgb: string): string {
    if (rgb.startsWith('#')) {
      const hex = rgb.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);

      const ansi = this.rgbToAnsi256(r, g, b);
      return `\x1b[38;5;${ansi}m`;
    }
    return '';
  }

  /**
   * 将RGB转换为ANSI 256色
   */
  private rgbToAnsi256(r: number, g: number, b: number): number {
    if (r === g && g === b) {
      if (r < 8) return 16;
      if (r > 248) return 231;
      return Math.round(((r - 8) / 247) * 24) + 231;
    }

    return (
      16 + Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51)
    );
  }

  /**
   * 获取背景色ANSI转义序列
   */
  backgroundToAnsi(colorName: keyof ThemeColors): string {
    const color = this.getColor(colorName);
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const ansi = this.rgbToAnsi256(r, g, b);
      return `\x1b[48;5;${ansi}m`;
    }
    return '';
  }
}

export const themeManager = ThemeManager.getInstance();

export default themeManager;
