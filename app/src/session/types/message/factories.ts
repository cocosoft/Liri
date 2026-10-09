// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 消息模型 —— 工厂与工具函数（C3 拆分，2026-10-09）
 *
 * 自 `session/types/message.ts` 拆出（R04-001 尺寸债治理）。对外 API 由该 barrel 原样重导出。
 *
 * 依赖方向：本文件仅**值导入**枚举（`./enums`/`./blocks`），对 `Message`/`NormalizedMessage`/
 * `CreateMessageParams` 只用 `import type`（擦除）⇒ 与 barrel `../message` **无运行时循环**。
 */

// C1（2026-10-09）：message/attachment id 熵源改用 crypto
import { randomIdSuffix } from '../../../utils/common';
import { ContentBlockType } from './blocks';
import type {
  AttachmentMessage,
  CompactBoundaryMessage,
  CompactBoundaryType,
  ContentBlock,
  ToolUseSummary,
  ToolUseSummaryMessage,
} from './blocks';
import {
  MessagePriority,
  MessageRole,
  MessageStatus,
  MessageType,
} from './enums';
import type { MessageAttachment } from './enums';
import type {
  CreateMessageParams,
  Message,
  NormalizedMessage,
} from '../message';

/**
 * 生成唯一ID
 * @returns 唯一ID
 */
export function generateId(): string {
  return Date.now().toString(36) + randomIdSuffix(10);
}

/**
 * 生成消息ID
 * @returns 消息ID
 */
export function generateMessageId(): string {
  // R1（2026-10-09）：后缀 7 → **10 hex（40 bit）**；身份类 ID 后缀不得低于 10 位（见台账 L-6）
  return `msg-${Date.now()}-${randomIdSuffix(10)}`;
}

/**
 * 生成附件ID
 * @returns 附件ID
 */
export function generateAttachmentId(): string {
  // R1（2026-10-09）：同上，7 → 10 hex
  return `att-${Date.now()}-${randomIdSuffix(10)}`;
}

/**
 * 创建消息
 * @param params 创建消息的参数
 * @returns 消息对象
 */
export function createMessage(params: CreateMessageParams): Message {
  const now = new Date();

  return {
    id: params.id || generateMessageId(),
    role: params.role,
    content: params.content,
    createdAt: now,
    updatedAt: now,
    sessionId: params.sessionId,
    toolCallId: params.toolCallId,
    metadata: params.metadata,
    status: params.status || MessageStatus.COMPLETED,
    priority: params.priority || MessagePriority.NORMAL,
    category: params.category,
    attachments: params.attachments,
    parentId: params.parentId,
    threadId: params.threadId,
    processingTime: params.processingTime,
    errorDetails: params.errorDetails,
    relatedMessageId: params.relatedMessageId,
  };
}

/**
 * 创建用户消息
 * @param content 消息内容
 * @param options 选项
 * @returns 消息对象
 */
export function createUserMessage(
  content: string,
  options?: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): Message {
  return createMessage({
    role: MessageRole.USER,
    content,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 创建助手消息
 * @param content 消息内容
 * @param options 选项
 * @returns 消息对象
 */
export function createAssistantMessage(
  content: string | ContentBlock[],
  options?: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): Message {
  return createMessage({
    role: MessageRole.ASSISTANT,
    content,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 创建工具消息
 * @param content 消息内容
 * @param toolCallId 工具调用ID
 * @param options 选项
 * @returns 消息对象
 */
export function createToolMessage(
  content: string,
  toolCallId: string,
  options?: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): Message {
  return createMessage({
    role: MessageRole.TOOL,
    content,
    toolCallId,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 创建系统消息
 * @param content 消息内容
 * @param options 选项
 * @returns 消息对象
 */
export function createSystemMessage(
  content: string,
  options?: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): Message {
  return createMessage({
    role: MessageRole.SYSTEM,
    content,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  });
}

/**
 * 规范化消息
 * @param message 消息对象
 * @returns 规范化的消息对象
 */
export function normalizeMessage(message: Message): NormalizedMessage {
  let normalizedContent = '';
  let hasToolCalls = false;
  let hasToolResults = false;

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === ContentBlockType.TEXT) {
        normalizedContent += block.value;
      } else if (block.type === ContentBlockType.CODE) {
        normalizedContent += `\n\`\`\`${block.language || ''}\n${block.value}\n\`\`\``;
      } else if (block.type === ContentBlockType.TOOL_CALL) {
        normalizedContent += `[Tool Call: ${block.toolName}]`;
        hasToolCalls = true;
      } else if (block.type === ContentBlockType.TOOL_RESULT) {
        normalizedContent += `[Tool Result: ${block.toolCallId}]`;
        hasToolResults = true;
      }
    }
  } else {
    normalizedContent = message.content;
  }

  return {
    ...message,
    normalizedContent,
    length: normalizedContent.length,
    hasToolCalls,
    hasToolResults,
  };
}

/**
 * 规范化消息列表
 * @param messages 消息列表
 * @returns 规范化的消息列表
 */
export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  return messages.map(normalizeMessage);
}

/**
 * 重新排序消息
 * @param messages 消息列表
 * @returns 排序后的消息列表
 */
export function reorderMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/**
 * 创建压缩边界消息
 * @param boundaryType 边界类型
 * @param options 选项
 * @returns 压缩边界消息对象
 */
export function createCompactBoundaryMessage(
  boundaryType: CompactBoundaryType,
  options?: {
    sessionId?: string;
    compressedMessageCount?: number;
    compressedTokenCount?: number;
    compressionReason?: string;
    contextSummary?: string;
    metadata?: Record<string, unknown>;
  }
): CompactBoundaryMessage {
  return {
    id: generateMessageId(),
    type: MessageType.COMPACT_BOUNDARY,
    boundaryType,
    compressedMessageCount: options?.compressedMessageCount,
    compressedTokenCount: options?.compressedTokenCount,
    compressionReason: options?.compressionReason,
    contextSummary: options?.contextSummary,
    createdAt: new Date(),
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  };
}

/**
 * 创建工具调用摘要消息
 * @param summaries 工具调用摘要列表
 * @param options 选项
 * @returns 工具调用摘要消息对象
 */
export function createToolUseSummaryMessage(
  summaries: ToolUseSummary[],
  options?: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): ToolUseSummaryMessage {
  return {
    id: generateMessageId(),
    type: MessageType.TOOL_USE_SUMMARY,
    summaries,
    createdAt: new Date(),
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  };
}

/**
 * 创建附件消息
 * @param role 消息角色
 * @param attachments 附件列表
 * @param options 选项
 * @returns 附件消息对象
 */
export function createAttachmentMessage(
  role: MessageRole,
  attachments: MessageAttachment[],
  options?: {
    description?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): AttachmentMessage {
  const now = new Date();
  return {
    id: generateMessageId(),
    type: MessageType.ATTACHMENT,
    role,
    attachments,
    description: options?.description,
    createdAt: now,
    updatedAt: now,
    sessionId: options?.sessionId,
    metadata: options?.metadata,
  };
}

/**
 * 创建工具调用摘要对象
 * @param toolCallId 工具调用ID
 * @param toolName 工具名称
 * @param toolArguments 工具参数
 * @param resultSummary 结果摘要
 * @param status 状态
 * @param options 选项
 * @returns 工具调用摘要对象
 */
export function createToolUseSummary(
  toolCallId: string,
  toolName: string,
  toolArguments: Record<string, unknown>,
  resultSummary: string,
  status: 'success' | 'failed' | 'pending',
  options?: {
    executionTime?: number;
    helpful?: boolean;
  }
): ToolUseSummary {
  return {
    toolCallId,
    toolName,
    toolArguments,
    resultSummary,
    status,
    executionTime: options?.executionTime,
    helpful: options?.helpful,
  };
}
