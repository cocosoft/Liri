/**
 * API重试机制
 * 实现指数退避策略和可配置的重试条件
 * 参考CC源码: cc_code/backend/services/api/retry.ts
 */

/**
 * API错误分类
 */
export enum APIErrorCategory {
  RATE_LIMIT = 'rate_limit',
  SERVER_ERROR = 'server_error',
  AUTH_ERROR = 'auth_error',
  BAD_REQUEST = 'bad_request',
  NETWORK_ERROR = 'network_error',
  TIMEOUT_ERROR = 'timeout_error',
  CONTEXT_OVERFLOW = 'context_overflow',
  UNKNOWN = 'unknown',
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryOnStatusCodes: number[];
  retryOnNetworkErrors: boolean;
}

export interface RetryContext {
  attempt: number;
  maxRetries: number;
  lastError?: Error;
  startTime: number;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  retryCount: number;
  durationMs: number;
}

export const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 60000,
  retryOnStatusCodes: [429, 500, 502, 503, 504],
  retryOnNetworkErrors: true,
};

const NETWORK_ERROR_TYPES = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
];

const RATE_LIMIT_STATUS_CODES = new Set([429, 402]);

const SERVER_ERROR_STATUS_CODES = new Set([500, 502, 503, 504]);

const AUTH_ERROR_STATUS_CODES = new Set([401, 403]);

const BAD_REQUEST_STATUS_CODES = new Set([400, 404, 405, 406, 415, 422]);

/**
 * 分类API错误
 */
export function categorizeAPIError(error: unknown): APIErrorCategory {
  if (!error) {
    return APIErrorCategory.UNKNOWN;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || '';
  const statusCode = extractStatusCode(err);

  if (statusCode) {
    if (RATE_LIMIT_STATUS_CODES.has(statusCode)) {
      return APIErrorCategory.RATE_LIMIT;
    }
    if (SERVER_ERROR_STATUS_CODES.has(statusCode)) {
      return APIErrorCategory.SERVER_ERROR;
    }
    if (AUTH_ERROR_STATUS_CODES.has(statusCode)) {
      return APIErrorCategory.AUTH_ERROR;
    }
    if (BAD_REQUEST_STATUS_CODES.has(statusCode)) {
      return APIErrorCategory.BAD_REQUEST;
    }
  }

  if (NETWORK_ERROR_TYPES.some((t) => message.includes(t))) {
    return APIErrorCategory.NETWORK_ERROR;
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('Timeout') ||
    message.includes('TIMEOUT')
  ) {
    return APIErrorCategory.TIMEOUT_ERROR;
  }

  if (
    message.includes('context_length_exceeded') ||
    message.includes('context overflow') ||
    message.includes('too many tokens') ||
    message.includes('maximum context length')
  ) {
    return APIErrorCategory.CONTEXT_OVERFLOW;
  }

  return APIErrorCategory.UNKNOWN;
}

function extractStatusCode(error: Error): number | null {
  const httpCodes = [
    400, 401, 402, 403, 404, 405, 406, 415, 422, 429, 500, 502, 503, 504,
  ];
  for (const code of httpCodes) {
    const regex = new RegExp(`\\b${code}\\b`);
    if (regex.test(error.message)) {
      return code;
    }
  }
  if ('statusCode' in error && typeof (error as any).statusCode === 'number') {
    return (error as any).statusCode;
  }
  if ('status' in error && typeof (error as any).status === 'number') {
    return (error as any).status;
  }
  return null;
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  const category = categorizeAPIError(error);
  switch (category) {
    case APIErrorCategory.RATE_LIMIT:
    case APIErrorCategory.SERVER_ERROR:
    case APIErrorCategory.NETWORK_ERROR:
    case APIErrorCategory.TIMEOUT_ERROR:
      return true;
    case APIErrorCategory.AUTH_ERROR:
    case APIErrorCategory.BAD_REQUEST:
    case APIErrorCategory.CONTEXT_OVERFLOW:
    case APIErrorCategory.UNKNOWN:
      return false;
  }
}

/**
 * 计算指数退避延迟
 */
function calculateDelay(config: RetryConfig, attempt: number): number {
  const delay = config.baseDelay * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelay);
}

/**
 * 等待指定时间
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 检查是否应该重试
 */
function shouldRetry(
  error: Error,
  config: RetryConfig,
  attempt: number
): boolean {
  if (attempt > config.maxRetries) {
    return false;
  }

  const category = categorizeAPIError(error);

  if (
    category === APIErrorCategory.RATE_LIMIT &&
    config.retryOnStatusCodes.includes(429)
  ) {
    return true;
  }

  if (
    category === APIErrorCategory.SERVER_ERROR &&
    config.retryOnStatusCodes.some((c) => c >= 500)
  ) {
    return true;
  }

  if (
    category === APIErrorCategory.NETWORK_ERROR &&
    config.retryOnNetworkErrors
  ) {
    return true;
  }

  if (
    category === APIErrorCategory.TIMEOUT_ERROR &&
    config.retryOnNetworkErrors
  ) {
    return true;
  }

  return false;
}

/**
 * 带重试的异步执行函数
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const retryConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  let attempt = 0;
  let retryCount = 0;
  let lastError: Error | undefined;

  while (attempt <= retryConfig.maxRetries) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1,
        retryCount,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      if (!shouldRetry(lastError, retryConfig, attempt)) {
        break;
      }

      retryCount++;
      const waitTime = calculateDelay(retryConfig, attempt);

      // 发布重试事件
      publishRetryEvent({
        attempt,
        maxRetries: retryConfig.maxRetries,
        waitTime,
        error: lastError,
      });

      await delay(waitTime);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attempt,
    retryCount,
    durationMs: Date.now() - startTime,
  };
}

/**
 * 重试事件类型
 */
export interface RetryEvent {
  attempt: number;
  maxRetries: number;
  waitTime: number;
  error: Error;
}

/**
 * 重试事件监听器
 */
type RetryEventListener = (event: RetryEvent) => void;

const retryEventListeners: RetryEventListener[] = [];

/**
 * 订阅重试事件
 */
export function onRetryEvent(listener: RetryEventListener): void {
  retryEventListeners.push(listener);
}

/**
 * 取消订阅重试事件
 */
export function offRetryEvent(listener: RetryEventListener): void {
  const index = retryEventListeners.indexOf(listener);
  if (index !== -1) {
    retryEventListeners.splice(index, 1);
  }
}

/**
 * 发布重试事件
 */
function publishRetryEvent(event: RetryEvent): void {
  for (const listener of retryEventListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('Error in retry event listener:', error);
    }
  }
}

/**
 * 重试包装器工厂
 */
export function createRetryWrapper<T>(
  config: Partial<RetryConfig> = {}
): (fn: () => Promise<T>) => Promise<RetryResult<T>> {
  return (fn) => withRetry(fn, config);
}
