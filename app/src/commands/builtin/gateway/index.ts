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
 * Gateway 命令 — 管理消息通道
 * 已迁移至 channels/ ChannelRegistry API
 */
import type { Command } from '@modules/commands';
import { channelRegistry } from '../../../channels/registry/ChannelRegistry';

/**
 * 网关命令
 */
export const gatewayCommand: Command = {
  type: 'action',
  name: 'gateway',
  description: '管理消息通道',
  aliases: ['gw', 'channels'],
  argumentHint: '[list|status|start|stop|diagnostics]',
  whenToUse: '当你需要查看或管理消息通道（Telegram、Discord 等）时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || '';
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'list': {
          const channels = channelRegistry.getAll();

          if (channels.length === 0) {
            return {
              success: true,
              message: '没有已注册的通道。请在设置中配置通道后启用。',
            };
          }

          const channelList = channels
            .map((ch) => {
              const status = ch.connected ? '✓' : '✗';
              return `  ${status} ${ch.name} (${ch.type})`;
            })
            .join('\n');

          const stats = channelRegistry.getStats();

          return {
            success: true,
            message: `已注册通道 (${channels.length}, 已启用 ${stats.enabled}):\n${channelList}`,
          };
        }

        case 'status': {
          const stats = channelRegistry.getStats();
          const statuses = channelRegistry.getAllStatuses();

          const summary = [
            '=== ChannelRegistry ===',
            `  总通道数: ${stats.total}`,
            `  已启用: ${stats.enabled}`,
            `  类型分布: ${Object.entries(stats.types)
              .map(([t, n]) => `${t}:${n}`)
              .join(', ')}`,
            '',
            '=== 通道详情 ===',
          ];

          if (statuses.length > 0) {
            for (const s of statuses) {
              summary.push(
                `  ${s.name} (${s.type}) — ${s.connected ? '已连接 ✓' : '未连接 ✗'}`
              );
            }
          } else {
            summary.push('  (无)');
          }

          return {
            success: true,
            message: summary.join('\n'),
          };
        }

        case 'start': {
          if (restArgs) {
            const channel = channelRegistry.get(restArgs);
            if (!channel) {
              return {
                success: false,
                error: `通道不存在: ${restArgs}`,
              };
            }
            try {
              await channel.connect();
              return { success: true, message: `通道已启动: ${restArgs}` };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return { success: false, error: `启动通道失败: ${message}` };
            }
          }

          // 启动所有已注册通道
          const all = channelRegistry.getAll();
          let started = 0;
          const errors: string[] = [];
          for (const ch of all) {
            try {
              await ch.connect();
              started++;
            } catch (error) {
              errors.push(
                `${ch.name}: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
          if (errors.length > 0) {
            return {
              success: false,
              error: `已启动 ${started}/${all.length} 个通道，${errors.length} 个失败: ${errors.join('; ')}`,
            };
          }
          return { success: true, message: `所有通道已启动 (${started})` };
        }

        case 'stop': {
          if (restArgs) {
            const channel = channelRegistry.get(restArgs);
            if (!channel) {
              return {
                success: false,
                error: `通道不存在: ${restArgs}`,
              };
            }
            try {
              await channel.disconnect();
              return { success: true, message: `通道已停止: ${restArgs}` };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return { success: false, error: `停止通道失败: ${message}` };
            }
          }

          const all = channelRegistry.getAll();
          for (const ch of all) {
            await ch.disconnect();
          }
          return { success: true, message: `所有通道已停止 (${all.length})` };
        }

        case 'diagnostics': {
          if (restArgs) {
            const channel = channelRegistry.get(restArgs);
            if (!channel) {
              return {
                success: false,
                error: `通道不存在: ${restArgs}`,
              };
            }
            const s = channel.getStatus();
            const fields = Object.entries(s)
              .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
              .join('\n');
            return {
              success: true,
              message: `通道诊断: ${restArgs} (${channel.type})\n${fields}`,
            };
          }

          const statuses = channelRegistry.getAllStatuses();
          if (statuses.length === 0) {
            return {
              success: false,
              error: '没有已注册的通道',
            };
          }

          const diagnostics = statuses
            .map((s) => {
              return `${s.name} (${s.type}): ${s.connected ? '已连接 ✓' : '未连接 ✗'}`;
            })
            .join('\n');

          return {
            success: true,
            message: `通道诊断信息:\n\n${diagnostics}`,
          };
        }

        case '': {
          const helpMessage = [
            '网关命令用法:',
            '',
            '/gateway list          - 列出所有已注册通道',
            '/gateway status        - 查看通道运行状态',
            '/gateway start [name]  - 启动所有或指定通道',
            '/gateway stop [name]   - 停止所有或指定通道',
            '/gateway diagnostics [name] - 查看通道诊断信息',
            '',
            '别名: /gw, /channels',
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
