/**
 * HookChain — 三段式 Hook 执行链
 *
 * 统一 before / after / onError 三段式 Hook 机制。
 * 用于替代 HookManager、ChatHookExecutor、Plugin hooks 三种实现。
 *
 * 用法:
 * ```
 * const chain = new HookChain('chat');
 * chain.before('validate', async (ctx) => { ... });
 * chain.after('log', async (ctx) => { ... });
 * chain.onError('report', async (ctx) => { ... });
 * await chain.execute({ event: 'sendMessage', sessionId: 's1' });
 * ```
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * Hook 上下文
 */
export interface HookContext {
  event: string;
  sessionId?: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * Hook 执行结果
 */
export interface HookResult {
  success: boolean;
  data?: unknown;
  error?: string;
  preventContinuation?: boolean;
}

/**
 * Hook 处理函数
 */
export type HookHandler = (context: HookContext) => Promise<HookResult>;

/**
 * Hook 注册项
 */
interface HookEntry {
  name: string;
  handler: HookHandler;
  priority: number;
  enabled: boolean;
}

/**
 * 三段式 HookChain
 *
 * 每个 execute 调用依次执行三个阶段:
 *   1. before — 执行前修改/校验
 *   2. after  — 执行后处理/记录
 *   3. onError — 异常时处理（仅当前序阶段抛出异常时执行）
 */
export class HookChain {
  private beforeHooks: HookEntry[] = [];
  private afterHooks: HookEntry[] = [];
  private onErrorHooks: HookEntry[] = [];

  constructor(readonly domain: string) {}

  /**
   * 注册 before hook
   */
  before(name: string, handler: HookHandler, priority: number = 10): void {
    this.beforeHooks.push({ name, handler, priority, enabled: true });
    this.beforeHooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 注册 after hook
   */
  after(name: string, handler: HookHandler, priority: number = 10): void {
    this.afterHooks.push({ name, handler, priority, enabled: true });
    this.afterHooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 注册 onError hook
   */
  onError(name: string, handler: HookHandler, priority: number = 10): void {
    this.onErrorHooks.push({ name, handler, priority, enabled: true });
    this.onErrorHooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 执行三段式 Hook 链
   *
   * 顺序: before → after，若 before/after 抛出异常则执行 onError。
   * before 中的 preventContinuation 会跳过 after 阶段。
   */
  async execute(context: HookContext): Promise<{
    before: HookResult[];
    after: HookResult[];
    error?: Error;
  }> {
    const beforeResults: HookResult[] = [];
    const afterResults: HookResult[] = [];

    try {
      for (const hook of this.beforeHooks) {
        if (!hook.enabled) continue;
        const result = await hook.handler(context);
        beforeResults.push(result);
        if (result.preventContinuation) {
          return { before: beforeResults, after: [] };
        }
      }

      for (const hook of this.afterHooks) {
        if (!hook.enabled) continue;
        const result = await hook.handler(context);
        afterResults.push(result);
      }

      return { before: beforeResults, after: afterResults };
    } catch (error) {
      const errorCtx: HookContext = {
        ...context,
        event: `${context.event}.error`,
        data: { originalError: error, originalContext: context },
      };

      for (const hook of this.onErrorHooks) {
        if (!hook.enabled) continue;
        try {
          await hook.handler(errorCtx);
        } catch {
          // onError hook 自身不得抛出异常
        }
      }

      return {
        before: beforeResults,
        after: afterResults,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * 注册并立即执行一个 hook 链（便捷方法）
   */
  async run(
    context: HookContext,
    hooks: {
      before?: Array<{ name: string; handler: HookHandler; priority?: number }>;
      after?: Array<{ name: string; handler: HookHandler; priority?: number }>;
      onError?: Array<{ name: string; handler: HookHandler; priority?: number }>;
    }
  ): Promise<{
    before: HookResult[];
    after: HookResult[];
    error?: Error;
  }> {
    if (hooks.before) {
      for (const h of hooks.before) {
        this.before(h.name, h.handler, h.priority);
      }
    }
    if (hooks.after) {
      for (const h of hooks.after) {
        this.after(h.name, h.handler, h.priority);
      }
    }
    if (hooks.onError) {
      for (const h of hooks.onError) {
        this.onError(h.name, h.handler, h.priority);
      }
    }
    return this.execute(context);
  }

  /**
   * 启用指定 hook
   */
  enable(name: string): void {
    for (const list of [this.beforeHooks, this.afterHooks, this.onErrorHooks]) {
      const entry = list.find((h) => h.name === name);
      if (entry) entry.enabled = true;
    }
  }

  /**
   * 禁用指定 hook
   */
  disable(name: string): void {
    for (const list of [this.beforeHooks, this.afterHooks, this.onErrorHooks]) {
      const entry = list.find((h) => h.name === name);
      if (entry) entry.enabled = false;
    }
  }

  /**
   * 清空所有 hooks
   */
  clear(): void {
    this.beforeHooks = [];
    this.afterHooks = [];
    this.onErrorHooks = [];
  }

  /**
   * 获取各阶段 hook 数量
   */
  stats(): { before: number; after: number; onError: number } {
    return {
      before: this.beforeHooks.length,
      after: this.afterHooks.length,
      onError: this.onErrorHooks.length,
    };
  }
}
