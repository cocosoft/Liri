/**
 * 查询上下文（基于 ContextBuilder 重构）
 * 提供动态系统提示词构建、用户上下文和系统上下文的获取功能
 */
import type { SystemPromptParts } from '../context/index';
import type { Message } from '@modules/session/types/message.js';
import type { ToolCall } from '@modules/session/types/tool.js';

export type { SystemPromptParts };

export function isResultSuccessful(
  message: Message | undefined,
  stopReason: string | null = null
): boolean {
  if (stopReason === 'end_turn' || stopReason === 'stop') return true;
  if (!message) return false;
  if (message.role === 'assistant' || message.role === 'user') {
    const content = typeof message.content === 'string' ? message.content : '';
    return content.length > 0;
  }
  return false;
}

export function normalizeMessage(message: Message): Message {
  return {
    ...message,
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
  };
}

export async function handleOrphanedPermission(
  _toolCall: ToolCall,
  _context: { sessionId: string }
): Promise<{ handled: boolean; result?: string }> {
  return { handled: false };
}
