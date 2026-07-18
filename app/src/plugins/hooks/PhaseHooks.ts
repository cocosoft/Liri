/**
 * PhaseHooks 阶段钩子管理器
 * 对标 OpenClaw 的 phase-hooks/，在特定执行阶段插入钩子
 */
import { EventEmitter } from 'events';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'plugins:hooks:PhaseHooks', level: LogLevel.INFO });

/**
 * 阶段名称
 */
export type PhaseName =
  | 'phase:init'
  | 'phase:configLoad'
  | 'phase:pluginDiscovery'
  | 'phase:pluginLoad'
  | 'phase:pluginActivate'
  | 'phase:pluginDeactivate'
  | 'phase:commandDispatch'
  | 'phase:toolExecute'
  | 'phase:sessionHandle'
  | 'phase:messageProcess'
  | 'phase:shutdown';

/**
 * 阶段钩子上下文
 */
export interface PhaseHookContext {
  phase: PhaseName;
  timestamp: number;
  data?: Record<string, unknown>;
  elapsed?: number;
}

/**
 * 阶段钩子函数
 */
export type PhaseHookFunction = (
  context: PhaseHookContext
) => Promise<PhaseHookResult> | PhaseHookResult;

/**
 * 阶段钩子结果
 */
export interface PhaseHookResult {
  continue: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * 阶段钩子注册信息
 */
export interface PhaseHookRegistration {
  id: string;
  phase: PhaseName;
  name: string;
  priority: number;
  fn: PhaseHookFunction;
  description?: string;
}

/**
 * 阶段钩子执行记录
 */
export interface PhaseExecutionRecord {
  phase: PhaseName;
  hookId: string;
  hookName: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * 阶段钩子管理器
 */
export class PhaseHooks extends EventEmitter {
  private hooks: Map<PhaseName, PhaseHookRegistration[]> = new Map();
  private executionHistory: PhaseExecutionRecord[] = [];
  private counter: number = 0;
  private maxHistory: number = 500;

  /**
   * 注册阶段钩子
   */
  register(
    phase: PhaseName,
    name: string,
    fn: PhaseHookFunction,
    options?: { priority?: number; description?: string }
  ): string {
    const id = `phase_hook_${++this.counter}`;
    const registration: PhaseHookRegistration = {
      id,
      phase,
      name,
      priority: options?.priority ?? 100,
      fn,
      description: options?.description,
    };

    const existing = this.hooks.get(phase) || [];
    existing.push(registration);
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(phase, existing);

    return id;
  }

  /**
   * 注销钩子
   */
  unregister(id: string): boolean {
    for (const [phase, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex((h) => h.id === id);

      if (index !== -1) {
        hooks.splice(index, 1);

        if (hooks.length === 0) {
          this.hooks.delete(phase);
        }

        return true;
      }
    }

    return false;
  }

  /**
   * 执行阶段钩子
   */
  async execute(
    phase: PhaseName,
    data?: Record<string, unknown>
  ): Promise<PhaseHookResult[]> {
    const hooks = this.hooks.get(phase);

    if (!hooks || hooks.length === 0) {
      return [{ continue: true }];
    }

    const results: PhaseHookResult[] = [];
    const phaseStartTime = Date.now();

    this.emit('phase:before', { phase, timestamp: phaseStartTime });

    for (const hook of hooks) {
      const hookStartTime = Date.now();
      const context: PhaseHookContext = {
        phase,
        timestamp: hookStartTime,
        data,
        elapsed: hookStartTime - phaseStartTime,
      };

      try {
        const result = await hook.fn(context);

        results.push(result);

        const record: PhaseExecutionRecord = {
          phase,
          hookId: hook.id,
          hookName: hook.name,
          startedAt: hookStartTime,
          durationMs: Date.now() - hookStartTime,
          success: !result.error,
          error: result.error,
        };

        this.executionHistory.push(record);

        if (this.executionHistory.length > this.maxHistory) {
          this.executionHistory.shift();
        }

        if (!result.continue) {
          break;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        results.push({ continue: false, error: errorMessage });

        const record: PhaseExecutionRecord = {
          phase,
          hookId: hook.id,
          hookName: hook.name,
          startedAt: hookStartTime,
          durationMs: Date.now() - hookStartTime,
          success: false,
          error: errorMessage,
        };

        this.executionHistory.push(record);
      }
    }

    this.emit('phase:after', { phase, timestamp: Date.now(), results });

    return results;
  }

  /**
   * 获取指定阶段的钩子
   */
  getHooks(phase?: PhaseName): PhaseHookRegistration[] {
    if (phase) {
      return this.hooks.get(phase) || [];
    }

    const all: PhaseHookRegistration[] = [];

    for (const hooks of this.hooks.values()) {
      all.push(...hooks);
    }

    return all;
  }

  /**
   * 获取执行记录
   */
  getExecutionHistory(
    phase?: PhaseName,
    limit?: number
  ): PhaseExecutionRecord[] {
    let records = this.executionHistory;

    if (phase) {
      records = records.filter((r) => r.phase === phase);
    }

    if (limit && limit > 0) {
      records = records.slice(-limit);
    }

    return records;
  }

  /**
   * 清除所有阶段钩子
   */
  clear(): void {
    this.hooks.clear();
    this.executionHistory = [];
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    byPhase: Record<string, number>;
    totalExecutions: number;
  } {
    const byPhase: Record<string, number> = {};

    for (const [phase, hooks] of this.hooks.entries()) {
      byPhase[phase] = hooks.length;
    }

    return {
      total: Array.from(this.hooks.values()).reduce(
        (sum, h) => sum + h.length,
        0
      ),
      byPhase,
      totalExecutions: this.executionHistory.length,
    };
  }
}

export const phaseHooks = new PhaseHooks();
