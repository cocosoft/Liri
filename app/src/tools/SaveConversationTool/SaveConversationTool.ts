import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
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
import type { SessionMessage } from '@modules/session';
import { loadSessionMessages } from '../sessionMessageSource';
import { resolveScopedDataDir } from '@openliri/kernel';

import { getLogger } from '@modules/monitoring';
import { DEFAULT_LOCALE } from '@modules/constants';
const logger = getLogger('tools:SaveConversationTool:SaveConversationTool');

export interface SaveConversationInput {
  sessionId?: string;
  summaryType?: 'concise' | 'detailed' | 'actionable';
  maxLength?: number;
}

export class SaveConversationTool extends BaseTool<SaveConversationInput> {
  name = TOOL_NAME_CONSTANTS.save_conversation;
  description = '将对话摘要保存到文件。当用户希望保存或记录当前对话时使用。';

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
      // 2026-10-23：改走 CoreAPI（身份作用域 + 真实消息源），不再读旧 chatService
      const messages = sessionId ? await loadSessionMessages(sessionId) : [];

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

      // 2026-10-23：产物目录按身份分区（本地身份与原 resolveDataDir 逐字相同；
      // 已认证身份 ⇒ `tenants/<t>/users/<u>/transcripts`）
      const saveDir = path.join(resolveScopedDataDir(), 'transcripts');
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
    lines.push(`> 保存时间: ${new Date().toLocaleString(DEFAULT_LOCALE)}`);
    lines.push(`> 消息总数: ${messages.length}`);
    lines.push('');

    const conversationMessages = messages.filter(
      (m) => m.type === 'user' || m.type === 'assistant'
    );

    for (const msg of conversationMessages) {
      const role = msg.type === 'user' ? '## 用户' : '## Liri';
      const time = msg.createdAt
        ? new Date(msg.createdAt).toLocaleString(DEFAULT_LOCALE)
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
