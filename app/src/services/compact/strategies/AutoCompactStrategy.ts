/**
 * AutoCompactStrategy 自动压缩策略
 * 基于 CC autoCompact.ts 核心模式
 * 当 token 数超过阈值时自动触发压缩
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

export interface AutoCompactConfig extends CompactConfig {
  autoCompactThreshold: number;
  warningThreshold: number;
  errorThreshold: number;
  blockingLimit: number;
  contextWindow: number;
  effectiveWindow: number;
  maxConsecutiveFailures: number;
}

const DEFAULT_CONFIG: AutoCompactConfig = {
  enabled: true,
  priority: 10,
  protectFirstN: 2,
  protectLastN: 2,
  maxOutputTokens: 20000,
  tokenBudget: 50000,
  autoCompactThreshold: 167000,
  warningThreshold: 180000,
  errorThreshold: 180000,
  blockingLimit: 197000,
  contextWindow: 200000,
  effectiveWindow: 180000,
  maxConsecutiveFailures: 3,
};

const AUTOCOMPACT_BUFFER_TOKENS = 13000;

export class AutoCompactStrategy extends ContextEngine {
  private consecutiveFailures: number = 0;
  private totalCompactCount: number = 0;

  constructor(config?: Partial<AutoCompactConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  getName(): string {
    return 'auto_compact';
  }

  getPriority(): number {
    return this.config.priority as number;
  }

  getMetadata(): CompactMetadata {
    return {
      name: 'AutoCompactStrategy',
      version: '1.0.0',
      description: '基于 token 阈值的自动压缩策略，当上下文超过阈值时触发压缩',
      supportedRoles: ['user', 'assistant', 'system', 'tool'],
    };
  }

  canHandle(message: Message): boolean {
    return ['user', 'assistant', 'tool'].includes(message.role);
  }

  evaluate(messages: Message[], context: CompactContext): CompactDecision {
    this.recordEvaluation();

    const config = this.getConfig() as AutoCompactConfig;
    const threshold = context.effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS;

    if (this.consecutiveFailures >= config.maxConsecutiveFailures) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `断路器已打开（连续 ${this.consecutiveFailures} 次失败）`,
        tokenCount: context.currentTokens,
        threshold,
        strategyName: this.getName(),
      };
    }

    if (context.currentTokens <= threshold) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `Token 数 ${context.currentTokens} 未超过阈值 ${threshold}`,
        tokenCount: context.currentTokens,
        threshold,
        strategyName: this.getName(),
      };
    }

    const priority = Math.min(
      100,
      Math.floor(
        ((context.currentTokens - threshold) /
          (context.contextWindow - threshold)) *
          100
      )
    );

    return {
      shouldCompact: true,
      priority,
      reason: `Token 数 ${context.currentTokens} 超过阈值 ${threshold}，超出 ${context.currentTokens - threshold} tokens`,
      tokenCount: context.currentTokens,
      threshold,
      strategyName: this.getName(),
    };
  }

  compact(
    messages: Message[],
    options?: Partial<CompactConfig>
  ): CompactResult {
    const startTime = Date.now();
    const originalTokenCount = this.getTotalTokenCount(messages);
    const config = { ...this.getConfig(), ...options } as AutoCompactConfig;

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

    this.consecutiveFailures = 0;
    this.totalCompactCount++;

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
   * 记录一次失败（断路器计数）
   */
  recordFailure(): void {
    this.consecutiveFailures++;
  }

  /**
   * 获取断路器状态
   */
  getCircuitBreakerStatus(): {
    consecutiveFailures: number;
    maxFailures: number;
    isOpen: boolean;
  } {
    const config = this.getConfig() as AutoCompactConfig;
    return {
      consecutiveFailures: this.consecutiveFailures,
      maxFailures: config.maxConsecutiveFailures,
      isOpen: this.consecutiveFailures >= config.maxConsecutiveFailures,
    };
  }

  /**
   * 重置断路器
   */
  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * 获取总压缩次数
   */
  getTotalCompactCount(): number {
    return this.totalCompactCount;
  }

  /**
   * 重置状态
   */
  override reset(): void {
    super.reset();
    this.consecutiveFailures = 0;
    this.totalCompactCount = 0;
  }
}
