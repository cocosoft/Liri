/**
 * SessionTokenTracker — 会话级别令牌追踪桥接器
 *
 * 职责：
 * 1. 桥接 session 系统与 services/tokenManagement/* 的令牌计数能力
 * 2. 将 API 调用的 TokenUsage 数据持久化到 SessionMetadata.tokenUsage
 * 3. 与 TokenBudgetManager 协作实现预算预警
 * 4. 与 CostMetricsBridge 协作实现成本追踪
 *
 * 不重复实现：令牌估算、预算管理、成本计算委托给现有模块
 */

import type { SessionMetadata } from './models/SessionMetadata';
import type { SessionTokenUsage } from './models/SessionTokenUsage';
import {
  createEmptyTokenUsage,
  accumulateTokenUsage,
} from './models/SessionTokenUsage';
import { Logger, LogLevel } from '@modules/monitoring';
import { globalEventBus, SystemEvents } from '../core/events/EventBus';
import type { CostRecordedEvent } from '../core/events/EventBus';

const logger = new Logger({
  module: 'session:tokenTracker',
  level: LogLevel.INFO,
});

export interface TokenUsageInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

export interface TrackerConfig {
  model: string;
  modelPricing?: {
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion?: number;
    cacheWritePerMillion?: number;
  };
}

export interface TokenBudgetAlert {
  status: 'normal' | 'warning' | 'critical' | 'exceeded';
  percentUsed: number;
  currentTokens: number;
  maxTokens: number;
  message: string;
}

export class SessionTokenTracker {
  private usages: Map<string, SessionTokenUsage> = new Map();
  private budgets: Map<string, TokenBudgetAlert> = new Map();
  /** P2-2.8 Phase 2: COST_RECORDED 订阅（被动接收 CostTracker 数据） */
  private costSubscribed = false;

  /**
   * P2-2.8 Phase 2: 订阅 COST_RECORDED 事件，被动同步 CostTracker 数据
   *
   * 消除独立追踪的冗余性，改为从 CostTracker（唯一写入点）被动订阅。
   */
  subscribeToCostEvents(): void {
    if (this.costSubscribed) return;
    this.costSubscribed = true;

    globalEventBus.subscribe(
      SystemEvents.COST_RECORDED,
      (event: CostRecordedEvent) => {
        const sessionId = event.sessionId || 'global';

        const delta: SessionTokenUsage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadInputTokens,
          cacheCreationTokens: event.cacheCreationInputTokens,
          reasoningTokens: 0,
          totalTokens: event.inputTokens + event.outputTokens,
          estimatedCostUsd: event.costUSD,
          costStatus: 'estimated',
          lastPromptTokens: event.inputTokens,
        };

        const existing = this.usages.get(sessionId) ?? createEmptyTokenUsage();
        const updated = accumulateTokenUsage(existing, delta);
        this.usages.set(sessionId, updated);
      }
    );

    logger.info(
      '[MIGRATION] SessionTokenTracker 已订阅 COST_RECORDED，实现被动数据同步'
    );
  }

  recordUsage(
    sessionId: string,
    input: TokenUsageInput,
    config?: TrackerConfig
  ): SessionTokenUsage {
    // P2-2.8: 迁移警告 — CostTracker 将成为唯一写入点，此方法后续仅通过 EventBus 被动订阅
    logger.warn(
      '[MIGRATION] SessionTokenTracker.recordUsage 将被迁移到 CostTracker.addCost 统一入口，见 ADR-001',
      { sessionId }
    );
    const totalTokens =
      input.inputTokens +
      input.outputTokens +
      (input.cacheReadInputTokens ?? 0) +
      (input.cacheCreationInputTokens ?? 0) +
      (input.reasoningTokens ?? 0);

    let estimatedCostUsd = 0;
    let costStatus: SessionTokenUsage['costStatus'] = 'unknown';

    if (config?.modelPricing) {
      const p = config.modelPricing;
      estimatedCostUsd =
        (input.inputTokens / 1_000_000) * p.inputPerMillion +
        (input.outputTokens / 1_000_000) * p.outputPerMillion +
        ((input.cacheReadInputTokens ?? 0) / 1_000_000) *
          (p.cacheReadPerMillion ?? p.inputPerMillion * 0.1) +
        ((input.cacheCreationInputTokens ?? 0) / 1_000_000) *
          (p.cacheWritePerMillion ?? p.inputPerMillion * 0.5);
      costStatus = 'estimated';
    }

    const delta: SessionTokenUsage = {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadInputTokens ?? 0,
      cacheCreationTokens: input.cacheCreationInputTokens ?? 0,
      reasoningTokens: input.reasoningTokens ?? 0,
      totalTokens,
      estimatedCostUsd,
      costStatus,
      lastPromptTokens: input.inputTokens + (input.cacheReadInputTokens ?? 0),
    };

    const existing = this.usages.get(sessionId) ?? createEmptyTokenUsage();
    const updated = accumulateTokenUsage(existing, delta);
    this.usages.set(sessionId, updated);

    logger.debug('Token usage recorded', {
      sessionId,
      model: config?.model ?? 'unknown',
      delta: delta.totalTokens,
      cumulative: updated.totalTokens,
    });

    return updated;
  }

  getUsage(sessionId: string): SessionTokenUsage | null {
    return this.usages.get(sessionId) ?? null;
  }

  getOrCreateUsage(sessionId: string): SessionTokenUsage {
    let usage = this.usages.get(sessionId);
    if (!usage) {
      usage = createEmptyTokenUsage();
      this.usages.set(sessionId, usage);
    }
    return usage;
  }

  applyUsageToMetadata(
    metadata: SessionMetadata,
    sessionId: string
  ): SessionMetadata {
    const usage = this.usages.get(sessionId);
    if (usage) {
      metadata.tokenUsage = { ...usage };
    }
    return metadata;
  }

  loadFromMetadata(metadata: SessionMetadata, sessionId: string): void {
    if (metadata.tokenUsage) {
      this.usages.set(sessionId, { ...metadata.tokenUsage });
      logger.debug('Token usage loaded from metadata', {
        sessionId,
        totalTokens: metadata.tokenUsage.totalTokens,
      });
    }
  }

  estimateBudgetAlert(
    sessionId: string,
    totalTokens: number,
    maxTokens: number
  ): TokenBudgetAlert {
    const percentUsed = maxTokens > 0 ? totalTokens / maxTokens : 0;

    let status: TokenBudgetAlert['status'];
    let message: string;

    if (percentUsed >= 1) {
      status = 'exceeded';
      message = `Token budget exceeded: ${totalTokens}/${maxTokens} (${Math.round(percentUsed * 100)}%)`;
    } else if (percentUsed >= 0.85) {
      status = 'critical';
      message = `Token budget critical: ${totalTokens}/${maxTokens} (${Math.round(percentUsed * 100)}%)`;
    } else if (percentUsed >= 0.7) {
      status = 'warning';
      message = `Token budget warning: ${totalTokens}/${maxTokens} (${Math.round(percentUsed * 100)}%)`;
    } else {
      status = 'normal';
      message = '';
    }

    const alert: TokenBudgetAlert = {
      status,
      percentUsed,
      currentTokens: totalTokens,
      maxTokens,
      message,
    };

    this.budgets.set(sessionId, alert);
    return alert;
  }

  getBudgetAlert(sessionId: string): TokenBudgetAlert | null {
    return this.budgets.get(sessionId) ?? null;
  }

  clearSession(sessionId: string): void {
    this.usages.delete(sessionId);
    this.budgets.delete(sessionId);
  }

  clearAll(): void {
    this.usages.clear();
    this.budgets.clear();
  }

  getSessionIds(): string[] {
    return Array.from(this.usages.keys());
  }

  get totalTrackedSessions(): number {
    return this.usages.size;
  }

  get totalTokensAccumulated(): number {
    let total = 0;
    for (const usage of this.usages.values()) {
      total += usage.totalTokens;
    }
    return total;
  }

  get totalCostAccumulated(): number {
    let total = 0;
    for (const usage of this.usages.values()) {
      total += usage.estimatedCostUsd;
    }
    return total;
  }

  static calculateCost(
    inputTokens: number,
    outputTokens: number,
    pricing: NonNullable<TrackerConfig['modelPricing']>
  ): number {
    return (
      (inputTokens / 1_000_000) * pricing.inputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion
    );
  }
}
