// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Agent Harness
 * 对标OpenClaw agents/harness/
 * v2 循环/注册表/生命周期/hooks 子系统
 */

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'agent:harness:index', level: LogLevel.INFO });

export type HookName =
  | 'beforeInit'
  | 'afterInit'
  | 'beforeRun'
  | 'afterRun'
  | 'beforeStep'
  | 'afterStep'
  | 'onError'
  | 'onComplete'
  | 'onAbort'
  | 'beforeToolUse'
  | 'afterToolUse'
  | 'onStateChange';

export type LifecycleStage =
  | 'created'
  | 'initializing'
  | 'initialized'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface HookContext {
  agentId: string;
  stage: LifecycleStage;
  payload?: Record<string, unknown>;
  startTime: number;
  error?: Error;
}

export type HookFn = (ctx: HookContext) => Promise<void> | void;

export interface HarnessConfig {
  agentId: string;
  maxRetries?: number;
  timeout?: number;
  autoInit?: boolean;
}

export interface HarnessStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDuration: number;
  lastRunAt?: number;
  errors: Array<{ stage: LifecycleStage; error: string; timestamp: number }>;
}

export interface HarnessRegistryEntry {
  name: string;
  version: string;
  description: string;
  createdAt: number;
  hooks: Record<HookName, HookFn[]>;
}

export class HarnessRegistry {
  private entries = new Map<string, HarnessRegistryEntry>();

  register(
    name: string,
    entry: Omit<HarnessRegistryEntry, 'createdAt' | 'hooks'>
  ): void {
    this.entries.set(name, {
      ...entry,
      createdAt: Date.now(),
      hooks: {} as Record<HookName, HookFn[]>,
    });
  }

  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  get(name: string): HarnessRegistryEntry | undefined {
    return this.entries.get(name);
  }

  list(filter?: { version?: string }): HarnessRegistryEntry[] {
    let result = Array.from(this.entries.values());
    if (filter?.version) {
      result = result.filter((e) => e.version === filter.version);
    }
    return result;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  getCount(): number {
    return this.entries.size;
  }
}

export class AgentHarness {
  private hooks = new Map<HookName, HookFn[]>();
  private stage: LifecycleStage = 'created';
  private config: Required<HarnessConfig>;
  private stats: HarnessStats;
  private registry: HarnessRegistry;

  constructor(config: HarnessConfig, registry: HarnessRegistry) {
    this.config = {
      agentId: config.agentId,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 30000,
      autoInit: config.autoInit ?? true,
    };

    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      avgDuration: 0,
      errors: [],
    };

    this.registry = registry;
  }

  on(hook: HookName, fn: HookFn): void {
    const existing = this.hooks.get(hook) ?? [];
    existing.push(fn);
    this.hooks.set(hook, existing);
  }

  off(hook: HookName, fn: HookFn): void {
    const existing = this.hooks.get(hook) ?? [];
    this.hooks.set(
      hook,
      existing.filter((f) => f !== fn)
    );
  }

  getHooks(hook: HookName): HookFn[] {
    return this.hooks.get(hook) ?? [];
  }

  clearHooks(hook?: HookName): void {
    if (hook) {
      this.hooks.delete(hook);
    } else {
      this.hooks.clear();
    }
  }

  async run(hookCtx?: Partial<HookContext>): Promise<void> {
    const ctx: HookContext = {
      agentId: this.config.agentId,
      stage: this.stage,
      startTime: Date.now(),
      ...hookCtx,
    };

    this.stats.totalRuns++;

    try {
      await this.transitionTo('initializing', ctx);

      await this.executeHooks('beforeInit', ctx);
      await this.initialize(ctx);
      await this.executeHooks('afterInit', ctx);

      await this.transitionTo('running', ctx);

      await this.executeHooks('beforeRun', ctx);
      await this.mainLoop(ctx);
      await this.executeHooks('afterRun', ctx);

      await this.transitionTo('completed', ctx);
      await this.executeHooks('onComplete', ctx);

      this.stats.successfulRuns++;
    } catch (error) {
      ctx.error = error instanceof Error ? error : new Error(String(error));

      await this.transitionTo('failed', ctx);
      await this.executeHooks('onError', ctx);

      this.stats.failedRuns++;
      this.stats.errors.push({
        stage: this.stage,
        error: ctx.error.message,
        timestamp: Date.now(),
      });
    }

    this.updateAvgDuration(Date.now() - ctx.startTime);
  }

  getStage(): LifecycleStage {
    return this.stage;
  }

  getStats(): HarnessStats {
    return { ...this.stats };
  }

  getConfig(): Readonly<Required<HarnessConfig>> {
    return { ...this.config };
  }

  async abort(): Promise<void> {
    if (this.stage === 'running' || this.stage === 'initializing') {
      await this.transitionTo('aborted', {
        agentId: this.config.agentId,
        stage: this.stage,
        startTime: Date.now(),
      });
      await this.executeHooks('onAbort', {
        agentId: this.config.agentId,
        stage: this.stage,
        startTime: Date.now(),
      });
    }
  }

  private async initialize(ctx: HookContext): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private async mainLoop(_ctx: HookContext): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private async transitionTo(
    stage: LifecycleStage,
    ctx: HookContext
  ): Promise<void> {
    this.stage = stage;
    ctx.stage = stage;

    const hookMap: Record<LifecycleStage, HookName> = {
      initializing: 'onStateChange',
      initialized: 'onStateChange',
      running: 'onStateChange',
      paused: 'onStateChange',
      completed: 'onStateChange',
      failed: 'onStateChange',
      aborted: 'onStateChange',
      created: 'onStateChange',
    };

    const hookName = hookMap[stage];
    if (hookName) {
      await this.executeHooks(hookName, ctx);
    }
  }

  private async executeHooks(hook: HookName, ctx: HookContext): Promise<void> {
    const fns = this.hooks.get(hook) ?? [];

    for (const fn of fns) {
      await fn(ctx);
    }
  }

  private updateAvgDuration(duration: number): void {
    const total = this.stats.successfulRuns + this.stats.failedRuns;
    this.stats.avgDuration =
      total > 1
        ? (this.stats.avgDuration * (total - 1) + duration) / total
        : duration;
  }
}

export function createHarness(
  agentId: string,
  registry?: HarnessRegistry
): { harness: AgentHarness; registry: HarnessRegistry } {
  const r = registry ?? new HarnessRegistry();
  const harness = new AgentHarness({ agentId }, r);
  return { harness, registry: r };
}
