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

const messageHistory: SendMessageResult[] = [];

export function sendMessage(input: SendMessageInput): SendMessageResult {
  const result: SendMessageResult = {
    messageId: `msg_${randomUUID().substring(0, 8)}`,
    to: input.to,
    delivered: true,
    timestamp: Date.now(),
  };
  messageHistory.push(result);
  return result;
}

export function getMessageHistory(toFilter?: string): SendMessageResult[] {
  if (toFilter) {
    return messageHistory.filter(m => m.to === toFilter);
  }
  return [...messageHistory];
}

import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolUseContext, ToolCallProgress, ToolResult } from '../types';
import { createToolResult } from '../types/ToolResult';

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
    const result = sendMessage({
      to: input.to as string,
      message: input.message as string,
      priority: input.priority as 'normal' | 'high' | 'low' | undefined,
    });
    return createToolResult(JSON.stringify(result, null, 2));
  }
}
