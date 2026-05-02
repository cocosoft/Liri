/**
 * 部分压缩实现（基于CC源码）
 * 支持用户选择压缩范围、方向控制、用户反馈、保留消息、边界检测
 */

import type { SessionMessage } from '../../session/models/SessionMessage';
import type { CompactionResult, CompactConversationOptions } from './types';
import { groupMessagesByApiRound } from './grouping';
import { getPartialCompactPrompt } from './prompt';
import { roughTokenCountEstimationForMessages } from './utils';

/**
 * 部分压缩方向（来自CC源码）
 */
export type PartialCompactDirection = 'from' | 'up_to';

/**
 * 部分压缩选项（来自CC源码）
 */
export interface PartialCompactOptions extends CompactConversationOptions {
  /**
   * 压缩方向
   */
  direction?: PartialCompactDirection;
  
  /**
   * 保留的消息数量
   */
  keepRecentMessages?: number;
  
  /**
   * 是否显示用户反馈
   */
  showUserFeedback?: boolean;
  
  /**
   * 是否检测API轮次边界
   */
  detectApiRoundBoundaries?: boolean;
}

/**
 * 部分压缩结果（扩展自CC源码）
 */
export interface PartialCompactResult extends CompactionResult {
  /**
   * 压缩的消息范围
   */
  compactedRange: {
    startIndex: number;
    endIndex: number;
    messageCount: number;
  };
  
  /**
   * 保留的消息范围
   */
  keptRange: {
    startIndex: number;
    endIndex: number;
    messageCount: number;
  };
  
  /**
   * 用户反馈信息
   */
  userFeedback?: string;
}

/**
 * 部分压缩服务类（基于CC源码实现）
 */
export class PartialCompactService {
  /**
   * 执行部分压缩
   * @param messages 消息列表
   * @param pivotIndex 枢轴索引
   * @param options 压缩选项
   * @returns 部分压缩结果
   */
  async partialCompact(
    messages: SessionMessage[],
    pivotIndex: number,
    options: PartialCompactOptions = {}
  ): Promise<PartialCompactResult> {
    const {
      direction = 'from',
      keepRecentMessages = 3,
      showUserFeedback = true,
      detectApiRoundBoundaries = true,
      model,
      customInstructions,
      suppressFollowUpQuestions = false,
    } = options;

    // 检测API轮次边界（来自CC源码）
    const apiRoundBoundaryIndex = detectApiRoundBoundaries
      ? this.detectApiRoundBoundary(messages, pivotIndex, direction)
      : pivotIndex;

    // 确定压缩范围
    const { messagesToSummarize, messagesToKeep } = this.determineCompactRange(
      messages,
      apiRoundBoundaryIndex,
      direction,
      keepRecentMessages
    );

    // 生成摘要
    const summary = await this.generatePartialSummary(
      messagesToSummarize,
      customInstructions
    );

    // 生成边界标记
    const boundaryMarker = this.createPartialCompactBoundaryMarker(
      direction,
      messagesToSummarize.length,
      messagesToKeep.length
    );

    // 生成用户反馈（来自CC源码）
    const userFeedback = showUserFeedback
      ? this.generateUserFeedback(messagesToSummarize.length, messagesToKeep.length)
      : undefined;

    // 计算token统计
    const preCompactTokenCount = roughTokenCountEstimationForMessages(messages);
    const postCompactTokenCount = roughTokenCountEstimationForMessages([
      ...messagesToKeep,
      ...this.createSummaryMessages(summary, suppressFollowUpQuestions),
    ]);

    return {
      boundaryMarker,
      summaryMessages: this.createSummaryMessages(summary, suppressFollowUpQuestions),
      attachments: [],
      hookResults: [],
      messagesToKeep: messagesToKeep.map(m => m.id),
      preCompactTokenCount,
      postCompactTokenCount,
      compactedRange: {
        startIndex: direction === 'up_to' ? 0 : apiRoundBoundaryIndex,
        endIndex: direction === 'up_to' ? apiRoundBoundaryIndex : messages.length - 1,
        messageCount: messagesToSummarize.length,
      },
      keptRange: {
        startIndex: direction === 'up_to' ? apiRoundBoundaryIndex : 0,
        endIndex: direction === 'up_to' ? messages.length - 1 : apiRoundBoundaryIndex - 1,
        messageCount: messagesToKeep.length,
      },
      userFeedback,
    };
  }

  /**
   * 检测API轮次边界（来自CC源码）
   * 确保压缩边界的语义完整性
   */
  private detectApiRoundBoundary(
    messages: SessionMessage[],
    pivotIndex: number,
    direction: PartialCompactDirection
  ): number {
    const groups = groupMessagesByApiRound(
      messages.map((m) => ({
        id: m.id,
        role: m.type as any,
        content: m.content,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
      }))
    );

    if (direction === 'up_to') {
      // 向前压缩：找到包含pivotIndex的API轮次
      let currentIndex = 0;
      for (const group of groups) {
        currentIndex += group.length;
        if (currentIndex > pivotIndex) {
          return Math.min(currentIndex, messages.length);
        }
      }
    } else {
      // 向后压缩：找到包含pivotIndex的API轮次
      let currentIndex = 0;
      for (const group of groups) {
        if (currentIndex <= pivotIndex && currentIndex + group.length > pivotIndex) {
          return currentIndex;
        }
        currentIndex += group.length;
      }
    }

    return pivotIndex;
  }

  /**
   * 确定压缩范围
   */
  private determineCompactRange(
    messages: SessionMessage[],
    boundaryIndex: number,
    direction: PartialCompactDirection,
    keepRecentMessages: number
  ): { messagesToSummarize: SessionMessage[]; messagesToKeep: SessionMessage[] } {
    if (direction === 'up_to') {
      // 压缩边界之前的所有消息
      const messagesToSummarize = messages.slice(0, boundaryIndex);
      const messagesToKeep = messages.slice(boundaryIndex);
      
      // 确保保留足够的最近消息
      if (messagesToKeep.length < keepRecentMessages) {
        const additionalMessages = Math.min(
          keepRecentMessages - messagesToKeep.length,
          messagesToSummarize.length
        );
        
        const keptFromSummary = messagesToSummarize.slice(-additionalMessages);
        const remainingSummary = messagesToSummarize.slice(0, -additionalMessages);
        
        return {
          messagesToSummarize: remainingSummary,
          messagesToKeep: [...keptFromSummary, ...messagesToKeep],
        };
      }
      
      return { messagesToSummarize, messagesToKeep };
    } else {
      // 压缩边界之后的所有消息
      const messagesToSummarize = messages.slice(boundaryIndex);
      const messagesToKeep = messages.slice(0, boundaryIndex);
      
      // 确保保留足够的最近消息
      if (messagesToKeep.length < keepRecentMessages) {
        const additionalMessages = Math.min(
          keepRecentMessages - messagesToKeep.length,
          messagesToSummarize.length
        );
        
        const keptFromSummary = messagesToSummarize.slice(0, additionalMessages);
        const remainingSummary = messagesToSummarize.slice(additionalMessages);
        
        return {
          messagesToSummarize: remainingSummary,
          messagesToKeep: [...messagesToKeep, ...keptFromSummary],
        };
      }
      
      return { messagesToSummarize, messagesToKeep };
    }
  }

  /**
   * 生成部分压缩摘要
   */
  private async generatePartialSummary(
    messages: SessionMessage[],
    customInstructions?: string
  ): Promise<string> {
    if (messages.length === 0) {
      return 'No messages to summarize';
    }

    // 简化实现：生成基础摘要
    // 实际实现应该调用AI服务生成更智能的摘要
    const prompt = getPartialCompactPrompt();
    
    let summary = 'Partial Conversation Summary:\n\n';
    
    messages.forEach((msg, index) => {
      summary += `[${index + 1}] [${msg.type}] ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`;
    });

    if (customInstructions) {
      summary += `\nCustom Instructions: ${customInstructions}\n`;
    }

    return summary;
  }

  /**
   * 创建部分压缩边界标记
   */
  private createPartialCompactBoundaryMarker(
    direction: PartialCompactDirection,
    compressedCount: number,
    keptCount: number
  ): string {
    return `[Partial compaction boundary - ${direction} - compressed ${compressedCount} messages, kept ${keptCount} messages - ${new Date().toISOString()}]`;
  }

  /**
   * 生成用户反馈（来自CC源码）
   */
  private generateUserFeedback(compressedCount: number, keptCount: number): string {
    return `Compressed ${compressedCount} messages, kept ${keptCount} recent messages. The conversation has been summarized to save context.`;
  }

  /**
   * 创建摘要消息
   */
  private createSummaryMessages(summary: string, suppressFollowUpQuestions: boolean): string[] {
    const summaryMessage = `Conversation Summary:\n\n${summary}`;
    
    if (suppressFollowUpQuestions) {
      return [summaryMessage];
    }
    
    return [
      summaryMessage,
      'Please continue with the conversation. The full history is available if needed.',
    ];
  }

  /**
   * 验证部分压缩参数（来自CC源码）
   */
  validatePartialCompactParams(
    messages: SessionMessage[],
    pivotIndex: number,
    direction: PartialCompactDirection
  ): { valid: boolean; error?: string } {
    if (messages.length === 0) {
      return { valid: false, error: 'No messages to compact' };
    }

    if (pivotIndex < 0 || pivotIndex >= messages.length) {
      return { valid: false, error: 'Invalid pivot index' };
    }

    if (direction === 'up_to' && pivotIndex === 0) {
      return { valid: false, error: 'Cannot compact up to the first message' };
    }

    if (direction === 'from' && pivotIndex === messages.length - 1) {
      return { valid: false, error: 'Cannot compact from the last message' };
    }

    return { valid: true };
  }
}