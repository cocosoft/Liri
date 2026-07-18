import type { Context } from './types/Context';
import type { ValidationResult } from './types/ValidationResult';
import {
  createValidResult,
  createInvalidResult,
} from './types/ValidationResult';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'context\ContextInjector', level: LogLevel.INFO });

export interface IContextInjector {
  inject(context: Context, target: unknown): Promise<void>;
  extract(target: unknown): Promise<Context | null>;
  validateInjection(context: Context, target: unknown): ValidationResult;
}

interface InjectionTarget {
  __context__?: Record<string, Context>;
}

export class ContextInjector implements IContextInjector {
  async inject(context: Context, target: unknown): Promise<void> {
    const validation = this.validateInjection(context, target);
    if (!validation.valid) {
      throw new AppError(
        `Injection validation failed: ${validation.errors.join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (target && typeof target === 'object') {
      const injectionTarget = target as InjectionTarget;
      if (!injectionTarget.__context__) {
        injectionTarget.__context__ = {};
      }
      injectionTarget.__context__[context.type] = context;
    }
  }

  async extract(target: unknown): Promise<Context | null> {
    if (!target || typeof target !== 'object') {
      return null;
    }

    const injectionTarget = target as InjectionTarget;
    if (!injectionTarget.__context__) {
      return null;
    }

    const types = Object.keys(injectionTarget.__context__);
    if (types.length === 0) {
      return null;
    }

    return injectionTarget.__context__[types[0]] || null;
  }

  validateInjection(context: Context, target: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!context) {
      errors.push('Context is required for injection');
    }

    if (!target) {
      errors.push('Target is required for injection');
    }

    if (context && !context.type) {
      errors.push('Context must have a type');
    }

    return errors.length > 0
      ? createInvalidResult(errors, warnings)
      : createValidResult();
  }
}

export const contextInjector = new ContextInjector();
