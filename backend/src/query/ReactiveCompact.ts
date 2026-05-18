/**
 * 响应式压缩服务（参考CC源码 cc_code/backend/services/compact/ 中ReactiveCompact）
 * 根据API响应动态压缩上下文
 */

import type { SessionMessage } from '../session/models/SessionMessage';
import {
  createContextCollapser,
  type ContextCollapser,
  type CollapseResult,
} from './ContextCollapse';
import { roughTokenCountEstimationForMessages } from '../services/compact/utils';

export interface ReactiveCompactConfig {
  maxTokens: number;
  safetyMargin: number;
  compressionRatio: number;
  minMessagesToCompact: number;
}

export interface ReactiveCompactResult {
  collapsedMessages: SessionMessage[];
  originalTokenCount: number;
  collapsedTokenCount: number;
  wasCompressed: boolean;
  compressionLevel: 'none' | 'light' | 'medium' | 'heavy';
}

export interface ReactiveCompactor {
  compactIfNeeded(
    messages: SessionMessage[],
    apiResponse?: ApiResponseInfo
  ): Promise<ReactiveCompactResult>;
  getCompressionLevel(
    messages: SessionMessage[]
  ): 'none' | 'light' | 'medium' | 'heavy';
}

export interface ApiResponseInfo {
  statusCode?: number;
  errorMessage?: string;
  retryAfterMs?: number;
  contextLimitExceeded?: boolean;
}

export class ReactiveCompactorImpl implements ReactiveCompactor {
  private config: ReactiveCompactConfig;
  private contextCollapser: ContextCollapser;

  constructor(config: Partial<ReactiveCompactConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens || 200_000,
      safetyMargin: config.safetyMargin || 0.1,
      compressionRatio: config.compressionRatio || 0.5,
      minMessagesToCompact: config.minMessagesToCompact || 5,
    };
    this.contextCollapser = createContextCollapser();
  }

  async compactIfNeeded(
    messages: SessionMessage[],
    apiResponse?: ApiResponseInfo
  ): Promise<ReactiveCompactResult> {
    const originalTokenCount = roughTokenCountEstimationForMessages(messages);
    const effectiveMaxTokens =
      this.config.maxTokens * (1 - this.config.safetyMargin);

    // 检查是否需要压缩
    const needsCompression = this.needsCompression(
      messages,
      apiResponse,
      originalTokenCount,
      effectiveMaxTokens
    );

    if (!needsCompression) {
      return {
        collapsedMessages: messages,
        originalTokenCount,
        collapsedTokenCount: originalTokenCount,
        wasCompressed: false,
        compressionLevel: 'none',
      };
    }

    // 确定压缩级别
    let compressionLevel = this.getCompressionLevel(messages);
    // 当API强制要求压缩但使用率低于阈值时，至少使用轻度压缩
    if (compressionLevel === 'none' && needsCompression) {
      compressionLevel = 'light';
    }

    // 根据压缩级别确定目标Token数
    let targetTokens = originalTokenCount;
    switch (compressionLevel) {
      case 'light':
        targetTokens = Math.floor(originalTokenCount * 0.8);
        break;
      case 'medium':
        targetTokens = Math.floor(originalTokenCount * 0.5);
        break;
      case 'heavy':
        targetTokens = Math.floor(originalTokenCount * 0.3);
        break;
    }

    // 执行压缩
    const collapseResult = await this.contextCollapser.collapse(messages, {
      maxTokens: Math.min(targetTokens, effectiveMaxTokens),
      preserveRecentMessages:
        compressionLevel === 'heavy'
          ? 1
          : compressionLevel === 'medium'
            ? 2
            : 3,
    });

    // 转换回SessionMessage格式
    const collapsedMessages = collapseResult.collapsedMessages.map(
      (msg, index) => ({
        id: index === 0 ? `collapsed_summary_${Date.now()}` : `msg_${index}`,
        type:
          index === 0 ? 'system' : msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ) as unknown as SessionMessage[];

    return {
      collapsedMessages,
      originalTokenCount,
      collapsedTokenCount: collapseResult.collapsedTokenCount,
      wasCompressed: true,
      compressionLevel,
    };
  }

  getCompressionLevel(
    messages: SessionMessage[]
  ): 'none' | 'light' | 'medium' | 'heavy' {
    const tokenCount = roughTokenCountEstimationForMessages(messages);
    const effectiveMaxTokens =
      this.config.maxTokens * (1 - this.config.safetyMargin);
    const usageRatio = tokenCount / effectiveMaxTokens;

    if (usageRatio < 0.6) return 'none';
    if (usageRatio < 0.8) return 'light';
    if (usageRatio < 0.95) return 'medium';
    return 'heavy';
  }

  private needsCompression(
    messages: SessionMessage[],
    apiResponse: ApiResponseInfo | undefined,
    tokenCount: number,
    effectiveMaxTokens: number
  ): boolean {
    // 如果消息太少，不压缩
    if (messages.length < this.config.minMessagesToCompact) {
      return false;
    }

    // 如果API响应指示上下文超限，强制压缩
    if (
      apiResponse?.contextLimitExceeded ||
      apiResponse?.statusCode === 413 ||
      (apiResponse?.errorMessage?.toLowerCase().includes('context') &&
        apiResponse?.errorMessage?.toLowerCase().includes('limit'))
    ) {
      return true;
    }

    // 如果Token使用超过安全阈值，压缩
    if (tokenCount > effectiveMaxTokens) {
      return true;
    }

    return false;
  }
}

export function createReactiveCompactor(
  config?: Partial<ReactiveCompactConfig>
): ReactiveCompactor {
  return new ReactiveCompactorImpl(config);
}
