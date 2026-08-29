/**
 * BriefTool
 *
 * 生成会话摘要，提取关键信息和决策点
 */

import { BaseTool } from '../BaseTool';
import chatService from '@modules/chat';
import type { ToolUseContext, ToolResult } from '../types';
import { ToolParam, ToolTag } from '../types/Tool';
import type { SessionMessage } from '@modules/session';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:BriefTool:BriefTool');

export interface BriefToolInput {
  sessionId?: string;
  maxLength?: number;
  messageCount?: number;
  summaryType?: 'concise' | 'detailed' | 'actionable';
}

export class BriefTool extends BaseTool<BriefToolInput> {
  name = 'brief';
  description = 'Generate a summary of the current session';

  override tags = [ToolTag.READ];

  params: ToolParam[] = [
    {
      name: 'sessionId',
      type: 'string',
      description: '会话ID',
      required: false,
    },
    {
      name: 'maxLength',
      type: 'number',
      description: '摘要最大长度',
      required: false,
      default: 1000,
    },
    {
      name: 'messageCount',
      type: 'number',
      description: '考虑的消息数量',
      required: false,
      default: 20,
    },
    {
      name: 'summaryType',
      type: 'string',
      description: '摘要类型: concise, detailed, actionable',
      required: false,
      default: 'concise',
    },
  ];

  override async execute(
    input: BriefToolInput,
    context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const sessionId = input.sessionId || (context as any).sessionId;
      const messages = (await chatService.getSessionMessages(
        sessionId
      )) as SessionMessage[];

      const summary = this.generateSummary(
        messages,
        input.maxLength || 1000,
        input.messageCount || 20,
        input.summaryType || 'concise'
      );

      return {
        success: true,
        output: summary,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private generateSummary(
    messages: SessionMessage[],
    maxLength: number,
    messageCount: number,
    summaryType: 'concise' | 'detailed' | 'actionable'
  ): string {
    // 获取最近的消息
    const recentMessages = messages.slice(-messageCount);

    if (recentMessages.length === 0) {
      return '## 会话摘要\n\n当前会话暂无消息。';
    }

    // 提取关键信息
    const keyPoints = this.extractKeyPoints(recentMessages);
    const decisions = this.extractDecisions(recentMessages);
    const actionItems = this.extractActionItems(recentMessages);

    // 根据摘要类型生成不同格式的摘要
    let summary = '';
    const header = `## 会话摘要\n\n`;
    const remainingLength = maxLength - header.length;

    switch (summaryType) {
      case 'detailed':
        summary = this.generateDetailedSummary(
          recentMessages,
          keyPoints,
          decisions,
          actionItems,
          remainingLength
        );
        break;
      case 'actionable':
        summary = this.generateActionableSummary(
          keyPoints,
          decisions,
          actionItems,
          remainingLength
        );
        break;
      case 'concise':
      default:
        summary = this.generateConciseSummary(
          recentMessages,
          keyPoints,
          remainingLength
        );
        break;
    }

    return header + summary;
  }

  private extractKeyPoints(messages: SessionMessage[]): string[] {
    const points: string[] = [];
    const patterns = [
      /(?:讨论|讨论了|讨论关于)\s+(.+?)(?:[。.!?\n]|$)/gi,
      /(?:问题|问题是|存在问题)\s*[:：]?\s*([^。.!?\n]+)/gi,
      /(?:需求|需求是|需要)\s*[:：]?\s*([^。.!?\n]+)/gi,
      /(?:目标|目标是)\s*[:：]?\s*([^。.!?\n]+)/gi,
    ];

    for (const msg of messages) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(msg.content)) !== null) {
          const point = match[1].trim();
          if (point && !points.includes(point)) {
            points.push(point);
          }
        }
      }
    }

    return points;
  }

  private extractDecisions(messages: SessionMessage[]): string[] {
    const decisions: string[] = [];
    const patterns = [
      /(?:决定|决定是|确定)\s*[:：]?\s*([^。.!?\n]+)/gi,
      /(?:同意|同意了)\s*([^。.!?\n]+)/gi,
      /(?:选择|选择了)\s*[:：]?\s*([^。.!?\n]+)/gi,
      /(?:采用|采用了)\s*[:：]?\s*([^。.!?\n]+)/gi,
    ];

    for (const msg of messages) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(msg.content)) !== null) {
          const decision = match[1].trim();
          if (decision && !decisions.includes(decision)) {
            decisions.push(decision);
          }
        }
      }
    }

    return decisions;
  }

  private extractActionItems(messages: SessionMessage[]): string[] {
    const items: string[] = [];
    const patterns = [
      /(?:需要|要|应该)\s*(?:做|完成|实现|处理|修改|添加)\s*([^。.!?\n]+)/gi,
      /(?:下一步|下一步是)\s*[:：]?\s*([^。.!?\n]+)/gi,
      /(?:待办|todo|TODO)\s*[:：]?\s*([^。.!?\n]+)/gi,
      /(?:任务|任务是)\s*[:：]?\s*([^。.!?\n]+)/gi,
    ];

    for (const msg of messages) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(msg.content)) !== null) {
          const item = match[1].trim();
          if (item && !items.includes(item)) {
            items.push(item);
          }
        }
      }
    }

    return items;
  }

  private generateConciseSummary(
    messages: SessionMessage[],
    keyPoints: string[],
    maxLength: number
  ): string {
    let summary = '';

    summary += `**会话消息数:** ${messages.length}\n\n`;

    if (keyPoints.length > 0) {
      summary += `**关键要点:**\n`;
      for (const point of keyPoints.slice(0, 5)) {
        summary += `- ${point}\n`;
      }
      summary += '\n';
    }

    const lastMessages = messages.slice(-3);
    summary += `**最近消息:**\n`;
    for (const msg of lastMessages) {
      const preview =
        msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '');
      const roleName =
        msg.type === 'user'
          ? '用户'
          : msg.type === 'assistant'
            ? '助手'
            : msg.type;
      summary += `${roleName}: ${preview}\n`;
    }

    return summary.substring(0, maxLength);
  }

  private generateDetailedSummary(
    messages: SessionMessage[],
    keyPoints: string[],
    decisions: string[],
    actionItems: string[],
    maxLength: number
  ): string {
    let summary = '';

    summary += `**会话概览:**\n`;
    summary += `- 消息总数: ${messages.length}\n`;
    summary += `- 第一条消息时间: ${messages[0]?.createdAt ? new Date(messages[0].createdAt).toLocaleString() : '未知'}\n`;
    summary += `- 最后消息时间: ${messages[messages.length - 1]?.createdAt ? new Date(messages[messages.length - 1].createdAt).toLocaleString() : '未知'}\n\n`;

    if (keyPoints.length > 0) {
      summary += `**关键要点:**\n`;
      for (const point of keyPoints.slice(0, 8)) {
        summary += `- ${point}\n`;
      }
      summary += '\n';
    }

    if (decisions.length > 0) {
      summary += `**决策记录:**\n`;
      for (const decision of decisions.slice(0, 5)) {
        summary += `- ${decision}\n`;
      }
      summary += '\n';
    }

    if (actionItems.length > 0) {
      summary += `**待办事项:**\n`;
      for (const item of actionItems.slice(0, 5)) {
        summary += `- ${item}\n`;
      }
      summary += '\n';
    }

    return summary.substring(0, maxLength);
  }

  private generateActionableSummary(
    keyPoints: string[],
    decisions: string[],
    actionItems: string[],
    maxLength: number
  ): string {
    let summary = '';

    if (decisions.length > 0) {
      summary += `**关键决策点:**\n`;
      for (const decision of decisions.slice(0, 5)) {
        summary += `- ${decision}\n`;
      }
      summary += '\n';
    } else {
      summary += `**关键决策点:**\n- 暂无明确决策\n\n`;
    }

    if (actionItems.length > 0) {
      summary += `**后续行动:**\n`;
      for (const item of actionItems.slice(0, 5)) {
        summary += `- ${item}\n`;
      }
      summary += '\n';
    } else {
      summary += `**后续行动:**\n- 暂无明确行动项\n\n`;
    }

    if (keyPoints.length > 0) {
      summary += `**背景信息:**\n`;
      for (const point of keyPoints.slice(0, 3)) {
        summary += `- ${point}\n`;
      }
    }

    return summary.substring(0, maxLength);
  }

  override isEnabled(): boolean {
    return true;
  }
}
