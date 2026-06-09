/**
 * 请求重试机制
 * 为API调用提供自动重试能力，支持指数退避
 *
 * ════════════════════════════════════════════════════
 * 项目标准重试实现（2026-06 架构治理统一）
 * 所有模块应优先使用本模块的 withRetry 进行重试，
 * 避免自行实现重试逻辑。
 * ════════════════════════════════════════════════════
 *
 * 已知变体（待合并）：
 * - query/withRetry.ts — 查询层专用，含 CannotRetryError
 * - streaming/retry.ts — 流式重试
 * - bridge/api/BridgeApi.ts — Bridge API 内部重试
 * */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

export interface RetryConfig {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoffMultiplier: 2,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ENETUNREACH',
    'EAI_AGAIN',
    'socket hang up',
    'Network Error',
    'Failed to fetch',
  ],
};

export interface RetryState {
  attempt: number;
  totalRetries: number;
  lastError?: Error;
  startTime: number;
  endTime?: number;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  state: RetryState;
}

export class RetryableError extends AppError {
  constructor(
    message: string,
    public originalError?: Error,
    public statusCode?: number
  ) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM);
    this.name = 'RetryableError';
  }
}

export function isRetryableError(
  error: any,
  config: Partial<RetryConfig> = {}
): boolean {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  if (error instanceof RetryableError) {
    return true;
  }

  if ('status' in error && typeof error.status === 'number') {
    return fullConfig.retryableStatusCodes.includes(error.status);
  }

  const errorMessage = error?.message || '';
  for (const retryableError of fullConfig.retryableErrors) {
    if (errorMessage.includes(retryableError)) {
      return true;
    }
  }

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === fullConfig.maxRetries) {
        throw lastError;
      }

      if (!isRetryableError(error, fullConfig)) {
        throw lastError;
      }

      const delay = calculateBackoffDelay(attempt, fullConfig);
      logger.warning(
        `Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

export async function withRetryAsync<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const state: RetryState = {
    attempt: 0,
    totalRetries: 0,
    startTime: Date.now(),
  };

  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    state.attempt = attempt;

    try {
      const result = await fn();
      state.endTime = Date.now();
      state.totalRetries = attempt;

      return {
        success: true,
        result,
        state,
      };
    } catch (error: any) {
      state.lastError =
        error instanceof Error ? error : new Error(String(error));

      if (attempt === fullConfig.maxRetries) {
        state.endTime = Date.now();
        state.totalRetries = attempt;

        return {
          success: false,
          error: state.lastError,
          state,
        };
      }

      if (!isRetryableError(error, fullConfig)) {
        state.endTime = Date.now();
        state.totalRetries = attempt;

        return {
          success: false,
          error: state.lastError,
          state,
        };
      }

      const delay = calculateBackoffDelay(attempt, fullConfig);
      logger.warning(
        `Attempt ${attempt + 1} failed: ${state.lastError.message}. Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  return {
    success: false,
    error: state.lastError,
    state,
  };
}

function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs
  );

  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRetryableFetch(
  config: Partial<RetryConfig> = {}
): typeof fetch {
  return async function retryingFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    return withRetry(async () => {
      const response = await fetch(input, init);

      if (
        !response.ok &&
        isRetryableError({ status: response.status }, config)
      ) {
        throw new RetryableError(
          `HTTP ${response.status}: ${response.statusText}`,
          undefined,
          response.status
        );
      }

      return response;
    }, config);
  };
}

export class RetryablePromise<T> {
  private fn: () => Promise<T>;
  private config: RetryConfig;

  constructor(fn: () => Promise<T>, config: Partial<RetryConfig> = {}) {
    this.fn = fn;
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  async execute(): Promise<RetryResult<T>> {
    return withRetryAsync(this.fn, this.config);
  }

  static from<T>(
    fn: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): RetryablePromise<T> {
    return new RetryablePromise(fn, config);
  }
}

// ═══════════════════════════════════════════════════════════
// 以下功能从 query/withRetry.ts 和 streaming/retry.ts 合并而来
// ═══════════════════════════════════════════════════════════

/**
 * 可重试错误类型枚举
 * 从 query/withRetry.ts 合并
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
 * 流式请求断路器
 * 从 streaming/retry.ts 合并
 *
 * 监控连续失败次数，达到阈值后断开（阻止请求），
 * 超时后自动半开恢复。
 */
export class StreamingCircuitBreaker {
  private consecutiveFailures: number = 0;
  private lastFailureTime: number = 0;
  private readonly maxConsecutiveFailures: number;
  private readonly resetTimeoutMs: number;

  constructor(
    maxConsecutiveFailures: number = 3,
    resetTimeoutMs: number = 60000
  ) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  /** 记录一次失败 */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
  }

  /** 记录一次成功，重置连续失败计数 */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /** 断路器是否断开（阻止请求） */
  isOpen(): boolean {
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.consecutiveFailures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  /** 当前连续失败次数 */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /** 重置断路器 */
  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }
}
