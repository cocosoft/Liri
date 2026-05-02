/**
 * 结构化IO模块
 * 处理结构化数据的输入输出（JSON、YAML等）
 */

export type OutputFormat = 'json' | 'yaml' | 'text' | 'table';

/**
 * 结构化输出配置
 */
export interface StructuredOutputConfig {
  format: OutputFormat;
  indent?: number;
  colorize?: boolean;
}

/**
 * 结构化IO管理器
 */
export class StructuredIO {
  private config: StructuredOutputConfig;

  constructor(config?: Partial<StructuredOutputConfig>) {
    this.config = {
      format: config?.format || 'text',
      indent: config?.indent || 2,
      colorize: config?.colorize ?? true,
    };
  }

  /**
   * 设置输出格式
   */
  setFormat(format: OutputFormat): void {
    this.config.format = format;
  }

  /**
   * 设置缩进
   */
  setIndent(indent: number): void {
    this.config.indent = indent;
  }

  /**
   * 启用/禁用颜色
   */
  setColorize(colorize: boolean): void {
    this.config.colorize = colorize;
  }

  /**
   * 将数据格式化为字符串
   * @param data 数据对象
   * @param format 输出格式（可选，默认使用配置）
   */
  format(data: unknown, format?: OutputFormat): string {
    const outputFormat = format || this.config.format;

    switch (outputFormat) {
      case 'json':
        return this.formatJson(data);
      case 'yaml':
        return this.formatYaml(data);
      case 'table':
        return this.formatTable(data);
      case 'text':
      default:
        return this.formatText(data);
    }
  }

  /**
   * 输出数据到控制台
   * @param data 数据对象
   * @param format 输出格式
   */
  output(data: unknown, format?: OutputFormat): void {
    const formatted = this.format(data, format);
    console.log(formatted);
  }

  /**
   * 将数据格式化为JSON
   */
  private formatJson(data: unknown): string {
    const jsonString = JSON.stringify(data, null, this.config.indent);
    if (this.config.colorize) {
      return this.colorizeJson(jsonString);
    }
    return jsonString;
  }

  /**
   * 将数据格式化为YAML
   */
  private formatYaml(data: unknown): string {
    // 简单的YAML格式转换
    return this.convertToYaml(data, 0);
  }

  /**
   * 将数据格式化为表格
   */
  private formatTable(data: unknown): string {
    if (!Array.isArray(data)) {
      return this.formatText(data);
    }

    if (data.length === 0) {
      return 'Empty table';
    }

    const headers = Object.keys(data[0] as Record<string, unknown>);
    const rows = data.map((item) => headers.map((h) => String((item as Record<string, unknown>)[h] ?? '')));

    // 计算每列的最大宽度
    const columnWidths = headers.map((_, colIndex) => {
      const headerWidth = headers[colIndex].length;
      const maxCellWidth = Math.max(...rows.map((row) => row[colIndex].length));
      return Math.max(headerWidth, maxCellWidth);
    });

    const chalk = this.config.colorize ? require('chalk') : null;

    // 构建表格
    let result = '';

    // 表头
    result += headers
      .map((header, i) => this.padRight(header, columnWidths[i]))
      .join(' | ') + '\n';

    // 分隔线
    result += columnWidths.map((w) => '-'.repeat(w)).join('-+-') + '\n';

    // 数据行
    rows.forEach((row) => {
      result += row
        .map((cell, i) => {
          const padded = this.padRight(cell, columnWidths[i]);
          return chalk ? chalk.gray(padded) : padded;
        })
        .join(' | ') + '\n';
    });

    return result.trim();
  }

  /**
   * 将数据格式化为文本
   */
  private formatText(data: unknown): string {
    if (data === null) return 'null';
    if (data === undefined) return 'undefined';
    if (typeof data === 'string') return data;
    if (typeof data === 'number' || typeof data === 'boolean') return String(data);
    if (Array.isArray(data)) {
      return data.map((item) => this.formatText(item)).join('\n');
    }
    if (typeof data === 'object') {
      const chalk = this.config.colorize ? require('chalk') : null;
      let result = '';
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const keyPart = chalk ? chalk.bold(key) : key;
        result += `${keyPart}: ${this.formatText(value)}\n`;
      }
      return result.trim();
    }
    return String(data);
  }

  /**
   * 为JSON添加颜色
   */
  private colorizeJson(json: string): string {
    const chalk = require('chalk');
    return json.replace(
      /("(?:[^"\\]|\\.)*")(\s*:)?|(\d+\.?\d*)|(true|false|null)/g,
      (match, str, colon, num, bool) => {
        if (str) {
          if (colon) {
            return chalk.blue(str) + colon;
          }
          return chalk.green(str);
        }
        if (num) return chalk.yellow(num);
        if (bool) return chalk.cyan(match);
        return match;
      }
    );
  }

  /**
   * 转换为YAML格式
   */
  private convertToYaml(data: unknown, indent: number): string {
    const indentStr = '  '.repeat(indent);

    if (data === null) return 'null';
    if (data === undefined) return '';
    if (typeof data === 'string') return `"${data}"`;
    if (typeof data === 'number' || typeof data === 'boolean') return String(data);

    if (Array.isArray(data)) {
      return data
        .map((item) => `${indentStr}- ${this.convertToYaml(item, indent + 1)}`)
        .join('\n');
    }

    if (typeof data === 'object') {
      let result = '';
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const valueStr = this.convertToYaml(value, indent + 1);
        if (valueStr) {
          result += `${indentStr}${key}:\n${valueStr}\n`;
        }
      }
      return result.trim();
    }

    return String(data);
  }

  /**
   * 右填充字符串
   */
  private padRight(str: string, length: number): string {
    return str.padEnd(length);
  }
}

/**
 * 创建结构化IO实例
 */
export function createStructuredIO(config?: Partial<StructuredOutputConfig>): StructuredIO {
  return new StructuredIO(config);
}