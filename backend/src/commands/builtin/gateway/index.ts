/**
 * Gateway 命令
 * 管理消息通道的注册、启停和状态查看
 */
import type { Command } from '@modules/commands/types';
import { getChannelManager } from '../../../core/gateway/ChannelManager';
import type { GatewayChannel } from '../../../core/gateway/types';
import { ChannelStatus } from '../../../core/gateway/types';

/**
 * 格式化通道状态为可读字符串
 */
function formatChannelStatus(channel: GatewayChannel): string {
  const statusIcon: Record<string, string> = {
    [ChannelStatus.CONNECTED]: '✓',
    [ChannelStatus.DISCONNECTED]: '✗',
    [ChannelStatus.CONNECTING]: '⟳',
    [ChannelStatus.ERROR]: '!',
    [ChannelStatus.IDLE]: '·',
    [ChannelStatus.STOPPED]: '■',
  };

  const icon = statusIcon[channel.status] || '?';

  const lines: string[] = [
    `  ${icon} ${channel.name}`,
    `    类型: ${channel.type}`,
    `    状态: ${channel.status}`,
    `    已连接: ${channel.isConnected() ? '是' : '否'}`,
  ];

  const stats = channel.stats;
  if (stats.messagesSent !== undefined || stats.messagesReceived !== undefined) {
    lines.push(`    消息: ${String(stats.messagesSent ?? 0)} 发送 / ${String(stats.messagesReceived ?? 0)} 接收`);
  }

  if (stats.errors !== undefined) {
    lines.push(`    错误: ${String(stats.errors ?? 0)}`);
  }

  return lines.join('\n');
}

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
          const channels = channelManager.listChannels();

          if (channels.length === 0) {
            return {
              success: true,
              message: '没有已注册的通道。使用 /gateway start 启动默认通道。',
            };
          }

          const channelList = channels
            .map((ch) => `  ${ch.name} (${ch.type}) — ${ch.status}${ch.isConnected() ? ' ✓' : ''}`)
            .join('\n');

          return {
            success: true,
            message: `已注册通道 (${channels.length}):\n${channelList}`,
          };
        }

        case 'status': {
          const status = channelManager.getStatus();

          const summary = [
            `通道管理器状态:`,
            `  运行中: ${status.isRunning ? '是' : '否'}`,
            `  总通道数: ${status.totalChannels}`,
            `  已连接: ${status.connectedChannels}/${status.totalChannels}`,
          ];

          if (status.channels.length > 0) {
            summary.push('');

            for (const ch of status.channels) {
              summary.push(`  ${ch.name} — ${ch.status}${ch.connected ? ' ✓' : ''}`);
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
              const message = error instanceof Error ? error.message : String(error);
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
              const message = error instanceof Error ? error.message : String(error);
              return { success: false, error: `停止通道失败: ${message}` };
            }
          }

          await channelManager.stop();
          return { success: true, message: '所有通道已停止' };
        }

        case 'diagnostics': {
          const channels = restArgs
            ? [channelManager.getChannel(restArgs)].filter(Boolean) as GatewayChannel[]
            : channelManager.listChannels();

          if (channels.length === 0) {
            return {
              success: false,
              error: restArgs
                ? `通道不存在: ${restArgs}`
                : '没有已注册的通道',
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
            '/gateway list          - 列出所有已注册通道',
            '/gateway status        - 查看通道管理器运行状态',
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
