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

export class TruncatorEngine implements IContextEngine {
  readonly id = 'truncator';
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
    return 0;
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

    const summaryText = `[截断压缩] 已移除 ${truncatedMessages.length} 条中间消息（${protectFirst}条保留 + ${protectLast}条保留）`;

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
