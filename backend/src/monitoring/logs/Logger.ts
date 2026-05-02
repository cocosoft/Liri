/**
 * 日志系统
 * 实现日志分级、文件和控制台输出
 */

import { join } from 'path';
import { existsSync, mkdirSync, appendFileSync } from 'fs';

/**
 * 日志级别
 */
export enum LogLevel {
  /**
   * 调试
   */
  DEBUG = 'debug',
  /**
   * 信息
   */
  INFO = 'info',
  /**
   * 警告
   */
  WARNING = 'warning',
  /**
   * 错误
   */
  ERROR = 'error',
  /**
   * 致命
   */
  FATAL = 'fatal',
}

/**
 * 日志配置
 */
export interface LoggerConfig {
  /**
   * 日志级别
   */
  level?: LogLevel;
  /**
   * 日志文件路径
   */
  logFile?: string;
  /**
   * 是否输出到控制台
   */
  consoleOutput?: boolean;
  /**
   * 是否输出到文件
   */
  fileOutput?: boolean;
}

/**
 * 日志记录器类
 */
export class Logger {
  /**
   * 日志配置
   */
  private config: Required<LoggerConfig>;

  /**
   * 构造函数
   * @param config 日志配置
   */
  constructor(config: LoggerConfig = {}) {
    this.config = {
      level: config.level || LogLevel.INFO,
      logFile: config.logFile || join(process.cwd(), 'logs', 'app.log'),
      consoleOutput: config.consoleOutput ?? true,
      fileOutput: config.fileOutput ?? true,
    };

    // 确保日志目录存在
    if (this.config.fileOutput) {
      const logDir = this.config.logFile.substring(
        0,
        Math.max(
          this.config.logFile.lastIndexOf('/'),
          this.config.logFile.lastIndexOf('\\')
        )
      );
      if (logDir && !existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
    }
  }

  /**
   * 检查日志级别是否启用
   * @param level 日志级别
   * @returns 是否启用
   */
  private isLevelEnabled(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARNING,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  /**
   * 生成日志消息
   * @param level 日志级别
   * @param message 日志消息
   * @param meta 元数据
   * @returns 日志消息
   */
  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(7);
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${levelStr}] ${message}${metaStr}`;
  }

  /**
   * 输出日志
   * @param level 日志级别
   * @param message 日志消息
   * @param meta 元数据
   */
  private log(level: LogLevel, message: string, meta?: any): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, meta);

    // 输出到控制台
    if (this.config.consoleOutput) {
      this.consoleLog(level, formattedMessage);
    }

    // 输出到文件
    if (this.config.fileOutput) {
      this.fileLog(formattedMessage);
    }
  }

  /**
   * 输出到控制台
   * @param level 日志级别
   * @param message 日志消息
   */
  private consoleLog(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.log(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARNING:
        console.warn(message);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(message);
        break;
    }
  }

  /**
   * 输出到文件
   * @param message 日志消息
   */
  private fileLog(message: string): void {
    try {
      appendFileSync(this.config.logFile, message + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * 调试日志
   * @param message 日志消息
   * @param meta 元数据
   */
  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * 信息日志
   * @param message 日志消息
   * @param meta 元数据
   */
  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * 警告日志
   * @param message 日志消息
   * @param meta 元数据
   */
  warning(message: string, meta?: any): void {
    this.log(LogLevel.WARNING, message, meta);
  }

  /**
   * 错误日志
   * @param message 日志消息
   * @param meta 元数据
   */
  error(message: string, meta?: any): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * 致命日志
   * @param message 日志消息
   * @param meta 元数据
   */
  fatal(message: string, meta?: any): void {
    this.log(LogLevel.FATAL, message, meta);
  }

  /**
   * 设置日志级别
   * @param level 日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * 获取日志级别
   * @returns 日志级别
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * 启用控制台输出
   */
  enableConsoleOutput(): void {
    this.config.consoleOutput = true;
  }

  /**
   * 禁用控制台输出
   */
  disableConsoleOutput(): void {
    this.config.consoleOutput = false;
  }

  /**
   * 启用文件输出
   */
  enableFileOutput(): void {
    this.config.fileOutput = true;
  }

  /**
   * 禁用文件输出
   */
  disableFileOutput(): void {
    this.config.fileOutput = false;
  }

  /**
   * 设置日志文件路径
   * @param logFile 日志文件路径
   */
  setLogFile(logFile: string): void {
    this.config.logFile = logFile;

    // 确保日志目录存在
    const logDir = logFile.substring(0, logFile.lastIndexOf('/'));
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }
}

/**
 * 日志记录器实例
 */
let logger: Logger | undefined;

/**
 * 获取日志记录器实例
 * @returns 日志记录器实例
 */
export function getLogger(): Logger {
  if (!logger) {
    logger = new Logger();
  }
  return logger;
}

/**
 * 创建日志记录器实例
 * @param config 日志配置
 * @returns 日志记录器实例
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  return new Logger(config);
}
