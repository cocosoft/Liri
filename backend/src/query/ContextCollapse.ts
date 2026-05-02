/**
 * 上下文折叠服务（参考CC源码 cc_code/backend/ 中ContextCollapse相关实现）
 * 将长上下文折叠为摘要，保留关键信息
 */

import type { SessionMessage } from '../session/models/SessionMessage';
import type { AIMessage } from '../ai/models/types';
import { AIMessageRole } from '../ai/models/types';
import { roughTokenCountEstimationForMessages } from '../services/compact/utils';

export interface CollapseOptions {
  maxTokens?: number;
  preserveRecentMessages?: number;
  preserveKeyPoints?: boolean;
  summaryModel?: string;
}

export interface CollapseResult {
  collapsedMessages: AIMessage[];
  originalTokenCount: number;
  collapsedTokenCount: number;
  summary?: string;
  preservedMessageIds: string[];
}

export interface ContextCollapser {
  collapse(messages: SessionMessage[], options?: CollapseOptions): Promise<CollapseResult>;
  estimateCollapseRatio(messages: SessionMessage[], maxTokens: number): number;
}

export class ContextCollapserImpl implements ContextCollapser {
  private readonly defaultMaxTokens: number = 100_000;
  private readonly defaultPreserveRecent: number = 3;

  async collapse(messages: SessionMessage[], options: CollapseOptions = {}): Promise<CollapseResult> {
    const maxTokens = options.maxTokens || this.defaultMaxTokens;
    const preserveRecent = options.preserveRecentMessages || this.defaultPreserveRecent;

    const originalTokenCount = roughTokenCountEstimationForMessages(messages);
    
    if (originalTokenCount <= maxTokens) {
      return {
        collapsedMessages: messages.map(this.convertToAIMessage),
        originalTokenCount,
        collapsedTokenCount: originalTokenCount,
        preservedMessageIds: messages.map(m => m.id),
      };
    }

    // 保留最近的消息
    const recentMessages = messages.slice(-preserveRecent);
    
    // 对早期消息进行摘要
    const messagesToSummarize = messages.slice(0, -preserveRecent);
    const summary = this.generateSummary(messagesToSummarize);
    
    // 构建折叠后的消息
    const collapsedMessages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: `[Context Collapsed - Summary of ${messagesToSummarize.length} messages]\n\n${summary}`,
      },
      ...recentMessages.map(this.convertToAIMessage),
    ];

    const collapsedTokenCount = roughTokenCountEstimationForMessages(
      collapsedMessages as any
    );

    return {
      collapsedMessages,
      originalTokenCount,
      collapsedTokenCount,
      summary,
      preservedMessageIds: recentMessages.map(m => m.id),
    };
  }

  estimateCollapseRatio(messages: SessionMessage[], maxTokens: number): number {
    const currentTokens = roughTokenCountEstimationForMessages(messages);
    
    if (currentTokens <= maxTokens) {
      return 1.0;
    }
    
    return maxTokens / currentTokens;
  }

  private convertToAIMessage(message: SessionMessage): AIMessage {
    return {
      role: message.type === 'user' ? AIMessageRole.USER : AIMessageRole.ASSISTANT,
      content: message.content,
    };
  }

  private generateSummary(messages: SessionMessage[]): string {
    if (messages.length === 0) {
      return 'No messages to summarize.';
    }

    let summary = 'Conversation Summary:\n\n';
    let userRequests: string[] = [];
    let keyPoints: string[] = [];
    
    messages.forEach((msg) => {
      const content = msg.content;
      
      if (msg.type === 'user') {
        userRequests.push(content.substring(0, 200));
      } else {
        // 提取关键点
        if (content.includes('```')) {
          keyPoints.push('• Code was provided');
        }
        if (content.toLowerCase().includes('error') || content.toLowerCase().includes('failed')) {
          keyPoints.push('• Error occurred');
        }
        if (content.toLowerCase().includes('success') || content.toLowerCase().includes('completed')) {
          keyPoints.push('• Task completed successfully');
        }
        if (content.toLowerCase().includes('file') && 
            (content.toLowerCase().includes('created') || 
             content.toLowerCase().includes('modified') || 
             content.toLowerCase().includes('deleted'))) {
          keyPoints.push('• File operation performed');
        }
      }
    });

    if (userRequests.length > 0) {
      summary += `**User Requests:**\n${userRequests.map((req, i) => `${i + 1}. ${req}`).join('\n')}\n\n`;
    }
    
    if (keyPoints.length > 0) {
      summary += `**Key Points:**\n${[...new Set(keyPoints)].join('\n')}\n`;
    }
    
    summary += `\n**Total messages summarized:** ${messages.length}`;
    
    return summary;
  }
}

export function createContextCollapser(): ContextCollapser {
  return new ContextCollapserImpl();
}