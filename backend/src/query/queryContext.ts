/**
 * 查询上下文（基于 ContextBuilder 重构）
 * 提供动态系统提示词构建、用户上下文和系统上下文的获取功能
 */
import { getContextBuilder, type SystemPromptParts } from '../context/index';
import type { Message } from '../chat/types/message.js';
import type { ToolCall } from '../chat/types/tool.js';

export type { SystemPromptParts };

/**
 * 获取系统提示词部件
 * @deprecated 功能已迁移至 systemPromptSections。请使用 PromptAssembler.assembleSystemPrompt() 替代。
 */
export async function fetchSystemPromptParts(options?: {
  customSystemPrompt?: string;
}): Promise<SystemPromptParts> {
  if (options?.customSystemPrompt) {
    return {
      basePrompt: [options.customSystemPrompt],
      userContext: { platform: process.platform, cwd: process.cwd() },
      systemContext: {},
    };
  }

  const builder = getContextBuilder();
  await builder.initialize();
  return builder.buildSystemPrompt();
}

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
