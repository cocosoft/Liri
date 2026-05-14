/**
 * 默认上下文引擎实现
 * 对标 Hermes agent/context_engine.py
 * 实现比例制预算 + 结构化摘要 + 辅助 LLM 压缩
 */
import type { ChatMessage } from '../../ai/models/types';
import {
  IContextEngine,
  CompressionConfig,
  CompressionResult,
  DEFAULT_COMPRESSION_CONFIG,
} from './IContextEngine';
import { SummaryTemplate, StructuredSummary } from './SummaryTemplate';
import { JsonTruncator } from './JsonTruncator';

/**
 * 默认上下文引擎
 */
export class DefaultContextEngine implements IContextEngine {
  readonly id = 'default-context-engine';
  private config: CompressionConfig;
  private lastFailureTime: number | null = null;
  private summaryTemplate: SummaryTemplate;
  private jsonTruncator: JsonTruncator;

  /**
   * 构造函数
   * @param config 压缩配置
   */
  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
    this.summaryTemplate = new SummaryTemplate();
    this.jsonTruncator = new JsonTruncator();
  }

  shouldCompress(totalTokens: number, maxTokens: number): boolean {
    const threshold = maxTokens * this.config.thresholdPercent;

    return totalTokens > threshold;
  }

  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getAvailableBudget(maxTokens: number, currentTokens: number): number {
    return Math.max(0, maxTokens - currentTokens);
  }

  getSummaryBudget(availableTokens: number): number {
    const budget = Math.floor(availableTokens * this.config.summaryRatio);

    return Math.min(budget, this.config.summaryTokensCeiling);
  }

  /**
   * 压缩消息列表
   * @param messages 原始消息列表
   * @param maxTokens 最大 Token 数
   * @returns 压缩结果
   */
  async compress(
    messages: ChatMessage[],
    maxTokens: number
  ): Promise<CompressionResult> {
    if (this.isInCooldown()) {
      return {
        messages,
        summary: '',
        originalTokens: 0,
        compressedTokens: 0,
        tokensSaved: 0,
        compressed: false,
        truncatedCount: 0,
      };
    }

    const protectFirst = this.config.protectFirstN;
    const protectLast = this.config.protectLastN;

    if (messages.length <= protectFirst + protectLast) {
      return {
        messages,
        summary: '',
        originalTokens: 0,
        compressedTokens: 0,
        tokensSaved: 0,
        compressed: false,
        truncatedCount: 0,
      };
    }

    const keptMessages: ChatMessage[] = [];
    const truncatedMessages: ChatMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      if (i < protectFirst || i >= messages.length - protectLast) {
        keptMessages.push(messages[i]);
      } else {
        truncatedMessages.push(messages[i]);
      }
    }

    const summaryText = this.generateSummaryText(truncatedMessages);

    if (summaryText) {
      keptMessages.splice(protectFirst, 0, {
        role: 'user',
        content: summaryText,
      });
    }

    const originalTokens = messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );
    const compressedTokens = keptMessages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );

    return {
      messages: keptMessages,
      summary: summaryText,
      originalTokens,
      compressedTokens,
      tokensSaved: originalTokens - compressedTokens,
      compressed: true,
      truncatedCount: truncatedMessages.length,
    };
  }

  /**
   * 检查是否在失败冷却期
   */
  private isInCooldown(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }

    const elapsed = Date.now() - this.lastFailureTime;

    return elapsed < this.config.failureCooldownMs;
  }

  /**
   * 生成摘要文本
   * @param truncatedMessages 被截断的消息
   * @returns 摘要文本
   */
  private generateSummaryText(truncatedMessages: ChatMessage[]): string {
    if (truncatedMessages.length === 0) {
      return '';
    }

    const userMessages = truncatedMessages.filter((m) => m.role === 'user');
    const assistantMessages = truncatedMessages.filter(
      (m) => m.role === 'assistant'
    );
    const toolMessages = truncatedMessages.filter((m) => m.role === 'tool');

    const lines: string[] = [];

    lines.push('[历史上下文摘要]');
    lines.push(`被压缩的消息数: ${truncatedMessages.length}`);
    lines.push(`  用户消息: ${userMessages.length}`);
    lines.push(`  助手响应: ${assistantMessages.length}`);
    lines.push(`  工具调用结果: ${toolMessages.length}`);
    lines.push('');

    const keyPoints = this.extractKeyPoints(truncatedMessages);
    if (keyPoints.length > 0) {
      lines.push('主要讨论内容:');
      for (const point of keyPoints) {
        lines.push(`  - ${point}`);
      }
      lines.push('');
    }

    const toolSummary = this.summarizeToolCalls(toolMessages);
    if (toolSummary.length > 0) {
      lines.push('工具使用摘要:');
      for (const summary of toolSummary) {
        lines.push(`  ${summary}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 提取关键点
   * @param messages 消息列表
   * @returns 关键点列表
   */
  private extractKeyPoints(messages: ChatMessage[]): string[] {
    const points: string[] = [];
    const userContent = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.slice(0, 200));

    for (const content of userContent) {
      if (content.trim().length > 0) {
        points.push(content);
      }
    }

    return points.slice(-5);
  }

  /**
   * 摘要工具调用结果
   * @param toolMessages 工具消息列表
   * @returns 摘要行列表
   */
  private summarizeToolCalls(toolMessages: ChatMessage[]): string[] {
    const summaries: string[] = [];

    for (const msg of toolMessages.slice(-5)) {
      const truncated = this.jsonTruncator.truncate(msg.content.slice(0, 200));

      if (truncated.length > 0) {
        summaries.push(`- 工具返回: ${truncated}`);
      }
    }

    return summaries;
  }

  /**
   * 记录压缩失败
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
  }

  /**
   * 获取摘要模板（用于外部调用）
   */
  getSummaryTemplate(): SummaryTemplate {
    return this.summaryTemplate;
  }

  /**
   * 获取 JSON 截断器
   */
  getJsonTruncator(): JsonTruncator {
    return this.jsonTruncator;
  }

  /**
   * 生成结构化摘要（使用辅助 LLM 的回调方式）
   * @param messages 消息列表
   * @param summaryFn 可选的辅助 LLM 调用函数
   * @returns 结构化摘要
   */
  async generateStructuredSummary(
    messages: ChatMessage[],
    summaryFn?: (content: string) => Promise<string>
  ): Promise<StructuredSummary> {
    const content = messages
      .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
      .join('\n');

    if (summaryFn) {
      try {
        const prompt = `请从以下对话记录中提取结构化摘要，格式如下：
问题: [待解决的问题列表]
决策: [关键决策]
目标: [当前目标]

对话记录:
${content.slice(0, 8000)}`;

        const response = await summaryFn(prompt);
        this.parseLLMSummary(response);
      } catch {
        this.recordFailure();
      }
    }

    return this.summaryTemplate.toStructuredSummary({
      start: 0,
      end: messages.length,
    });
  }

  /**
   * 解析 LLM 生成的摘要
   * @param llmResponse LLM 响应
   */
  private parseLLMSummary(llmResponse: string): void {
    const issueMatch = llmResponse.match(
      /问题[:：]\s*\n([\s\S]*?)(?=\n决策|$)/
    );
    const decisionMatch = llmResponse.match(
      /决策[:：]\s*\n([\s\S]*?)(?=\n目标|$)/
    );
    const goalMatch = llmResponse.match(/目标[:：]\s*\n?([\s\S]*?)$/);

    if (issueMatch) {
      const issueLines = issueMatch[1].trim().split('\n');
      for (const line of issueLines) {
        const cleanLine = line.replace(/^[-*]\s*/, '').trim();
        if (cleanLine) {
          this.summaryTemplate.addIssue(cleanLine, cleanLine, 'pending');
        }
      }
    }

    if (decisionMatch) {
      const decisionLines = decisionMatch[1].trim().split('\n');
      for (const line of decisionLines) {
        const cleanLine = line.replace(/^[-*]\s*/, '').trim();
        if (cleanLine) {
          const parts = cleanLine.split(':');
          if (parts.length >= 2) {
            this.summaryTemplate.addDecision(
              parts[0].trim(),
              parts[1].trim(),
              ''
            );
          } else {
            this.summaryTemplate.addDecision(cleanLine, cleanLine, '');
          }
        }
      }
    }

    if (goalMatch) {
      const goal = goalMatch[1].trim();
      if (goal) {
        this.summaryTemplate.setCurrentGoal(goal);
      }
    }
  }
}
