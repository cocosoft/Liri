/**
 * 请求重试机制
 * 为API调用提供自动重试能力，支持指数退避
 *
 * 基于CC源码 cc_code/backend/utils/retry.ts 实现
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

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

export class RetryableError extends Error {
  constructor(
    message: string,
    public originalError?: Error,
    public statusCode?: number
  ) {
    super(message);
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
