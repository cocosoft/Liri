import { appendFileSync } from 'node:fs';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  WARNING = 'warning',
  ERROR = 'error',
  FATAL = 'fatal',
}

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
}

let defaultLogger: Logger | null = null;

export class Logger {
  private level: LogLevel;
  private module: string;
  private logFile: string | undefined;
  private consoleOutput: boolean;
  private fileOutput: boolean;

  constructor(config: LoggerConfig = {}) {
    this.level = config.level ?? LogLevel.INFO;
    this.module = config.module ?? 'app';
    this.logFile = config.logFile;
    this.consoleOutput = config.consoleOutput !== false;
    this.fileOutput = config.fileOutput ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta !== undefined
      ? ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`
      : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.module}] ${message}${metaStr}`;
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, meta);

    if (this.consoleOutput) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formatted);
          break;
        case LogLevel.INFO:
          console.info(formatted);
          break;
        case LogLevel.WARN:
        case LogLevel.WARNING:
          console.warn(formatted);
          break;
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(formatted);
          break;
      }
    }

    if (this.fileOutput && this.logFile) {
      try {
        appendFileSync(this.logFile, formatted + '\n', 'utf-8');
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
    defaultLogger = new Logger({ level: LogLevel.INFO });
  }
  return defaultLogger;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  return new Logger(config);
}
