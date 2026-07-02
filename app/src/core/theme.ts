/**
 * 主题系统
 * 提供不同的视觉主题选项
 */

import { Logger, LogLevel } from '@modules/monitoring';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { resolveDataDir } from '@modules/core';

const logger = new Logger({ module: 'core:theme', level: LogLevel.INFO });

/**
 * 主题接口
 */
export interface Theme {
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    text: string;
    background: string;
    border: string;
    highlight: string;
  };
  styles: {
    header: (text: string) => string;
    title: (text: string) => string;
    subtitle: (text: string) => string;
    success: (text: string) => string;
    warning: (text: string) => string;
    error: (text: string) => string;
    info: (text: string) => string;
    code: (text: string) => string;
    prompt: (text: string) => string;
    progress: (text: string) => string;
  };
}

/**
 * 内置主题
 */
const builtinThemes: Theme[] = [
  {
    name: 'light',
    description: 'Light theme with bright colors',
    colors: {
      primary: '#007acc',
      secondary: '#6c757d',
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545',
      info: '#17a2b8',
      text: '#212529',
      background: '#ffffff',
      border: '#dee2e6',
      highlight: '#f8f9fa',
    },
    styles: {
      header: (text: string) => chalk.cyan.bold(text),
      title: (text: string) => chalk.blue.bold(text),
      subtitle: (text: string) => chalk.green(text),
      success: (text: string) => chalk.green('✓ ' + text),
      warning: (text: string) => chalk.yellow('⚠ ' + text),
      error: (text: string) => chalk.red('✗ ' + text),
      info: (text: string) => chalk.blue('ℹ ' + text),
      code: (text: string) => chalk.gray(text),
      prompt: (text: string) => chalk.cyan(text),
      progress: (text: string) => chalk.blue(text),
    },
  },
  {
    name: 'dark',
    description: 'Dark theme with dark colors',
    colors: {
      primary: '#00bfff',
      secondary: '#6c757d',
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545',
      info: '#17a2b8',
      text: '#e9ecef',
      background: '#212529',
      border: '#495057',
      highlight: '#343a40',
    },
    styles: {
      header: (text: string) => chalk.cyan.bold(text),
      title: (text: string) => chalk.blue.bold(text),
      subtitle: (text: string) => chalk.green(text),
      success: (text: string) => chalk.green('✓ ' + text),
      warning: (text: string) => chalk.yellow('⚠ ' + text),
      error: (text: string) => chalk.red('✗ ' + text),
      info: (text: string) => chalk.blue('ℹ ' + text),
      code: (text: string) => chalk.gray(text),
      prompt: (text: string) => chalk.cyan(text),
      progress: (text: string) => chalk.blue(text),
    },
  },
  {
    name: 'monokai',
    description: 'Monokai theme with vibrant colors',
    colors: {
      primary: '#f92672',
      secondary: '#66d9ef',
      success: '#a6e22e',
      warning: '#e6db74',
      error: '#f92672',
      info: '#66d9ef',
      text: '#f8f8f2',
      background: '#272822',
      border: '#49483e',
      highlight: '#383830',
    },
    styles: {
      header: (text: string) => chalk.magenta.bold(text),
      title: (text: string) => chalk.cyan.bold(text),
      subtitle: (text: string) => chalk.green(text),
      success: (text: string) => chalk.green('✓ ' + text),
      warning: (text: string) => chalk.yellow('⚠ ' + text),
      error: (text: string) => chalk.red('✗ ' + text),
      info: (text: string) => chalk.cyan('ℹ ' + text),
      code: (text: string) => chalk.gray(text),
      prompt: (text: string) => chalk.magenta(text),
      progress: (text: string) => chalk.cyan(text),
    },
  },
  {
    name: 'solarized',
    description: 'Solarized theme with balanced colors',
    colors: {
      primary: '#268bd2',
      secondary: '#657b83',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#268bd2',
      text: '#657b83',
      background: '#fdf6e3',
      border: '#e6e0d4',
      highlight: '#eee8d5',
    },
    styles: {
      header: (text: string) => chalk.blue.bold(text),
      title: (text: string) => chalk.cyan.bold(text),
      subtitle: (text: string) => chalk.green(text),
      success: (text: string) => chalk.green('✓ ' + text),
      warning: (text: string) => chalk.yellow('⚠ ' + text),
      error: (text: string) => chalk.red('✗ ' + text),
      info: (text: string) => chalk.blue('ℹ ' + text),
      code: (text: string) => chalk.gray(text),
      prompt: (text: string) => chalk.blue(text),
      progress: (text: string) => chalk.cyan(text),
    },
  },
  {
    name: 'dracula',
    description: 'Dracula theme with dark purple colors',
    colors: {
      primary: '#bd93f9',
      secondary: '#6272a4',
      success: '#50fa7b',
      warning: '#f1fa8c',
      error: '#ff5555',
      info: '#8be9fd',
      text: '#f8f8f2',
      background: '#282a36',
      border: '#44475a',
      highlight: '#44475a',
    },
    styles: {
      header: (text: string) => chalk.magenta.bold(text),
      title: (text: string) => chalk.cyan.bold(text),
      subtitle: (text: string) => chalk.green(text),
      success: (text: string) => chalk.green('✓ ' + text),
      warning: (text: string) => chalk.yellow('⚠ ' + text),
      error: (text: string) => chalk.red('✗ ' + text),
      info: (text: string) => chalk.cyan('ℹ ' + text),
      code: (text: string) => chalk.gray(text),
      prompt: (text: string) => chalk.magenta(text),
      progress: (text: string) => chalk.cyan(text),
    },
  },
];

/**
 * 主题管理器
 */
export class ThemeManager {
  private currentTheme: Theme;
  private themes: Theme[];
  private configPath: string;

  constructor() {
    this.themes = builtinThemes;
    this.configPath = path.join(resolveDataDir(), 'theme.json');
    this.currentTheme = this.loadTheme();
  }

  /**
   * 加载主题配置
   */
  private loadTheme(): Theme {
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        const theme = this.themes.find((t) => t.name === config.theme);
        if (theme) {
          return theme;
        }
      }
    } catch (error) {
      // 忽略错误，使用默认主题
    }
    return this.themes[0]; // 默认使用第一个主题
  }

  /**
   * 保存主题配置
   */
  private saveTheme(themeName: string): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(
        this.configPath,
        JSON.stringify({ theme: themeName }, null, 2)
      );
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 获取当前主题
   */
  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * 设置主题
   */
  setTheme(themeName: string): boolean {
    const theme = this.themes.find((t) => t.name === themeName);
    if (theme) {
      this.currentTheme = theme;
      this.saveTheme(themeName);
      return true;
    }
    return false;
  }

  /**
   * 切换主题
   */
  toggleTheme(): void {
    const currentIndex = this.themes.findIndex(
      (t) => t.name === this.currentTheme.name
    );
    const nextIndex = (currentIndex + 1) % this.themes.length;
    this.currentTheme = this.themes[nextIndex];
    this.saveTheme(this.currentTheme.name);
  }

  /**
   * 获取所有主题
   */
  getThemes(): Theme[] {
    return this.themes;
  }

  /**
   * 显示所有主题
   */
  displayThemes(): void {
    const output: string[] = ['Available themes:'];
    this.themes.forEach((theme, index) => {
      const isCurrent = theme.name === this.currentTheme.name;
      output.push(
        `  ${isCurrent ? '✓' : ' '} ${index + 1}. ${theme.name} - ${theme.description}`
      );
    });
    logger.info(output.join('\n'));
  }

  /**
   * 显示当前主题
   */
  displayCurrentTheme(): void {
    logger.info(
      `Current theme: ${this.currentTheme.name}\nDescription: ${this.currentTheme.description}`
    );
  }

  /**
   * 应用主题样式
   */
  applyStyle(style: keyof Theme['styles'], text: string): string {
    return this.currentTheme.styles[style](text);
  }

  /**
   * 获取主题颜色
   */
  getColor(color: keyof Theme['colors']): string {
    return this.currentTheme.colors[color];
  }
}

/**
 * 全局主题管理器实例
 */
let themeManager: ThemeManager | null = null;

/**
 * 获取主题管理器
 */
export function getThemeManager(): ThemeManager {
  if (!themeManager) {
    themeManager = new ThemeManager();
  }
  return themeManager;
}

export default getThemeManager();
