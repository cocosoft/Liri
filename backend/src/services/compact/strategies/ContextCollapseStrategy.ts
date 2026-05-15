/**
 * ContextCollapseStrategy 上下文折叠策略
 * 基于 CC contextCollapse 核心模式
 * 最激进的压缩策略，将中间对话折叠为结构化摘要
 * 适用于上下文极度紧张的场景（如接近 context window 上限）
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

export interface ContextCollapseConfig extends CompactConfig {
  collapseThreshold: number;
  collapseRatio: number;
  preserveUserMessages: boolean;
  preserveToolResults: boolean;
  minRemainingMessages: number;
  maxCollapseBatchSize: number;
}

const DEFAULT_CONFIG: ContextCollapseConfig = {
  enabled: true,
  priority: 40,
  protectFirstN: 2,
  protectLastN: 2,
  maxOutputTokens: 20000,
  tokenBudget: 50000,
  collapseThreshold: 0.85,
  collapseRatio: 0.5,
  preserveUserMessages: true,
  preserveToolResults: false,
  minRemainingMessages: 5,
  maxCollapseBatchSize: 20,
};

export interface CollapsedBlock {
  originalCount: number;
  originalTokens: number;
  summary: string;
  roles: string[];
}

export class ContextCollapseStrategy extends ContextEngine {
  private collapseBlocks: Map<string, CollapsedBlock[]> = new Map();

  constructor(config?: Partial<ContextCollapseConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  getName(): string {
    return 'context_collapse';
  }

  getPriority(): number {
    return this.config.priority as number;
  }

  getMetadata(): CompactMetadata {
    return {
      name: 'ContextCollapseStrategy',
      version: '1.0.0',
      description: '上下文折叠策略，将中间对话批量折叠为结构化摘要，适用于上下文极度紧张场景',
      supportedRoles: ['user', 'assistant'],
    };
  }

  canHandle(message: Message): boolean {
    return message.role === 'user' || message.role === 'assistant' || message.role === 'tool';
  }

  evaluate(messages: Message[], context: CompactContext): CompactDecision {
    this.recordEvaluation();

    const config = this.getConfig() as ContextCollapseConfig;
    const usageRatio = context.currentTokens / context.contextWindow;

    if (usageRatio < config.collapseThreshold) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `上下文使用率 ${(usageRatio * 100).toFixed(1)}% 未达到折叠阈值 ${(config.collapseThreshold * 100).toFixed(1)}%`,
        tokenCount: context.currentTokens,
        threshold: Math.floor(config.collapseThreshold * context.contextWindow),
        strategyName: this.getName(),
      };
    }

    if (messages.length <= config.minRemainingMessages) {
      return {
        shouldCompact: false,
        priority: 0,
        reason: `消息数 ${messages.length} 不足最小保留量 ${config.minRemainingMessages}`,
        tokenCount: context.currentTokens,
        threshold: config.minRemainingMessages,
        strategyName: this.getName(),
      };
    }

    const priority = Math.min(
      100,
      Math.max(50, Math.floor((usageRatio - config.collapseThreshold) * 200 + 50))
    );

    return {
      shouldCompact: true,
      priority,
      reason: `上下文使用率 ${(usageRatio * 100).toFixed(1)}% 超过折叠阈值，需激进压缩`,
      tokenCount: context.currentTokens,
      threshold: Math.floor(config.collapseThreshold * context.contextWindow),
      strategyName: this.getName(),
    };
  }

  compact(messages: Message[], options?: Partial<CompactConfig>): CompactResult {
    const startTime = Date.now();
    const originalTokenCount = this.getTotalTokenCount(messages);
    const config = { ...this.getConfig(), ...options } as ContextCollapseConfig;

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
    const headMessages = this.protectFirst(messages, range.start);
    resultMessages.push(...headMessages);

    const collapsibleMessages = messages.slice(range.start, range.end);
    const collapsedBlocks = this.collapseMessages(collapsibleMessages, config);

    for (const block of collapsedBlocks) {
      resultMessages.push(this.createCollapsedMarker(block));
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
      removedCount: collapsibleMessages.length,
      strategyName: this.getName(),
      duration: Date.now() - startTime,
    };

    this.recordCompact(result);
    return result;
  }

  /**
   * 获取指定会话的折叠块记录
   */
  getCollapseBlocks(sessionId: string): CollapsedBlock[] {
    return [...(this.collapseBlocks.get(sessionId) || [])];
  }

  /**
   * 清除指定会话的折叠块记录
   */
  clearCollapseBlocks(sessionId: string): void {
    this.collapseBlocks.delete(sessionId);
  }

  /**
   * 重置状态
   */
  override reset(): void {
    super.reset();
    this.collapseBlocks.clear();
  }

  /**
   * 将消息批量折叠为摘要块
   */
  private collapseMessages(
    messages: Message[],
    config: ContextCollapseConfig
  ): CollapsedBlock[] {
    const blocks: CollapsedBlock[] = [];
    const batchSize = config.maxCollapseBatchSize;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const block = this.createCollapseBlock(batch, config);
      blocks.push(block);
    }

    return blocks;
  }

  /**
   * 创建单个折叠块
   */
  private createCollapseBlock(
    messages: Message[],
    config: ContextCollapseConfig
  ): CollapsedBlock {
    const roles = new Set<string>();
    let totalTokens = 0;

    for (const msg of messages) {
      roles.add(msg.role);
      totalTokens += this.getMessageTokenCount(msg);
    }

    const collapsedTokens = Math.max(
      1,
      Math.floor(totalTokens * (1 - config.collapseRatio))
    );

    const summaryParts: string[] = [];
    let userCount = 0;
    let assistantCount = 0;
    let toolCount = 0;

    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          userCount++;
          break;
        case 'assistant':
          assistantCount++;
          break;
        case 'tool':
          toolCount++;
          break;
      }
    }

    if (userCount > 0) {
      summaryParts.push(`${userCount} 条用户消息`);
    }
    if (assistantCount > 0) {
      summaryParts.push(`${assistantCount} 条助手消息`);
    }
    if (toolCount > 0) {
      summaryParts.push(`${toolCount} 条工具结果`);
    }

    return {
      originalCount: messages.length,
      originalTokens: totalTokens,
      summary: `[已折叠 ${summaryParts.join('，')}，原始 ${totalTokens} tokens → 约 ${collapsedTokens} tokens]`,
      roles: Array.from(roles),
    };
  }

  /**
   * 创建折叠标记消息
   */
  private createCollapsedMarker(block: CollapsedBlock): Message {
    const summaryContent = [
      `<collapsed_context original_count="${block.originalCount}" original_tokens="${block.originalTokens}">`,
      `  ${block.summary}`,
      '</collapsed_context>',
    ].join('\n');

    return {
      id: `collapse_marker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'system',
      content: summaryContent,
      createdAt: new Date(),
      metadata: {
        type: 'collapse_marker',
        originalCount: block.originalCount,
        originalTokens: block.originalTokens,
      },
    };
  }
}
