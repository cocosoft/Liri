/**
 * 彩色输出支持工具
 * 用于在命令行中显示彩色文本
 */

import { configManager } from '@modules/config';

export interface ColorOptions {
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  inverse?: boolean;
}

export class ColorFormatter {
  // 颜色代码
  private static readonly colors = {
    // 前景色
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',

    // 背景色
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',

    // 样式
    bold: '\x1b[1m',
    underline: '\x1b[4m',
    italic: '\x1b[3m',
    inverse: '\x1b[7m',

    // 重置
    reset: '\x1b[0m',
  };

  /**
   * 应用颜色和样式
   */
  static colorize(
    text: string,
    color: keyof typeof ColorFormatter.colors,
    options: ColorOptions = {}
  ): string {
    const colorCode = ColorFormatter.colors[color] || '';
    const styleCodes = [];

    if (options.bold) styleCodes.push(ColorFormatter.colors.bold);
    if (options.underline) styleCodes.push(ColorFormatter.colors.underline);
    if (options.italic) styleCodes.push(ColorFormatter.colors.italic);
    if (options.inverse) styleCodes.push(ColorFormatter.colors.inverse);

    return `${styleCodes.join('')}${colorCode}${text}${ColorFormatter.colors.reset}`;
  }

  /**
   * 格式化成功消息（绿色）
   */
  static success(text: string): string {
    return ColorFormatter.colorize(text, 'green', { bold: true });
  }

  /**
   * 格式化错误消息（红色）
   */
  static error(text: string): string {
    return ColorFormatter.colorize(text, 'red', { bold: true });
  }

  /**
   * 格式化警告消息（黄色）
   */
  static warning(text: string): string {
    return ColorFormatter.colorize(text, 'yellow', { bold: true });
  }

  /**
   * 格式化信息消息（蓝色）
   */
  static info(text: string): string {
    return ColorFormatter.colorize(text, 'blue', { bold: true });
  }

  /**
   * 格式化标题（青色）
   */
  static title(text: string): string {
    return ColorFormatter.colorize(text, 'cyan', {
      bold: true,
      underline: true,
    });
  }

  /**
   * 格式化强调文本（洋红色）
   */
  static highlight(text: string): string {
    return ColorFormatter.colorize(text, 'magenta', { bold: true });
  }

  /**
   * 检查终端是否支持颜色
   */
  static supportsColor(): boolean {
    return process.stdout.isTTY && !configManager.env('NO_COLOR');
  }

  /**
   * 安全地应用颜色（如果终端支持）
   */
  static safeColorize(
    text: string,
    color: keyof typeof ColorFormatter.colors,
    options: ColorOptions = {}
  ): string {
    if (ColorFormatter.supportsColor()) {
      return ColorFormatter.colorize(text, color, options);
    }
    return text;
  }
}
