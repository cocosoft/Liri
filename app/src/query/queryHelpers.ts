/**
 * 查询辅助函数
 * 参考CC源码 cc_code/backend/utils/queryHelpers.ts 实现
 * 提供查询结果判断、权限处理等辅助功能
 */

import type { Message } from '../chat/types/message.js';
import type { ToolCall, ToolResult } from '../chat/types/tool.js';

/**
 * 工具进度跟踪配置
 */
const MAX_TOOL_PROGRESS_TRACKING_ENTRIES = 100;
const TOOL_PROGRESS_THROTTLE_MS = 30000;
const toolProgressLastSentTime = new Map<string, number>();

/**
 * 检查查询结果是否成功
 * @param message 最后一条消息
 * @param stopReason 停止原因
 * @returns 是否成功
 */
export function isResultSuccessful(
  message: Message | undefined,
  stopReason: string | null = null
): message is Message {
  if (!message) return false;

  if (message.role === 'assistant') {
    const content = typeof message.content === 'string' ? message.content : '';
    return content.length > 0;
  }

  if (message.role === 'user') {
    const content = typeof message.content === 'string' ? message.content : '';
    return content.length > 0;
  }

  return stopReason === 'end_turn' || stopReason === 'stop';
}

/**
 * 规范化消息
 * @param message 消息对象
 * @returns 规范化的消息
 */
export function normalizeMessage(message: Message): Message {
  return {
    ...message,
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
  };
}

/**
 * 规范化消息列表
 * @param messages 消息列表
 * @returns 规范化的消息列表
 */
export function normalizeMessages(messages: Message[]): Message[] {
  return messages.map(normalizeMessage);
}

/**
 * 检查消息是否非空
 * @param message 消息对象
 * @returns 是否非空
 */
export function isNotEmptyMessage(message: Message): boolean {
  const content = typeof message.content === 'string' ? message.content : '';
  return content.trim().length > 0;
}

/**
 * 处理孤立权限
 * @param toolCall 工具调用
 * @param context 上下文
 * @returns 处理结果
 */
export async function handleOrphanedPermission(
  toolCall: ToolCall,
  context: { sessionId: string }
): Promise<{ handled: boolean; result?: string }> {
  return { handled: false };
}

/**
 * 检查工具进度是否需要发送（节流）
 * @param toolUseId 工具使用ID
 * @returns 是否允许发送
 */
export function shouldSendToolProgress(toolUseId: string): boolean {
  const now = Date.now();
  const lastSent = toolProgressLastSentTime.get(toolUseId);

  if (lastSent && now - lastSent < TOOL_PROGRESS_THROTTLE_MS) {
    return false;
  }

  toolProgressLastSentTime.set(toolUseId, now);

  if (toolProgressLastSentTime.size > MAX_TOOL_PROGRESS_TRACKING_ENTRIES) {
    const oldestKey = toolProgressLastSentTime.keys().next().value;
    if (oldestKey !== undefined) {
      toolProgressLastSentTime.delete(oldestKey);
    }
  }

  return true;
}

/**
 * 创建只读文件状态缓存
 * @param sizeLimit 大小限制
 * @returns 文件状态缓存
 */
export function createReadFileStateCache(sizeLimit = 10): Map<string, string> {
  const cache = new Map<string, string>();

  return {
    get(key: string): string | undefined {
      return cache.get(key);
    },
    set(key: string, value: string): void {
      if (cache.size >= sizeLimit) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
      cache.set(key, value);
    },
    has(key: string): boolean {
      return cache.has(key);
    },
    delete(key: string): boolean {
      return cache.delete(key);
    },
    clear(): void {
      cache.clear();
    },
    get size(): number {
      return cache.size;
    },
  } as Map<string, string>;
}
