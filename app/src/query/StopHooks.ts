/**
 * @owner chat/ChatManager（自 2026-07-13，原属于 query/TAORLoop）
 *
 * 停止钩子系统（参考CC源码 query/stopHooks.ts）
 * 在查询停止时执行自定义钩子函数
 * 支持同步和异步钩子，支持优先级排序
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'query:stopHooks' });

export type StopHookReason =
  | 'completed'
  | 'aborted'
  | 'error'
  | 'timeout'
  | 'max_turns'
  | 'diminishing_returns'
  | 'budget_exhausted'
  | 'verifier_escalate';

export interface StopHookContext {
  sessionId: string;
  reason: StopHookReason;
  turnCount: number;
  durationMs: number;
  error?: Error;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Phase 2: 追问检测标记（由 needs_follow_up 钩子设置） */
  _needsFollowUp?: boolean;
}

export interface StopHook {
  name: string;
  priority: number;
  hook: (context: StopHookContext) => void | Promise<void>;
}

export class StopHookManager {
  private hooks: StopHook[] = [];
  private executing = false;

  registerHook(hook: StopHook): void {
    const existingIndex = this.hooks.findIndex((h) => h.name === hook.name);
    if (existingIndex >= 0) {
      this.hooks[existingIndex] = hook;
    } else {
      this.hooks.push(hook);
      this.hooks.sort((a, b) => b.priority - a.priority);
    }
  }

  unregisterHook(name: string): boolean {
    const initialLength = this.hooks.length;
    this.hooks = this.hooks.filter((h) => h.name !== name);
    return this.hooks.length < initialLength;
  }

  hasHook(name: string): boolean {
    return this.hooks.some((h) => h.name === name);
  }

  getHooks(): StopHook[] {
    return [...this.hooks];
  }

  async executeHooks(context: StopHookContext): Promise<void> {
    if (this.executing) {
      return;
    }
    this.executing = true;

    try {
      for (const hook of this.hooks) {
        try {
          await hook.hook(context);
        } catch (error) {
          await handleError(error, {
            module: 'query:stopHooks',
            action: '执行停止钩子',
          });
        }
      }
    } finally {
      this.executing = false;
    }
  }

  clearHooks(): void {
    this.hooks = [];
  }
}

export function createStopHookManager(): StopHookManager {
  return new StopHookManager();
}

export const DEFAULT_STOP_HOOK_PRIORITIES = {
  HIGH: 100,
  MEDIUM: 50,
  LOW: 10,
} as const;
