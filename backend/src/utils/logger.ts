/**
 * 日志工具
 */

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * 日志配置
 */
export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

/**
 * 日志工具类
 */
export class Logger {
  private config: LoggerConfig;

  /**
   * 构造函数
   * @param config 日志配置
   */
  constructor(config: LoggerConfig = { level: LogLevel.INFO }) {
    this.config = {
      level: config.level,
      prefix: config.prefix,
      timestamp: config.timestamp ?? true,
    };
  }

  /**
   * 生成日志前缀
   */
  private getPrefix(): string {
    const parts: string[] = [];

    if (this.config.timestamp) {
      const now = new Date();
      const timestamp = now.toISOString();
      parts.push(`[${timestamp}]`);
    }

    if (this.config.prefix) {
      parts.push(`[${this.config.prefix}]`);
    }

    return parts.join(' ');
  }

  /**
   * 检查日志级别是否启用
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  /**
   * 调试日志
   */
  debug(...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.getPrefix(), '[DEBUG]', ...args);
    }
  }

  /**
   * 信息日志
   */
  info(...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.getPrefix(), '[INFO]', ...args);
    }
  }

  /**
   * 警告日志
   */
  warn(...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.getPrefix(), '[WARN]', ...args);
    }
  }

  /**
   * 错误日志
   */
  error(...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.getPrefix(), '[ERROR]', ...args);
    }
  }
}

/**
 * 创建日志实例
 * @param config 日志配置
 */
export function createLogger(
  config: LoggerConfig = { level: LogLevel.INFO }
): Logger {
  return new Logger(config);
}

// 导出默认日志实例
const logger = createLogger();
export default logger;

// 导出便捷函数
export const logDebug = logger.debug.bind(logger);
export const logInfo = logger.info.bind(logger);
export const logWarn = logger.warn.bind(logger);
export const logError = logger.error.bind(logger);
