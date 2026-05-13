/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: Error;
}

/**
 * 日志记录器类
 */
export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private logFile?: string;

  /**
   * 私有构造函数
   */
  private constructor() {}

  /**
   * 获取日志记录器实例
   * @returns 日志记录器实例
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * 设置日志级别
   * @param level 日志级别
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * 设置日志文件
   * @param file 日志文件路径
   */
  setLogFile(file: string): void {
    this.logFile = file;
  }

  /**
   * 调试级别日志
   * @param message 日志消息
   * @param context 日志上下文
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * 信息级别日志
   * @param message 日志消息
   * @param context 日志上下文
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * 警告级别日志
   * @param message 日志消息
   * @param context 日志上下文
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * 错误级别日志
   * @param message 日志消息
   * @param error 错误对象
   * @param context 日志上下文
   */
  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * 致命级别日志
   * @param message 日志消息
   * @param error 错误对象
   * @param context 日志上下文
   */
  fatal(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    this.log(LogLevel.FATAL, message, context, error);
  }

  /**
   * 记录日志
   * @param level 日志级别
   * @param message 日志消息
   * @param context 日志上下文
   * @param error 错误对象
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
    };

    // 输出到控制台
    this.logToConsole(entry);

    // 输出到文件
    this.logToFile(entry);
  }

  /**
   * 检查是否应该记录该级别的日志
   * @param level 日志级别
   * @returns 是否应该记录
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  /**
   * 输出日志到控制台
   * @param entry 日志条目
   */
  private logToConsole(entry: LogEntry): void {
    const { level, message, context, error } = entry;
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const errorStr = error ? ` ${error.stack}` : '';

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`[DEBUG] ${message}${contextStr}${errorStr}`);
        break;
      case LogLevel.INFO:
        console.info(`[INFO] ${message}${contextStr}`);
        break;
      case LogLevel.WARN:
        console.warn(`[WARN] ${message}${contextStr}`);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(
          `[${level.toUpperCase()}] ${message}${contextStr}${errorStr}`
        );
        break;
    }
  }

  /**
   * 输出日志到文件
   * @param entry 日志条目
   */
  private logToFile(entry: LogEntry): void {
    if (!this.logFile) {
      return;
    }

    try {
      const fs = require('fs');
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logFile, line);
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }
}

// 导出全局日志记录器实例
export const logger = Logger.getInstance();
