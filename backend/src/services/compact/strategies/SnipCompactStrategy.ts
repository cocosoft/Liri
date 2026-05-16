/**
 * SnipCompactStrategy 裁剪压缩策略
 * 基于 CC snipCompact.ts 核心模式
 * 移除中间冗余消息，保留对话首尾关键部分
 * 支持 protect_first_n / protect_last_n 参数配置
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

export interface SnipCompactConfig extends CompactConfig {
  minIntervalTokens: number;
  maxIntervalTokens: number;
  preserveSystemMessages: boolean;
  preserveToolResults: boolean;
  summaryInsertThreshold: number;
}

const DEFAULT_CONFIG: SnipCompactConfig = {
  enabled: true,
  priority: 30,
  protectFirstN: 3,
  protectLastN: 3,
  maxOutputTokens: 20000,
  tokenBudget: 50000,
  minIntervalTokens: 1000,
  maxIntervalTokens: 100000,
  preserveSystemMessages: true,
  preserveToolResults: false,
  summaryInsertThreshold: 50000,
};

export class SnipCompactStrategy extends ContextEngine {
  constructor(config?: Partial<SnipCompactConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  getName(): string {
    return 'snip_compact';
  }

  getPriority(): number {
    return this.config.priority as number;
  }

  getMetadata(): CompactMetadata {
    return {
      name: 'SnipCompactStrategy',
      version: '1.0.0',
      description: '裁剪压缩策略，移除中间冗余消息，保留对话首尾关键部分',
      supportedRoles: ['user', 'assistant', 'system', 'tool'],
    };
  }

  canHandle(message: Message): boolean {
    return (
      message.role !== 'system' ||
      (this.getConfig() as SnipCompactConfig).preserveSystemMessages
    );
  }

  evaluate(messages: Message[], context: CompactContext): CompactDecision {
    this.recordEvaluation();

    const config = this.getConfig() as SnipCompactConfig;
    const firstN = config.protectFirstN;
    const lastN = config.protectLastN;

    if (messages.length <= firstN + lastN) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `消息数 ${messages.length} 不足保护区间（${firstN + lastN}），无需裁剪`,
        tokenCount: context.currentTokens,
        threshold: firstN + lastN,
        strategyName: this.getName(),
      };
    }

    const removableCount = messages.length - firstN - lastN;
    const removableTokens = this.estimateTokenReduction(messages);

    if (context.currentTokens < config.minIntervalTokens) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `Token 数 ${context.currentTokens} 低于最小裁剪阈值 ${config.minIntervalTokens}`,
        tokenCount: context.currentTokens,
        threshold: config.minIntervalTokens,
        strategyName: this.getName(),
      };
    }

    const tokenExcess = context.currentTokens - config.minIntervalTokens;
    const priority = Math.min(
      80,
      Math.max(10, Math.floor((tokenExcess / config.maxIntervalTokens) * 80))
    );

    return {
      shouldCompact: true,
      priority,
      reason: `可裁剪中间 ${removableCount} 条消息，预计节省约 ${removableTokens} tokens`,
      tokenCount: context.currentTokens,
      threshold: config.minIntervalTokens,
      strategyName: this.getName(),
    };
  }

  compact(
    messages: Message[],
    options?: Partial<CompactConfig>
  ): CompactResult {
    const startTime = Date.now();
    const originalTokenCount = this.getTotalTokenCount(messages);
    const config = { ...this.getConfig(), ...options } as SnipCompactConfig;

    const firstN = config.protectFirstN;
    const lastN = config.protectLastN;

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

    const resultMessages: Message[] = [];
    let removedCount = 0;

    const headMessages = this.protectFirst(messages, range.start);
    resultMessages.push(...headMessages);

    if (config.preserveSystemMessages) {
      for (let i = range.start; i < range.end; i++) {
        if (messages[i].role === 'system') {
          resultMessages.push(messages[i]);
        } else {
          removedCount++;
        }
      }
    } else {
      removedCount = range.end - range.start;

      if (originalTokenCount >= config.summaryInsertThreshold) {
        resultMessages.push(
          this.createSnippedMarker(removedCount, originalTokenCount)
        );
      }
    }

    const tailMessages = this.protectLast(messages, lastN);
    resultMessages.push(...tailMessages);

    const compressedTokenCount = this.getTotalTokenCount(resultMessages);
    const reductionRatio =
      originalTokenCount > 0
        ? 1 - compressedTokenCount / originalTokenCount
        : 0;

    const result: CompactResult = {
      messages: resultMessages,
      originalTokenCount,
      compressedTokenCount,
      reductionRatio,
      preservedFirst: firstN,
      preservedLast: lastN,
      removedCount,
      strategyName: this.getName(),
      duration: Date.now() - startTime,
    };

    this.recordCompact(result);
    return result;
  }

  /**
   * 创建裁剪占位标记消息
   */
  private createSnippedMarker(
    removedCount: number,
    totalTokens: number
  ): Message {
    return {
      id: `snip_marker_${Date.now()}`,
      role: 'system',
      content: `[已裁剪中间 ${removedCount} 条消息，原始上下文约 ${totalTokens} tokens，保留对话首尾关键部分]`,
      createdAt: new Date(),
      metadata: { type: 'snip_marker' },
    };
  }
}
