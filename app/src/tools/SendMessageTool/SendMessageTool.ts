/**
 * 多代理消息工具 SendMessageTool
 */
import { randomUUID } from 'crypto';

export interface SendMessageInput {
  to: string;
  message: string;
  priority?: 'normal' | 'high' | 'low';
  type?: 'direct' | 'broadcast';
}

export type BroadcastOutput = SendMessageResult & { type: 'broadcast' };
export type MessageRouting = 'direct' | 'broadcast';
export type SendMessageOutput = SendMessageResult;

export interface SendMessageResult {
  messageId: string;
  to: string;
  delivered: boolean;
  timestamp: number;
}

import { BaseTool } from '../BaseTool';
import type {
  ToolParam,
  ToolUseContext,
  ToolCallProgress,
  ToolResult,
} from '../types';
import { createToolResult, ErrorLevel } from '../types/ToolResult';
import { getTeammateManager } from '../../subagent/TeammateManager';
import type {
  Message,
  MessageRole,
  MessageType,
} from '../../chat/types/message';

export class SendMessageTool extends BaseTool {
  name = 'send_message';
  description = 'Send a message to another agent';

  params: ToolParam[] = [
    {
      name: 'to',
      type: 'string',
      description: 'The recipient agent',
      required: true,
    },
    {
      name: 'message',
      type: 'string',
      description: 'The message content',
      required: true,
    },
    {
      name: 'priority',
      type: 'string',
      description: 'Message priority (normal, high, low)',
      required: false,
    },
  ];

  override isReadOnly(): boolean {
    return false;
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<any>
  ): Promise<ToolResult<unknown>> {
    const to = String(input.to ?? '').trim();
    const messageContent = String(input.message ?? '').trim();
    if (!to || !messageContent) {
      return createToolResult(null, {
        errorLevel: ErrorLevel.RECOVERABLE,
        error: 'to 和 message 为必填项',
      });
    }

    const message: Message = {
      id: `msg_${randomUUID().substring(0, 8)}`,
      role: 'user' as MessageRole,
      type: 'message' as MessageType,
      content: messageContent,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        sender: (context.sessionId as string) || 'main',
        receiver: to,
        type: 'direct',
      },
    };

    // 2026-08-26（残留修复）：真实投递到 teammate 体系——
    // 原实现只往内存数组 push 并恒返回 delivered:true（假成功），
    // 不检查接收者、不接入 MailboxSystem/MessageBus。
    try {
      await getTeammateManager().sendMessageToTeammate(to, message);
      return createToolResult(
        JSON.stringify(
          {
            messageId: message.id,
            to,
            delivered: true,
            timestamp: message.createdAt.getTime(),
          },
          null,
          2
        )
      );
    } catch (e) {
      // 接收者不存在 / 投递失败 → 诚实反馈失败（可恢复，模型可重试或换接收者）
      return createToolResult(null, {
        errorLevel: ErrorLevel.RECOVERABLE,
        error: `消息投递失败：${e instanceof Error ? e.message : String(e)}`,
        metadata: {
          messageId: message.id,
          to,
          delivered: false,
        },
      });
    }
  }
}
