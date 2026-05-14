/**
 * 通道 CLI 命令
 * py_app channel list/status/connect/disconnect
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { channelRegistry } from '@modules/channels';
import type { ChannelInterface } from '@modules/channels';

const logger = new Logger({ level: LogLevel.INFO });

const channelCmd: Command = {
  type: 'local',
  name: 'channel',
  description: 'Manage messaging channels (list/status/connect/disconnect)',
  aliases: ['channels'],
  loadedFrom: 'builtin',
  disableModelInvocation: true,
  userInvocable: true,
  argumentHint: '<action> [name]',

  async load() {
    return {
      async execute(args: string, _ctx?: CommandContext): Promise<CommandResult> {
        const parts = args.trim().split(/\s+/);
        const action = parts[0] || 'list';
        const name = parts[1] || '';

        try {
          switch (action) {
            case 'list':
              return listChannels();
            case 'status':
              return channelStatus(name);
            case 'connect':
              return connectChannel(name);
            case 'disconnect':
              return disconnectChannel(name);
            default:
              return listChannels();
          }
        } catch (error) {
          return { success: false, type: 'error', error: (error as Error).message };
        }
      },
    };
  },
};

function listChannels(): CommandResult {
  const entries = channelRegistry.getAll();

  if (entries.length === 0) {
    return { success: true, type: 'text', message: '没有注册的通道', data: [] };
  }

  const lines = entries.map((ch: ChannelInterface) => {
    return `  ${ch.name} (${ch.type}) — ${ch.connected ? '🟢 已连接' : '⚫ 未连接'} ${ch.enabled ? '已启用' : '已禁用'}`;
  });

  return { success: true, type: 'text', message: `通道列表 (${entries.length}):\n${lines.join('\n')}`, data: entries };
}

function channelStatus(name: string): CommandResult {
  if (!name) {
    const statuses = channelRegistry.getAllStatuses();

    if (statuses.length === 0) return { success: true, type: 'text', message: '没有注册的通道' };

    const lines = statuses.map((s: { id: string; status: { connected: boolean; latencyMs: number } }) => {
      return `  ${s.id}: ${s.status.connected ? '🟢' : '⚫'} 延迟 ${s.status.latencyMs}ms`;
    });

    return { success: true, type: 'text', message: `通道状态:\n${lines.join('\n')}` };
  }

  const status = channelRegistry.getStatus(name);
  if (!status) return { success: false, type: 'error', error: `通道不存在: ${name}` };

  return { success: true, type: 'text', message: `${name}: ${status.connected ? '🟢 已连接' : '⚫ 未连接'}`, data: status };
}

async function connectChannel(name: string): Promise<CommandResult> {
  if (!name) return { success: false, type: 'error', error: '请指定通道名称' };

  const ok = await channelRegistry.connect(name);
  return { success: ok, type: 'text', message: ok ? `通道 ${name} 已连接` : `通道 ${name} 连接失败` };
}

async function disconnectChannel(name: string): Promise<CommandResult> {
  if (!name) return { success: false, type: 'error', error: '请指定通道名称' };

  const ok = await channelRegistry.disconnect(name);
  return { success: ok, type: 'text', message: ok ? `通道 ${name} 已断开` : `通道 ${name} 断开失败` };
}

export default channelCmd;
