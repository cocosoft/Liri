/**
 * ReactiveCompactStrategy 反应式压缩策略
 * 基于 CC reactiveCompact.ts
 * 监控 token 增长率和轮次变化，当增长过快或轮次过多时触发压缩
 */

import {
  ContextEngine,
  type Message,
  type CompactContext,
  type CompactDecision,
  type CompactResult,
  type CompactConfig,
  type CompactMetadata,
} from '../ContextEngine';

export interface ReactiveCompactConfig extends CompactConfig {
  growthThreshold: number;
  roundsThreshold: number;
  minCompactInterval: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTime: number;
}

const DEFAULT_CONFIG: ReactiveCompactConfig = {
  enabled: true,
  priority: 20,
  protectFirstN: 2,
  protectLastN: 3,
  maxOutputTokens: 20000,
  tokenBudget: 50000,
  growthThreshold: 0.15,
  roundsThreshold: 5,
  minCompactInterval: 30000,
  circuitBreakerThreshold: 3,
  circuitBreakerResetTime: 300000,
};

export interface RoundInfo {
  roundNumber: number;
  tokenCount: number;
  timestamp: number;
}

export class ReactiveCompactStrategy extends ContextEngine {
  private previousRoundTokens: Map<string, number> = new Map();
  private roundHistory: Map<string, RoundInfo[]> = new Map();
  private consecutiveFailures: number = 0;
  private lastCompactTime: number = 0;

  constructor(config?: Partial<ReactiveCompactConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  getName(): string {
    return 'reactive_compact';
  }

  getPriority(): number {
    return this.config.priority as number;
  }

  getMetadata(): CompactMetadata {
    return {
      name: 'ReactiveCompactStrategy',
      version: '1.0.0',
      description: '反应式压缩策略，监控 token 增长率和轮次变化触发压缩',
      supportedRoles: ['user', 'assistant', 'system', 'tool'],
    };
  }

  canHandle(message: Message): boolean {
    return message.role === 'assistant' || message.role === 'user';
  }

  evaluate(messages: Message[], context: CompactContext): CompactDecision {
    this.recordEvaluation();

    const config = this.getConfig() as ReactiveCompactConfig;

    if (this.consecutiveFailures >= config.circuitBreakerThreshold) {
      if (
        this.lastCompactTime > 0 &&
        Date.now() - this.lastCompactTime > config.circuitBreakerResetTime
      ) {
        this.consecutiveFailures = 0;
      } else {
        return {
          shouldCompact: false,
          priority: 0,
          reason: '反应式压缩断路器已打开',
          tokenCount: context.currentTokens,
          threshold: 0,
          strategyName: this.getName(),
        };
      }
    }

    if (Date.now() - this.lastCompactTime < config.minCompactInterval) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `距离上次压缩不足 ${config.minCompactInterval}ms 最小间隔`,
        tokenCount: context.currentTokens,
        threshold: 0,
        strategyName: this.getName(),
      };
    }

    const roundCheck = this.checkRoundGrowth(
      context.sessionId,
      context.currentTokens,
      config
    );
    if (roundCheck && roundCheck.shouldCompact) {
      return roundCheck;
    }

    const roundsCount = this.getRoundCount(context.sessionId);
    if (roundsCount >= config.roundsThreshold) {
      return {
        shouldCompact: true,
        priority: 60,
        reason: `对话已进行 ${roundsCount} 轮，超过阈值 ${config.roundsThreshold}`,
        tokenCount: context.currentTokens,
        threshold: config.roundsThreshold,
        strategyName: this.getName(),
      };
    }

    return {
      shouldCompact: false,
      priority: 0,
      reason: '未触发反应式压缩条件',
      tokenCount: context.currentTokens,
      threshold: 0,
      strategyName: this.getName(),
    };
  }

  compact(
    messages: Message[],
    options?: Partial<CompactConfig>
  ): CompactResult {
    const startTime = Date.now();
    const originalTokenCount = this.getTotalTokenCount(messages);
    const config = { ...this.getConfig(), ...options } as ReactiveCompactConfig;

    const firstN = config.protectFirstN;
    const lastN = config.protectLastN;

    const protectedMessages: Message[] = [];
    const removedMessages: Message[] = [];

    const range = this.getRemovableRange(messages);

    if (!range) {
      const result: CompactResult = {
        messages: [...messages],
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        reductionRatio: 0,
        preservedFirst: messages.length,
        preservedLast: 0,
        removedCount: 0,
        strategyName: this.getName(),
        duration: Date.now() - startTime,
      };

      this.recordCompact(result);
      return result;
    }

    for (let i = 0; i < messages.length; i++) {
      if (i < range.start || i >= range.end) {
        protectedMessages.push(messages[i]);
      } else {
        removedMessages.push(messages[i]);
      }
    }

    const compressedTokenCount = this.getTotalTokenCount(protectedMessages);
    const reductionRatio =
      originalTokenCount > 0
        ? 1 - compressedTokenCount / originalTokenCount
        : 0;

    this.lastCompactTime = Date.now();
    this.consecutiveFailures = 0;

    const result: CompactResult = {
      messages: protectedMessages,
      originalTokenCount,
      compressedTokenCount,
      reductionRatio,
      preservedFirst: firstN,
      preservedLast: lastN,
      removedCount: removedMessages.length,
      strategyName: this.getName(),
      duration: Date.now() - startTime,
    };

    this.recordCompact(result);
    return result;
  }

  /**
   * 记录轮次信息
   */
  recordRound(sessionId: string, tokenCount: number): void {
    if (!this.roundHistory.has(sessionId)) {
      this.roundHistory.set(sessionId, []);
    }

    const rounds = this.roundHistory.get(sessionId)!;
    rounds.push({
      roundNumber: rounds.length + 1,
      tokenCount,
      timestamp: Date.now(),
    });

    this.previousRoundTokens.set(sessionId, tokenCount);
  }

  /**
   * 获取指定会话的轮次数量
   */
  getRoundCount(sessionId: string): number {
    return this.roundHistory.get(sessionId)?.length || 0;
  }

  /**
   * 获取轮次历史
   */
  getRoundHistory(sessionId: string): RoundInfo[] {
    return [...(this.roundHistory.get(sessionId) || [])];
  }

  /**
   * 清除指定会话的轮次记录
   */
  clearRoundHistory(sessionId: string): void {
    this.roundHistory.delete(sessionId);
    this.previousRoundTokens.delete(sessionId);
  }

  /**
   * 记录一次失败
   */
  recordFailure(): void {
    this.consecutiveFailures++;
  }

  /**
   * 重置断路器
   */
  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * 获取断路器状态
   */
  getCircuitBreakerStatus(): { isOpen: boolean; consecutiveFailures: number } {
    const config = this.getConfig() as ReactiveCompactConfig;

    if (this.consecutiveFailures >= config.circuitBreakerThreshold) {
      if (
        this.lastCompactTime > 0 &&
        Date.now() - this.lastCompactTime > config.circuitBreakerResetTime
      ) {
        this.consecutiveFailures = 0;
      }
    }

    return {
      isOpen: this.consecutiveFailures >= config.circuitBreakerThreshold,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * 重置状态
   */
  override reset(): void {
    super.reset();
    this.previousRoundTokens.clear();
    this.roundHistory.clear();
    this.consecutiveFailures = 0;
    this.lastCompactTime = 0;
  }

  /**
   * 检查轮次增长是否触发压缩
   */
  private checkRoundGrowth(
    sessionId: string,
    currentTokens: number,
    config: ReactiveCompactConfig
  ): CompactDecision | null {
    const previousTokens = this.previousRoundTokens.get(sessionId);

    if (previousTokens === undefined) {
      return null;
    }

    if (previousTokens <= 0) {
      return null;
    }

    const growthRate = (currentTokens - previousTokens) / previousTokens;

    if (growthRate >= config.growthThreshold) {
      const priority = Math.min(100, Math.floor(growthRate * 100));

      return {
        shouldCompact: true,
        priority,
        reason: `Token 增长率 ${(growthRate * 100).toFixed(1)}% 超过阈值 ${(config.growthThreshold * 100).toFixed(1)}%`,
        tokenCount: currentTokens,
        threshold: config.growthThreshold,
        strategyName: this.getName(),
      };
    }

    return null;
  }

  /**
   * 检查断路器状态
   */
  private isCircuitBreakerOpen(config: ReactiveCompactConfig): boolean {
    if (this.consecutiveFailures < config.circuitBreakerThreshold) {
      return false;
    }

    if (
      this.lastCompactTime > 0 &&
      Date.now() - this.lastCompactTime > config.circuitBreakerResetTime
    ) {
      this.consecutiveFailures = 0;
      return false;
    }

    return true;
  }
}
