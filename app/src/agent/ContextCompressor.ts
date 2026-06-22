/**
 * 上下文压缩器
 * 基于 AI 的智能上下文压缩，支持触发比例和保留比例精细控制
 */
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import type { AIModelType } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export interface CompressibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tokenCount: number;
  timestamp: number;
  id: string;
  metadata?: Record<string, unknown>;
}

export interface ContextCompressionConfig {
  triggerRatio: number;
  reserveRatio: number;
  compressionPrompt: string;
  maxTokens: number;
  preserveSystemMessages: boolean;
  preserveRecentToolResults: boolean;
  recentMessageCount: number;
}

export const DEFAULT_COMPRESSION_CONFIG: ContextCompressionConfig = {
  triggerRatio: 0.8,
  reserveRatio: 0.5,
  compressionPrompt:
    '请总结以上对话的核心内容，保留关键决策、工具调用结果和用户需求，去除冗余细节：',
  maxTokens: 128000,
  preserveSystemMessages: true,
  preserveRecentToolResults: true,
  recentMessageCount: 6,
};

export interface CompressionResult {
  messages: CompressibleMessage[];
  originalTokenCount: number;
  compressedTokenCount: number;
  compressionRatio: number;
  summary: string;
}

/**
 * 上下文压缩器
 *
 * 与 CompactionManager 的区别：
 * - CompactionManager：基于规则的简单截断（保留比例、丢弃旧消息）
 * - ContextCompressor：基于 AI 的智能压缩，生成语义摘要
 */
export class ContextCompressor {
  private config: ContextCompressionConfig;
  private model: AIModelType;

  constructor(config?: Partial<ContextCompressionConfig>, model?: AIModelType) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
    this.model = model ?? ('' as AIModelType);
  }

  /**
   * 判断是否需要压缩
   * @param tokenCount 当前词元数
   * @returns 是否需要压缩
   */
  shouldCompress(tokenCount: number): boolean {
    return tokenCount > this.config.maxTokens * this.config.triggerRatio;
  }

  /**
   * 执行上下文压缩
   * @param messages 消息列表
   * @returns 压缩结果
   */
  async compress(messages: CompressibleMessage[]): Promise<CompressionResult> {
    const originalTokenCount = messages.reduce(
      (sum, m) => sum + m.tokenCount,
      0
    );

    if (!this.shouldCompress(originalTokenCount)) {
      return {
        messages,
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        compressionRatio: 1,
        summary: '',
      };
    }

    const recentMessages = this.takeRecent(messages);
    const compressibleMessages = this.getCompressibleMessages(messages);

    if (compressibleMessages.length === 0) {
      return {
        messages: recentMessages,
        originalTokenCount,
        compressedTokenCount: recentMessages.reduce(
          (sum, m) => sum + m.tokenCount,
          0
        ),
        compressionRatio:
          recentMessages.reduce((sum, m) => sum + m.tokenCount, 0) /
          originalTokenCount,
        summary: '',
      };
    }

    const summary = await this.generateSummary(compressibleMessages);

    const summaryMessage: CompressibleMessage = {
      id: `summary_${Date.now()}`,
      role: 'system',
      content: `对话摘要：\n${summary}`,
      tokenCount: Math.ceil(summary.length / 4),
      timestamp: Date.now(),
      metadata: { type: 'compression_summary' },
    };

    const systemMessages = this.config.preserveSystemMessages
      ? messages.filter((m) => m.role === 'system')
      : [];

    const compressedMessages = [
      ...systemMessages,
      summaryMessage,
      ...recentMessages,
    ];

    const compressedTokenCount = compressedMessages.reduce(
      (sum, m) => sum + m.tokenCount,
      0
    );

    logger.info('上下文压缩完成', {
      originalTokens: originalTokenCount,
      compressedTokens: compressedTokenCount,
      ratio: (compressedTokenCount / originalTokenCount).toFixed(2),
      summaryLength: summary.length,
    });

    return {
      messages: compressedMessages,
      originalTokenCount,
      compressedTokenCount,
      compressionRatio:
        originalTokenCount > 0 ? compressedTokenCount / originalTokenCount : 1,
      summary,
    };
  }

  /**
   * 保留最近的 N 条消息
   * @param messages 所有消息
   * @returns 最近的消息
   */
  takeRecent(messages: CompressibleMessage[]): CompressibleMessage[] {
    const recent = messages.slice(-this.config.recentMessageCount);

    if (this.config.preserveRecentToolResults) {
      // 收集 recent 中所有 tool 消息的 tool_call_id（从 metadata 中提取实际 API ID）
      const toolResultCallIds = new Set(
        recent
          .filter((m) => m.role === 'tool')
          .map((m) => m.metadata?.tool_call_id as string | undefined)
          .filter((id): id is string => !!id)
      );

      if (toolResultCallIds.size === 0) return recent;

      // 查找其 tool_calls[].id 匹配上述 tool_call_id 的 assistant 消息
      // 这些 assistant 消息虽不在 recent 窗口内，但其 tool 结果在 recent 中，必须一并保留
      const extraAssistant = messages.filter(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.metadata?.tool_calls) &&
          (m.metadata!.tool_calls as Array<{ id?: string }>).some(
            (tc) => tc.id && toolResultCallIds.has(tc.id)
          )
      );

      return [...extraAssistant, ...recent];
    }

    return recent;
  }

  /**
   * 获取可压缩的消息（排除 system 和最近消息）
   * @param messages 所有消息
   * @returns 可压缩的消息
   */
  private getCompressibleMessages(
    messages: CompressibleMessage[]
  ): CompressibleMessage[] {
    const preserveCount = this.config.recentMessageCount;
    const count = messages.length;

    return messages.slice(0, count - preserveCount).filter((m) => {
      if (this.config.preserveSystemMessages && m.role === 'system') {
        return false;
      }
      return true;
    });
  }

  /**
   * 使用 AI 生成摘要
   * @param messages 待压缩的消息
   * @returns 摘要文本
   */
  private async generateSummary(
    messages: CompressibleMessage[]
  ): Promise<string> {
    const systemMessage = `你是一个对话压缩专家。${this.config.compressionPrompt}`;

    const conversationText = messages
      .map(
        (m) =>
          `[${m.role.toUpperCase()} (${new Date(m.timestamp).toISOString()})]: ${m.content}`
      )
      .join('\n\n');

    try {
      const response = await aiService.generate(
        [
          { role: AIMessageRole.SYSTEM, content: systemMessage },
          { role: AIMessageRole.USER, content: conversationText },
        ],
        this.model,
        {
          temperature: 0.3,
          max_tokens: Math.min(2048, Math.round(this.config.maxTokens * 0.1)),
        }
      );

      return response.content;
    } catch (err) {
      logger.warn('AI 摘要生成失败，使用截断方式压缩', {
        error: String(err),
      });

      return this.fallbackSummary(messages);
    }
  }

  /**
   * 降级方案：简单截断摘要
   * @param messages 消息列表
   * @returns 摘要文本
   */
  private fallbackSummary(messages: CompressibleMessage[]): string {
    const parts: string[] = [];
    let totalLength = 0;
    const maxLength = 2000;

    for (const msg of messages) {
      const snippet = msg.content.slice(0, 150);
      const entry = `[${msg.role}]: ${snippet}`;

      if (totalLength + entry.length > maxLength) {
        parts.push(`... 还有 ${messages.length - parts.length} 条消息被截断`);
        break;
      }

      parts.push(entry);
      totalLength += entry.length;
    }

    return parts.join('\n');
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextCompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<ContextCompressionConfig> {
    return { ...this.config };
  }
}
