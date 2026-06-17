import { appendFileSync } from 'node:fs';
import { logRedact } from './redact/LogRedact.js';
import { appendLogEntry } from './LogMemory.js';
import { LogLevel, type StructuredLogEntry, type LogSource } from './types.js';

export { LogLevel } from './types.js';
export type { StructuredLogEntry, LogSource } from './types.js';

const LOG_LEVEL_PRIORITY: Record<string, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.WARNING]: 2,
  [LogLevel.ERROR]: 3,
  [LogLevel.FATAL]: 4,
};

export interface LoggerConfig {
  level?: LogLevel;
  logFile?: string;
  consoleOutput?: boolean;
  fileOutput?: boolean;
  module?: string;
  format?: 'text' | 'json';
}

let defaultLogger: Logger | null = null;

/** 全局配置提供者（由 LogConfigManager 注册） */
type GlobalConfigProvider = () => Partial<LoggerConfig>;
let globalConfigProvider: GlobalConfigProvider | null = null;

/**
 * 设置全局配置提供者
 * 用于 LogConfigManager 等集中配置系统注册默认配置
 */
export function setGlobalConfigProvider(provider: GlobalConfigProvider): void {
  globalConfigProvider = provider;
}

export class Logger {
  private level: LogLevel;
  private module: string;
  private logFile: string | undefined;
  private consoleOutput: boolean;
  private fileOutput: boolean;
  private format: 'text' | 'json';

  constructor(config: LoggerConfig = {}) {
    // 合并全局配置提供者的默认值
    const globalDefaults = globalConfigProvider ? globalConfigProvider() : {};
    const merged: LoggerConfig = { ...globalDefaults, ...config };

    this.level = merged.level ?? LogLevel.INFO;
    this.module = merged.module ?? 'app';
    this.logFile = merged.logFile;
    this.consoleOutput = merged.consoleOutput !== false;
    this.fileOutput = merged.fileOutput ?? false;
    this.format = merged.format ?? 'text';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    meta?: unknown
  ): string {
    const timestamp = new Date().toISOString();

    if (this.format === 'json') {
      const entry: Record<string, unknown> = {
        timestamp,
        level,
        module: this.module,
        message,
      };
      if (meta !== undefined) {
        entry.meta = meta;
      }
      return JSON.stringify(entry);
    }

    const metaStr =
      meta !== undefined
        ? ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`
        : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.module}] ${message}${metaStr}`;
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, meta);
    const sanitized = logRedact.redact(formatted);

    // 将日志条目写入内存，供日志查询接口使用
    const logEntry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      data: meta !== undefined ? (typeof meta === 'object' ? meta as Record<string, unknown> : { meta }) : undefined,
      source: 'logger' as LogSource,
    };
    appendLogEntry(logEntry);

    if (this.consoleOutput) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(sanitized);
          break;
        case LogLevel.INFO:
          console.info(sanitized);
          break;
        case LogLevel.WARN:
        case LogLevel.WARNING:
          console.warn(sanitized);
          break;
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(sanitized);
          break;
      }
    }

    if (this.fileOutput && this.logFile) {
      try {
        appendFileSync(this.logFile, sanitized + '\n', 'utf-8');
      } catch {
        // 文件写入失败时静默处理
      }
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write(LogLevel.WARN, message, meta);
  }

  warning(message: string, meta?: unknown): void {
    this.write(LogLevel.WARNING, message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write(LogLevel.ERROR, message, meta);
  }

  fatal(message: string, meta?: unknown): void {
    this.write(LogLevel.FATAL, message, meta);
  }
}

export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger({ level: LogLevel.INFO, format: 'json' });
  }
  return defaultLogger;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  return new Logger({ format: 'json', ...config });
}
