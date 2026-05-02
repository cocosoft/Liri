/**
 * 监控和日志工具
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * 日志配置
 */
export interface LogConfig {
  level: LogLevel;
  logPath: string;
  console: boolean;
  file: boolean;
}

/**
 * 监控数据
 */
export interface MonitoringData {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * 日志类
 */
export class Logger {
  private config: LogConfig;

  /**
   * 构造函数
   * @param config 日志配置
   */
  constructor(config: Partial<LogConfig> = {}) {
    this.config = {
      level: config.level || LogLevel.INFO,
      logPath: config.logPath || join(process.cwd(), 'logs'),
      console: config.console ?? true,
      file: config.file ?? true,
    };

    // 确保日志目录存在
    if (this.config.file && !existsSync(this.config.logPath)) {
      mkdirSync(this.config.logPath, { recursive: true });
    }
  }

  /**
   * 生成日志消息
   * @param level 日志级别
   * @param message 日志消息
   * @param data 附加数据
   * @returns 日志消息字符串
   */
  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }

  /**
   * 检查日志级别
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
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  /**
   * 记录日志
   * @param level 日志级别
   * @param message 日志消息
   * @param data 附加数据
   */
  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logMessage = this.formatMessage(level, message, data);

    // 输出到控制台
    if (this.config.console) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(logMessage);
          break;
        case LogLevel.INFO:
          console.info(logMessage);
          break;
        case LogLevel.WARN:
          console.warn(logMessage);
          break;
        case LogLevel.ERROR:
          console.error(logMessage);
          break;
        case LogLevel.FATAL:
          console.error(logMessage);
          break;
      }
    }

    // 输出到文件
    if (this.config.file) {
      const logFile = join(
        this.config.logPath,
        `${new Date().toISOString().split('T')[0]}.log`
      );
      appendFileSync(logFile, logMessage + '\n', 'utf-8');
    }
  }

  /**
   * 调试日志
   * @param message 日志消息
   * @param data 附加数据
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * 信息日志
   * @param message 日志消息
   * @param data 附加数据
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * 警告日志
   * @param message 日志消息
   * @param data 附加数据
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * 错误日志
   * @param message 日志消息
   * @param data 附加数据
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * 致命错误日志
   * @param message 日志消息
   * @param data 附加数据
   */
  fatal(message: string, data?: any): void {
    this.log(LogLevel.FATAL, message, data);
  }
}

/**
 * 监控器类
 */
export class Monitor {
  private logger: Logger;
  private metrics: Map<string, number>;

  /**
   * 构造函数
   */
  constructor() {
    this.logger = new Logger();
    this.metrics = new Map();
  }

  /**
   * 记录指标
   * @param name 指标名称
   * @param value 指标值
   * @param tags 标签
   */
  recordMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    this.metrics.set(name, value);
    this.logger.debug(`Metric recorded: ${name} = ${value}`, tags);
  }

  /**
   * 获取指标
   * @param name 指标名称
   * @returns 指标值
   */
  getMetric(name: string): number | undefined {
    return this.metrics.get(name);
  }

  /**
   * 记录执行时间
   * @param name 操作名称
   * @param fn 函数
   * @returns 函数返回值
   */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      this.recordMetric(`${name}_errors`, 1);
      throw error;
    }
  }

  /**
   * 记录执行时间（同步）
   * @param name 操作名称
   * @param fn 函数
   * @returns 函数返回值
   */
  timeSync<T>(name: string, fn: () => T): T {
    const start = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.recordMetric(`${name}_duration`, duration);
      this.recordMetric(`${name}_errors`, 1);
      throw error;
    }
  }

  /**
   * 健康检查
   * @returns 健康状态
   */
  healthCheck(): {
    status: string;
    timestamp: number;
    metrics: Record<string, number>;
  } {
    return {
      status: 'healthy',
      timestamp: Date.now(),
      metrics: Object.fromEntries(this.metrics),
    };
  }
}

/**
 * 日志实例
 */
export const logger = new Logger();

/**
 * 监控器实例
 */
export const monitor = new Monitor();

/**
 * 获取日志实例
 * @returns 日志实例
 */
export function getLogger(): Logger {
  return logger;
}

/**
 * 获取监控器实例
 * @returns 监控器实例
 */
export function getMonitor(): Monitor {
  return monitor;
}

/**
 * 记录执行时间
 * @param name 操作名称
 * @param fn 函数
 * @returns 函数返回值
 */
export async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return await monitor.time(name, fn);
}

/**
 * 记录执行时间（同步）
 * @param name 操作名称
 * @param fn 函数
 * @returns 函数返回值
 */
export function timeSync<T>(name: string, fn: () => T): T {
  return monitor.timeSync(name, fn);
}
