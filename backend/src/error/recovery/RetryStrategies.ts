import { sleep } from '@modules/utils/common.js';

/**
 * 增强重试策略
 *
 * 设计参考: cc_code/backend/services/api/withRetry.ts
 *
 * 在现有 ErrorRecoverer 基础上增强，支持：
 * - 指数退避 + 抖动
 * - Retry-After 头解析
 * - 持久重试模式（无限制重试）
 * - 异步生成器进度通知
 * - 前台/后台区分（避免级联放大）
 */

/**
 * 增强重试选项
 */
export interface EnhancedRetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitterFactor: number;
  retryAfterHeader: boolean;
  persistentMode: boolean;
  onProgress?: (attempt: number, delay: number) => void;
}

/**
 * 重试进度
 */
export interface RetryProgress {
  attempt: number;
  maxAttempts: number;
  delay: number;
  error: Error;
}

/**
 * 默认重试选项
 */
export const DEFAULT_RETRY_OPTIONS: EnhancedRetryOptions = {
  maxRetries: 10,
  baseDelay: 500,
  maxDelay: 32000,
  backoffFactor: 2,
  jitterFactor: 0.25,
  retryAfterHeader: true,
  persistentMode: false,
};

/**
 * 计算重试延迟（指数退避 + 抖动）
 *
 * 参考 CC_CODE getRetryDelay 实现
 */
export function calculateDelay(
  attempt: number,
  options: EnhancedRetryOptions,
  retryAfterHeader?: string | null
): number {
  if (options.retryAfterHeader && retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }

  const baseDelay = Math.min(
    options.baseDelay * Math.pow(options.backoffFactor, attempt - 1),
    options.maxDelay
  );
  const jitter = Math.random() * options.jitterFactor * baseDelay;
  return baseDelay + jitter;
}

/**
 * 解析 Retry-After 头
 */
export function parseRetryAfterHeader(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const err = error as any;

  if (err.headers) {
    if (typeof err.headers.get === 'function') {
      return err.headers.get('retry-after') ?? null;
    }
    if (typeof err.headers['retry-after'] === 'string') {
      return err.headers['retry-after'];
    }
  }

  return null;
}

/**
 * 判断是否为 529 服务器过载错误
 */
export function is529Error(error: unknown): boolean {
  if (error instanceof Error && 'status' in error) {
    return (error as any).status === 529;
  }
  return false;
}

/**
 * 判断是否为 429 速率限制错误
 */
export function is429Error(error: unknown): boolean {
  if (error instanceof Error && 'status' in error) {
    return (error as any).status === 429;
  }
  return false;
}

/**
 * 判断是否为临时容量错误（429 或 529）
 */
export function isTransientCapacityError(error: unknown): boolean {
  return is529Error(error) || is429Error(error);
}

/**
 * 无法重试错误
 */
export class CannotRetryError extends Error {
  constructor(public readonly originalError: Error) {
    super(`无法重试: ${originalError.message}`);
    this.name = 'CannotRetryError';
  }
}

/**
 * 带进度的重试异步生成器
 *
 * 参考 CC_CODE withRetry 异步生成器模式
 *
 * 使用示例:
 * ```typescript
 * for await (const progress of retryWithProgress(apiCall, options)) {
 *   console.log(`重试 ${progress.attempt}/${progress.maxAttempts}，等待 ${progress.delay}ms`);
 * }
 * ```
 */
export async function* retryWithProgress<T>(
  fn: () => Promise<T>,
  options: Partial<EnhancedRetryOptions> = {}
): AsyncGenerator<RetryProgress, T> {
  const opts: EnhancedRetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let lastError: Error | null = null;
  let persistentAttempt = 0;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isPersistent =
        opts.persistentMode && isTransientCapacityError(error);

      if (attempt > opts.maxRetries && !isPersistent) {
        throw new CannotRetryError(lastError);
      }

      const reportedAttempt = isPersistent ? ++persistentAttempt : attempt;
      const retryAfter = parseRetryAfterHeader(error);
      const delay = calculateDelay(reportedAttempt, opts, retryAfter);

      yield {
        attempt: reportedAttempt,
        maxAttempts: opts.maxRetries,
        delay,
        error: lastError,
      };

      if (opts.onProgress) {
        opts.onProgress(reportedAttempt, delay);
      }

      await sleep(delay);

      if (isPersistent && attempt >= opts.maxRetries) {
        attempt = opts.maxRetries;
      }
    }
  }

  if (lastError) {
    throw new CannotRetryError(lastError);
  }
  throw new CannotRetryError(new Error('未知错误'));
}

/**
 * 简单重试函数（非生成器版本）
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<EnhancedRetryOptions> = {}
): Promise<T> {
  const opts: EnhancedRetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < opts.maxRetries) {
        const retryAfter = parseRetryAfterHeader(error);
        const delay = calculateDelay(attempt, opts, retryAfter);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('未知错误');
}
