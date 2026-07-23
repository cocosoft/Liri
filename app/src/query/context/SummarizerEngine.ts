import type { ChatMessage } from '../../ai/models/types';
import {
  IContextEngine,
  CompressionConfig,
  CompressionResult,
  DEFAULT_COMPRESSION_CONFIG,
} from './IContextEngine';
import { estimateMessagesTokens, IMAGE_TOKEN_ESTIMATE } from '../../ai/tokenizer/TokenEstimator';
import { generateStructuredSummary } from './SummaryGenerator';

/** @deprecated 使用 estimateMessagesTokens() 替代 */
function estimateTokens(messages: ChatMessage[]): number {
  return estimateMessagesTokens(messages);
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

    const summaryText = generateStructuredSummary(truncatedMessages);

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
