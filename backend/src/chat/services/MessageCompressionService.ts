/**
 * 消息压缩服务
 * 参考CC源码 services/compact/compact.ts 实现
 */

import type { Message, SystemMessage } from '../types/message.js';
import {
  createCompactBoundaryMessage,
  createMicrocompactBoundaryMessage,
} from '@modules/utils/messages.js';

export interface CompressionConfig {
  /** 最大消息数触发压缩 */
  maxMessages: number;
  /** 最大令牌数触发压缩 */
  maxTokens: number;
  /** 是否启用部分压缩 */
  enablePartial: boolean;
  /** 微型压缩阈值（消息数） */
  microCompactThreshold: number;
  /** 保留的最近消息数 */
  keepRecentMessages: number;
}

export interface CompressionResult {
  /** 是否执行了压缩 */
  compressed: boolean;
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 压缩摘要 */
  summary?: string;
  /** 压缩前的消息数 */
  beforeCount: number;
  /** 压缩后的消息数 */
  afterCount: number;
  /** 压缩类型 */
  type: 'full' | 'partial' | 'micro';
}

export interface CompressionMetadata {
  trigger: 'message_count' | 'token_count' | 'manual';
  preTokens: number;
  preservedSegment?: {
    headUuid: string;
    anchorUuid: string;
    tailUuid: string;
  };
}

const DEFAULT_CONFIG: CompressionConfig = {
  maxMessages: 50,
  maxTokens: 10000,
  enablePartial: true,
  microCompactThreshold: 10,
  keepRecentMessages: 5,
};

/**
 * 消息压缩服务
 */
export class MessageCompressionService {
  private config: CompressionConfig;

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 估算消息的令牌数
   * @param messages 消息列表
   * @returns 估算的令牌数
   */
  estimateTokens(messages: Message[]): number {
    const totalText = messages.map((m) => m.content || '').join(' ');
    // 粗略估算：平均每个令牌4个字符
    return Math.ceil(totalText.length / 4);
  }

  /**
   * 检查是否需要压缩
   * @param messages 消息列表
   * @returns 是否需要压缩
   */
  needsCompression(messages: Message[]): boolean {
    const messageCount = messages.length;
    const tokenCount = this.estimateTokens(messages);

    return (
      messageCount >= this.config.maxMessages ||
      tokenCount >= this.config.maxTokens
    );
  }

  /**
   * 检查是否需要微型压缩
   * @param messages 消息列表
   * @returns 是否需要微型压缩
   */
  needsMicroCompression(messages: Message[]): boolean {
    return messages.length >= this.config.microCompactThreshold;
  }

  /**
   * 获取压缩触发器类型
   * @param messages 消息列表
   * @returns 触发器类型
   */
  getCompressionTrigger(messages: Message[]): CompressionMetadata['trigger'] {
    const messageCount = messages.length;
    const tokenCount = this.estimateTokens(messages);

    if (tokenCount >= this.config.maxTokens) {
      return 'token_count';
    }
    if (messageCount >= this.config.maxMessages) {
      return 'message_count';
    }
    return 'manual';
  }

  /**
   * 生成压缩摘要提示
   */
  private buildCompressionPrompt(messages: Message[]): string {
    const recentMessages = messages.slice(-this.config.keepRecentMessages);
    const messagesToSummarize = messages.slice(
      0,
      -this.config.keepRecentMessages
    );

    const context = messagesToSummarize
      .map((m, idx) => {
        const role =
          m.role === 'user'
            ? 'User'
            : m.role === 'assistant'
              ? 'Assistant'
              : 'System';
        return `${idx + 1}. ${role}: ${m.content.slice(0, 200)}`;
      })
      .join('\n');

    return `Summarize the following conversation concisely:\n\n${context}\n\nSummary:`;
  }

  /**
   * 生成压缩摘要
   * @param messages 消息列表
   * @returns 摘要字符串
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    // 模拟AI摘要生成（实际使用时调用AI模型）
    const prompt = this.buildCompressionPrompt(messages);

    // 模拟摘要结果
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    return `Conversation summary: ${userMessages.length} user messages, ${assistantMessages.length} assistant messages`;
  }

  /**
   * 执行完整压缩
   * @param messages 消息列表
   * @returns 压缩结果
   */
  async compress(messages: Message[]): Promise<CompressionResult> {
    if (!this.needsCompression(messages)) {
      return {
        compressed: false,
        messages,
        beforeCount: messages.length,
        afterCount: messages.length,
        type: 'full',
      };
    }

    const beforeCount = messages.length;
    const trigger = this.getCompressionTrigger(messages);
    const preTokens = this.estimateTokens(messages);

    // 获取需要保留的最近消息
    const recentMessages = messages.slice(-this.config.keepRecentMessages);

    // 获取需要压缩的消息
    const messagesToCompress = messages.slice(
      0,
      -this.config.keepRecentMessages
    );

    // 生成摘要
    const summary = await this.generateSummary(messagesToCompress);

    // 创建压缩边界消息
    const boundaryMessage = createCompactBoundaryMessage({
      summary,
      direction: 'from',
    }) as SystemMessage;

    // 添加压缩元数据
    boundaryMessage.metadata = {
      compactMetadata: {
        trigger,
        preTokens,
        preservedSegment: {
          headUuid: messagesToCompress[0]?.id || '',
          anchorUuid:
            messagesToCompress[Math.floor(messagesToCompress.length / 2)]?.id ||
            '',
          tailUuid: messagesToCompress[messagesToCompress.length - 1]?.id || '',
        },
      },
    };

    // 构建压缩后的消息列表
    const compressedMessages = [boundaryMessage, ...recentMessages];

    return {
      compressed: true,
      messages: compressedMessages,
      summary,
      beforeCount,
      afterCount: compressedMessages.length,
      type: 'full',
    };
  }

  /**
   * 执行部分压缩
   * @param messages 消息列表
   * @param direction 压缩方向
   * @returns 压缩结果
   */
  async partialCompress(
    messages: Message[],
    direction: 'from' | 'up_to'
  ): Promise<CompressionResult> {
    if (!this.config.enablePartial) {
      return {
        compressed: false,
        messages,
        beforeCount: messages.length,
        afterCount: messages.length,
        type: 'partial',
      };
    }

    const beforeCount = messages.length;
    const trigger = this.getCompressionTrigger(messages);
    const preTokens = this.estimateTokens(messages);

    // 根据方向决定压缩哪部分
    let messagesToCompress: Message[];
    let remainingMessages: Message[];

    if (direction === 'from') {
      // 从开头压缩，保留末尾
      const splitIndex = Math.floor(messages.length / 2);
      messagesToCompress = messages.slice(0, splitIndex);
      remainingMessages = messages.slice(splitIndex);
    } else {
      // 压缩到指定位置，保留开头
      const splitIndex = Math.floor(messages.length / 2);
      messagesToCompress = messages.slice(splitIndex);
      remainingMessages = messages.slice(0, splitIndex);
    }

    // 生成摘要
    const summary = await this.generateSummary(messagesToCompress);

    // 创建压缩边界消息
    const boundaryMessage = createCompactBoundaryMessage({
      summary,
      direction,
    }) as SystemMessage;

    boundaryMessage.metadata = {
      compactMetadata: {
        trigger,
        preTokens,
      },
    };

    // 构建压缩后的消息列表
    const compressedMessages =
      direction === 'from'
        ? [boundaryMessage, ...remainingMessages]
        : [...remainingMessages, boundaryMessage];

    return {
      compressed: true,
      messages: compressedMessages,
      summary,
      beforeCount,
      afterCount: compressedMessages.length,
      type: 'partial',
    };
  }

  /**
   * 执行微型压缩
   * @param messages 消息列表
   * @returns 压缩结果
   */
  async microCompress(messages: Message[]): Promise<CompressionResult> {
    if (!this.needsMicroCompression(messages)) {
      return {
        compressed: false,
        messages,
        beforeCount: messages.length,
        afterCount: messages.length,
        type: 'micro',
      };
    }

    const beforeCount = messages.length;

    // 获取最近的消息
    const recentMessages = messages.slice(-3);

    // 获取需要压缩的消息
    const messagesToCompress = messages.slice(0, -3);

    if (messagesToCompress.length === 0) {
      return {
        compressed: false,
        messages,
        beforeCount,
        afterCount: messages.length,
        type: 'micro',
      };
    }

    // 生成简短摘要
    const summary = `(${messagesToCompress.length} messages compressed)`;

    // 创建微型压缩边界消息
    const boundaryMessage = createMicrocompactBoundaryMessage(
      summary
    ) as SystemMessage;

    // 构建压缩后的消息列表
    const compressedMessages = [boundaryMessage, ...recentMessages];

    return {
      compressed: true,
      messages: compressedMessages,
      summary,
      beforeCount,
      afterCount: compressedMessages.length,
      type: 'micro',
    };
  }

  /**
   * 检查消息是否是压缩边界消息
   * @param message 消息
   * @returns 是否是压缩边界消息
   */
  isCompactBoundaryMessage(message: Message): boolean {
    return (
      message.subtype === 'compact_boundary' ||
      message.subtype === 'micro_compact_boundary'
    );
  }

  /**
   * 获取压缩边界后的消息
   * @param messages 消息列表
   * @returns 压缩边界后的消息
   */
  getMessagesAfterCompactBoundary(messages: Message[]): Message[] {
    const lastBoundaryIndex = [...messages]
      .reverse()
      .findIndex((m) => this.isCompactBoundaryMessage(m));

    if (lastBoundaryIndex === -1) {
      return messages;
    }

    return messages.slice(messages.length - lastBoundaryIndex);
  }

  /**
   * 获取压缩边界前的消息
   * @param messages 消息列表
   * @returns 压缩边界前的消息
   */
  getMessagesBeforeCompactBoundary(messages: Message[]): Message[] {
    const firstBoundaryIndex = messages.findIndex((m) =>
      this.isCompactBoundaryMessage(m)
    );

    if (firstBoundaryIndex === -1) {
      return messages;
    }

    return messages.slice(0, firstBoundaryIndex);
  }

  /**
   * 统计压缩次数
   * @param messages 消息列表
   * @returns 压缩次数
   */
  countCompactionBoundaries(messages: Message[]): number {
    return messages.filter((m) => this.isCompactBoundaryMessage(m)).length;
  }
}

export const messageCompressionService = new MessageCompressionService();
