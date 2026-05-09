/**
 * 错误处理器
 * 提供统一的错误处理和记录功能
 */

import { logger, LogLevel } from '../utils/log';
import { AppError, ErrorSeverity, TelemetrySafeError } from './types';
import { ErrorUtils } from './utils';
import { ErrorFormatter } from './formatter';
import { SafeLogger } from './safeLog';
import { errorMonitor } from './monitor/ErrorMonitor';

/**
 * 错误处理器类
 */
export class ErrorHandler {
  /**
   * 处理错误
   * @param error 错误对象
   * @param context 额外上下文
   */
  static handle(error: Error, context?: Record<string, any>): void {
    if (error instanceof AppError) {
      this.handleAppError(error, context);
    } else {
      this.handleUnknownError(error, context);
    }
  }

  /**
   * 处理应用错误
   * @param error 应用错误
   * @param context 额外上下文
   */
  private static handleAppError(
    error: AppError,
    context?: Record<string, any>
  ): void {
    // 记录错误到监控器
    errorMonitor.recordError(error);

    // 根据错误严重程度选择日志级别
    const logLevel = this.getLogLevelFromSeverity(error.severity);

    // 使用错误格式化器格式化错误消息
    const formattedMessage = ErrorFormatter.format(error);

    // 记录错误
    this.logError(logLevel, formattedMessage, error, {
      code: error.code,
      severity: error.severity,
      context: { ...error.context, ...context },
    });

    if (error.severity === ErrorSeverity.CRITICAL) {
      // 严重错误，可能需要退出
      logger.fatal('Critical error occurred, exiting process', error);
      process.exit(1);
    }
  }

  /**
   * 处理未知错误
   * @param error 未知错误
   * @param context 额外上下文
   */
  private static handleUnknownError(
    error: Error,
    context?: Record<string, any>
  ): void {
    // 将未知错误转换为AppError
    const appError = ErrorUtils.toAppError(error);

    // 记录到监控器
    errorMonitor.recordError(appError);

    // 格式化并记录
    const formattedMessage = ErrorFormatter.format(error);
    logger.error(formattedMessage, error, {
      stack: error.stack,
      context,
    });
  }

  /**
   * 根据错误严重程度获取日志级别
   * @param severity 错误严重程度
   * @returns 日志级别
   */
  private static getLogLevelFromSeverity(severity: ErrorSeverity): LogLevel {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return LogLevel.FATAL;
      case ErrorSeverity.HIGH:
        return LogLevel.ERROR;
      case ErrorSeverity.MEDIUM:
        return LogLevel.WARN;
      case ErrorSeverity.LOW:
        return LogLevel.INFO;
      default:
        return LogLevel.ERROR;
    }
  }

  /**
   * 记录错误
   * @param level 日志级别
   * @param message 错误信息
   * @param error 错误对象
   * @param context 上下文
   */
  private static logError(
    level: LogLevel,
    message: string,
    error: Error,
    context?: Record<string, any>
  ): void {
    switch (level) {
      case LogLevel.FATAL:
        logger.fatal(message, error, context);
        break;
      case LogLevel.ERROR:
        logger.error(message, error, context);
        break;
      case LogLevel.WARN:
        logger.warn(message, context);
        break;
      case LogLevel.INFO:
        logger.info(message, context);
        break;
      case LogLevel.DEBUG:
        logger.debug(message, context);
        break;
    }
  }

  /**
   * 安全地处理错误（不记录敏感信息）
   * @param error 错误对象
   * @param context 额外上下文
   */
  static handleSafely(error: Error, context?: Record<string, any>): void {
    SafeLogger.logError(error, context);

    // 同时记录到监控器
    const appError =
      error instanceof AppError ? error : ErrorUtils.toAppError(error);
    errorMonitor.recordError(appError);
  }

  /**
   * 处理并返回用户友好的错误信息
   * @param error 错误对象
   * @returns 用户友好的错误信息
   */
  static getUserFriendlyMessage(error: Error): string {
    return ErrorFormatter.formatUserFriendly(error);
  }

  /**
   * 生成详细的错误报告
   * @param error 错误对象
   * @returns 详细的错误报告
   */
  static generateErrorReport(error: Error): string {
    return ErrorFormatter.formatDetailedReport(error);
  }

  /**
   * 处理错误并返回JSON格式
   * @param error 错误对象
   * @returns JSON格式的错误信息
   */
  static handleToJSON(error: Error): object {
    return ErrorFormatter.formatJSON(error);
  }

  /**
   * 处理多个错误
   * @param errors 错误数组
   * @param context 额外上下文
   */
  static handleMultiple(errors: Error[], context?: Record<string, any>): void {
    for (const error of errors) {
      this.handle(error, context);
    }
  }

  /**
   * 处理错误并执行回调
   * @param error 错误对象
   * @param callback 回调函数
   * @param context 额外上下文
   */
  static handleWithCallback(
    error: Error,
    callback: (error: Error, userFriendlyMessage: string) => void,
    context?: Record<string, any>
  ): void {
    this.handle(error, context);
    const userFriendlyMessage = this.getUserFriendlyMessage(error);
    callback(error, userFriendlyMessage);
  }

  /**
   * 包装异步函数，自动处理错误
   * @param fn 异步函数
   * @param errorHandler 错误处理器
   * @returns 包装后的函数
   */
  static wrapAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    errorHandler?: (error: Error) => void
  ): T {
    return (async (...args: any[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (errorHandler) {
          errorHandler(err);
        } else {
          this.handle(err);
        }
        throw err;
      }
    }) as T;
  }

  /**
   * 包装同步函数，自动处理错误
   * @param fn 同步函数
   * @param errorHandler 错误处理器
   * @returns 包装后的函数
   */
  static wrapSync<T extends (...args: any[]) => any>(
    fn: T,
    errorHandler?: (error: Error) => void
  ): T {
    return ((...args: any[]) => {
      try {
        return fn(...args);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (errorHandler) {
          errorHandler(err);
        } else {
          this.handle(err);
        }
        throw err;
      }
    }) as T;
  }
}
