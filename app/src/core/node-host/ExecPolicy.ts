import { ExecPolicyConfig } from './types.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'core:node-host:ExecPolicy',
  level: LogLevel.INFO,
});

const DEFAULT_POLICY: ExecPolicyConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoff: 'exponential',
  timeout: 30000,
  maxConcurrency: 5,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30000,
};

interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number;
  isOpen: boolean;
  openedAt: number;
}

export class ExecPolicy {
  private config: ExecPolicyConfig;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private activeCount: number = 0;

  constructor(config: Partial<ExecPolicyConfig> = {}) {
    this.config = { ...DEFAULT_POLICY, ...config };
  }

  getConfig(): ExecPolicyConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<ExecPolicyConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  async execute<T>(
    nodeId: string,
    operation: () => Promise<T>,
    context?: { retryOverride?: number; timeoutOverride?: number }
  ): Promise<{
    success: boolean;
    result?: T;
    error?: string;
    attempts: number;
    durationMs: number;
  }> {
    const startTime = Date.now();
    let lastError: string | undefined;
    let attempts = 0;

    if (this.isCircuitBroken(nodeId)) {
      return {
        success: false,
        error: `Circuit breaker is open for node ${nodeId}`,
        attempts: 0,
        durationMs: 0,
      };
    }

    if (this.activeCount >= this.config.maxConcurrency) {
      return {
        success: false,
        error: 'Max concurrency reached',
        attempts: 0,
        durationMs: 0,
      };
    }

    const maxRetries = context?.retryOverride ?? this.config.maxRetries;

    this.activeCount++;

    try {
      for (let i = 0; i <= maxRetries; i++) {
        attempts++;

        try {
          const timeoutMs = context?.timeoutOverride ?? this.config.timeout;
          const result = await this.withTimeout(operation, timeoutMs);

          this.recordSuccess(nodeId);

          return {
            success: true,
            result,
            attempts,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);

          if (i < maxRetries) {
            const delay = this.calculateDelay(i);

            await this.sleep(delay);
          }
        }
      }

      this.recordFailure(nodeId);

      return {
        success: false,
        error: lastError,
        attempts,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.activeCount--;
    }
  }

  canExecute(nodeId: string): { allowed: boolean; reason?: string } {
    if (this.isCircuitBroken(nodeId)) {
      return { allowed: false, reason: `Circuit breaker open for ${nodeId}` };
    }

    if (this.activeCount >= this.config.maxConcurrency) {
      return { allowed: false, reason: 'Max concurrency reached' };
    }

    return { allowed: true };
  }

  isCircuitBroken(nodeId: string): boolean {
    const state = this.circuitBreakers.get(nodeId);

    if (!state || !state.isOpen) {
      return false;
    }

    if (Date.now() - state.openedAt >= this.config.circuitBreakerResetMs) {
      state.isOpen = false;
      state.failures = 0;

      return false;
    }

    return true;
  }

  private recordSuccess(nodeId: string): void {
    this.circuitBreakers.delete(nodeId);
  }

  private recordFailure(nodeId: string): void {
    let state = this.circuitBreakers.get(nodeId);

    if (!state) {
      state = { failures: 0, lastFailureAt: 0, isOpen: false, openedAt: 0 };
      this.circuitBreakers.set(nodeId, state);
    }

    state.failures++;
    state.lastFailureAt = Date.now();

    if (state.failures >= this.config.circuitBreakerThreshold) {
      state.isOpen = true;
      state.openedAt = Date.now();
    }
  }

  private calculateDelay(attemptIndex: number): number {
    if (this.config.retryBackoff === 'exponential') {
      return this.config.retryDelayMs * Math.pow(2, attemptIndex);
    }

    return this.config.retryDelayMs;
  }

  private withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const execPolicy = new ExecPolicy();
