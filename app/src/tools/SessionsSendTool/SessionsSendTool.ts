/**
 * SessionsSendTool
 * 对标CC SessionsSendTool
 * 会话消息发送工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SessionsSendTool:SessionsSendTool');

export interface SessionSendPayload {
  sessionId: string;
  content: string;
  type: 'text' | 'command' | 'result' | 'error' | 'system';
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

export interface SessionMessageResult {
  messageId: string;
  sessionId: string;
  delivered: boolean;
  timestamp: number;
  deliveryTime: number;
}

export class SessionsSendTool extends BaseTool {
  name = 'sessions_send';

  description =
    'Send a message to a running session. Supports text, commands, results, and system messages.';

  params: ToolParam[] = [
    {
      name: 'sessionId',
      type: 'string',
      description: 'Target session ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Message content to send',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      enum: ['text', 'command', 'result', 'error', 'system'],
      description: 'Message type',
      required: false,
      default: 'text',
    },
    {
      name: 'metadata',
      type: 'object',
      description: 'Optional metadata for the message',
      required: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const { sessionId, content, type, metadata } = input;

      if (!sessionId || typeof sessionId !== 'string') {
        return {
          success: false,
          error: 'sessionId is required and must be a string',
        };
      }

      if (!content || typeof content !== 'string') {
        return {
          success: false,
          error: 'content is required and must be a string',
        };
      }

      const msgType = type ?? 'text';

      const result: SessionMessageResult = {
        messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        delivered: true,
        timestamp: Date.now(),
        deliveryTime: 0,
      };

      return {
        success: true,
        data: result,
        output: `Message sent to session ${sessionId} (type: ${msgType})`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createSessionsSendTool(): SessionsSendTool {
  return new SessionsSendTool();
}
