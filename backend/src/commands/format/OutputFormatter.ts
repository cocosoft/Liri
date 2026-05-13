/**
 * 统一输出格式化工具
 * 用于美化命令的输出格式
 */

export interface FormatOptions {
  indent?: number;
  align?: 'left' | 'right' | 'center';
  width?: number;
  color?: string;
}

export class OutputFormatter {
  /**
   * 格式化文本
   */
  static format(text: string, options: FormatOptions = {}): string {
    let result = text;

    // 处理缩进
    if (options.indent) {
      const indentStr = ' '.repeat(options.indent);
      result = result
        .split('\n')
        .map((line) => indentStr + line)
        .join('\n');
    }

    // 处理对齐
    if (options.align && options.width) {
      result = result
        .split('\n')
        .map((line) => {
          const width = options.width!;
          switch (options.align) {
            case 'left':
              return line.padEnd(width);
            case 'right':
              return line.padStart(width);
            case 'center':
              const padding = Math.floor((width - line.length) / 2);
              return (
                ' '.repeat(padding) +
                line +
                ' '.repeat(width - line.length - padding)
              );
            default:
              return line;
          }
        })
        .join('\n');
    }

    return result;
  }

  /**
   * 格式化标题
   */
  static formatTitle(title: string): string {
    const border = '='.repeat(title.length);
    return `${border}\n${title}\n${border}`;
  }

  /**
   * 格式化列表
   */
  static formatList(items: string[], options: FormatOptions = {}): string {
    const indent = options.indent || 2;
    return items.map((item) => ' '.repeat(indent) + `- ${item}`).join('\n');
  }

  /**
   * 格式化键值对
   */
  static formatKeyValuePairs(
    pairs: Record<string, unknown>,
    options: FormatOptions = {}
  ): string {
    const indent = options.indent || 2;
    const maxKeyLength = Math.max(
      ...Object.keys(pairs).map((key) => key.length)
    );

    return Object.entries(pairs)
      .map(([key, value]) => {
        const keyStr = key.padEnd(maxKeyLength);
        const valueStr =
          typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
        return ' '.repeat(indent) + `${keyStr}: ${valueStr}`;
      })
      .join('\n');
  }

  /**
   * 格式化成功消息
   */
  static formatSuccess(message: string): string {
    return `✅ ${message}`;
  }

  /**
   * 格式化错误消息
   */
  static formatError(message: string): string {
    return `❌ ${message}`;
  }

  /**
   * 格式化警告消息
   */
  static formatWarning(message: string): string {
    return `⚠️  ${message}`;
  }

  /**
   * 格式化信息消息
   */
  static formatInfo(message: string): string {
    return `ℹ️  ${message}`;
  }
}
