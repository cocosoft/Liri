/**
 * SaveConversationTool
 *
 * 当用户要求保存对话记录时，使用此工具总结整个对话并保存到文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolParam, ToolTag } from '../types/Tool';
import type { ToolUseContext, ToolResult } from '../types';
import { createToolResult } from '../types/ToolResult';
import chatService from '@modules/chat';
import type { SessionMessage } from '@modules/session/models/SessionMessage';
import { resolveDataDir } from '@modules/core/paths';

export interface SaveConversationInput {
  sessionId?: string;
  summaryType?: 'concise' | 'detailed' | 'actionable';
  maxLength?: number;
}

export class SaveConversationTool extends BaseTool<SaveConversationInput> {
  name = 'save_conversation';
  description =
    'Save a conversation summary to a file. Use this when the user wants to save or record the current conversation.';

  override tags = [ToolTag.WRITE];

  params: ToolParam[] = [
    {
      name: 'sessionId',
      type: 'string',
      description: '会话ID',
      required: false,
    },
    {
      name: 'summaryType',
      type: 'string',
      description: '摘要类型: concise, detailed, actionable',
      required: false,
      default: 'concise',
    },
    {
      name: 'maxLength',
      type: 'number',
      description: '摘要最大长度',
      required: false,
      default: 2000,
    },
  ];

  override async execute(
    input: SaveConversationInput,
    context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const sessionId = input.sessionId || (context as any).sessionId;
      const messages = (await chatService.getSessionMessages(
        sessionId
      )) as SessionMessage[];

      if (messages.length === 0) {
        return createToolResult('当前会话暂无消息，无法保存记录。', {
          newMessages: [{ role: 'system', content: '当前会话暂无消息' }],
        });
      }

      const summary = this.generateConversationSummary(
        messages,
        input.summaryType || 'concise',
        input.maxLength || 2000
      );

      const saveDir = path.join(resolveDataDir(), 'transcripts');
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const fileName = `conversation-${timestamp}.md`;
      const filePath = path.join(saveDir, fileName);

      fs.writeFileSync(filePath, summary, 'utf-8');

      const result = `✅ 对话记录已保存到: ${filePath}\n\n${summary}`;

      return createToolResult(result, {
        newMessages: [
          {
            role: 'system',
            content: `对话记录已成功保存到文件: ${filePath}`,
          },
        ],
      });
    } catch (error) {
      return createToolResult(`保存对话记录失败: ${(error as Error).message}`, {
        newMessages: [
          {
            role: 'system',
            content: `保存失败: ${(error as Error).message}`,
          },
        ],
      });
    }
  }

  private generateConversationSummary(
    messages: SessionMessage[],
    _summaryType: string,
    maxLength: number
  ): string {
    const lines: string[] = [];

    lines.push('# Liri 对话记录');
    lines.push('');
    lines.push(`> 保存时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push(`> 消息总数: ${messages.length}`);
    lines.push('');

    const conversationMessages = messages.filter(
      (m) => m.type === 'user' || m.type === 'assistant'
    );

    for (const msg of conversationMessages) {
      const role = msg.type === 'user' ? '## 用户' : '## Liri';
      const time = msg.createdAt
        ? new Date(msg.createdAt).toLocaleString('zh-CN')
        : '';

      lines.push(`${role}${time ? ` (${time})` : ''}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    }

    let result = lines.join('\n');

    if (result.length > maxLength) {
      result = result.substring(0, maxLength) + '\n\n...（内容已截断）';
    }

    return result;
  }

  override isReadOnly(): boolean {
    return false;
  }

  override isConcurrencySafe(): boolean {
    return false;
  }

  override isDestructive(): boolean {
    return false;
  }
}
