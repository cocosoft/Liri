/**
 * 重命名会话命令
 * 重命名当前会话
 */
import type { Command } from '@modules/commands/types';

/**
 * rename 命令定义
 */
export const renameCommand: Command = {
  type: 'action',
  name: 'rename',
  description: '重命名会话',
  aliases: ['rn'],
  argumentHint: '<新名称>',
  whenToUse: '当你需要重命名当前会话时',
  load: async () => import('./Rename.js').then((m) => ({ execute: m.default.execute })),
};

