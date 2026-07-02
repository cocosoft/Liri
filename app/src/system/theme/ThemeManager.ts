/**
 * 主题管理器
 * 提供浅色和深色主题支持，以及自定义主题功能
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import chalk from 'chalk';

const logger = new Logger({ module: 'system:theme', level: LogLevel.INFO });

export interface ThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  text: string;
  textSecondary: string;
  background: string;
  backgroundSecondary: string;
  border: string;
  muted: string;
}

export interface Theme {
  name: string;
  description: string;
  isDark: boolean;
  colors: ThemeColors;
}

export class ThemeManager {
  private currentTheme: Theme;
  private customThemes: Map<string, Theme>;
  private listeners: Array<(theme: Theme) => void>;

  constructor() {
    this.customThemes = new Map();
    this.listeners = [];
    this.currentTheme = this.getBuiltInTheme('light');
  }

  /**
   * 获取内置主题
   */
  private getBuiltInTheme(name: string): Theme {
    const themes: Record<string, Theme> = {
      light: {
        name: 'light',
        description: '浅色主题',
        isDark: false,
        colors: {
          primary: '#0066cc',
          secondary: '#6c757d',
          success: '#28a745',
          warning: '#ffc107',
          error: '#dc3545',
          info: '#17a2b8',
          text: '#212529',
          textSecondary: '#6c757d',
          background: '#ffffff',
          backgroundSecondary: '#f8f9fa',
          border: '#dee2e6',
          muted: '#adb5bd',
        },
      },
      dark: {
        name: 'dark',
        description: '深色主题',
        isDark: true,
        colors: {
          primary: '#4dabf7',
          secondary: '#868e96',
          success: '#51cf66',
          warning: '#ffd43b',
          error: '#ff6b6b',
          info: '#22b8cf',
          text: '#f8f9fa',
          textSecondary: '#adb5bd',
          background: '#1a1a2e',
          backgroundSecondary: '#16213e',
          border: '#495057',
          muted: '#6c757d',
        },
      },
      monokai: {
        name: 'monokai',
        description: 'Monokai 主题',
        isDark: true,
        colors: {
          primary: '#f92672',
          secondary: '#75715e',
          success: '#a6e22e',
          warning: '#e6db74',
          error: '#f92672',
          info: '#66d9ef',
          text: '#f8f8f2',
          textSecondary: '#75715e',
          background: '#272822',
          backgroundSecondary: '#1e1f1c',
          border: '#49483e',
          muted: '#75715e',
        },
      },
      solarized: {
        name: 'solarized',
        description: 'Solarized 主题',
        isDark: false,
        colors: {
          primary: '#268bd2',
          secondary: '#93a1a1',
          success: '#859900',
          warning: '#b58900',
          error: '#dc322f',
          info: '#2aa198',
          text: '#657b83',
          textSecondary: '#93a1a1',
          background: '#fdf6e3',
          backgroundSecondary: '#eee8d5',
          border: '#d3d3d3',
          muted: '#93a1a1',
        },
      },
      dracula: {
        name: 'dracula',
        description: 'Dracula 主题',
        isDark: true,
        colors: {
          primary: '#bd93f9',
          secondary: '#6272a4',
          success: '#50fa7b',
          warning: '#f1fa8c',
          error: '#ff5555',
          info: '#8be9fd',
          text: '#f8f8f2',
          textSecondary: '#6272a4',
          background: '#282a36',
          backgroundSecondary: '#383a47',
          border: '#44475a',
          muted: '#6272a4',
        },
      },
    };

    return themes[name] || themes.light;
  }

  /**
   * 获取可用主题列表
   */
  getAvailableThemes(): Theme[] {
    const builtInThemes = ['light', 'dark', 'monokai', 'solarized', 'dracula'];
    const themes: Theme[] = builtInThemes.map((name) =>
      this.getBuiltInTheme(name)
    );

    this.customThemes.forEach((theme) => {
      themes.push(theme);
    });

    return themes;
  }

  /**
   * 设置主题
   */
  setTheme(themeName: string): boolean {
    let theme: Theme | undefined;

    if (this.customThemes.has(themeName)) {
      theme = this.customThemes.get(themeName);
    } else {
      theme = this.getBuiltInTheme(themeName);
    }

    if (!theme) {
      return false;
    }

    this.currentTheme = theme;
    this.notifyListeners();
    return true;
  }

  /**
   * 获取当前主题
   */
  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * 添加自定义主题
   */
  addCustomTheme(theme: Theme): void {
    if (this.customThemes.has(theme.name)) {
      throw new AppError(
        `Theme ${theme.name} already exists`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    this.customThemes.set(theme.name, theme);
  }

  /**
   * 移除自定义主题
   */
  removeCustomTheme(themeName: string): boolean {
    return this.customThemes.delete(themeName);
  }

  /**
   * 获取主题颜色
   */
  getColor(type: keyof ThemeColors): string {
    return this.currentTheme.colors[type];
  }

  /**
   * 是否为深色主题
   */
  isDarkTheme(): boolean {
    return this.currentTheme.isDark;
  }

  /**
   * 切换主题
   */
  toggleTheme(): void {
    const currentName = this.currentTheme.name;
    const themes = this.getAvailableThemes();
    const currentIndex = themes.findIndex((t) => t.name === currentName);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.setTheme(themes[nextIndex].name);
  }

  /**
   * 订阅主题变化
   */
  subscribe(listener: (theme: Theme) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      listener(this.currentTheme);
    });
  }

  /**
   * 显示主题列表
   */
  displayThemes(): void {
    const output: string[] = [
      chalk.cyan('═'.repeat(60)),
      chalk.bold('  可用主题'),
      chalk.cyan('═'.repeat(60)),
      '',
    ];

    const themes = this.getAvailableThemes();
    themes.forEach((theme) => {
      const marker =
        theme.name === this.currentTheme.name
          ? chalk.green('●')
          : chalk.gray('○');
      const darkLabel = theme.isDark
        ? chalk.gray('[深色]')
        : chalk.gray('[浅色]');
      output.push(
        `  ${marker} ${chalk.yellow(theme.name.padEnd(15))} ${darkLabel} ${theme.description}`
      );
    });

    output.push('');
    output.push(chalk.gray(`当前主题: ${this.currentTheme.name}`));
    output.push(chalk.cyan('═'.repeat(60)));
    logger.info(output.join('\n'));
  }

  /**
   * 显示当前主题详情
   */
  displayCurrentTheme(): void {
    const theme = this.currentTheme;

    const output: string[] = [
      chalk.cyan('═'.repeat(60)),
      chalk.bold(`  主题: ${theme.name}`),
      chalk.gray(`  ${theme.description}`),
      chalk.cyan('─'.repeat(60)),
      '',
      chalk.yellow('颜色配置:'),
    ];

    Object.entries(theme.colors).forEach(([key, value]) => {
      const colorPreview = this.getColorPreview(value);
      output.push(
        `  ${chalk.white(key.padEnd(18))} ${colorPreview} ${chalk.gray(value)}`
      );
    });

    output.push('');
    output.push(chalk.cyan('═'.repeat(60)));
    logger.info(output.join('\n'));
  }

  /**
   * 获取颜色预览块
   */
  private getColorPreview(color: string): string {
    const bgColor = color;
    const textColor = this.isLightColor(color) ? '#000000' : '#ffffff';
    return chalk.bgHex(bgColor).hex(textColor)(' 预览 ');
  }

  /**
   * 判断是否为浅色
   */
  private isLightColor(color: string): boolean {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128;
  }

  /**
   * 应用主题样式
   */
  applyStyle(
    style:
      | 'header'
      | 'title'
      | 'subtitle'
      | 'success'
      | 'warning'
      | 'error'
      | 'info'
      | 'code'
      | 'prompt'
      | 'progress',
    text: string
  ): string {
    const styles: Record<string, (t: string) => string> = {
      header: (t) => chalk.hex(this.currentTheme.colors.primary).bold(t),
      title: (t) => chalk.hex(this.currentTheme.colors.primary).bold(t),
      subtitle: (t) => chalk.hex(this.currentTheme.colors.success)(t),
      success: (t) => chalk.hex(this.currentTheme.colors.success)('✓ ' + t),
      warning: (t) => chalk.hex(this.currentTheme.colors.warning)('⚠ ' + t),
      error: (t) => chalk.hex(this.currentTheme.colors.error)('✗ ' + t),
      info: (t) => chalk.hex(this.currentTheme.colors.info)('ℹ ' + t),
      code: (t) => chalk.hex(this.currentTheme.colors.textSecondary)(t),
      prompt: (t) => chalk.hex(this.currentTheme.colors.primary)(t),
      progress: (t) => chalk.hex(this.currentTheme.colors.info)(t),
    };

    const formatter = styles[style] || ((t) => t);
    return formatter(text);
  }

  /**
   * 导出主题为 JSON
   */
  exportTheme(themeName?: string): string {
    const theme = themeName
      ? this.customThemes.get(themeName) || this.getBuiltInTheme(themeName)
      : this.currentTheme;
    return JSON.stringify(theme, null, 2);
  }

  /**
   * 从 JSON 导入主题
   */
  importTheme(json: string): boolean {
    try {
      const theme = JSON.parse(json) as Theme;

      if (!theme.name || !theme.colors || !theme.isDark) {
        throw new AppError(
          'Invalid theme format',
          ErrorCategory.VALIDATION,
          ErrorSeverity.MEDIUM
        );
      }

      this.addCustomTheme(theme);
      return true;
    } catch (error) {
      logger.error(
        '导入主题失败',
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }
}

let themeManagerInstance: ThemeManager | undefined;

export function getThemeManager(): ThemeManager {
  if (!themeManagerInstance) {
    themeManagerInstance = new ThemeManager();
  }
  return themeManagerInstance;
}

export function createThemeManager(): ThemeManager {
  return new ThemeManager();
}
