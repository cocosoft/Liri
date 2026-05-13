/**
 * 通道 CLI 命令
 * py_app channel list/status/connect/disconnect
 */

import type { Command, CommandContext, CommandResult } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { channelRegistry } from '@modules/channels';

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
  const lines = entries.map((e: { plugin: { meta: { icon: string; displayName: string; vendor: string }; id: string; lifecycle: { getStatus: () => { connected: boolean } } } }) => {
    const s = e.plugin.lifecycle.getStatus();
    return `  ${e.plugin.meta.icon} ${e.plugin.meta.displayName} (${e.plugin.id}) — ${s.connected ? '🟢 已连接' : '⚫ 未连接'} ${e.plugin.meta.vendor}`;
  });
  return { success: true, type: 'text', message: `通道列表 (${entries.length}):\n${lines.join('\n')}`, data: entries };
}

function channelStatus(name: string): CommandResult {
  if (!name) {
    const statuses = channelRegistry.getAllStatuses();
    if (statuses.length === 0) return { success: true, type: 'text', message: '没有注册的通道' };
    const lines = statuses.map((s: { id: string; status: { connected: boolean; latencyMs: number } }) => {
      const st = s.status;
      return `  ${s.id}: ${st.connected ? '🟢' : '⚫'} 延迟 ${st.latencyMs}ms`;
    });
    return { success: true, type: 'text', message: `通道状态:\n${lines.join('\n')}` };
  }
  const status = channelRegistry.getStatus(name as 'wecom' | 'feishu' | 'dingtalk' | 'wechat' | 'qq' | 'telegram' | 'discord');
  if (!status) return { success: false, type: 'error', error: `通道不存在: ${name}` };
  return { success: true, type: 'text', message: `${name}: ${status.connected ? '🟢 已连接' : '⚫ 未连接'}`, data: status };
}

async function connectChannel(name: string): Promise<CommandResult> {
  if (!name) return { success: false, type: 'error', error: '请指定通道名称' };
  const ok = await channelRegistry.connect(name as 'wecom' | 'feishu' | 'dingtalk' | 'wechat' | 'qq' | 'telegram' | 'discord');
  return { success: ok, type: 'text', message: ok ? `通道 ${name} 已连接` : `通道 ${name} 连接失败` };
}

async function disconnectChannel(name: string): Promise<CommandResult> {
  if (!name) return { success: false, type: 'error', error: '请指定通道名称' };
  const ok = await channelRegistry.disconnect(name as 'wecom' | 'feishu' | 'dingtalk' | 'wechat' | 'qq' | 'telegram' | 'discord');
  return { success: ok, type: 'text', message: ok ? `通道 ${name} 已断开` : `通道 ${name} 断开失败` };
}

export default channelCmd;
