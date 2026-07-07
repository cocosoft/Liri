// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 聊天辅助工具类
 * 从 ChatManager 拆分出的纯函数和轻量依赖方法，不依赖 ChatManager 的 this 上下文
 */
import type { Message } from '../types/message.js';
import { MessageRole } from '../types/message.js';
import { SessionState } from '../types/session.js';
import type { ToolResult } from '../types/tool.js';
import type { TodoBlockData } from '@modules/runtime/api/todo-types.js';
import { MessageType as SessionMessageType } from '@modules/session/types/Message';
import { getAIModelManager } from '@modules/ai';

/**
 * 将 Message 角色映射为 SessionMessageType
 */
export function toSessionMsgType(message: Message): SessionMessageType {
  if (message.role === MessageRole.USER) return SessionMessageType.USER;
  if (message.role === MessageRole.ASSISTANT)
    return SessionMessageType.ASSISTANT;
  if (message.role === MessageRole.TOOL) return SessionMessageType.TOOL_RESULT;
  return SessionMessageType.SYSTEM;
}

/**
 * 单轮清理：从后往前遍历，移除 tool_calls 未得到完整响应的 assistant 消息
 */
export function sanitizePass(apiMessages: Record<string, unknown>[]): void {
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const msg = apiMessages[i];

    if (
      msg.role === 'assistant' &&
      Array.isArray(msg.tool_calls) &&
      (msg.tool_calls as Array<{ id?: string }>).length > 0
    ) {
      const pendingIds = new Set<string>();
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) pendingIds.add(tc.id);
      }

      if (pendingIds.size === 0) continue;

      let j = i + 1;
      while (j < apiMessages.length && apiMessages[j]?.role === 'tool') {
        const toolMsg = apiMessages[j];
        if (toolMsg.tool_call_id) {
          pendingIds.delete(toolMsg.tool_call_id as string);
        }
        j++;
      }

      if (pendingIds.size > 0) {
        // 有未响应的 tool_call_id：删除此 assistant 及紧随其后的 tool 消息
        apiMessages.splice(i, 1);
        while (i < apiMessages.length && apiMessages[i]?.role === 'tool') {
          apiMessages.splice(i, 1);
        }
      }
    }
  }
}

/**
 * 将会话状态字符串映射为 SessionState 枚举
 */
export function mapSessionStatusToState(status: string): SessionState {
  switch (status) {
    case 'active':
    case 'running':
      return SessionState.ACTIVE;
    case 'paused':
      return SessionState.PAUSED;
    case 'ended':
    case 'completed':
    case 'aborted':
      return SessionState.ENDED;
    case 'archived':
      return SessionState.ARCHIVED;
    default:
      return SessionState.ACTIVE;
  }
}

/**
 * 从工具执行结果中提取 TodoBlockData
 */
export function extractTodoData(toolResult: ToolResult): TodoBlockData | null {
  const result = toolResult as unknown as {
    metadata?: Record<string, unknown>;
  };
  const metadata = result.metadata;
  if (!metadata?._todoData) return null;

  const raw = metadata._todoData as Record<string, unknown>;

  if (Array.isArray(raw.tasks)) {
    return {
      title: (raw.title as string) || '任务计划',
      tasks: raw.tasks as TodoBlockData['tasks'],
      phase: (raw.phase as TodoBlockData['phase']) || 'planning',
      createdAt: Date.now(),
    };
  }
  return null;
}

import { ImageUrlHelper } from '../../tools/ImageUrlHelper';

/**
 * 修复 AI 响应中错误的图片 URL
 *
 * 委托给 ImageUrlHelper.repairAll，统一处理：
 * - Markdown 图片语法 ![alt](错误路径)
 * - 磁盘绝对路径 E:\...\filename.png
 * - 各种错误 URL 格式
 */
export function repairImageUrls(content: string): string {
  return ImageUrlHelper.repairAll(content);
}
export function resolveMaxContextTokens(model?: string): number {
  if (model) {
    try {
      const ctx = getAIModelManager().getContextWindow(model);
      if (ctx > 0) return ctx;
    } catch {
      // 模型未注册等情况，使用默认值
    }
  }
  return 128_000;
}
