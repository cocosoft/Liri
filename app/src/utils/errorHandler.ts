/**
 * 错误处理工具
 *
 * 本文件提供轻量级错误处理辅助函数和 ErrorHandler 类。
 * 所有核心错误类型委托给 @modules/error/types 中的规范定义。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 错误类型（兼容原独立定义）
 * 用于 handle() 方法将系统错误码映射到规范 ErrorCategory
 */
export enum ErrorType {
  NETWORK = 'network',
  API = 'api',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  DATABASE = 'database',
  FILE_SYSTEM = 'file_system',
  UNKNOWN = 'unknown',
}

/**
 * 将 ErrorType 映射为规范 ErrorCategory
 */
function mapToCategory(type: ErrorType): ErrorCategory {
  switch (type) {
    case ErrorType.NETWORK:
      return ErrorCategory.NETWORK;
    case ErrorType.API:
      return ErrorCategory.API;
    case ErrorType.VALIDATION:
      return ErrorCategory.VALIDATION;
    case ErrorType.AUTHENTICATION:
    case ErrorType.AUTHORIZATION:
      return ErrorCategory.PERMISSION;
    case ErrorType.DATABASE:
      return ErrorCategory.DATABASE;
    case ErrorType.FILE_SYSTEM:
      return ErrorCategory.FILESYSTEM;
    default:
      return ErrorCategory.UNKNOWN;
  }
}

/**
 * 错误处理类
 */
export class ErrorHandler {
  /**
   * 处理错误
   * @param error 错误
   * @returns 规范 AppError 实例
   */
  static handle(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    const err = error as { code?: string; name?: string; message?: string };

    // 处理网络错误
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return new AppError(
        '网络连接失败，请检查网络设置',
        ErrorCategory.NETWORK,
        ErrorSeverity.MEDIUM,
        err.code
      );
    }

    // 处理验证错误
    if (err.name === 'ValidationError' || err.name === 'ZodError') {
      return new AppError(
        '数据验证失败',
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'VALIDATION_ERROR'
      );
    }

    // 处理认证错误
    if (
      err.code === 'UNAUTHENTICATED' ||
      (err.message && err.message.includes('authentication'))
    ) {
      return new AppError(
        '认证失败，请重新登录',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'AUTHENTICATION_ERROR'
      );
    }

    // 处理授权错误
    if (
      err.code === 'UNAUTHORIZED' ||
      (err.message && err.message.includes('authorization'))
    ) {
      return new AppError(
        '授权失败，权限不足',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH,
        'AUTHORIZATION_ERROR'
      );
    }

    // 处理数据库错误
    if (
      err.code &&
      typeof err.code === 'string' &&
      err.code.startsWith('SQL')
    ) {
      return new AppError(
        '数据库操作失败',
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH,
        err.code
      );
    }

    // 处理文件系统错误
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      return new AppError(
        '文件系统操作失败',
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.MEDIUM,
        err.code
      );
    }

    // 处理未知错误
    return new AppError(
      err.message || '未知错误',
      ErrorCategory.UNKNOWN,
      ErrorSeverity.MEDIUM,
      'UNKNOWN_ERROR'
    );
  }

  /**
   * 捕获并处理异步函数错误
   * @param fn 函数
   * @returns 处理后的函数
   */
  static catchAsync<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T
  ): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
    return async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
      try {
        return (await fn(...args)) as ReturnType<T>;
      } catch (error) {
        const handledError = ErrorHandler.handle(error);
        logger.error('Error:', { handledError });
        return null;
      }
    };
  }

  /**
   * 捕获并处理同步函数错误
   * @param fn 函数
   * @returns 处理后的函数
   */
  static catchSync<T extends (...args: unknown[]) => unknown>(
    fn: T
  ): (...args: Parameters<T>) => ReturnType<T> | null {
    return (...args: Parameters<T>): ReturnType<T> | null => {
      try {
        return fn(...args) as ReturnType<T>;
      } catch (error) {
        const handledError = ErrorHandler.handle(error);
        logger.error('Error:', { handledError });
        return null;
      }
    };
  }
}

/**
 * 处理错误
 * @param error 错误
 * @returns 规范 AppError 实例
 */
export function handleError(error: unknown): AppError {
  return ErrorHandler.handle(error);
}

/**
 * 捕获并处理异步函数错误
 * @param fn 函数
 * @returns 处理后的函数
 */
export function catchAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
  return ErrorHandler.catchAsync(fn) as (
    ...args: Parameters<T>
  ) => Promise<ReturnType<T> | null>;
}

/**
 * 捕获并处理同步函数错误
 * @param fn 函数
 * @returns 处理后的函数
 */
export function catchSync<T extends (...args: unknown[]) => unknown>(
  fn: T
): (...args: Parameters<T>) => ReturnType<T> | null {
  return ErrorHandler.catchSync(fn) as (
    ...args: Parameters<T>
  ) => ReturnType<T> | null;
}
