/**
 * 流式请求重试与错误恢复
 *
 * @deprecated 请使用 @modules/utils/withRetry 中的 StreamingCircuitBreaker。
 *   当前文件保留为兼容层，新代码请直接导入 @modules/utils/withRetry。
 */

import { ApiError } from '../services/api';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('streaming:retry');
export { StreamingCircuitBreaker } from '../utils/withRetry';

/**
 * 判断流式错误是否可重试
 * 已迁移至标准重试模块
 */
export function shouldRetryStreaming(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
    return false;
  }
  if (error instanceof TypeError) return true;
  return false;
}

/**
 * 指数退避重试（流式专用）
 * 已迁移至标准重试模块
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!shouldRetryStreaming(error) || attempt >= maxRetries) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);

      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  throw lastError;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};
