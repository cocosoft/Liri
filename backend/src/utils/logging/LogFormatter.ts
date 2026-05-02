/**
 * 日志格式化器
 * 基于CC源码日志系统实现
 */

import type { LogEntry } from './LogFilter.js';
import { LogLevel } from './LogFilter.js';

export enum LogFormat {
  SIMPLE = 'simple',
  JSON = 'json',
  STRUCTURED = 'structured',
  PRETTY = 'pretty',
}

export interface FormatterOptions {
  format?: LogFormat;
  showTimestamp?: boolean;
  showLevel?: boolean;
  showSource?: boolean;
  showContext?: boolean;
  showError?: boolean;
  colorize?: boolean;
  timestampFormat?: 'iso' | 'local' | 'unix';
  truncate?: number;
}

const COLOR_CODES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m',
  [LogLevel.INFO]: '\x1b[32m',
  [LogLevel.WARN]: '\x1b[33m',
  [LogLevel.ERROR]: '\x1b[31m',
  [LogLevel.FATAL]: '\x1b[35m',
};

const COLOR_RESET = '\x1b[0m';

export class LogFormatter {
  private options: Required<FormatterOptions>;

  constructor(options: FormatterOptions = {}) {
    this.options = {
      format: options.format ?? LogFormat.SIMPLE,
      showTimestamp: options.showTimestamp ?? true,
      showLevel: options.showLevel ?? true,
      showSource: options.showSource ?? false,
      showContext: options.showContext ?? true,
      showError: options.showError ?? true,
      colorize: options.colorize ?? false,
      timestampFormat: options.timestampFormat ?? 'iso',
      truncate: options.truncate ?? 0,
    };
  }

  format(entry: LogEntry): string {
    switch (this.options.format) {
      case LogFormat.JSON:
        return this.formatJson(entry);
      case LogFormat.STRUCTURED:
        return this.formatStructured(entry);
      case LogFormat.PRETTY:
        return this.formatPretty(entry);
      case LogFormat.SIMPLE:
      default:
        return this.formatSimple(entry);
    }
  }

  formatBatch(entries: LogEntry[]): string {
    return entries.map(e => this.format(e)).join('\n');
  }

  private formatSimple(entry: LogEntry): string {
    const parts: string[] = [];

    if (this.options.showTimestamp) {
      parts.push(this.formatTimestamp(entry.timestamp));
    }

    if (this.options.showLevel) {
      parts.push(`[${entry.level.toUpperCase()}]`);
    }

    if (this.options.showSource && entry.source) {
      parts.push(`[${entry.source}]`);
    }

    parts.push(this.truncateMessage(entry.message));

    if (this.options.showContext && entry.context && Object.keys(entry.context).length > 0) {
      parts.push(JSON.stringify(entry.context));
    }

    if (this.options.showError && entry.error) {
      parts.push(`\n${entry.stack || entry.error.message}`);
    }

    return this.colorizeText(parts.join(' '), entry.level);
  }

  private formatJson(entry: LogEntry): string {
    const obj: Record<string, unknown> = {
      timestamp: this.formatTimestamp(entry.timestamp),
      level: entry.level,
      message: entry.message,
    };

    if (entry.source) {
      obj.source = entry.source;
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      obj.context = entry.context;
    }

    if (entry.error) {
      obj.error = {
        name: entry.error.name,
        message: entry.error.message,
        stack: entry.stack || entry.error.stack,
      };
    }

    return JSON.stringify(obj);
  }

  private formatStructured(entry: LogEntry): string {
    const parts: string[] = [];

    parts.push(this.formatTimestamp(entry.timestamp));
    parts.push(`"${entry.level.toUpperCase()}"`);

    if (entry.source) {
      parts.push(`"source":"${entry.source}"`);
    }

    parts.push(`"message":"${this.escapeString(entry.message)}"`);

    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(`"context":${JSON.stringify(entry.context)}`);
    }

    if (entry.error) {
      parts.push(`"error":"${this.escapeString(entry.stack || entry.error.message)}"`);
    }

    return `{${parts.join(' ')}}`;
  }

  private formatPretty(entry: LogEntry): string {
    const lines: string[] = [];

    lines.push(this.colorizeText(`${entry.level.toUpperCase()} - ${this.formatTimestamp(entry.timestamp)}`, entry.level));

    if (entry.source) {
      lines.push(`  Source: ${entry.source}`);
    }

    lines.push(`  Message: ${this.truncateMessage(entry.message)}`);

    if (this.options.showContext && entry.context && Object.keys(entry.context).length > 0) {
      lines.push(`  Context: ${JSON.stringify(entry.context, null, 2)}`);
    }

    if (this.options.showError && entry.error) {
      lines.push(`  Error: ${entry.stack || entry.error.message}`);
    }

    return lines.join('\n');
  }

  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);

    switch (this.options.timestampFormat) {
      case 'local':
        return date.toLocaleString();
      case 'unix':
        return String(date.getTime());
      case 'iso':
      default:
        return date.toISOString();
    }
  }

  private truncateMessage(message: string): string {
    if (this.options.truncate > 0 && message.length > this.options.truncate) {
      return message.slice(0, this.options.truncate) + '...';
    }
    return message;
  }

  private escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  }

  private colorizeText(text: string, level: LogLevel): string {
    if (!this.options.colorize) {
      return text;
    }
    return `${COLOR_CODES[level]}${text}${COLOR_RESET}`;
  }

  static colorize(text: string, level: LogLevel): string {
    return `${COLOR_CODES[level]}${text}${COLOR_RESET}`;
  }

  static levelColor(level: LogLevel): string {
    return COLOR_CODES[level];
  }

  static levelReset(): string {
    return COLOR_RESET;
  }
}
