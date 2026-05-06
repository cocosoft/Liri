/**
 * 消息分组工具
 * 基于CC源码 cc_code/backend/services/compact/grouping.ts 实现
 *
 * 按API轮次边界对消息分组：每轮API往返为一组。
 * 边界触发条件：新的assistant响应开始（message.id与上一个assistant不同）。
 * 对于格式良好的对话，这是API安全的拆分点——API合约要求每个tool_use
 * 在下一个assistant轮次之前被解析，因此配对有效性由assistant-id边界保证。
 */

import type { Message } from '@modules/chat/types/message';
import { MessageRole } from '@modules/chat/types/message';

/**
 * 按API轮次边界分组消息
 * 每组代表一个完整的API往返（请求→响应→工具结果）
 *
 * @param messages 消息列表
 * @returns 分组后的消息数组
 */
export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  let current: Message[] = [];
  let lastAssistantId: string | undefined;

  for (const msg of messages) {
    if (
      msg.role === MessageRole.ASSISTANT &&
      msg.id !== lastAssistantId &&
      current.length > 0
    ) {
      groups.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
    if (msg.role === MessageRole.ASSISTANT) {
      lastAssistantId = msg.id;
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

/**
 * 获取消息的文本内容
 * 支持字符串内容和ContentBlock数组
 *
 * @param message 消息对象
 * @returns 文本内容字符串
 */
export function getMessageTextContent(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter(block => block.type === 'text' || block.type === 'code')
      .map(block => block.value)
      .join('\n');
  }
  return '';
}

/**
 * 获取指定角色的最后一条消息
 *
 * @param messages 消息列表
 * @param role 消息角色
 * @returns 最后匹配的消息，未找到返回undefined
 */
export function getLastMessageByRole(
  messages: Message[],
  role: MessageRole
): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) {
      return messages[i];
    }
  }
  return undefined;
}
