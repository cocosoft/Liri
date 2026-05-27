/**
 * ChannelManagerTool — 通道管理器
 * 包装 ChannelRegistry / ChannelHealthMonitor / ChannelLogManager
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';
import { ChannelHealthMonitor } from '../../channels/monitoring/ChannelHealthMonitor';
import { ChannelLogManager } from '../../channels/log/ChannelLogManager';

const healthMonitor = new ChannelHealthMonitor(channelRegistry, {
  autoStart: false,
});
const logManager = new ChannelLogManager();

export interface ChannelManagerOperation {
  action:
    | 'list'
    | 'status'
    | 'stats'
    | 'connect'
    | 'disconnect'
    | 'health'
    | 'logs'
    | 'log-stats';
  channel?: string;
  logLevel?: string;
  logLimit?: number;
}

export class ChannelManagerTool extends BaseTool {
  name = 'channel_manager';

  description =
    'Manage and monitor communication channels. Supports listing channels, checking status and health, viewing logs, and connecting/disconnecting channels.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: [
        'list',
        'status',
        'stats',
        'connect',
        'disconnect',
        'health',
        'logs',
        'log-stats',
      ],
      description:
        'Action to perform: list channels, get status/stats, connect/disconnect, check health, view logs',
      required: true,
    },
    {
      name: 'channel',
      type: 'string',
      description: 'Channel name (required for connect/disconnect/status/logs)',
      required: false,
    },
    {
      name: 'logLevel',
      type: 'string',
      description: 'Filter logs by level (debug, info, warn, error)',
      required: false,
    },
    {
      name: 'logLimit',
      type: 'number',
      description: 'Max log entries to return (default 50)',
      required: false,
    },
  ];

  async execute(
    input: ChannelManagerOperation,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const { action, channel } = input;

      switch (action) {
        case 'list': {
          const all = channelRegistry.getAll();
          const list = all.map((c) => ({
            name: c.name,
            type: c.type,
            enabled: c.enabled,
            connected: c.connected,
          }));
          return {
            success: true,
            data: { channels: list, total: list.length },
            output: JSON.stringify(
              { channels: list, total: list.length },
              null,
              2
            ),
          };
        }

        case 'status': {
          if (!channel) {
            const statuses = channelRegistry.getAllStatuses();
            return {
              success: true,
              data: { statuses },
              output: JSON.stringify({ statuses }, null, 2),
            };
          }
          const status = channelRegistry.getStatus(channel);
          if (!status) {
            return {
              success: false,
              output: `Channel '${channel}' not found`,
            };
          }
          return {
            success: true,
            data: { channel, status },
            output: JSON.stringify({ channel, status }, null, 2),
          };
        }

        case 'stats': {
          const stats = channelRegistry.getStats();
          return {
            success: true,
            data: { stats },
            output: JSON.stringify({ stats }, null, 2),
          };
        }

        case 'connect': {
          if (!channel) {
            return {
              success: false,
              output: 'channel name is required for connect action',
            };
          }
          const result = await channelRegistry.connect(channel);
          return {
            success: result,
            data: { channel, connected: result },
            output: `Channel '${channel}': ${result ? 'connected' : 'connect failed'}`,
          };
        }

        case 'disconnect': {
          if (!channel) {
            return {
              success: false,
              output: 'channel name is required for disconnect action',
            };
          }
          const result = await channelRegistry.disconnect(channel);
          return {
            success: result,
            data: { channel, disconnected: result },
            output: `Channel '${channel}': ${result ? 'disconnected' : 'disconnect failed'}`,
          };
        }

        case 'health': {
          const report = channel
            ? [await healthMonitor.checkChannel(channel)].filter(Boolean)
            : await healthMonitor.getReport();

          const healthStats = await healthMonitor.getStats();
          return {
            success: true,
            data: { report, stats: healthStats },
            output: JSON.stringify({ report, stats: healthStats }, null, 2),
          };
        }

        case 'logs': {
          const filter: Record<string, unknown> = {
            limit: input.logLimit || 50,
          };
          if (channel) filter.channelId = channel;
          if (input.logLevel) filter.level = input.logLevel;

          const entries = logManager.query(filter as any);
          return {
            success: true,
            data: { entries, count: entries.length },
            output: JSON.stringify({ entries, count: entries.length }, null, 2),
          };
        }

        case 'log-stats': {
          const logStats = logManager.getStats();
          return {
            success: true,
            data: { stats: logStats },
            output: JSON.stringify({ stats: logStats }, null, 2),
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
        error: `Channel manager operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createChannelManagerTool(): ChannelManagerTool {
  return new ChannelManagerTool();
}
