/**
 * BriefTool
 *
 * 生成会话摘要，提取关键信息和决策点
 */

import { BaseTool } from '../BaseTool';
import chatService from '../../chat';
import type { ToolContext, ToolResult } from '../../types';

export interface BriefToolInput {
  sessionId?: string;
  maxLength?: number;
  messageCount?: number;
  summaryType?: 'concise' | 'detailed' | 'actionable';
}

export class BriefTool extends BaseTool<BriefToolInput> {
  name = 'brief';
  description = 'Generate a summary of the current session';

  async execute(
    input: BriefToolInput,
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      const messages = await chatService.getSessionMessages(input.sessionId || context.sessionId);

      const summary = await this.generateSummary(
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

  private async generateSummary(
    messages: any[],
    maxLength: number,
    messageCount: number,
    summaryType: 'concise' | 'detailed' | 'actionable'
  ): Promise<string> {
    // 简单实现：提取最近的消息并生成摘要
    const recentMessages = messages.slice(-messageCount);
    const content = recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    // 根据摘要类型生成不同格式的摘要
    let summary = '';
    switch (summaryType) {
      case 'detailed':
        summary = `## 详细会话摘要\n\n${content.substring(0, maxLength)}`;
        break;
      case 'actionable':
        summary = `## 可操作会话摘要\n\n**关键决策点:**\n- 待补充\n\n**后续行动:**\n- 待补充\n\n${content.substring(0, maxLength - 200)}`;
        break;
      case 'concise':
      default:
        summary = `## 会话摘要\n\n${content.substring(0, maxLength)}`;
        break;
    }

    return summary;
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }
}