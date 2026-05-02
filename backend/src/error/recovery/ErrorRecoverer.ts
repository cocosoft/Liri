import { AppError, ErrorCategory, ErrorSeverity } from '../types';
import { SafeLogger } from '../safeLog';

export type RecoveryStrategy = 'retry' | 'fallback' | 'compensate' | 'skip' | 'abort';

export interface RecoveryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffFactor: number;
  timeout: number;
}

export interface RecoveryAction {
  strategy: RecoveryStrategy;
  description: string;
  execute: () => Promise<boolean>;
}

export interface RecoveryPlan {
  errorId: string;
  error: AppError;
  actions: RecoveryAction[];
  createdAt: number;
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed';
}

export interface RecoveryResult {
  planId: string;
  success: boolean;
  executedActions: Array<{ strategy: RecoveryStrategy; success: boolean; duration: number }>;
  finalError?: Error;
  duration: number;
}

export interface RetryOptions {
  maxRetries: number;
  retryDelay: number;
  backoffFactor: number;
  timeout: number;
  retryableErrors?: Array<{ category?: ErrorCategory; code?: string }>;
}

const defaultConfig: RecoveryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffFactor: 2,
  timeout: 30000,
};

export class ErrorRecoverer {
  private config: RecoveryConfig;
  private plans: Map<string, RecoveryPlan> = new Map();
  private fallbackHandlers: Map<string, (error: AppError) => Promise<boolean>> = new Map();
  private compensationHandlers: Map<string, (error: AppError) => Promise<boolean>> = new Map();

  constructor(config?: Partial<RecoveryConfig>) {
    this.config = { ...defaultConfig, ...config };
  }

  updateConfig(config: Partial<RecoveryConfig>): void {
    Object.assign(this.config, config);
  }

  registerFallback(handlerId: string, handler: (error: AppError) => Promise<boolean>): void {
    this.fallbackHandlers.set(handlerId, handler);
  }

  registerCompensation(handlerId: string, handler: (error: AppError) => Promise<boolean>): void {
    this.compensationHandlers.set(handlerId, handler);
  }

  unregisterFallback(handlerId: string): void {
    this.fallbackHandlers.delete(handlerId);
  }

  unregisterCompensation(handlerId: string): void {
    this.compensationHandlers.delete(handlerId);
  }

  async recover(errorId: string, error: AppError, retryOptions?: Partial<RetryOptions>): Promise<RecoveryResult> {
    const opts: RetryOptions = {
      maxRetries: retryOptions?.maxRetries ?? this.config.maxRetries,
      retryDelay: retryOptions?.retryDelay ?? this.config.retryDelay,
      backoffFactor: retryOptions?.backoffFactor ?? this.config.backoffFactor,
      timeout: retryOptions?.timeout ?? this.config.timeout,
      retryableErrors: retryOptions?.retryableErrors,
    };

    if (!this.isRecoverable(error, opts)) {
      SafeLogger.logInfo(`Error ${errorId} is not recoverable, skipping recovery`, {
        category: error.category,
        code: error.code,
      });
      return {
        planId: errorId,
        success: false,
        executedActions: [],
        duration: 0,
      };
    }

    const plan = this.buildRecoveryPlan(errorId, error, opts);
    this.plans.set(errorId, plan);
    return this.executePlan(plan, opts);
  }

  private isRecoverable(error: AppError, opts: RetryOptions): boolean {
    if (!opts.retryableErrors || opts.retryableErrors.length === 0) {
      return error.severity !== ErrorSeverity.CRITICAL;
    }
    return opts.retryableErrors.some(r =>
      (!r.category || r.category === error.category) &&
      (!r.code || r.code === error.code)
    );
  }

  private buildRecoveryPlan(errorId: string, error: AppError, opts: RetryOptions): RecoveryPlan {
    const actions: RecoveryAction[] = [];

    actions.push({
      strategy: 'retry',
      description: `Retry operation (up to ${opts.maxRetries} times with backoff)`,
      execute: () => this.executeWithRetry(error, opts),
    });

    if (this.fallbackHandlers.size > 0) {
      actions.push({
        strategy: 'fallback',
        description: 'Execute fallback handler',
        execute: async () => {
          for (const [id, handler] of this.fallbackHandlers) {
            try {
              if (await handler(error)) {
                SafeLogger.logInfo(`Fallback handler ${id} succeeded`, { errorId });
                return true;
              }
            } catch (e) {
              SafeLogger.logInfo(`Fallback handler ${id} failed`, {
                errorId,
                handlerError: (e as Error).message,
              });
            }
          }
          return false;
        },
      });
    }

    if (this.compensationHandlers.size > 0) {
      actions.push({
        strategy: 'compensate',
        description: 'Execute compensation handler to mitigate impact',
        execute: async () => {
          for (const [id, handler] of this.compensationHandlers) {
            try {
              if (await handler(error)) {
                SafeLogger.logInfo(`Compensation handler ${id} executed`, { errorId });
                return true;
              }
            } catch (e) {
              SafeLogger.logInfo(`Compensation handler ${id} failed`, {
                errorId,
                handlerError: (e as Error).message,
              });
            }
          }
          return false;
        },
      });
    }

    return {
      errorId,
      error,
      actions,
      createdAt: Date.now(),
      status: 'pending',
    };
  }

  private async executePlan(plan: RecoveryPlan, opts: RetryOptions): Promise<RecoveryResult> {
    const startTime = Date.now();
    plan.status = 'in_progress';
    const executedActions: RecoveryResult['executedActions'] = [];

    for (const action of plan.actions) {
      const actionStart = Date.now();
      let success = false;
      try {
        success = await action.execute();
      } catch (e) {
        SafeLogger.logError(e as Error, { planId: plan.errorId, strategy: action.strategy });
      }

      const duration = Date.now() - actionStart;
      executedActions.push({ strategy: action.strategy, success, duration });

      if (success) {
        plan.status = 'succeeded';
        return {
          planId: plan.errorId,
          success: true,
          executedActions,
          duration: Date.now() - startTime,
        };
      }
    }

    plan.status = 'failed';
    return {
      planId: plan.errorId,
      success: false,
      executedActions,
      duration: Date.now() - startTime,
    };
  }

  private async executeWithRetry(error: AppError, opts: RetryOptions): Promise<boolean> {
    for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
      try {
        SafeLogger.logInfo(`Retry attempt ${attempt}/${opts.maxRetries}`, {
          category: error.category,
          code: error.code,
          delay: opts.retryDelay * Math.pow(opts.backoffFactor, attempt - 1),
        });
        return true;
      } catch (e) {
        SafeLogger.logInfo(`Retry attempt ${attempt} failed`, {
          error: (e as Error).message,
        });
        if (attempt < opts.maxRetries) {
          await this.delay(opts.retryDelay * Math.pow(opts.backoffFactor, attempt - 1));
        }
      }
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getPlan(errorId: string): RecoveryPlan | undefined {
    return this.plans.get(errorId);
  }

  getStats(): { totalPlans: number; succeeded: number; failed: number; pending: number } {
    const plans = [...this.plans.values()];
    return {
      totalPlans: plans.length,
      succeeded: plans.filter(p => p.status === 'succeeded').length,
      failed: plans.filter(p => p.status === 'failed').length,
      pending: plans.filter(p => p.status === 'pending' || p.status === 'in_progress').length,
    };
  }

  clear(): void {
    this.plans.clear();
  }
}

export const errorRecoverer = new ErrorRecoverer();
