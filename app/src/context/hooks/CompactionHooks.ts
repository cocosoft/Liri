/**
 * CompactionHooks — 压缩生命周期钩子（Phase 5）
 * 对标 openclaw compaction-hooks.ts
 *
 * Hook 点：
 *   onBeforeCompact — 压缩前（可修改压缩输入）
 *   onAfterCompact  — 压缩后（可记录指标/触发副作用）
 *   onTierTrigger   — 每级压缩触发时
 *
 * 超时保护：所有 hook 调用有 3 秒超时，不阻塞主压缩流程
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'context:compaction:hooks',
  level: LogLevel.INFO,
});

const HOOK_TIMEOUT_MS = 3000;

export interface CompactionInput {
  tier: 1 | 2 | 3;
  trigger: string;
  messages: unknown[];
  beforeTokens: number;
  maxTokens: number;
  sessionId?: string;
}

export interface CompactionResult {
  tier: 1 | 2 | 3;
  afterTokens: number;
  savingPercent: number;
  durationMs: number;
}

export interface CompactionHooks {
  /** 压缩前回调（可修改输入） */
  onBeforeCompact?(input: CompactionInput): Promise<void>;
  /** 压缩后回调 */
  onAfterCompact?(result: CompactionResult): Promise<void>;
  /** 每级触发时回调 */
  onTierTrigger?(
    tier: 1 | 2 | 3,
    reason: string,
    beforeTokens: number
  ): Promise<void>;
}

export interface LifecycleHooks {
  onSessionStart?(sessionId: string): Promise<void>;
  onSessionEnd?(sessionId: string, messages: unknown[]): Promise<void>;
  onSessionReset?(): Promise<void>;
}

/**
 * 注册压缩钩子
 */
class HookRegistry {
  private compactionHooks: CompactionHooks[] = [];
  private lifecycleHooks: LifecycleHooks[] = [];

  registerCompactionHooks(hooks: CompactionHooks): void {
    this.compactionHooks.push(hooks);
  }

  registerLifecycleHooks(hooks: LifecycleHooks): void {
    this.lifecycleHooks.push(hooks);
  }

  /** 安全执行（超时保护 3 秒） */
  private async safeExec(fn: () => Promise<void>, name: string): Promise<void> {
    try {
      await Promise.race([
        fn(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), HOOK_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      await handleError(err, {
        module: 'context:compaction:hooks',
        action: name,
      });
    }
  }

  async runBeforeCompact(input: CompactionInput): Promise<void> {
    for (const h of this.compactionHooks) {
      if (h.onBeforeCompact) {
        await this.safeExec(() => h.onBeforeCompact!(input), 'onBeforeCompact');
      }
    }
  }

  async runAfterCompact(result: CompactionResult): Promise<void> {
    for (const h of this.compactionHooks) {
      if (h.onAfterCompact) {
        await this.safeExec(() => h.onAfterCompact!(result), 'onAfterCompact');
      }
    }
  }

  async runTierTrigger(
    tier: 1 | 2 | 3,
    reason: string,
    beforeTokens: number
  ): Promise<void> {
    for (const h of this.compactionHooks) {
      if (h.onTierTrigger) {
        await this.safeExec(
          () => h.onTierTrigger!(tier, reason, beforeTokens),
          'onTierTrigger'
        );
      }
    }
  }

  async runSessionStart(sessionId: string): Promise<void> {
    for (const h of this.lifecycleHooks) {
      if (h.onSessionStart) {
        await this.safeExec(
          () => h.onSessionStart!(sessionId),
          'onSessionStart'
        );
      }
    }
  }

  async runSessionEnd(sessionId: string, messages: unknown[]): Promise<void> {
    for (const h of this.lifecycleHooks) {
      if (h.onSessionEnd) {
        await this.safeExec(
          () => h.onSessionEnd!(sessionId, messages),
          'onSessionEnd'
        );
      }
    }
  }

  async runSessionReset(): Promise<void> {
    for (const h of this.lifecycleHooks) {
      if (h.onSessionReset) {
        await this.safeExec(() => h.onSessionReset!(), 'onSessionReset');
      }
    }
  }
}

export const hookRegistry = new HookRegistry();
