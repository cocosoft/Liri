import type { ChatMessage } from '../../ai/models/types';
import {
  IContextEngine,
  CompressionConfig,
  CompressionResult,
  DEFAULT_COMPRESSION_CONFIG,
} from './IContextEngine';

const IMAGE_TOKEN_ESTIMATE = 1600;

function estimateTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += Math.ceil(m.content.length / 4);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content as Array<Record<string, unknown>>) {
        if (part['type'] === 'text' && typeof part['text'] === 'string') {
          total += Math.ceil((part['text'] as string).length / 4);
        } else if (part['type'] === 'image' || part['type'] === 'image_url') {
          total += IMAGE_TOKEN_ESTIMATE;
        }
      }
    }
  }
  return total;
}

function generateSummaryText(truncatedMessages: ChatMessage[]): string {
  if (truncatedMessages.length === 0) return '';

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

  const userContent = userMessages
    .map((m) => (typeof m.content === 'string' ? m.content.slice(0, 200) : ''))
    .filter((c) => c.trim().length > 0);
  if (userContent.length > 0) {
    lines.push('主要讨论内容:');
    for (const content of userContent.slice(-5)) {
      lines.push(`  - ${content}`);
    }
    lines.push('');
  }

  if (toolMessages.length > 0) {
    lines.push('工具使用摘要:');
    for (const msg of toolMessages.slice(-5)) {
      const truncated =
        typeof msg.content === 'string'
          ? msg.content.slice(0, 200)
          : '[结构化内容]';
      if (truncated.length > 0) {
        lines.push(`  - 工具返回: ${truncated}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export class SummarizerEngine implements IContextEngine {
  readonly id = 'summarizer';
  private config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
  }

  shouldCompress(totalTokens: number, maxTokens: number): boolean {
    return totalTokens > maxTokens * this.config.thresholdPercent;
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
    return Math.min(
      Math.floor(availableTokens * this.config.summaryRatio),
      this.config.summaryTokensCeiling
    );
  }

  async compress(
    messages: ChatMessage[],
    maxTokens: number
  ): Promise<CompressionResult> {
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

    const summaryText = generateSummaryText(truncatedMessages);

    if (summaryText) {
      keptMessages.splice(protectFirst, 0, {
        role: 'user',
        content: summaryText,
      });
    }

    const originalTokens = estimateTokens(messages);
    const compressedTokens = estimateTokens(keptMessages);

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
}
