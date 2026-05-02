/**
 * API重试机制
 * 实现指数退避策略和可配置的重试条件
 */

export interface RetryConfig {
  maxRetries: number;           // 最大重试次数
  baseDelay: number;            // 基础延迟(ms)
  maxDelay: number;             // 最大延迟(ms)
  retryOnStatusCodes: number[]; // 重试状态码列表
  retryOnNetworkErrors: boolean; // 是否重试网络错误
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检查是否应该重试
 * @param attempt 当前尝试次数（从0开始，0表示第一次尝试）
 */
function shouldRetry(
  error: Error,
  config: RetryConfig,
  attempt: number
): boolean {
  // attempt 是已经尝试的次数，所以如果已经达到最大重试次数，就不再重试
  // 例如：maxRetries=3 意味着可以重试3次，总共尝试4次（初始+3次重试）
  if (attempt > config.maxRetries) {
    return false;
  }

  // 检查网络错误
  const networkErrorTypes = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'];
  const isNetworkError = networkErrorTypes.some(type => 
    error.message.includes(type)
  );

  if (isNetworkError && config.retryOnNetworkErrors) {
    return true;
  }

  // 检查HTTP状态码（如果错误是HTTP错误）
  if ('statusCode' in error) {
    const statusCode = (error as any).statusCode;
    if (config.retryOnStatusCodes.includes(statusCode)) {
      return true;
    }
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