/**
 * Brief命令
 * 生成当前会话的摘要，提取关键信息和决策点
 */
import type { CommandContext } from '@modules/commands/types';
import type { SessionMessage } from '@modules/session/models/SessionMessage';

interface AnalysisResult {
  type: 'text';
  value: string;
}

/**
 * Brief命令实现类
 */
export class BriefCommand {
  /**
   * 执行命令
   * @param args - 命令参数
   * @param context - 命令上下文
   */
  async call(args: string, context: CommandContext): Promise<AnalysisResult> {
    try {
      const params = args.trim().split(' ');
      const options: {
        sessionId?: string;
        maxLength?: number;
        messageCount?: number;
        summaryType?: 'concise' | 'detailed' | 'actionable';
      } = {
        sessionId: context.sessionId,
        maxLength: 1000,
        messageCount: 20,
        summaryType: 'concise',
      };

      for (const param of params) {
        if (param.startsWith('--length=')) {
          const value = parseInt(param.replace('--length=', ''), 10);
          if (!isNaN(value) && value > 0) {
            options.maxLength = value;
          }
        } else if (param.startsWith('--count=')) {
          const value = parseInt(param.replace('--count=', ''), 10);
          if (!isNaN(value) && value > 0) {
            options.messageCount = value;
          }
        } else if (param.startsWith('--type=')) {
          const type = param.replace('--type=', '');
          if (['concise', 'detailed', 'actionable'].includes(type)) {
            options.summaryType = type as 'concise' | 'detailed' | 'actionable';
          }
        }
      }

      if (!context.chatManager) {
        return {
          type: 'text',
          value: '错误：聊天管理器不可用',
        };
      }

      const messages = context.chatManager.getSessionMessages(
        options.sessionId!
      ) as unknown as SessionMessage[];

      const summary = this.generateSummary(
        messages,
        options.maxLength || 1000,
        options.messageCount || 20,
        options.summaryType || 'concise'
      );

      return {
        type: 'text',
        value: summary,
      };
    } catch (error) {
      return {
        type: 'text',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * 生成会话摘要
   */
  private generateSummary(
    messages: SessionMessage[],
    maxLength: number,
    messageCount: number,
    summaryType: 'concise' | 'detailed' | 'actionable'
  ): string {
    const recentMessages = messages.slice(-messageCount);

    if (recentMessages.length === 0) {
      return '## 会话摘要\n\n当前会话暂无消息。';
    }

    const keyPoints = this.extractKeyPoints(recentMessages);
    const decisions = this.extractDecisions(recentMessages);
    const actionItems = this.extractActionItems(recentMessages);

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
}

export const briefCommand = new BriefCommand();
