/**
 * AutoCompactionPolicy — 分级压缩触发策略（Phase 3）
 * 对标 PilotDeck AutoCompactionPolicy + hermes-agent 反抖动
 *
 * 决策逻辑：
 *   < 85% → skip
 *   85%-92% → warn（建议 MicroCompact 或 Snip）
 *   > 92% → trigger（必须 Full Compaction）
 *
 * 反抖动：连续 2 次 Full Compaction 各节省 < 10% 则跳过本次
 *
 * === Phase 依赖 DAG ===
 *
 *   Phase 1 (安全)
 *   ├── AsyncContextStorage.resetStore
 *   ├── LifecycleManager.destroyAll
 *   └── context.rs py_free_string
 *        ↓
 *   Phase 1.5 (前置)
 *   ├── ContextErrorCode            ──── 被 Phase 2 所有模块引用
 *   └── ContextStore 驱逐策略
 *        ↓
 *   Phase 2 (基础)
 *   ├── TokenEstimator              ──── 关键路径：AutoCompactionPolicy 依赖
 *   ├── ContextPersistence          ──── 独立，可并行
 *   ├── ContextWindowResolver       ──── 依赖 TokenEstimator
 *   ├── ToolResultBudget            ──── 独立，可并行
 *   └── UsageExtractor              ──── 独立，可并行
 *        ↓
 *   Phase 3 (压缩)                  ──── 依赖 Phase 2 全部模块
 *   ├── MicroCompactionEngine
 *   ├── SnipEngine
 *   ├── toolPairIntegrity
 *   └── AutoCompactionPolicy        ← 本文件
 *        ↓
 *   Phase 4 (架构)
 *   ├── ContextInjector WeakMap
 *   ├── ContextManager DI
 *   ├── SummaryGenerator
 *   └── CostTracker/TokenBudget 迁移
 *        ↓
 *   Phase 5 (生态)
 *   ├── MemoryProvider + MemoryManager
 *   ├── CompactionHooks
 *   └── CompactionMetrics
 */
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import { resolveContextWindow } from '../window/ContextWindowResolver';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'context:compaction:policy',
  level: LogLevel.INFO,
});

export type CompactionDecision = 'skip' | 'warn' | 'trigger';

export interface AutoCompactionDecision {
  decision: CompactionDecision;
  snapshot: { tokens: number; maxTokens: number; ratio: number };
  reason?: string;
}

export class AutoCompactionPolicy {
  private warningRatio: number;
  private blockingRatio: number;
  private recentSavings: number[] = [];
  private maxRecentSavings: number;

  constructor(warningRatio = 0.85, blockingRatio = 0.92) {
    this.warningRatio = warningRatio;
    this.blockingRatio = blockingRatio;
    this.maxRecentSavings = 2; // 反抖动窗口
  }

  /**
   * 评估是否触发压缩
   * @param messages 当前消息列表
   * @param model 模型名（用于解析上下文窗口）
   */
  evaluate(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string,
    configOverride?: number
  ): AutoCompactionDecision {
    const tokens = estimateMessagesTokens(messages);
    const { tokens: maxTokens } = resolveContextWindow(model, configOverride);
    const ratio = maxTokens > 0 ? tokens / maxTokens : 0;

    const snapshot = { tokens, maxTokens, ratio };

    if (ratio < this.warningRatio) {
      return { decision: 'skip', snapshot };
    }

    if (ratio >= this.blockingRatio) {
      // 反抖动检查
      if (this.shouldSkipDueToAntiFlapping()) {
        return {
          decision: 'skip',
          snapshot,
          reason: `anti-flapping: last ${this.maxRecentSavings} compactions each saved < 10%`,
        };
      }

      logger.info('compaction:triggered', {
        tier: 3,
        reason: 'blocking threshold',
        beforeTokens: tokens,
        maxTokens,
        ratio,
      });

      return {
        decision: 'trigger',
        snapshot,
        reason: `token ratio ${(ratio * 100).toFixed(1)}% >= ${(this.blockingRatio * 100).toFixed(0)}%`,
      };
    }

    return {
      decision: 'warn',
      snapshot,
      reason: `token ratio ${(ratio * 100).toFixed(1)}% >= ${(this.warningRatio * 100).toFixed(0)}%`,
    };
  }

  /**
   * 记录压缩节省比例（用于反抖动）
   * @param savedPercent 节省百分比（0-100）
   */
  recordSaving(savedPercent: number): void {
    this.recentSavings.push(savedPercent);
    if (this.recentSavings.length > this.maxRecentSavings) {
      this.recentSavings.shift();
    }
  }

  /**
   * 反抖动：最近 N 次压缩各节省 < 10% 则跳过
   */
  private shouldSkipDueToAntiFlapping(): boolean {
    if (this.recentSavings.length < this.maxRecentSavings) return false;
    return this.recentSavings.every((s) => s < 10);
  }

  /** 重置反抖动状态 */
  reset(): void {
    this.recentSavings = [];
  }
}

/** 默认实例 */
export const autoCompactionPolicy = new AutoCompactionPolicy();
