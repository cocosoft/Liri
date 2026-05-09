/**
 * 错误处理工具
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 错误类型
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
 * 应用错误接口
 */
export interface AppError {
  type: ErrorType;
  message: string;
  code?: string;
  stack?: string;
  details?: any;
}

/**
 * 应用错误类
 */
export class AppError extends Error implements AppError {
  type: ErrorType;
  code?: string;
  details?: any;

  /**
   * 构造函数
   * @param type 错误类型
   * @param message 错误消息
   * @param code 错误代码
   * @param details 错误详情
   */
  constructor(type: ErrorType, message: string, code?: string, details?: any) {
    super(message);
    this.type = type;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

/**
 * 错误处理类
 */
export class ErrorHandler {
  /**
   * 处理错误
   * @param error 错误
   * @returns 处理后的错误
   */
  static handle(error: any): AppError {
    if (error instanceof AppError) {
      return error;
    }

    // 处理网络错误
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return new AppError(
        ErrorType.NETWORK,
        '网络连接失败，请检查网络设置',
        error.code,
        error
      );
    }

    // 处理验证错误
    if (error.name === 'ValidationError' || error.name === 'ZodError') {
      return new AppError(
        ErrorType.VALIDATION,
        '数据验证失败',
        'VALIDATION_ERROR',
        error
      );
    }

    // 处理认证错误
    if (
      error.code === 'UNAUTHENTICATED' ||
      error.message.includes('authentication')
    ) {
      return new AppError(
        ErrorType.AUTHENTICATION,
        '认证失败，请重新登录',
        'AUTHENTICATION_ERROR',
        error
      );
    }

    // 处理授权错误
    if (
      error.code === 'UNAUTHORIZED' ||
      error.message.includes('authorization')
    ) {
      return new AppError(
        ErrorType.AUTHORIZATION,
        '授权失败，权限不足',
        'AUTHORIZATION_ERROR',
        error
      );
    }

    // 处理数据库错误
    if (error.code && error.code.startsWith('SQL')) {
      return new AppError(
        ErrorType.DATABASE,
        '数据库操作失败',
        error.code,
        error
      );
    }

    // 处理文件系统错误
    if (error.code === 'ENOENT' || error.code === 'EACCES') {
      return new AppError(
        ErrorType.FILE_SYSTEM,
        '文件系统操作失败',
        error.code,
        error
      );
    }

    // 处理未知错误
    return new AppError(
      ErrorType.UNKNOWN,
      error.message || '未知错误',
      'UNKNOWN_ERROR',
      error
    );
  }

  /**
   * 捕获并处理错误
   * @param fn 函数
   * @returns 处理后的函数
   */
  static catchAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T
  ): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
    return async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
      try {
        return await fn(...args);
      } catch (error) {
        const handledError = ErrorHandler.handle(error);
        logger.error('Error:', { handledError });
        return null;
      }
    };
  }

  /**
   * 捕获并处理错误（同步）
   * @param fn 函数
   * @returns 处理后的函数
   */
  static catchSync<T extends (...args: any[]) => any>(
    fn: T
  ): (...args: Parameters<T>) => ReturnType<T> | null {
    return (...args: Parameters<T>): ReturnType<T> | null => {
      try {
        return fn(...args);
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
 * @returns 处理后的错误
 */
export function handleError(error: any): AppError {
  return ErrorHandler.handle(error);
}

/**
 * 捕获并处理错误
 * @param fn 函数
 * @returns 处理后的函数
 */
export function catchAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
  return ErrorHandler.catchAsync(fn);
}

/**
 * 捕获并处理错误（同步）
 * @param fn 函数
 * @returns 处理后的函数
 */
export function catchSync<T extends (...args: any[]) => any>(
  fn: T
): (...args: Parameters<T>) => ReturnType<T> | null {
  return ErrorHandler.catchSync(fn);
}
