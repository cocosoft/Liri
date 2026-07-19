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
 * ChannelTool — 统一通道管理工具
 *
 * 合并了 ChannelManagerTool 和 GatewayTool，提供统一的通道管理入口。
 * 覆盖通道列表、状态、连接/断开、健康检查、日志等全部操作。
 *
 * 旧工具：
 *   - ChannelManagerTool → @deprecated，委托到本工具
 *   - GatewayTool → @deprecated，委托到本工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:ChannelTool:ChannelTool',
  level: LogLevel.INFO,
});

export interface ChannelToolOperation {
  action: 'list' | 'status' | 'connect' | 'disconnect' | 'health' | 'logs';
  channel?: string;
  logLevel?: string;
  logLimit?: number;
}

export class ChannelTool extends BaseTool {
  name = 'channel';

  description =
    'Unified channel management tool. List, connect, disconnect channels, check status, health, and view logs.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['list', 'status', 'connect', 'disconnect', 'health', 'logs'],
      description:
        'Action: list channels, get status, connect/disconnect, check health, view logs',
      required: true,
    },
    {
      name: 'channel',
      type: 'string',
      description: 'Channel name (required for connect/disconnect/status)',
      required: false,
    },
    {
      name: 'logLevel',
      type: 'string',
      enum: ['info', 'warn', 'error'],
      description: 'Filter logs by level',
      required: false,
    },
    {
      name: 'logLimit',
      type: 'number',
      description: 'Maximum number of log entries to return (default: 50)',
      required: false,
    },
  ];

  async execute(
    params: ChannelToolOperation,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const { action, channel, logLevel, logLimit } = params;

    switch (action) {
      case 'list': {
        const channels = channelRegistry.getEnabled();
        const list = channels.map((ch) => ({
          name: ch.name,
          type: ch.type,
          enabled: ch.enabled,
          connected: ch.connected,
          homeChannelId: ch.homeChannelId || null,
        }));
        return {
          success: true,
          data: { channels: list, count: list.length },
          output: `Channels: ${list.map((c) => `${c.name}(${c.connected ? 'connected' : 'disconnected'})`).join(', ') || '(none)'}`,
        };
      }

      case 'status': {
        if (!channel) {
          return {
            success: false,
            output: 'channel name is required for status action',
          };
        }
        const ch = channelRegistry.get(channel);
        if (!ch) {
          return { success: false, output: `Channel '${channel}' not found` };
        }
        const status = ch.getStatus();
        return {
          success: true,
          data: { name: ch.name, type: ch.type, ...status },
          output: `${ch.name}: ${ch.connected ? 'connected' : 'disconnected'} (${ch.type})`,
        };
      }

      case 'connect': {
        if (!channel) {
          return {
            success: false,
            output: 'channel name is required for connect action',
          };
        }
        const ok = await channelRegistry.connect(channel);
        return {
          success: ok,
          data: { channel, connected: ok },
          output: ok
            ? `Channel '${channel}' connected`
            : `Failed to connect channel '${channel}'`,
        };
      }

      case 'disconnect': {
        if (!channel) {
          return {
            success: false,
            output: 'channel name is required for disconnect action',
          };
        }
        const ok = await channelRegistry.disconnect(channel);
        return {
          success: ok,
          data: { channel, disconnected: ok },
          output: ok
            ? `Channel '${channel}' disconnected`
            : `Failed to disconnect channel '${channel}'`,
        };
      }

      case 'health': {
        const channels = channelRegistry.getEnabled();
        const healthData = channels.map((ch) => {
          const status = ch.getStatus();
          return {
            name: ch.name,
            type: ch.type,
            connected: ch.connected,
            status: status.status || 'unknown',
          };
        });
        const healthy = healthData.filter((h) => h.connected).length;
        return {
          success: true,
          data: { channels: healthData, healthy, total: healthData.length },
          output: `Health: ${healthy}/${healthData.length} channels connected`,
        };
      }

      case 'logs': {
        const level = logLevel || 'info';
        const limit = logLimit || 50;
        try {
          const { ChannelLogManager } =
            await import('../../channels/log/ChannelLogManager');
          const logManager = new ChannelLogManager();
          const logs = logManager.query({
            channelId: channel as any,
            level: level as any,
            limit,
          });
          return {
            success: true,
            data: {
              logs,
              count: logs.length,
              level,
              channel: channel || 'all',
            },
            output: `Logs: ${logs.length} entries (level: ${level})`,
          };
        } catch (error) {
          return {
            success: false,
            output: `Failed to read logs: ${(error as Error).message}`,
          };
        }
      }

      default:
        return { success: false, output: `Unknown action: ${action}` };
    }
  }
}
