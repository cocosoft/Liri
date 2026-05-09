/**
 * 流式请求重试与错误恢复
 *
 * 提供流式请求的重试逻辑和断路器模式支持。
 */
import { ApiError } from '../services/api';

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

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

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

  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }
}

export function shouldRetryStreaming(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
    return false;
  }
  if (error instanceof TypeError) return true;
  return false;
}

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
