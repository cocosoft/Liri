import { AppError, ErrorCategory, ErrorSeverity } from './types';
import { ErrorHandler } from './ErrorHandler';
import { errorMonitor, ErrorStats } from './monitor/ErrorMonitor';
import { ErrorService } from './services/ErrorService';
import {
  errorTracker,
  ErrorSearchQuery,
  ErrorAnalysis,
  TrackedError,
} from './tracker/ErrorTracker';
import {
  errorRecoverer,
  RecoveryResult,
  RecoveryPlan,
  RetryOptions,
} from './recovery/ErrorRecoverer';
import {
  errorWarner,
  AlertThreshold,
  AlertEvent,
  AlertLevel,
} from './warning/ErrorWarner';
import { QuerySource, shouldRetryOnError } from './context/QuerySource';

export interface ErrorManagerConfig {
  autoTrack: boolean;
  autoRecover: boolean;
  autoWarn: boolean;
  defaultRetryOptions?: Partial<RetryOptions>;
}

export interface ErrorManagerStats {
  monitor: ErrorStats;
  tracker: ErrorAnalysis;
  recovery: {
    totalPlans: number;
    succeeded: number;
    failed: number;
    pending: number;
  };
  warner: {
    totalAlerts: number;
    unacknowledged: number;
    criticalCount: number;
    warningCount: number;
  };
}

export class ErrorManager {
  private config: ErrorManagerConfig;
  private service: ErrorService;

  constructor(config?: Partial<ErrorManagerConfig>) {
    this.config = {
      autoTrack: true,
      autoRecover: true,
      autoWarn: true,
      ...config,
    };
    this.service = new ErrorService();
  }

  updateConfig(config: Partial<ErrorManagerConfig>): void {
    Object.assign(this.config, config);
  }

  async handleError(
    error: Error,
    context?: Record<string, unknown>,
    querySource?: QuerySource
  ): Promise<{
    trackedId?: string;
    recoveryResult?: RecoveryResult;
    alert?: AlertEvent;
    retryable: boolean;
  }> {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(
            error.message || 'Unknown error',
            ErrorCategory.UNKNOWN,
            ErrorSeverity.MEDIUM,
            undefined,
            context
          );

    ErrorHandler.handle(appError, context);

    const result: {
      trackedId?: string;
      recoveryResult?: RecoveryResult;
      alert?: AlertEvent;
      retryable: boolean;
    } = { retryable: true };

    if (this.config.autoTrack) {
      result.trackedId = errorTracker.track(appError, context);
    }

    if (this.config.autoRecover) {
      if (querySource && !shouldRetryOnError(error, querySource)) {
        result.retryable = false;
      } else {
        result.recoveryResult = await errorRecoverer.recover(
          result.trackedId || `err_${Date.now()}`,
          appError,
          this.config.defaultRetryOptions
        );
      }
    }

    if (this.config.autoWarn) {
      const alert = errorWarner.evaluate(appError);
      if (alert) {
        result.alert = alert;
      }
    }

    return result;
  }

  async handleAndThrow(
    error: Error,
    context?: Record<string, unknown>
  ): Promise<never> {
    await this.handleError(error, context);
    throw error;
  }

  wrapAsync<T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    context?: Record<string, unknown>
  ): (...args: Parameters<T>) => Promise<ReturnType<T>> {
    return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      try {
        return (await fn(...args)) as ReturnType<T>;
      } catch (error) {
        await this.handleError(
          error instanceof Error ? error : new Error(String(error)),
          context
        );
        throw error;
      }
    };
  }

  getTracker() {
    return errorTracker;
  }

  getRecoverer() {
    return errorRecoverer;
  }

  getWarner() {
    return errorWarner;
  }

  getMonitor() {
    return errorMonitor;
  }

  getService() {
    return this.service;
  }

  getStats(): ErrorManagerStats {
    return {
      monitor: errorMonitor.getStats(),
      tracker: errorTracker.analyze(),
      recovery: errorRecoverer.getStats(),
      warner: errorWarner.getStats(),
    };
  }

  getSummary(): string {
    const stats = this.getStats();
    return [
      '=== Error Manager Summary ===',
      `Monitor: ${stats.monitor.totalErrors} total errors`,
      `Tracker: ${stats.tracker.totalTracked} tracked, ${stats.tracker.resolved} resolved (${(stats.tracker.resolutionRate * 100).toFixed(1)}%)`,
      `Recovery: ${stats.recovery.succeeded} succeeded, ${stats.recovery.failed} failed, ${stats.recovery.pending} pending`,
      `Warner: ${stats.warner.totalAlerts} alerts, ${stats.warner.unacknowledged} unacknowledged`,
    ].join('\n');
  }

  reset(): void {
    errorTracker.clear();
    errorRecoverer.clear();
    errorWarner.clear();
  }
}

export const errorManager = new ErrorManager();
