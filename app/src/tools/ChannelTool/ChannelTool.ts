import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
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
import { channelRegistry } from '@modules/channels';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:ChannelTool:ChannelTool');

export interface ChannelToolOperation {
  action: 'list' | 'status' | 'connect' | 'disconnect' | 'health' | 'logs';
  channel?: string;
  logLevel?: string;
  logLimit?: number;
}

/**
 * U-03（2026-10-19）：`channel` 的**模型可见出参结构**（JSON Schema）。
 *
 * 出口按 action 分五类：
 * - `list`：`{ channels[{name,type,enabled,connected,homeChannelId|null}], count }`；
 * - `status`：`{ name, type, ...该通道 getStatus() 的其余字段 }`（随通道类型变化）；
 * - `connect` / `disconnect`：`{ channel, connected|disconnected }`；
 * - `health`：`{ channels[{name,type,connected,status}], healthy, total }`；
 * - `logs`：`{ logs[], count, level, channel }`。
 * ⇒ 不设根级 required；`channels` 元素取 list/health 两分支的并集。
 */
const CHANNEL_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    channels: {
      type: 'array',
      description: '通道列表（list 分支为通道配置；health 分支含 status）',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '通道名' },
          type: { type: 'string', description: '通道类型' },
          enabled: { type: 'boolean', description: '是否启用（list 分支）' },
          connected: { type: 'boolean', description: '是否已连接' },
          homeChannelId: {
            type: ['string', 'null'],
            description: '主页通道 ID（list 分支，未配置为 null）',
          },
          status: {
            type: 'string',
            description: '通道自报状态（health 分支，未知为 unknown）',
          },
        },
        required: ['name', 'type', 'connected'],
      },
    },
    count: { type: 'number', description: '通道/日志条数（list/logs 分支）' },
    name: { type: 'string', description: '通道名（status 分支）' },
    type: { type: 'string', description: '通道类型（status 分支）' },
    channel: {
      type: 'string',
      description: '目标通道名（connect/disconnect）或日志筛选通道（logs）',
    },
    connected: { type: 'boolean', description: '连接结果（connect 分支）' },
    disconnected: {
      type: 'boolean',
      description: '断开结果（disconnect 分支）',
    },
    healthy: { type: 'number', description: '已连接通道数（health 分支）' },
    total: { type: 'number', description: '参与检查的通道总数（health 分支）' },
    logs: {
      type: 'array',
      description: '日志条目（logs 分支）',
      items: { type: 'object', description: '单条通道日志' },
    },
    level: {
      type: 'string',
      enum: ['info', 'warn', 'error'],
      description: '实际筛选的日志级别（logs 分支）',
    },
  },
};

export class ChannelTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.channel;

  description =
    'Unified channel management tool. List, connect, disconnect channels, check status, health, and view logs.';

  /** U-03（2026-10-19）：模型可见出参结构（按 action 分支） */
  override outputJsonSchema = CHANNEL_OUTPUT_JSON_SCHEMA;

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
