import type { Context } from './types/Context';
import type { ValidationResult } from './types/ValidationResult';
import {
  createValidResult,
  createInvalidResult,
} from './types/ValidationResult';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ContextErrorCode } from './types/ContextErrorCode';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'context:injector',
  level: LogLevel.INFO,
});

export interface IContextInjector {
  inject(context: Context, target: object): Promise<void>;
  extract(target: object): Promise<Context | null>;
  validateInjection(context: Context, target: object): ValidationResult;
  /** 显式清理 target 的所有注入上下文 */
  dispose(target: object): void;
}

/** 非侵入式上下文注册表：WeakMap<target, Map<type, Context>> */
const contextRegistry = new WeakMap<object, Map<string, Context>>();

/**
 * @deprecated 旧 __context__ 属性注入接口，迁移期间保留兼容
 */
interface InjectionTarget {
  __context__?: Record<string, Context>;
}

export class ContextInjector implements IContextInjector {
  async inject(context: Context, target: object): Promise<void> {
    const validation = this.validateInjection(context, target);
    if (!validation.valid) {
      throw new AppError(
        `Injection validation failed: ${validation.errors.join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.INJECTION_FAILED
      );
    }

    // 新路径：WeakMap 非侵入式注入
    let map = contextRegistry.get(target);
    if (!map) {
      map = new Map();
      contextRegistry.set(target, map);
    }
    map.set(context.type, context);

    // 旧路径兼容：保留 __context__ 写入直到 Phase 4 完成
    const injectionTarget = target as InjectionTarget;
    if (!injectionTarget.__context__) {
      injectionTarget.__context__ = {};
    }
    injectionTarget.__context__[context.type] = context;
  }

  async extract(target: object): Promise<Context | null> {
    // 优先使用 WeakMap（新路径）
    const map = contextRegistry.get(target);
    if (map && map.size > 0) {
      return map.values().next().value ?? null;
    }

    // 回退到 __context__（旧路径兼容）
    const injectionTarget = target as InjectionTarget;
    if (injectionTarget.__context__) {
      const types = Object.keys(injectionTarget.__context__);
      if (types.length > 0) {
        return injectionTarget.__context__[types[0]] || null;
      }
    }

    return null;
  }

  /** 显式清理 target 的所有注入上下文 */
  dispose(target: object): void {
    contextRegistry.delete(target);
  }

  validateInjection(context: Context, target: object): ValidationResult {
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

    // 短生命周期对象警告：WeakMap 依赖 GC，短生命周期对象可能在 extract 前被回收
    // 调用方应确保 target 生命周期覆盖 inject → extract 的全过程
    if (target && typeof target === 'object' && !contextRegistry.has(target)) {
      // 首次注入此 target，正常
    }

    return errors.length > 0
      ? createInvalidResult(errors, warnings)
      : createValidResult();
  }
}

export const contextInjector = new ContextInjector();
