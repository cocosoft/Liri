/**
 * 状态命令
 * 显示系统状态信息，支持 system/agent/gateway/channels 子命令
 */
import type { Command } from '@modules/commands/types';

/**
 * 状态命令
 */
export const statusCommand: Command = {
  type: 'action',
  name: 'status',
  description: '显示系统状态信息（system/agent/gateway/channels）',
  aliases: ['st'],
  argumentHint: '[system|agent|gateway|channels|help]',
  whenToUse: '当你需要了解系统当前状态时',
  load: async () =>
    import('./Status.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
