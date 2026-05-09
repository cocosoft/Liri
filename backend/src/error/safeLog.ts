/**
 * 安全日志工具
 * 提供安全的错误记录功能，自动清理敏感信息
 */

import { logger } from '../utils/log';
import {
  AppError,
  TelemetrySafeError,
  ErrorCategory,
  ErrorSeverity,
} from './types';
import { ErrorUtils } from './utils';

/**
 * 安全日志类
 */
export class SafeLogger {
  /**
   * 安全地记录错误
   * @param error 错误对象
   * @param context 额外上下文
   */
  static logError(error: Error, context?: Record<string, unknown>): void {
    // 将错误转换为安全错误
    const safeError = this.toSafeError(error);

    // 提取错误信息
    const errorInfo = ErrorUtils.extractErrorInfo(safeError);

    // 记录错误
    logger.error(errorInfo.message, undefined, {
      category: errorInfo.category,
      severity: errorInfo.severity,
      code: errorInfo.code,
      context: errorInfo.context || context,
      stack: errorInfo.stack,
    });
  }

  /**
   * 安全地记录警告
   * @param message 警告信息
   * @param context 额外上下文
   */
  static logWarning(message: string, context?: Record<string, unknown>): void {
    const safeContext = context ? this.sanitizeContext(context) : undefined;
    logger.warn(message, safeContext);
  }

  /**
   * 安全地记录信息
   * @param message 信息
   * @param context 额外上下文
   */
  static logInfo(message: string, context?: Record<string, unknown>): void {
    const safeContext = context ? this.sanitizeContext(context) : undefined;
    logger.info(message, safeContext);
  }

  /**
   * 将错误转换为安全错误
   * @param error 错误对象
   * @returns 安全错误对象
   */
  static toSafeError(error: Error): Error {
    if (error instanceof TelemetrySafeError) {
      return error;
    }

    if (error instanceof AppError) {
      return new TelemetrySafeError(
        error.message,
        error.category,
        error.severity,
        undefined,
        error.code,
        error.context
      );
    }

    // 对于普通错误，创建一个安全错误
    const category = ErrorUtils.categorizeError(error);
    const severity = ErrorUtils.getErrorSeverity(error);

    return new TelemetrySafeError(
      error.message || 'Unknown error',
      category,
      severity,
      undefined,
      undefined,
      { originalError: error.name }
    );
  }

  /**
   * 清理上下文，移除敏感信息
   * @param context 上下文
   * @returns 清理后的上下文
   */
  private static sanitizeContext(
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const sensitiveKeys = [
      'password',
      'token',
      'apiKey',
      'secret',
      'credential',
      'auth',
      'key',
    ];
    const safeContext: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      if (
        sensitiveKeys.some((sensitiveKey) =>
          key.toLowerCase().includes(sensitiveKey.toLowerCase())
        )
      ) {
        safeContext[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        safeContext[key] = this.sanitizeContext(
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        safeContext[key] = value;
      }
    }

    return safeContext;
  }

  /**
   * 安全地记录详细错误信息
   * @param error 错误对象
   * @param operation 操作名称
   * @param context 额外上下文
   */
  static logDetailedError(
    error: Error,
    operation: string,
    context?: Record<string, unknown>
  ): void {
    const safeError = this.toSafeError(error);
    const errorInfo = ErrorUtils.extractErrorInfo(safeError);

    logger.error(`${operation} failed`, undefined, {
      operation,
      error: {
        message: errorInfo.message,
        category: errorInfo.category,
        severity: errorInfo.severity,
        code: errorInfo.code,
      },
      context: errorInfo.context || context,
      stack: errorInfo.stack,
    });
  }

  /**
   * 安全地记录错误摘要
   * @param error 错误对象
   * @param operation 操作名称
   */
  static logErrorSummary(error: Error, operation: string): void {
    const safeError = this.toSafeError(error);
    const errorInfo = ErrorUtils.extractErrorInfo(safeError);

    logger.warn(`${operation} encountered an error`, {
      operation,
      errorMessage: errorInfo.message,
      errorCategory: errorInfo.category,
      errorCode: errorInfo.code,
    });
  }

  /**
   * 获取安全的错误信息（不包含敏感信息）
   * @param error 错误对象
   * @returns 安全的错误信息
   */
  static getSafeErrorInfo(error: Error): {
    message: string;
    category: ErrorCategory;
    severity: ErrorSeverity;
    code?: string;
  } {
    const safeError = this.toSafeError(error);
    const errorInfo = ErrorUtils.extractErrorInfo(safeError);

    return {
      message: errorInfo.message,
      category: errorInfo.category,
      severity: errorInfo.severity,
      code: errorInfo.code,
    };
  }
}
