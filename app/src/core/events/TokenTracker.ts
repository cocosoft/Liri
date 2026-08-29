/**
 * Token 成本追踪器
 *
 * 挂在 globalEventBus 上作为中间件，订阅 TOKEN_USAGE 事件，
 * 按 session 累计 token 消耗，提供预算控制能力。
 *
 * 用法：
 *   1. 实例化 TokenTracker
 *   2. 调用 startTracking() 订阅 globalEventBus
 *   3. LLM 调用完成后调用 recordUsage(sessionId, tokens)
 *   4. 调用 isOverBudget(sessionId) 检查是否超预算
 */

import { OrchestrationEventType } from '@modules/agent';
import {
  globalEventBus,
  type EventSubscription,
  SystemEvents,
} from './EventBus';
import type { CostRecordedEvent } from './EventBus';
import { createLogger, LogLevel } from '@modules/monitoring';

const logger = createLogger({
  module: 'core:events:TokenTracker',
  level: LogLevel.WARN,
});

/** Token 使用量上报 payload */
export interface TokenUsagePayload {
  /** 会话 ID */
  sessionId: string;
  /** 累计总 token 数 */
  totalTokens: number;
  /** 剩余预算 */
  budgetRemaining: number;
  /** 明细（可选） */
  breakdown?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** 默认每 session 最大 token 预算 */
const DEFAULT_MAX_TOKENS_PER_SESSION = 100_000;

/**
 * Token 成本追踪器
 */
export class TokenTracker {
  /** sessionId → 累计 token 数 */
  private sessionTokens: Map<string, number> = new Map();
  /** sessionId → 输入 token 累计 */
  private inputTokens: Map<string, number> = new Map();
  /** sessionId → 输出 token 累计 */
  private outputTokens: Map<string, number> = new Map();
  /** 每 session 预算上限 */
  private maxTokensPerSession: number;
  /** 是否已订阅 globalEventBus */
  private trackingStarted = false;
  /** 订阅对象（用于取消） */
  private subscription: EventSubscription | null = null;
  /** P2-2.8 Phase 2: COST_RECORDED 订阅（被动接收 CostTracker 数据） */
  private costSubscription: EventSubscription | null = null;

  /**
   * @param maxTokensPerSession 每 session 最大 token 预算（默认 100,000）
   */
  constructor(maxTokensPerSession: number = DEFAULT_MAX_TOKENS_PER_SESSION) {
    this.maxTokensPerSession = maxTokensPerSession;
  }

  /**
   * 开始追踪：订阅 globalEventBus 的 TOKEN_USAGE 事件
   */
  startTracking(): void {
    if (this.trackingStarted) return;

    this.subscription = globalEventBus.on(
      OrchestrationEventType.TOKEN_USAGE,
      (payload: unknown) => {
        const data = payload as TokenUsagePayload;
        if (data?.sessionId && typeof data.totalTokens === 'number') {
          this.sessionTokens.set(data.sessionId, data.totalTokens);
          if (data.breakdown) {
            this.inputTokens.set(data.sessionId, data.breakdown.inputTokens);
            this.outputTokens.set(data.sessionId, data.breakdown.outputTokens);
          }
        }
      }
    );

    this.trackingStarted = true;
  }

  /**
   * P2-2.8 Phase 2: 订阅 COST_RECORDED 事件，被动同步 CostTracker 数据
   *
   * 消除 TokenTracker 独立追踪的冗余性，改为从 CostTracker（唯一写入点）被动订阅。
   * recordUsage() 仍可用作主动写入，但数据来源逐步迁移到 CostTracker → EventBus 管线。
   */
  subscribeToCostEvents(): void {
    if (this.costSubscription) return;

    this.costSubscription = globalEventBus.subscribe(
      SystemEvents.COST_RECORDED,
      (event: CostRecordedEvent) => {
        const sessionId = event.sessionId || 'global';
        const tokens = event.inputTokens + event.outputTokens;

        const current = this.sessionTokens.get(sessionId) ?? 0;
        this.sessionTokens.set(sessionId, current + tokens);

        const currentInput = this.inputTokens.get(sessionId) ?? 0;
        this.inputTokens.set(sessionId, currentInput + event.inputTokens);

        const currentOutput = this.outputTokens.get(sessionId) ?? 0;
        this.outputTokens.set(sessionId, currentOutput + event.outputTokens);
      }
    );
  }

  /**
   * 停止追踪
   */
  stopTracking(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.costSubscription) {
      this.costSubscription.unsubscribe();
      this.costSubscription = null;
    }
    this.trackingStarted = false;
  }

  /**
   * 记录 token 使用量并发布事件
   *
   * @param sessionId 会话 ID
   * @param tokens 本次消耗的 token 数
   * @param inputTokens 本次输入的 token 数（可选）
   * @param outputTokens 本次输出的 token 数（可选）
   */
  recordUsage(
    sessionId: string,
    tokens: number,
    inputTokens?: number,
    outputTokens?: number
  ): void {
    // P2-2.8: 迁移警告 — CostTracker 将成为唯一写入点
    logger.info(
      '[MIGRATION] TokenTracker.recordUsage 将被迁移到 CostTracker.addCost 统一入口，见 ADR-001',
      { sessionId, tokens }
    );
    const current = this.sessionTokens.get(sessionId) ?? 0;
    const newTotal = current + tokens;
    this.sessionTokens.set(sessionId, newTotal);

    if (inputTokens !== undefined) {
      const currentInput = this.inputTokens.get(sessionId) ?? 0;
      this.inputTokens.set(sessionId, currentInput + inputTokens);
    }
    if (outputTokens !== undefined) {
      const currentOutput = this.outputTokens.get(sessionId) ?? 0;
      this.outputTokens.set(sessionId, currentOutput + outputTokens);
    }

    // 发布事件，供其他模块（如 OTel Bridge）消费
    globalEventBus.publish(OrchestrationEventType.TOKEN_USAGE, {
      sessionId,
      totalTokens: newTotal,
      budgetRemaining: this.maxTokensPerSession - newTotal,
      breakdown: {
        inputTokens: this.inputTokens.get(sessionId) ?? 0,
        outputTokens: this.outputTokens.get(sessionId) ?? 0,
      },
    } satisfies TokenUsagePayload);
  }

  /**
   * 检查指定 session 是否超出预算
   *
   * @param sessionId 会话 ID
   * @returns true 表示超出预算
   */
  isOverBudget(sessionId: string): boolean {
    return (this.sessionTokens.get(sessionId) ?? 0) >= this.maxTokensPerSession;
  }

  /**
   * 获取指定 session 的 token 使用量
   *
   * @param sessionId 会话 ID
   * @returns token 使用量，0 表示无数据
   */
  getUsage(sessionId: string): {
    total: number;
    input: number;
    output: number;
    budgetRemaining: number;
  } {
    return {
      total: this.sessionTokens.get(sessionId) ?? 0,
      input: this.inputTokens.get(sessionId) ?? 0,
      output: this.outputTokens.get(sessionId) ?? 0,
      budgetRemaining:
        this.maxTokensPerSession - (this.sessionTokens.get(sessionId) ?? 0),
    };
  }

  /**
   * 重置指定 session 的追踪数据
   *
   * @param sessionId 会话 ID
   */
  resetSession(sessionId: string): void {
    this.sessionTokens.delete(sessionId);
    this.inputTokens.delete(sessionId);
    this.outputTokens.delete(sessionId);
  }

  /**
   * 重置所有 session 的追踪数据
   */
  resetAll(): void {
    this.sessionTokens.clear();
    this.inputTokens.clear();
    this.outputTokens.clear();
  }

  /**
   * 获取所有 session 的统计摘要
   */
  getSummary(): Array<{
    sessionId: string;
    total: number;
    input: number;
    output: number;
    overBudget: boolean;
  }> {
    const result: Array<{
      sessionId: string;
      total: number;
      input: number;
      output: number;
      overBudget: boolean;
    }> = [];

    for (const [sessionId, total] of this.sessionTokens) {
      result.push({
        sessionId,
        total,
        input: this.inputTokens.get(sessionId) ?? 0,
        output: this.outputTokens.get(sessionId) ?? 0,
        overBudget: total >= this.maxTokensPerSession,
      });
    }

    return result;
  }
}

/**
 * 全局 TokenTracker 实例
 */
let tokenTracker: TokenTracker | null = null;

/**
 * 获取全局 TokenTracker 实例（单例）
 *
 * @param maxTokensPerSession 每 session 预算上限（仅在首次创建时生效）
 * @returns TokenTracker 实例
 */
export function getTokenTracker(maxTokensPerSession?: number): TokenTracker {
  if (!tokenTracker) {
    tokenTracker = new TokenTracker(maxTokensPerSession);
    tokenTracker.startTracking();
    // P2-2.8 Phase 2: 订阅 COST_RECORDED 实现被动数据同步
    tokenTracker.subscribeToCostEvents();
  }
  return tokenTracker;
}

/**
 * 创建 TokenTracker 实例（不自动启动追踪，用于测试）
 *
 * @param maxTokensPerSession 每 session 预算上限
 * @returns TokenTracker 实例
 */
export function createTokenTracker(maxTokensPerSession?: number): TokenTracker {
  return new TokenTracker(maxTokensPerSession);
}
