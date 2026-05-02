/**
 * 错误服务
 * 负责统一错误处理和管理
 */

import {
  AppError,
  ErrorType,
  ErrorLevel,
  ErrorHandlerOptions,
} from '../models/types';

/**
 * 错误服务类
 */
export class ErrorService {
  /**
   * 生成错误ID
   * @returns 错误ID
   */
  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 创建错误
   * @param type 错误类型
   * @param message 错误消息
   * @param options 错误选项
   * @returns 应用错误
   */
  createError(
    type: ErrorType,
    message: string,
    options?: {
      code?: string;
      details?: any;
      originalError?: Error;
      location?: string;
      level?: ErrorLevel;
      stack?: string;
    }
  ): AppError {
    const error: AppError = {
      id: this.generateErrorId(),
      type,
      level: options?.level || ErrorLevel.ERROR,
      message,
      code: options?.code,
      details: options?.details,
      originalError: options?.originalError,
      timestamp: Date.now(),
      location: options?.location,
      stack: options?.stack || options?.originalError?.stack,
    };

    return error;
  }

  /**
   * 处理错误
   * @param error 错误
   * @param options 处理选项
   * @returns 处理后的错误
   */
  handleError(error: unknown, options: ErrorHandlerOptions = {}): AppError {
    let appError: AppError;

    // 如果是原生错误，转换为应用错误
    if (error instanceof Error) {
      appError = this.createError(ErrorType.SYSTEM, error.message, {
        originalError: error,
        stack: error.stack,
      });
    } else if (error && typeof error === 'object' && 'type' in error) {
      // 已经是 AppError
      appError = error as AppError;
    } else {
      // 其他类型，转换为应用错误
      appError = this.createError(ErrorType.SYSTEM, String(error));
    }

    // 记录错误
    if (options.log) {
      this.logError(appError);
    }

    // 执行回调
    if (options.callback) {
      options.callback(appError);
    }

    return appError;
  }

  /**
   * 记录错误
   * @param error 应用错误
   */
  logError(error: AppError): void {
    const timestamp = new Date(error.timestamp).toISOString();
    const level = error.level.toUpperCase();
    const type = error.type;
    const message = error.message;
    const code = error.code ? ` (${error.code})` : '';

    console.error(`[${timestamp}] [${level}] [${type}] ${message}${code}`);

    if (error.details) {
      console.error('Details:', JSON.stringify(error.details, null, 2));
    }

    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }

  /**
   * 转换为HTTP错误响应
   * @param error 应用错误
   * @returns HTTP错误响应
   */
  toHttpResponse(error: AppError): { status: number; body: any } {
    // 根据错误类型确定HTTP状态码
    let status = 500; // 默认500 Internal Server Error

    switch (error.type) {
      case ErrorType.INPUT:
        status = 400; // Bad Request
        break;
      case ErrorType.AUTHENTICATION:
        status = 401; // Unauthorized
        break;
      case ErrorType.AUTHORIZATION:
        status = 403; // Forbidden
        break;
      case ErrorType.RESOURCE:
        status = 404; // Not Found
        break;
      case ErrorType.BUSINESS:
        status = 422; // Unprocessable Entity
        break;
      case ErrorType.NETWORK:
        status = 503; // Service Unavailable
        break;
    }

    const body = {
      error: {
        id: error.id,
        type: error.type,
        message: error.message,
        code: error.code,
      },
    };

    return { status, body };
  }

  /**
   * 包装异步函数，自动处理错误
   * @param fn 异步函数
   * @param options 错误处理选项
   * @returns 包装后的函数
   */
  wrapAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: ErrorHandlerOptions = {}
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      try {
        return await fn(...args);
      } catch (error) {
        const appError = this.handleError(error, options);
        throw appError;
      }
    };
  }

  /**
   * 包装同步函数，自动处理错误
   * @param fn 同步函数
   * @param options 错误处理选项
   * @returns 包装后的函数
   */
  wrapSync<T extends (...args: any[]) => any>(
    fn: T,
    options: ErrorHandlerOptions = {}
  ): (...args: Parameters<T>) => ReturnType<T> {
    return (...args: Parameters<T>): ReturnType<T> => {
      try {
        return fn(...args);
      } catch (error) {
        const appError = this.handleError(error, options);
        throw appError;
      }
    };
  }
}

/**
 * 错误服务实例
 */
let errorService: ErrorService | undefined;

/**
 * 获取错误服务实例
 * @returns 错误服务实例
 */
export function getErrorService(): ErrorService {
  if (!errorService) {
    errorService = new ErrorService();
  }
  return errorService;
}

/**
 * 创建错误
 * @param type 错误类型
 * @param message 错误消息
 * @param options 错误选项
 * @returns 应用错误
 */
export function createError(
  type: ErrorType,
  message: string,
  options?: {
    code?: string;
    details?: any;
    originalError?: Error;
    location?: string;
    level?: ErrorLevel;
  }
): AppError {
  return getErrorService().createError(type, message, options);
}

/**
 * 处理错误
 * @param error 错误
 * @param options 处理选项
 * @returns 处理后的错误
 */
export function handleError(
  error: unknown,
  options: ErrorHandlerOptions = {}
): AppError {
  return getErrorService().handleError(error, options);
}

/**
 * 包装异步函数，自动处理错误
 * @param fn 异步函数
 * @param options 错误处理选项
 * @returns 包装后的函数
 */
export function wrapAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: ErrorHandlerOptions = {}
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return getErrorService().wrapAsync(fn, options);
}

/**
 * 包装同步函数，自动处理错误
 * @param fn 同步函数
 * @param options 错误处理选项
 * @returns 包装后的函数
 */
export function wrapSync<T extends (...args: any[]) => any>(
  fn: T,
  options: ErrorHandlerOptions = {}
): (...args: Parameters<T>) => ReturnType<T> {
  return getErrorService().wrapSync(fn, options);
}
