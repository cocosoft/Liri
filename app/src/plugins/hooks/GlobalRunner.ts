/**
 * GlobalRunner 全局钩子运行器
 * 对标 OpenClaw 的 global-runner/，在所有操作前/后执行全局注册的钩子
 */
import { EventEmitter } from 'events';
import {
  pluginHooks,
  type HookType,
  type HookStage,
  type HookResult,
} from './PluginHooks.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:hooks:GlobalRunner',
  level: LogLevel.INFO,
});

/**
 * 全局运行策略
 */
export type GlobalRunnerStrategy = 'sequential' | 'parallel' | 'race';

/**
 * 全局钩子过滤器
 */
export interface GlobalHookFilter {
  types?: HookType[];
  stages?: HookStage[];
  pluginNames?: string[];
}

/**
 * 全局运行结果
 */
export interface GlobalRunResult {
  success: boolean;
  results: HookResult[];
  durationMs: number;
  errorCount: number;
}

/**
 * 全局钩子运行器
 */
export class GlobalRunner extends EventEmitter {
  private enabled: boolean = true;
  private strategy: GlobalRunnerStrategy = 'sequential';

  /**
   * 设置运行策略
   */
  setStrategy(strategy: GlobalRunnerStrategy): void {
    this.strategy = strategy;
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 全局运行所有匹配的钩子
   */
  async run(
    type: HookType,
    stage: HookStage,
    data?: Record<string, unknown>
  ): Promise<GlobalRunResult> {
    if (!this.enabled) {
      return { success: true, results: [], durationMs: 0, errorCount: 0 };
    }

    const startTime = Date.now();

    this.emit('global:before', { type, stage, timestamp: startTime });

    const hooks = pluginHooks.getHooks(type).filter((h) => h.stage === stage);

    if (hooks.length === 0) {
      return { success: true, results: [], durationMs: 0, errorCount: 0 };
    }

    let results: HookResult[] = [];

    switch (this.strategy) {
      case 'sequential':
        results = await this.runSequential(hooks, type, stage, data);
        break;

      case 'parallel':
        results = await this.runParallel(hooks, type, stage, data);
        break;

      case 'race':
        results = await this.runRace(hooks, type, stage, data);
        break;
    }

    const errorCount = results.filter((r) => r.error !== undefined).length;

    const runResult: GlobalRunResult = {
      success: errorCount === 0,
      results,
      durationMs: Date.now() - startTime,
      errorCount,
    };

    this.emit('global:after', { type, stage, result: runResult });

    return runResult;
  }

  /**
   * 顺序执行
   */
  private async runSequential(
    hooks: Array<{
      pluginName: string;
      fn: (context: {
        type: HookType;
        stage: HookStage;
        pluginName?: string;
        timestamp: number;
        data?: Record<string, unknown>;
      }) => Promise<HookResult> | HookResult;
    }>,
    type: HookType,
    stage: HookStage,
    data?: Record<string, unknown>
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of hooks) {
      try {
        const result = await hook.fn({
          type,
          stage,
          pluginName: hook.pluginName,
          timestamp: Date.now(),
          data,
        });

        results.push(result);

        if (!result.continue) {
          break;
        }
      } catch (err) {
        results.push({
          continue: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * 并行执行
   */
  private async runParallel(
    hooks: Array<{
      pluginName: string;
      fn: (context: {
        type: HookType;
        stage: HookStage;
        pluginName?: string;
        timestamp: number;
        data?: Record<string, unknown>;
      }) => Promise<HookResult> | HookResult;
    }>,
    type: HookType,
    stage: HookStage,
    data?: Record<string, unknown>
  ): Promise<HookResult[]> {
    const promises = hooks.map((hook) =>
      (async () => {
        try {
          return await hook.fn({
            type,
            stage,
            pluginName: hook.pluginName,
            timestamp: Date.now(),
            data,
          });
        } catch (err) {
          return {
            continue: false,
            error: err instanceof Error ? err.message : String(err),
          } as HookResult;
        }
      })()
    );

    return Promise.all(promises);
  }

  /**
   * 竞速执行
   */
  private async runRace(
    hooks: Array<{
      pluginName: string;
      fn: (context: {
        type: HookType;
        stage: HookStage;
        pluginName?: string;
        timestamp: number;
        data?: Record<string, unknown>;
      }) => Promise<HookResult> | HookResult;
    }>,
    type: HookType,
    stage: HookStage,
    data?: Record<string, unknown>
  ): Promise<HookResult[]> {
    const promises = hooks.map((hook) =>
      (async () => {
        try {
          return await hook.fn({
            type,
            stage,
            pluginName: hook.pluginName,
            timestamp: Date.now(),
            data,
          });
        } catch (err) {
          return {
            continue: false,
            error: err instanceof Error ? err.message : String(err),
          } as HookResult;
        }
      })()
    );

    const result = await Promise.race(promises);

    return [result];
  }

  /**
   * 获取状态
   */
  getStatus(): { enabled: boolean; strategy: GlobalRunnerStrategy } {
    return { enabled: this.enabled, strategy: this.strategy };
  }
}

export const globalRunner = new GlobalRunner();
