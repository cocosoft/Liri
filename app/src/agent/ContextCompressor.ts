/**
 * 上下文压缩器
 * 基于 AI 的智能上下文压缩，支持触发比例和保留比例精细控制
 */
import aiService from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
import type { AIModelType } from '@modules/ai';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('agent:contextCompressor');

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
    '请总结以上对话的核心内容。\n' +
    '【任务边界规则 — 最高优先级】\n' +
    '1. 如果对话中发生了明显的任务/话题切换（例如从"A话题"切换到"B话题"），必须在摘要中明确标注：\n' +
    '   "【旧任务已完成：XXX】"（列出已结束的任务），然后单独标注"【当前任务：YYY】"（当前正在进行的新任务）\n' +
    '2. 对话中最后几条用户消息所代表的任务为"当前任务"，优先于所有历史内容。如果旧任务和新任务之间存在矛盾，以新任务为准\n' +
    '3. 已完成的旧任务仅做简要记录（1-2句话），重点详细保留当前任务的进展\n' +
    '\n' +
    '【必须保留的内容】\n' +
    '(1)用户个人信息（姓名、背景、经历、偏好）\n' +
    '(2)关键决策与用户需求\n' +
    '(3)当前任务进展状态与最新决策（最重要，模型将继续执行任务，必须知道做到哪了）\n' +
    '(4)工具调用结果\n' +
    '\n' +
    '去除冗余细节和已完成的中间步骤。请直接输出摘要，不需要开场白。\n' +
    '\n' +
    '【图片URL规则】显示图片时必须使用 displayUrl（以 /v1/images/static/ 开头），禁止从 filePath 自行拼接 URL。',
  // 与 ContextWindowResolver.DEFAULT_CONTEXT_WINDOW 对齐（200K），
  // 此前硬编码 128000 与推理链路默认值不一致，1M 窗口模型在 10% 用量时即过早触发 AI 压缩
  maxTokens: 200000,
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
    // 按比例动态计算保留数：总消息数的 30%，下限 6，上限 100
    const dynamicCount = Math.max(
      6,
      Math.min(100, Math.floor(messages.length * 0.3))
    );
    const recent = messages.slice(-dynamicCount);

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

    return messages.slice(0, Math.max(0, count - preserveCount)).filter((m) => {
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
    const parts: string[] = [
      `⚠️ 以下为历史任务记录（已完成），当前任务见最近消息段。`,
    ];
    let totalLength = parts[0].length;
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
