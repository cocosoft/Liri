/**
 * BroadcastTool — 通道广播工具
 * 向一个或多个通道发送消息
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';

export interface BroadcastOperation {
  action: 'send' | 'broadcast' | 'home' | 'thread';
  message: string;
  channel?: string;
  threadId?: string;
}

export class BroadcastTool extends BaseTool {
  name = 'broadcast';

  description =
    'Send messages to one or all channels. Supports single channel send, broadcast to all enabled channels, home channel messages, and thread replies.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['send', 'broadcast', 'home', 'thread'],
      description:
        'send: to one channel | broadcast: to all enabled channels | home: to home channel | thread: reply in thread',
      required: true,
    },
    {
      name: 'message',
      type: 'string',
      description: 'Message content to send',
      required: true,
    },
    {
      name: 'channel',
      type: 'string',
      description: 'Target channel name (required for send/home/thread)',
      required: false,
    },
    {
      name: 'threadId',
      type: 'string',
      description: 'Thread ID for thread reply (required for action=thread)',
      required: false,
    },
  ];

  async execute(
    input: BroadcastOperation,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const { action, message, channel, threadId } = input;

      if (!message || typeof message !== 'string') {
        return {
          success: false,
          output: 'message is required and must be a string',
        };
      }

      switch (action) {
        case 'send': {
          if (!channel) {
            return {
              success: false,
              output: 'channel is required for send action',
            };
          }
          const ch = channelRegistry.get(channel);
          if (!ch) {
            return {
              success: false,
              output: `Channel '${channel}' not found`,
            };
          }
          const ok = await ch.sendMessage('', message);
          return {
            success: ok,
            data: { channel, sent: ok },
            output: `Message sent to channel '${channel}': ${ok ? 'success' : 'failed'}`,
          };
        }

        case 'broadcast': {
          const results = await channelRegistry.broadcast(message);
          const successCount = results.filter((r) => r.success).length;
          return {
            success: successCount > 0,
            data: { results, successCount, total: results.length },
            output: `Broadcast to ${results.length} channels: ${successCount} succeeded, ${results.length - successCount} failed`,
          };
        }

        case 'home': {
          if (!channel) {
            return {
              success: false,
              output: 'channel is required for home action',
            };
          }
          const ok = channelRegistry.sendToHomeChannel(channel, message);
          return {
            success: ok,
            data: { channel, sent: ok },
            output: `Message sent to home channel of '${channel}': ${ok ? 'success' : 'failed'}`,
          };
        }

        case 'thread': {
          if (!channel) {
            return {
              success: false,
              output: 'channel is required for thread action',
            };
          }
          if (!threadId) {
            return {
              success: false,
              output: 'threadId is required for thread action',
            };
          }
          const ok = channelRegistry.sendThreadReply(
            channel,
            threadId,
            message
          );
          return {
            success: ok,
            data: { channel, threadId, sent: ok },
            output: `Thread reply sent to '${channel}' thread ${threadId}: ${ok ? 'success' : 'failed'}`,
          };
        }

        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Broadcast operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createBroadcastTool(): BroadcastTool {
  return new BroadcastTool();
}
