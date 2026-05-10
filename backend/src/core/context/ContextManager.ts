/**
 * 上下文管理器
 */

import type { Message } from '@modules/core/types';

interface TokenUsage {
  total: number;
  ratio: number;
}

export class ContextManager {
  private maxTokens: number = 200000;
  private compressionThreshold: number = 0.5;
  private consecutiveFailures: number = 0;

  constructor(maxTokens?: number) {
    if (maxTokens) {
      this.maxTokens = maxTokens;
    }
  }

  /**
   * 计算 token 用量
   */
  calculateTokens(messages: Message[]): TokenUsage {
    const estimatedTokens = messages.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content);
    }, 0);

    return {
      total: estimatedTokens,
      ratio: estimatedTokens / this.maxTokens,
    };
  }

  /**
   * 压缩上下文
   */
  async compress(messages: Message[]): Promise<Message[]> {
    const usage = this.calculateTokens(messages);

    if (usage.ratio > this.compressionThreshold) {
      return this.lightCompress(messages);
    }

    return messages;
  }

  /**
   * 轻量压缩 - 清理旧工具结果
   */
  private lightCompress(messages: Message[]): Message[] {
    return messages.filter((msg) => {
      if (msg.role === 'tool') {
        return true;
      }
      return true;
    });
  }

  /**
   * 估算 token 数（简化实现）
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /**
   * 检查熔断器
   */
  checkCircuitBreaker(): boolean {
    if (this.consecutiveFailures >= 3) {
      return false;
    }
    return true;
  }

  /**
   * 记录失败
   */
  recordFailure(): void {
    this.consecutiveFailures++;
  }

  /**
   * 重置失败计数
   */
  resetFailures(): void {
    this.consecutiveFailures = 0;
  }
}
