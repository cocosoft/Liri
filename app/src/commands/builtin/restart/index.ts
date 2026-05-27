/**
 * 重启命令
 * 重启应用
 */
import type { Command } from '@modules/commands/types';

/**
 * restart 命令定义
 */
export const restartCommand: Command = {
  type: 'action',
  name: 'restart',
  description: '重启应用',
  aliases: ['reboot'],
  argumentHint: '',
  whenToUse: '当你需要重启应用时',
  load: async () =>
    import('./Restart.js').then((m) => ({
      execute: m.default.execute.bind(m.default),
    })),
};
