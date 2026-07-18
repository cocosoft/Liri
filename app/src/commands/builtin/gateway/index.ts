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
 * Gateway 命令
 * 管理消息通道的注册、启停和状态查看
 * 已统一：list/status 从 ChannelRegistry 获取数据，start/stop/diagnostics 通过 ChannelManager
 *
 * @deprecated 基于旧 ChannelManager 体系，待迁移至 channels/ 新 IChannelPlugin 体系
 */
import type { Command } from '@modules/commands';
import { getChannelManager } from '../../../core/gateway/ChannelManagerFactory';
import { channelRegistry } from '../../../channels/registry/ChannelRegistry';
import type { GatewayChannel } from '../../../core/gateway/types';
import { ChannelStatus } from '../../../core/gateway/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:builtin:gateway:index', level: LogLevel.INFO });

/**
 * 网关命令
 */
export const gatewayCommand: Command = {
  type: 'action',
  name: 'gateway',
  description: '管理消息通道',
  aliases: ['gw', 'channels'],
  argumentHint: '[list|status|start|stop|diagnostics]',
  whenToUse: '当你需要查看或管理消息通道（Telegram、WebSocket）时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || '';
      const restArgs = parts.slice(1).join(' ');

      const channelManager = getChannelManager();

      switch (subcommand) {
        case 'list': {
          const registryChannels = channelRegistry.getAll();

          if (registryChannels.length === 0) {
            return {
              success: true,
              message: '没有已注册的通道。使用 /gateway start 启动默认通道。',
            };
          }

          const channelList = registryChannels
            .map((ch) => {
              const status = ch.connected ? '✓' : '✗';
              return `  ${status} ${ch.name} (${ch.type})`;
            })
            .join('\n');

          const stats = channelRegistry.getStats();

          return {
            success: true,
            message: `已注册通道 (${registryChannels.length}, 已启用 ${stats.enabled}):\n${channelList}`,
          };
        }

        case 'status': {
          const regStats = channelRegistry.getStats();
          const cmStatus = channelManager.getStatus();

          const summary = [
            '=== ChannelRegistry ===',
            `  总通道数: ${regStats.total}`,
            `  已启用: ${regStats.enabled}`,
            `  类型分布: ${Object.entries(regStats.types)
              .map(([t, n]) => `${t}:${n}`)
              .join(', ')}`,
            '',
            '=== ChannelManager ===',
            `  运行中: ${cmStatus.isRunning ? '是' : '否'}`,
            `  总通道数: ${cmStatus.totalChannels}`,
            `  已连接: ${cmStatus.connectedChannels}/${cmStatus.totalChannels}`,
          ];

          if (cmStatus.channels.length > 0) {
            summary.push('');
            for (const ch of cmStatus.channels) {
              summary.push(
                `  ${ch.name} — ${ch.status}${ch.connected ? ' ✓' : ''}`
              );
            }
          }

          return {
            success: true,
            message: summary.join('\n'),
          };
        }

        case 'start': {
          if (restArgs) {
            try {
              await channelManager.startChannel(restArgs);
              return { success: true, message: `通道已启动: ${restArgs}` };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return { success: false, error: `启动通道失败: ${message}` };
            }
          }

          await channelManager.start();
          return { success: true, message: '所有通道已启动' };
        }

        case 'stop': {
          if (restArgs) {
            try {
              await channelManager.stopChannel(restArgs);
              return { success: true, message: `通道已停止: ${restArgs}` };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return { success: false, error: `停止通道失败: ${message}` };
            }
          }

          await channelManager.stop();
          return { success: true, message: '所有通道已停止' };
        }

        case 'diagnostics': {
          const channels = restArgs
            ? ([channelManager.getChannel(restArgs)].filter(
                Boolean
              ) as GatewayChannel[])
            : channelManager.listChannels();

          if (channels.length === 0) {
            return {
              success: false,
              error: restArgs ? `通道不存在: ${restArgs}` : '没有已注册的通道',
            };
          }

          const diagnostics = channels
            .map((ch) => {
              const diag = ch.getDiagnostics();
              const header = `通道: ${ch.name} (${ch.type})`;
              const fields = Object.entries(diag)
                .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
                .join('\n');
              return `${header}\n${fields}`;
            })
            .join('\n\n');

          return {
            success: true,
            message: `通道诊断信息:\n\n${diagnostics}`,
          };
        }

        case '': {
          const helpMessage = [
            '网关命令用法:',
            '',
            '/gateway list          - 列出所有已注册通道（ChannelRegistry）',
            '/gateway status        - 查看通道管理器运行状态',
            '/gateway start [name]  - 启动所有或指定通道',
            '/gateway stop [name]   - 停止所有或指定通道',
            '/gateway diagnostics [name] - 查看通道诊断信息',
            '',
            '别名: /gw, /channels',
            '注意: /channel 命令也提供类似功能，使用 ChannelRegistry 后端',
            '',
            '示例:',
            '  /gateway list',
            '  /gateway start telegram',
            '  /gateway status',
          ];
          return { success: true, message: helpMessage.join('\n') };
        }

        default:
          return {
            success: false,
            error: `未知子命令: ${subcommand}。可用命令: list, status, start, stop, diagnostics`,
          };
      }
    },
  }),
};
