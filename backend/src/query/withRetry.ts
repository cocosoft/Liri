/**
 * API重试机制（基于CC源码 withRetry.ts 增强）
 * 实现指数退避重试、529过载处理、瞬态错误检测
 * 支持可配置的重试条件和自定义重试判断
 */

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 60000;
const JITTER_FACTOR = 0.1;
const MAX_TOTAL_RETRY_TIME_MS = 300000; // 5分钟最大重试时间

/** 529过载错误最大重试次数（参考CC源码 MAX_529_RETRIES=3） */
export const MAX_529_RETRIES = 3;
/** 默认最大重试次数（参考CC源码 DEFAULT_MAX_RETRIES=10） */
export const MAX_RETRIES_DEFAULT = 10;
/** 基础退避延迟（参考CC源码 BASE_DELAY_MS=500） */
export const BASE_DELAY_MS = 500;

/**
 * 可重试错误类型枚举
 */
export enum RetryableErrorType {
  RATE_LIMIT = 'rate_limit',
  OVERLOADED = 'overloaded',
  CONNECTION_ERROR = 'connection_error',
  TIMEOUT = 'timeout',
  INTERNAL_SERVER_ERROR = 'internal_server_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  STALE_CONNECTION = 'stale_connection',
  UNKNOWN = 'unknown',
}

/**
 * API错误分类
 */
export interface APIErrorClassification {
  type: RetryableErrorType;
  retryable: boolean;
  retryAfterMs?: number;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  maxTotalRetryTimeMs?: number;
  retryOn?: (error: unknown) => boolean;
  delayCalculator?: (attempt: number, error: unknown) => number;
  onBeforeRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  onAfterRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  onRetryFailed?: (error: unknown, attempts: number, totalDelayMs: number) => void;
}

/**
 * 重试状态信息
 */
export interface RetryState {
  attempt: number;
  totalDelayMs: number;
  lastError?: unknown;
}

/**
 * 重试结果
 */
export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDelayMs: number;
}

/**
 * 默认重试配置（对齐CC源码）
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: MAX_RETRIES_DEFAULT,
  initialDelayMs: BASE_DELAY_MS,
  maxDelayMs: MAX_RETRY_DELAY_MS,
  jitterFactor: JITTER_FACTOR,
};

/**
 * 判断是否为529过载错误
 */
export function is529Error(error: unknown): boolean {
  const err = error as any;
  return err?.status === 529 || err?.statusCode === 529;
}

/**
 * 判断是否为瞬态容量错误（529或429）
 */
export function isTransientCapacityError(error: unknown): boolean {
  const err = error as any;
  const status = err?.status || err?.statusCode;
  return status === 529 || status === 429;
}

/**
 * 判断是否为过期连接错误（ECONNRESET/EPIPE）
 */
export function isStaleConnectionError(error: unknown): boolean {
  const err = error as any;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('econnreset') || msg.includes('epipe');
}

/**
 * 不可重试错误（参考CC源码 CannotRetryError）
 */
export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    message?: string,
  ) {
    super(message || 'Cannot retry error');
    this.name = 'CannotRetryError';
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * 分类API错误
 * @param error 错误对象
 * @returns 错误分类结果
 */
export function categorizeAPIError(error: unknown): APIErrorClassification {
  const err = error as any;
  const msg = (err.message || '').toString().toLowerCase();
  const statusCode = err.status || err.statusCode;

  // 速率限制
  if (statusCode === 429 || msg.includes('rate_limit') || msg.includes('rate limit')) {
    const retryAfter = err.retryAfterMs || err.headers?.['retry-after'];
    return {
      type: RetryableErrorType.RATE_LIMIT,
      retryable: true,
      retryAfterMs: retryAfter ? parseInt(retryAfter) * 1000 : undefined,
    };
  }

  // 服务过载
  if (statusCode === 529 || msg.includes('overloaded')) {
    return {
      type: RetryableErrorType.OVERLOADED,
      retryable: true,
      retryAfterMs: 5000,
    };
  }

  // 过期连接（ECONNRESET/EPIPE）
  if (msg.includes('econnreset') || msg.includes('epipe')) {
    return {
      type: RetryableErrorType.STALE_CONNECTION,
      retryable: true,
      retryAfterMs: BASE_DELAY_MS,
    };
  }

  // 其他连接错误
  if (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('connection') ||
    msg.includes('network')
  ) {
    return {
      type: RetryableErrorType.CONNECTION_ERROR,
      retryable: true,
    };
  }

  // 超时
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      type: RetryableErrorType.TIMEOUT,
      retryable: true,
    };
  }

  // 服务器内部错误
  if (statusCode === 500) {
    return {
      type: RetryableErrorType.INTERNAL_SERVER_ERROR,
      retryable: true,
      retryAfterMs: 2000,
    };
  }

  // 服务不可用
  if (statusCode === 503) {
    return {
      type: RetryableErrorType.SERVICE_UNAVAILABLE,
      retryable: true,
      retryAfterMs: 3000,
    };
  }

  // 客户端错误（4xx，除429外）不可重试
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return {
      type: RetryableErrorType.UNKNOWN,
      retryable: false,
    };
  }

  return {
    type: RetryableErrorType.UNKNOWN,
    retryable: false,
  };
}

/**
 * 计算退避延迟
 * @param attempt 重试次数
 * @param config 重试配置
 * @returns 延迟时间（毫秒）
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = Math.min(
    config.initialDelayMs * Math.pow(2, attempt),
    config.maxDelayMs
  );
  const jitter = exponentialDelay * config.jitterFactor * Math.random();
  return Math.floor(exponentialDelay + jitter);
}

/**
 * 使用重试机制执行异步操作
 * @param operation 要执行的操作
 * @param config 重试配置
 * @param onRetry 重试回调
 * @returns 操作结果
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const classification = categorizeAPIError(error);

      if (!classification.retryable || attempt >= config.maxRetries) {
        throw error;
      }

      const delayMs = classification.retryAfterMs ?? calculateBackoffDelay(attempt, config);

      if (onRetry) {
        onRetry(error, attempt + 1, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * 使用重试机制执行异步生成器
 * @param generatorFactory 生成器工厂
 * @param config 重试配置
 * @param onRetry 重试回调
 * @returns 异步生成器
 */
export async function* withRetryGenerator<T>(
  generatorFactory: () => AsyncGenerator<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
): AsyncGenerator<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const generator = generatorFactory();
      for await (const item of generator) {
        yield item;
      }
      return;
    } catch (error) {
      lastError = error;
      const classification = categorizeAPIError(error);

      if (!classification.retryable || attempt >= config.maxRetries) {
        throw error;
      }

      const delayMs = classification.retryAfterMs ?? calculateBackoffDelay(attempt, config);

      if (onRetry) {
        onRetry(error, attempt + 1, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * 增强的重试机制 - 支持更多配置选项
 * @param operation 要执行的操作
 * @param config 重试配置
 * @returns 重试结果
 */
export async function withRetryEnhanced<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  const maxTotalTime = config.maxTotalRetryTimeMs ?? MAX_TOTAL_RETRY_TIME_MS;
  let totalDelayMs = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await operation();
      return {
        result,
        attempts: attempt + 1,
        totalDelayMs,
      };
    } catch (error) {
      lastError = error;

      // 检查是否应该重试
      const shouldRetry = config.retryOn
        ? config.retryOn(error)
        : categorizeAPIError(error).retryable;

      if (!shouldRetry || attempt >= config.maxRetries) {
        if (config.onRetryFailed) {
          config.onRetryFailed(error, attempt + 1, totalDelayMs);
        }
        throw error;
      }

      // 检查总重试时间
      const delayMs = config.delayCalculator
        ? config.delayCalculator(attempt, error)
        : calculateBackoffDelay(attempt, config);

      if (totalDelayMs + delayMs > maxTotalTime) {
        if (config.onRetryFailed) {
          config.onRetryFailed(error, attempt + 1, totalDelayMs);
        }
        throw error;
      }

      // 执行重试前回调
      if (config.onBeforeRetry) {
        config.onBeforeRetry(error, attempt + 1, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
      totalDelayMs += delayMs;

      // 执行重试后回调
      if (config.onAfterRetry) {
        config.onAfterRetry(error, attempt + 1, delayMs);
      }
    }
  }

  if (config.onRetryFailed && lastError) {
    config.onRetryFailed(lastError, config.maxRetries + 1, totalDelayMs);
  }

  throw lastError;
}

/**
 * 创建带超时的重试操作
 * @param operation 要执行的操作
 * @param timeoutMs 超时时间（毫秒）
 * @param config 重试配置
 * @returns 操作结果
 */
export async function withRetryWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Retry operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const retryPromise = withRetry(operation, config);

  return Promise.race([retryPromise, timeoutPromise]);
}

/**
 * 创建延迟重试策略
 * @param delaysMs 延迟数组（毫秒）
 * @returns 延迟计算函数
 */
export function createExponentialBackoffStrategy(
  initialDelay: number = BASE_DELAY_MS,
  maxDelay: number = MAX_RETRY_DELAY_MS,
  jitterFactor: number = JITTER_FACTOR
): (attempt: number) => number {
  return (attempt: number) => {
    const exponentialDelay = Math.min(
      initialDelay * Math.pow(2, attempt),
      maxDelay
    );
    const jitter = exponentialDelay * jitterFactor * (Math.random() - 0.5) * 2;
    return Math.max(0, Math.floor(exponentialDelay + jitter));
  };
}

/**
 * 创建固定间隔重试策略
 * @param delayMs 固定延迟（毫秒）
 * @returns 延迟计算函数
 */
export function createFixedDelayStrategy(delayMs: number): (attempt: number) => number {
  return () => delayMs;
}