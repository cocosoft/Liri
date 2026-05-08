/**
 * 消息格式转换工具
 * 参考CC源码 utils/messages/mappers.ts 实现
 */

import { randomUUID } from 'crypto';
import type { Message, AssistantMessage, SystemMessage, UserMessage } from '@modules/chat/types/message.js';
import { MessageRole, MessageType } from '@modules/chat/types/message.js';

/**
 * SDK消息类型定义
 */
export interface SDKMessage {
  type: 'assistant' | 'user' | 'system';
  message?: string;
  uuid?: string;
  timestamp?: string;
  isSynthetic?: boolean;
  subtype?: string;
  compact_metadata?: SDKCompactMetadata;
  session_id?: string;
  parent_tool_use_id?: string | null;
  error?: string;
  tool_use_result?: Record<string, unknown>;
}

/**
 * SDK压缩元数据
 */
export interface SDKCompactMetadata {
  trigger?: string;
  pre_tokens?: number;
  preserved_segment?: {
    head_uuid?: string;
    anchor_uuid?: string;
    tail_uuid?: string;
  };
}

/**
 * 内部压缩元数据
 */
export interface CompactMetadata {
  trigger?: string;
  preTokens?: number;
  preservedSegment?: {
    headUuid?: string;
    anchorUuid?: string;
    tailUuid?: string;
  };
}

/**
 * 将SDK消息转换为内部消息格式
 * @param messages SDK消息列表
 * @returns 内部消息列表
 */
export function toInternalMessages(messages: readonly SDKMessage[]): Message[] {
  return messages.flatMap((message) => {
    switch (message.type) {
      case 'assistant':
        return [
          {
            id: message.uuid || `msg_${Date.now()}`,
            role: MessageRole.ASSISTANT,
            content: message.message || '',
            type: MessageType.NORMAL,
            createdAt: message.timestamp ? new Date(message.timestamp) : new Date(),
            updatedAt: message.timestamp ? new Date(message.timestamp) : new Date(),
          } as AssistantMessage,
        ];
      case 'user':
        return [
          {
            id: message.uuid || `msg_${randomUUID()}`,
            role: MessageRole.USER,
            content: message.message || '',
            type: MessageType.NORMAL,
            createdAt: message.timestamp ? new Date(message.timestamp) : new Date(),
            updatedAt: message.timestamp ? new Date(message.timestamp) : new Date(),
          } as UserMessage,
        ];
      case 'system':
        if (message.subtype === 'compact_boundary') {
          const compactMsg = message as SDKMessage & { compact_metadata?: SDKCompactMetadata };
          return [
            {
              id: message.uuid || `sys_${Date.now()}`,
              role: MessageRole.SYSTEM,
              content: 'Conversation compacted',
              type: MessageType.COMPACT_BOUNDARY,
              createdAt: new Date(),
              updatedAt: new Date(),
              metadata: {
                compactMetadata: compactMsg.compact_metadata ? fromSDKCompactMetadata(compactMsg.compact_metadata) : undefined,
              },
            } as SystemMessage,
          ];
        }
        return [];
      default:
        return [];
    }
  });
}

/**
 * 将内部消息转换为SDK消息格式
 * @param messages 内部消息列表
 * @param sessionId 会话ID
 * @returns SDK消息列表
 */
export function toSDKMessages(messages: Message[], sessionId?: string): SDKMessage[] {
  return messages.flatMap((message): SDKMessage[] => {
    switch (message.role) {
      case MessageRole.ASSISTANT:
        return [
          {
            type: 'assistant',
            message: typeof message.content === 'string' ? message.content : '',
            session_id: sessionId,
            parent_tool_use_id: null,
            uuid: message.id,
            error: undefined,
          },
        ];
      case MessageRole.USER:
        return [
          {
            type: 'user',
            message: typeof message.content === 'string' ? message.content : '',
            session_id: sessionId,
            parent_tool_use_id: null,
            uuid: message.id,
            timestamp: message.createdAt.toISOString(),
            isSynthetic: message.metadata?.isSynthetic === true,
          },
        ];
      case MessageRole.SYSTEM:
        if (message.type === MessageType.COMPACT_BOUNDARY && message.metadata?.compactMetadata) {
          return [
            {
              type: 'system',
              subtype: 'compact_boundary',
              uuid: message.id,
              compact_metadata: toSDKCompactMetadata(message.metadata.compactMetadata as CompactMetadata),
            },
          ];
        }
        return [];
      default:
        return [];
    }
  });
}

/**
 * 将内部压缩元数据转换为SDK格式
 * @param meta 内部压缩元数据
 * @returns SDK压缩元数据
 */
export function toSDKCompactMetadata(meta: CompactMetadata): SDKCompactMetadata {
  const seg = meta.preservedSegment;
  return {
    trigger: meta.trigger,
    pre_tokens: meta.preTokens,
    ...(seg && {
      preserved_segment: {
        head_uuid: seg.headUuid,
        anchor_uuid: seg.anchorUuid,
        tail_uuid: seg.tailUuid,
      },
    }),
  };
}

/**
 * 将SDK压缩元数据转换为内部格式
 * @param meta SDK压缩元数据
 * @returns 内部压缩元数据
 */
export function fromSDKCompactMetadata(meta: SDKCompactMetadata): CompactMetadata {
  const seg = meta.preserved_segment;
  return {
    trigger: meta.trigger,
    preTokens: meta.pre_tokens,
    ...(seg && {
      preservedSegment: {
        headUuid: seg.head_uuid,
        anchorUuid: seg.anchor_uuid,
        tailUuid: seg.tail_uuid,
      },
    }),
  };
}

/**
 * 规范化助手消息用于SDK输出
 * @param message 助手消息
 * @returns 规范化的消息内容
 */
export function normalizeAssistantMessageForSDK(message: AssistantMessage): string {
  return typeof message.content === 'string' ? message.content : '';
}

/**
 * 将本地命令输出转换为SDK助手消息
 * @param stdout 标准输出
 * @param stderr 标准错误
 * @returns SDK助手消息
 */
export function localCommandOutputToSDKAssistantMessage(
  stdout: string,
  stderr: string
): SDKMessage {
  const content = [
    stdout ? `<local_command_stdout>${stdout}</local_command_stdout>` : '',
    stderr ? `<local_command_stderr>${stderr}</local_command_stderr>` : '',
  ].filter(Boolean).join('\n');

  return {
    type: 'assistant',
    message: content,
    uuid: `msg_${randomUUID()}`,
  };
}
