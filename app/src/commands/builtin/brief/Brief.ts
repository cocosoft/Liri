/**
 * Brief命令
 * 生成当前会话的摘要，提取关键信息和决策点
 */
import type { CommandContext } from '@modules/commands';
import type { SessionMessage } from '@modules/session';
import { insightsEngine } from '@modules/analytics';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:builtin:brief:Brief');

/**
 * 把会话消息映射为引擎输入。
 *
 * `SessionMessage` 声明的是 `type`，但 `chatManager.getSessionMessages()` 运行期
 * 返回的是 `role`（见 `generateConciseSummary` 的同款注释）⇒ 两者都认。
 */
function toConversationMessages(messages: SessionMessage[]) {
  return messages.map((message) => {
    const rawRole =
      (message as SessionMessage & { role?: string }).role ??
      message.type ??
      'system';
    const role: 'user' | 'assistant' | 'system' | 'tool' =
      rawRole === 'user' || rawRole === 'assistant' || rawRole === 'tool'
        ? rawRole
        : 'system';
    const createdAt = message.createdAt as Date | string | undefined;
    const date =
      createdAt instanceof Date
        ? createdAt
        : createdAt
          ? new Date(createdAt)
          : undefined;
    const timestamp =
      date && !Number.isNaN(date.getTime()) ? date.getTime() : undefined;
    return { role, content: message.content, timestamp };
  });
}

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

      const cm = context.chatManager as {
        getSessionMessages: (sessionId: string) => Promise<unknown[]>;
      };
      const messages = (await cm.getSessionMessages(
        options.sessionId!
      )) as SessionMessage[];

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
      return '会话摘要\n\n当前会话暂无消息。';
    }

    // 2026-10-23：提取实现统一收敛到 `InsightsEngine`（原 Brief 的私有正则已上收），
    // 本命令只负责排版与长度控制。
    const extracted = insightsEngine.extract(
      toConversationMessages(recentMessages)
    );
    const keyPoints = extracted.keyFacts;
    const decisions = extracted.decisions;
    const actionItems = extracted.actionItems;

    let summary = '';
    const header = `会话摘要\n\n`;
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

  private generateConciseSummary(
    messages: SessionMessage[],
    keyPoints: string[],
    maxLength: number
  ): string {
    let summary = '';

    summary += `会话消息数: ${messages.length}\n\n`;

    if (keyPoints.length > 0) {
      summary += `关键要点:\n`;
      for (const point of keyPoints.slice(0, 5)) {
        summary += `- ${point}\n`;
      }
      summary += '\n';
    }

    const lastMessages = messages.slice(-3);
    summary += `最近消息:\n`;
    for (const msg of lastMessages) {
      const preview =
        msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '');
      // 2026-10-22：`SessionMessage` 声明的是 `type`，但 `chatManager.getSessionMessages()`
      // 运行期返回的是 `role`（与 ChatMessage 同形）⇒ 只读 `type` 会输出 "undefined: …"。
      // 两者都认，并按实际值渲染。
      const rawRole =
        (msg as SessionMessage & { role?: string }).role ?? msg.type ?? '消息';
      const roleName =
        rawRole === 'user'
          ? '用户'
          : rawRole === 'assistant'
            ? '助手'
            : rawRole;
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

    summary += `会话概览:\n`;
    summary += `- 消息总数: ${messages.length}\n`;
    summary += `- 第一条消息时间: ${messages[0]?.createdAt ? new Date(messages[0].createdAt).toLocaleString() : '未知'}\n`;
    summary += `- 最后消息时间: ${messages[messages.length - 1]?.createdAt ? new Date(messages[messages.length - 1].createdAt).toLocaleString() : '未知'}\n\n`;

    if (keyPoints.length > 0) {
      summary += `关键要点:\n`;
      for (const point of keyPoints.slice(0, 8)) {
        summary += `- ${point}\n`;
      }
      summary += '\n';
    }

    if (decisions.length > 0) {
      summary += `决策记录:\n`;
      for (const decision of decisions.slice(0, 5)) {
        summary += `- ${decision}\n`;
      }
      summary += '\n';
    }

    if (actionItems.length > 0) {
      summary += `待办事项:\n`;
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
      summary += `关键决策点:\n`;
      for (const decision of decisions.slice(0, 5)) {
        summary += `- ${decision}\n`;
      }
      summary += '\n';
    } else {
      summary += `关键决策点:\n- 暂无明确决策\n\n`;
    }

    if (actionItems.length > 0) {
      summary += `后续行动:\n`;
      for (const item of actionItems.slice(0, 5)) {
        summary += `- ${item}\n`;
      }
      summary += '\n';
    } else {
      summary += `后续行动:\n- 暂无明确行动项\n\n`;
    }

    if (keyPoints.length > 0) {
      summary += `背景信息:\n`;
      for (const point of keyPoints.slice(0, 3)) {
        summary += `- ${point}\n`;
      }
    }

    return summary.substring(0, maxLength);
  }
}

export const briefCommand = new BriefCommand();
