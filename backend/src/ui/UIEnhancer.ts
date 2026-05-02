/**
 * 用户界面增强模块
 * 提供更好的用户交互体验
 */

import chalk from 'chalk';
import { getThemeManager } from '../core/theme';
import { createInterface, Interface } from 'readline';

/**
 * 进度条配置
 */
export interface ProgressBarConfig {
  total: number;
  width?: number;
  title?: string;
  suffix?: string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'cyan' | 'magenta';
}

/**
 * 提示配置
 */
export interface PromptConfig {
  message: string;
  default?: string;
  required?: boolean;
  validate?: (input: string) => boolean | string;
  options?: string[];
}

/**
 * 选择配置
 */
export interface SelectConfig {
  message: string;
  options: Array<{ value: string; label: string }>;
  default?: string;
}

/**
 * 用户界面增强器
 */
export class UIEnhancer {
  private themeManager = getThemeManager();
  private rl: Interface | null = null;

  /**
   * 显示进度条
   */
  showProgressBar(config: ProgressBarConfig): (current: number) => void {
    const { total, width = 40, title = '', suffix = '' } = config;
    const color = this.getColorFunction(config.color || 'blue');

    return (current: number) => {
      const percent = Math.min(Math.round((current / total) * 100), 100);
      const filledLength = Math.round((percent / 100) * width);
      const bar = '█'.repeat(filledLength) + ' '.repeat(width - filledLength);

      process.stdout.write(
        `\r${color(`[${bar}] ${percent}%`)} ${title} ${suffix}`
      );

      if (current >= total) {
        process.stdout.write('\n');
      }
    };
  }

  /**
   * 显示加载动画
   */
  showLoading(message: string): { stop: () => void } {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    let isRunning = true;

    const interval = setInterval(() => {
      if (!isRunning) return;
      process.stdout.write(`\r${chalk.blue(frames[frameIndex])} ${message}`);
      frameIndex = (frameIndex + 1) % frames.length;
    }, 100);

    return {
      stop: () => {
        isRunning = false;
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
      },
    };
  }

  /**
   * 显示成功消息
   */
  showSuccess(message: string): void {
    console.log(this.themeManager.applyStyle('success', message));
  }

  /**
   * 显示警告消息
   */
  showWarning(message: string): void {
    console.log(this.themeManager.applyStyle('warning', message));
  }

  /**
   * 显示错误消息
   */
  showError(message: string): void {
    console.log(this.themeManager.applyStyle('error', message));
  }

  /**
   * 显示信息消息
   */
  showInfo(message: string): void {
    console.log(this.themeManager.applyStyle('info', message));
  }

  /**
   * 显示标题
   */
  showTitle(title: string): void {
    console.log('');
    console.log(this.themeManager.applyStyle('header', '═'.repeat(60)));
    console.log(this.themeManager.applyStyle('title', `  ${title}`));
    console.log(this.themeManager.applyStyle('header', '═'.repeat(60)));
    console.log('');
  }

  /**
   * 显示副标题
   */
  showSubtitle(subtitle: string): void {
    console.log(this.themeManager.applyStyle('subtitle', subtitle));
    console.log('');
  }

  /**
   * 显示分隔线
   */
  showSeparator(): void {
    console.log(this.themeManager.applyStyle('header', '─'.repeat(60)));
  }

  /**
   * 显示代码块
   */
  showCode(code: string): void {
    console.log(this.themeManager.applyStyle('code', code));
  }

  /**
   * 提示用户输入
   */
  async prompt(config: PromptConfig): Promise<string> {
    const {
      message,
      default: defaultValue,
      required = false,
      validate,
      options,
    } = config;

    if (!this.rl) {
      this.rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    return new Promise((resolve) => {
      const ask = () => {
        let promptMessage = this.themeManager.applyStyle('prompt', message);
        if (defaultValue !== undefined) {
          promptMessage += ` (${defaultValue})`;
        }
        if (options && options.length > 0) {
          console.log('Options:', options.join(', '));
        }
        promptMessage += ': ';

        this.rl?.question(promptMessage, (input) => {
          const value = input.trim() || defaultValue || '';

          if (required && !value) {
            this.showWarning('This field is required');
            ask();
            return;
          }

          if (validate) {
            const validation = validate(value);
            if (validation !== true) {
              this.showError(validation as string);
              ask();
              return;
            }
          }

          resolve(value);
        });
      };

      ask();
    });
  }

  /**
   * 让用户选择选项
   */
  async select(config: SelectConfig): Promise<string> {
    const { message, options, default: defaultValue } = config;

    if (!this.rl) {
      this.rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    return new Promise((resolve) => {
      console.log(message);
      options.forEach((option, index) => {
        const isDefault = option.value === defaultValue;
        console.log(`  ${isDefault ? '>' : ' '} ${index + 1}. ${option.label}`);
      });

      const ask = () => {
        const promptMessage = this.themeManager.applyStyle(
          'prompt',
          'Enter your choice: '
        );

        this.rl?.question(promptMessage, (input) => {
          const trimmedInput = input.trim();

          if (!trimmedInput && defaultValue) {
            resolve(defaultValue);
            return;
          }

          const index = parseInt(trimmedInput, 10) - 1;
          if (index >= 0 && index < options.length) {
            resolve(options[index].value);
          } else {
            this.showError('Invalid choice. Please try again.');
            ask();
          }
        });
      };

      ask();
    });
  }

  /**
   * 显示菜单
   */
  async showMenu(
    title: string,
    options: Array<{ value: string; label: string }>
  ): Promise<string> {
    this.showTitle(title);
    return this.select({ message: 'Please select an option:', options });
  }

  /**
   * 显示确认对话框
   */
  async confirm(
    message: string,
    defaultYes: boolean = false
  ): Promise<boolean> {
    if (!this.rl) {
      this.rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    return new Promise((resolve) => {
      const promptMessage = this.themeManager.applyStyle(
        'prompt',
        `${message} (${defaultYes ? 'Y/n' : 'y/N'}): `
      );

      this.rl?.question(promptMessage, (input) => {
        const trimmedInput = input.trim().toLowerCase();
        if (!trimmedInput) {
          resolve(defaultYes);
        } else {
          resolve(['y', 'yes'].includes(trimmedInput));
        }
      });
    });
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * 获取颜色函数
   */
  private getColorFunction(color: string): (text: string) => string {
    const colorMap: Record<string, (text: string) => string> = {
      blue: chalk.blue,
      green: chalk.green,
      yellow: chalk.yellow,
      red: chalk.red,
      cyan: chalk.cyan,
      magenta: chalk.magenta,
    };
    return colorMap[color] || chalk.blue;
  }
}

/**
 * 全局UI增强器实例
 */
let uiEnhancer: UIEnhancer | null = null;

/**
 * 获取UI增强器
 */
export function getUIEnhancer(): UIEnhancer {
  if (!uiEnhancer) {
    uiEnhancer = new UIEnhancer();
  }
  return uiEnhancer;
}

export default getUIEnhancer();
