/**
 * 文件管理命令
 * 管理工作目录中的文件
 */
import type { Command } from '@modules/commands/types';

/**
 * files 命令定义
 */
export const filesCommand: Command = {
  type: 'action',
  name: 'files',
  description: '文件管理',
  aliases: ['ls', 'dir'],
  argumentHint: '[list|find|view|tree|clean|help]',
  whenToUse: '当你需要管理或查看文件时',
  load: async () => import('./Files.js').then((m) => ({ execute: m.default.execute.bind(m.default) })),
};

