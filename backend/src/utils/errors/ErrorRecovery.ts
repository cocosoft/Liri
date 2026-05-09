//
/**
 * 错误恢复策略
 * 基于CC源码错误处理实现
 */

export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  CIRCUIT_BREAKER = 'circuit_breaker',
  TIMEOUT = 'timeout',
  ABORT = 'abort',
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
}

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime?: number;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60000;
  }

  getState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime >= this.timeout
      ) {
        this.state = CircuitState.HALF_OPEN;
      }
    }
    return this.state;
  }

  isAllowed(): boolean {
    return this.getState() !== CircuitState.OPEN;
  }

  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
  }
}

export class RetryManager {
  private retryCount: Map<string, number> = new Map();

  calculateDelay(attempt: number, options: Required<RetryOptions>): number {
    const delay = Math.min(
      options.baseDelay * Math.pow(options.backoffMultiplier, attempt - 1),
      options.maxDelay
    );
    return delay;
  }

  shouldRetry(
    error: unknown,
    attempt: number,
    options: Required<RetryOptions>
  ): boolean {
    if (attempt >= options.maxAttempts) {
      return false;
    }

    if (options.retryableErrors.length === 0) {
      return true;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return options.retryableErrors.some((pattern) => {
      return errorMessage.includes(pattern);
    });
  }

  incrementRetry(key: string): number {
    const current = this.retryCount.get(key) ?? 0;
    const next = current + 1;
    this.retryCount.set(key, next);
    return next;
  }

  getRetryCount(key: string): number {
    return this.retryCount.get(key) ?? 0;
  }

  resetRetry(key: string): void {
    this.retryCount.delete(key);
  }

  resetAll(): void {
    this.retryCount.clear();
  }

  async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const opts: Required<RetryOptions> = {
      maxAttempts: options.maxAttempts ?? 3,
      baseDelay: options.baseDelay ?? 1000,
      maxDelay: options.maxDelay ?? 30000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      retryableErrors: options.retryableErrors ?? [],
    };

    let lastError: unknown;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!this.shouldRetry(error, attempt, opts)) {
          throw error;
        }

        if (attempt < opts.maxAttempts) {
          const delay = this.calculateDelay(attempt, opts);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class ErrorRecoveryManager {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private retryManager: RetryManager = new RetryManager();

  getOrCreateCircuitBreaker(
    key: string,
    options?: CircuitBreakerOptions
  ): CircuitBreaker {
    let breaker = this.circuitBreakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker(options);
      this.circuitBreakers.set(key, breaker);
    }
    return breaker;
  }

  getCircuitBreaker(key: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(key);
  }

  removeCircuitBreaker(key: string): void {
    this.circuitBreakers.delete(key);
  }

  getRetryManager(): RetryManager {
    return this.retryManager;
  }

  async executeWithCircuitBreaker<T>(
    key: string,
    fn: () => Promise<T>,
    options?: CircuitBreakerOptions
  ): Promise<T> {
    const breaker = this.getOrCreateCircuitBreaker(key, options);

    if (!breaker.isAllowed()) {
      throw new Error(`Circuit breaker is open for: ${key}`);
    }

    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      breaker.recordFailure();
      throw error;
    }
  }

  async executeWithRetry<T>(
    key: string,
    fn: () => Promise<T>,
    options?: RetryOptions
  ): Promise<T> {
    return this.retryManager.withRetry(fn, options);
  }

  resetAll(): void {
    this.circuitBreakers.clear();
    this.retryManager.resetAll();
  }
}

let globalRecoveryManager: ErrorRecoveryManager | null = null;

export function getGlobalRecoveryManager(): ErrorRecoveryManager {
  if (!globalRecoveryManager) {
    globalRecoveryManager = new ErrorRecoveryManager();
  }
  return globalRecoveryManager;
}

export function resetGlobalRecoveryManager(): void {
  globalRecoveryManager = null;
}
