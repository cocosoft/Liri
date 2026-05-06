/**
 * 桥接消息处理
 * 提供消息的格式化、解析和安全过滤功能
 */

import type { Message } from '@modules/types/message.js';

/**
 * 消息类型
 */
export type BridgeMessageType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'system'
  | 'permission_request'
  | 'permission_response'
  | 'control_request'
  | 'control_response';

/**
 * 桥接消息接口
 */
export interface BridgeMessage {
  id: string;
  type: BridgeMessageType;
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * 消息格式化选项
 */
export interface MessageFormatOptions {
  includeTimestamp?: boolean;
  includeMetadata?: boolean;
  maxLength?: number;
  truncateContent?: boolean;
}

/**
 * 消息过滤器选项
 */
export interface MessageFilterOptions {
  allowAttachments?: boolean;
  maxAttachmentSize?: number;
  allowedContentTypes?: string[];
  sanitizeHtml?: boolean;
}

/**
 * 默认消息格式化选项
 */
const DEFAULT_FORMAT_OPTIONS: MessageFormatOptions = {
  includeTimestamp: true,
  includeMetadata: false,
  maxLength: 10000,
  truncateContent: true,
};

/**
 * 默认消息过滤选项
 */
const DEFAULT_FILTER_OPTIONS: MessageFilterOptions = {
  allowAttachments: true,
  maxAttachmentSize: 10 * 1024 * 1024,
  allowedContentTypes: ['text/plain', 'text/markdown', 'application/json'],
  sanitizeHtml: true,
};

/**
 * 创建桥接消息ID
 * @returns 消息ID
 */
export function createBridgeMessageId(): string {
  return `bridge_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 从Message创建桥接消息
 * @param message 源消息
 * @returns 桥接消息
 */
export function createBridgeMessageFromMessage(
  message: Message,
  options: MessageFormatOptions = DEFAULT_FORMAT_OPTIONS
): BridgeMessage {
  const formatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };

  let content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);

  if (formatOptions.maxLength && content.length > formatOptions.maxLength) {
    if (formatOptions.truncateContent) {
      content = content.substring(0, formatOptions.maxLength) + '...[truncated]';
    }
  }

  return {
    id: createBridgeMessageId(),
    type: determineMessageType(message),
    content,
    timestamp: message.timestamp || Date.now(),
    metadata: formatOptions.includeMetadata ? {
      role: message.role,
      ...message.metadata,
    } : undefined,
  };
}

/**
 * 确定消息类型
 * @param message 消息
 * @returns 消息类型
 */
function determineMessageType(message: Message): BridgeMessageType {
  if (message.role === 'user') {
    return 'text';
  }

  if (message.role === 'assistant') {
    return 'text';
  }

  if (message.role === 'system') {
    return 'system';
  }

  return 'text';
}

/**
 * 格式化桥接消息为字符串
 * @param message 桥接消息
 * @param options 格式化选项
 * @returns 格式化后的字符串
 */
export function formatBridgeMessage(
  message: BridgeMessage,
  options: MessageFormatOptions = DEFAULT_FORMAT_OPTIONS
): string {
  const formatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  const parts: string[] = [];

  if (formatOptions.includeTimestamp) {
    const date = new Date(message.timestamp);
    parts.push(`[${date.toISOString()}]`);
  }

  parts.push(`[${message.type.toUpperCase()}]`);

  parts.push(message.content);

  return parts.join(' ');
}

/**
 * 解析桥接消息字符串
 * @param str 字符串
 * @returns 桥接消息或null
 */
export function parseBridgeMessage(str: string): BridgeMessage | null {
  try {
    const json = JSON.parse(str);

    if (!json.id || !json.type || !json.content) {
      return null;
    }

    return json as BridgeMessage;
  } catch {
    return null;
  }
}

/**
 * 过滤消息内容
 * @param content 内容
 * @param options 过滤选项
 * @returns 过滤后的内容
 */
export function filterMessageContent(
  content: string,
  options: MessageFilterOptions = DEFAULT_FILTER_OPTIONS
): string {
  const filterOptions = { ...DEFAULT_FILTER_OPTIONS, ...options };
  let filtered = content;

  if (filterOptions.sanitizeHtml) {
    filtered = sanitizeHtml(filtered);
  }

  return filtered;
}

/**
 * 清理HTML内容
 * @param content 内容
 * @returns 清理后的内容
 */
function sanitizeHtml(content: string): string {
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 验证消息附件
 * @param attachment 附件
 * @param options 验证选项
 * @returns 是否有效
 */
export function validateAttachment(
  attachment: { name: string; size: number; type: string },
  options: MessageFilterOptions = DEFAULT_FILTER_OPTIONS
): { valid: boolean; error?: string } {
  const filterOptions = { ...DEFAULT_FILTER_OPTIONS, ...options };

  if (!filterOptions.allowAttachments) {
    return { valid: false, error: 'Attachments not allowed' };
  }

  if (filterOptions.maxAttachmentSize && attachment.size > filterOptions.maxAttachmentSize) {
    return {
      valid: false,
      error: `Attachment size exceeds limit: ${attachment.size} > ${filterOptions.maxAttachmentSize}`,
    };
  }

  if (
    filterOptions.allowedContentTypes &&
    !filterOptions.allowedContentTypes.includes(attachment.type)
  ) {
    return {
      valid: false,
      error: `Content type not allowed: ${attachment.type}`,
    };
  }

  return { valid: true };
}

/**
 * 批量格式化消息
 * @param messages 消息数组
 * @param options 格式化选项
 * @returns 格式化后的字符串数组
 */
export function formatMessages(
  messages: BridgeMessage[],
  options: MessageFormatOptions = DEFAULT_FORMAT_OPTIONS
): string[] {
  return messages.map((msg) => formatBridgeMessage(msg, options));
}

/**
 * 创建批量消息
 * @param messages 源消息数组
 * @param options 格式化选项
 * @returns 桥接消息数组
 */
export function createBatchBridgeMessages(
  messages: Message[],
  options: MessageFormatOptions = DEFAULT_FORMAT_OPTIONS
): BridgeMessage[] {
  return messages.map((msg) => createBridgeMessageFromMessage(msg, options));
}

/**
 * 提取消息中的文本内容
 * @param message 桥接消息
 * @returns 文本内容
 */
export function extractTextContent(message: BridgeMessage): string {
  return message.content;
}

/**
 * 判断消息是否为空
 * @param message 桥接消息
 * @returns 是否为空
 */
export function isMessageEmpty(message: BridgeMessage): boolean {
  return !message.content || message.content.trim().length === 0;
}

/**
 * 合并多个消息
 * @param messages 消息数组
 * @returns 合并后的消息
 */
export function mergeMessages(messages: BridgeMessage[]): BridgeMessage {
  const first = messages[0];
  if (!first) {
    throw new Error('Cannot merge empty message array');
  }

  return {
    id: first.id,
    type: first.type,
    content: messages.map((m) => m.content).join('\n'),
    timestamp: first.timestamp,
    metadata: {
      merged: true,
      messageCount: messages.length,
    },
  };
}
