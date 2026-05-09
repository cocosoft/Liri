/**
 * 日志过滤器
 * 基于CC源码日志系统实现
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

export interface LogFilterOptions {
  minLevel?: LogLevel;
  maxLevel?: LogLevel;
  sources?: string[];
  patterns?: RegExp[];
  excludePatterns?: RegExp[];
  startTime?: Date;
  endTime?: Date;
}

export class LogFilter {
  private options: LogFilterOptions;

  constructor(options: LogFilterOptions = {}) {
    this.options = options;
  }

  setOptions(options: LogFilterOptions): void {
    this.options = options;
  }

  filter(logs: LogEntry[]): LogEntry[] {
    return logs.filter((log) => this.matches(log));
  }

  matches(log: LogEntry): boolean {
    if (this.options.minLevel && !this.meetsMinLevel(log.level)) {
      return false;
    }

    if (this.options.maxLevel && !this.meetsMaxLevel(log.level)) {
      return false;
    }

    if (this.options.sources && this.options.sources.length > 0) {
      if (!this.matchesSource(log.source)) {
        return false;
      }
    }

    if (this.options.patterns && this.options.patterns.length > 0) {
      if (!this.matchesPatterns(log.message)) {
        return false;
      }
    }

    if (
      this.options.excludePatterns &&
      this.options.excludePatterns.length > 0
    ) {
      if (this.matchesExcludePatterns(log.message)) {
        return false;
      }
    }

    if (
      this.options.startTime &&
      new Date(log.timestamp) < this.options.startTime
    ) {
      return false;
    }

    if (
      this.options.endTime &&
      new Date(log.timestamp) > this.options.endTime
    ) {
      return false;
    }

    return true;
  }

  private meetsMinLevel(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.options.minLevel!);
  }

  private meetsMaxLevel(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) <= levels.indexOf(this.options.maxLevel!);
  }

  private matchesSource(source?: string): boolean {
    if (!source) return false;
    return this.options.sources!.includes(source);
  }

  private matchesPatterns(message: string): boolean {
    return this.options.patterns!.some((pattern) => pattern.test(message));
  }

  private matchesExcludePatterns(message: string): boolean {
    return this.options.excludePatterns!.some((pattern) =>
      pattern.test(message)
    );
  }

  static levelToNumber(level: LogLevel): number {
    const levels: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
      [LogLevel.FATAL]: 4,
    };
    return levels[level];
  }

  static numberToLevel(num: number): LogLevel {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels[Math.min(Math.max(0, num), levels.length - 1)];
  }

  static compareLevels(a: LogLevel, b: LogLevel): number {
    return LogFilter.levelToNumber(a) - LogFilter.levelToNumber(b);
  }
}

export interface LogEntry {
  id?: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  context?: Record<string, unknown>;
  error?: Error;
  stack?: string;
}
