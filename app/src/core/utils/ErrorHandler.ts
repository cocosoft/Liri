/**
 * 错误处理核心工具
 * 负责应用的错误恢复和容错机制
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'ErrorHandler' });
import { toError, isAbortError, errorMessage } from '@modules/error';

/**
 * 错误处理选项
 */
interface ErrorHandlerOptions {
  /**
   * 是否重新抛出错误
   */
  rethrow?: boolean;
  /**
   * 错误恢复策略
   */
  recoveryStrategy?: 'retry' | 'fallback' | 'ignore';
  /**
   * 重试次数
   */
  maxRetries?: number;
  /**
   * 重试间隔（毫秒）
   */
  retryInterval?: number;
  /**
   * 回退值
   */
  fallbackValue?: unknown;
  /**
   * 错误处理回调
   */
  onError?: (error: Error) => void;
  /**
   * 错误记录级别
   */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 错误处理结果
 */
interface ErrorHandlerResult<T> {
  /**
   * 操作是否成功
   */
  success: boolean;
  /**
   * 操作结果
   */
  result?: T;
  /**
   * 错误信息
   */
  error?: Error;
  /**
   * 重试次数
   */
  retries?: number;
}

/**
 * 错误处理器
 */
export class ErrorHandler {
  /**
   * 处理同步函数的错误
   * @param fn 要执行的函数
   * @param options 错误处理选项
   * @returns 错误处理结果
   */
  public static handleSync<T>(
    fn: () => T,
    options: ErrorHandlerOptions = {}
  ): ErrorHandlerResult<T> {
    const {
      rethrow = false,
      recoveryStrategy = 'ignore',
      maxRetries = 0,
      retryInterval = 1000,
      fallbackValue,
      onError,
      logLevel = 'error',
    } = options;

    let retries = 0;
    let lastError: Error | undefined;

    while (retries <= maxRetries) {
      try {
        const result = fn();
        return {
          success: true,
          result,
          retries,
        };
      } catch (error) {
        const e = toError(error);
        lastError = e;

        // 处理中止错误
        if (isAbortError(e)) {
          this.logError('Operation aborted', e, logLevel);
          if (rethrow) {
            throw e;
          }
          return {
            success: false,
            error: e,
          };
        }

        // 调用错误处理回调
        if (onError) {
          try {
            onError(e);
          } catch (callbackError) {
            this.logError(
              'Error in error callback',
              toError(callbackError),
              'error'
            );
          }
        }

        // 记录错误
        this.logError('Error occurred', e, logLevel);

        // 如果需要重新抛出错误
        if (rethrow) {
          throw e;
        }

        // 处理恢复策略
        if (recoveryStrategy === 'retry' && retries < maxRetries) {
          retries++;
          this.logError(`Retrying (${retries}/${maxRetries})...`, e, 'debug');
          // 同步重试，实际应用中可能需要异步
          continue;
        } else if (recoveryStrategy === 'fallback') {
          this.logError('Using fallback value', e, 'debug');
          return {
            success: true,
            result: fallbackValue as T,
            retries,
          };
        } else {
          // 'ignore' 策略
          this.logError('Ignoring error', e, 'debug');
          return {
            success: false,
            error: e,
            retries,
          };
        }
      }
    }

    // 达到最大重试次数
    if (lastError && rethrow) {
      throw lastError;
    }

    return {
      success: false,
      error: lastError,
      retries,
    };
  }

  /**
   * 处理异步函数的错误
   * @param fn 要执行的异步函数
   * @param options 错误处理选项
   * @returns 错误处理结果
   */
  public static async handleAsync<T>(
    fn: () => Promise<T>,
    options: ErrorHandlerOptions = {}
  ): Promise<ErrorHandlerResult<T>> {
    const {
      rethrow = false,
      recoveryStrategy = 'ignore',
      maxRetries = 0,
      retryInterval = 1000,
      fallbackValue,
      onError,
      logLevel = 'error',
    } = options;

    let retries = 0;
    let lastError: Error | undefined;

    while (retries <= maxRetries) {
      try {
        const result = await fn();
        return {
          success: true,
          result,
          retries,
        };
      } catch (error) {
        const e = toError(error);
        lastError = e;

        // 处理中止错误
        if (isAbortError(e)) {
          this.logError('Operation aborted', e, logLevel);
          if (rethrow) {
            throw e;
          }
          return {
            success: false,
            error: e,
          };
        }

        // 调用错误处理回调
        if (onError) {
          try {
            onError(e);
          } catch (callbackError) {
            this.logError(
              'Error in error callback',
              toError(callbackError),
              'error'
            );
          }
        }

        // 记录错误
        this.logError('Error occurred', e, logLevel);

        // 如果需要重新抛出错误
        if (rethrow) {
          throw e;
        }

        // 处理恢复策略
        if (recoveryStrategy === 'retry' && retries < maxRetries) {
          retries++;
          this.logError(`Retrying (${retries}/${maxRetries})...`, e, 'debug');
          // 等待重试间隔
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
          continue;
        } else if (recoveryStrategy === 'fallback') {
          this.logError('Using fallback value', e, 'debug');
          return {
            success: true,
            result: fallbackValue as T,
            retries,
          };
        } else {
          // 'ignore' 策略
          this.logError('Ignoring error', e, 'debug');
          return {
            success: false,
            error: e,
            retries,
          };
        }
      }
    }

    // 达到最大重试次数
    if (lastError && rethrow) {
      throw lastError;
    }

    return {
      success: false,
      error: lastError,
      retries,
    };
  }

  /**
   * 记录错误
   * @param message 错误消息
   * @param error 错误对象
   * @param level 日志级别
   */
  private static logError(message: string, error: Error, level: string): void {
    switch (level) {
      case 'debug':
        logger.debug(message, { error: errorMessage(error) });
        break;
      case 'info':
        logger.info(message, { error: errorMessage(error) });
        break;
      case 'warn':
        logger.warn(message, { error: errorMessage(error) });
        break;
      case 'error':
        logger.error(message, error);
        break;
      default:
        logger.error(message, error);
    }
  }

  /**
   * 安全执行同步函数
   * @param fn 要执行的函数
   * @param fallback 回退值
   * @returns 执行结果或回退值
   */
  public static safeSync<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (error) {
      logger.debug('Safe sync execution failed', {
        error: errorMessage(error),
      });
      return fallback;
    }
  }

  /**
   * 安全执行异步函数
   * @param fn 要执行的异步函数
   * @param fallback 回退值
   * @returns 执行结果或回退值
   */
  public static async safeAsync<T>(
    fn: () => Promise<T>,
    fallback: T
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      logger.debug('Safe async execution failed', {
        error: errorMessage(error),
      });
      return fallback;
    }
  }
}

/**
 * 安全执行同步函数的便捷方法
 * @param fn 要执行的函数
 * @param fallback 回退值
 * @returns 执行结果或回退值
 */
export function safeSync<T>(fn: () => T, fallback: T): T {
  return ErrorHandler.safeSync(fn, fallback);
}

/**
 * 安全执行异步函数的便捷方法
 * @param fn 要执行的异步函数
 * @param fallback 回退值
 * @returns 执行结果或回退值
 */
export function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  return ErrorHandler.safeAsync(fn, fallback);
}

/**
 * 处理错误的便捷方法
 * @param fn 要执行的函数
 * @param options 错误处理选项
 * @returns 错误处理结果
 */
export function handleError<T>(
  fn: () => T,
  options: ErrorHandlerOptions = {}
): ErrorHandlerResult<T> {
  return ErrorHandler.handleSync(fn, options);
}

/**
 * 处理异步错误的便捷方法
 * @param fn 要执行的异步函数
 * @param options 错误处理选项
 * @returns 错误处理结果
 */
export async function handleErrorAsync<T>(
  fn: () => Promise<T>,
  options: ErrorHandlerOptions = {}
): Promise<ErrorHandlerResult<T>> {
  return await ErrorHandler.handleAsync(fn, options);
}
