/**
 * 添加工作目录命令
 * 将指定目录添加到工作区
 */
import type { Command } from '@modules/commands/types';

/**
 * add-dir 命令定义
 */
export const addDirCommand: Command = {
  type: 'action',
  name: 'add-dir',
  description: '添加工作目录',
  aliases: ['add', 'cd'],
  argumentHint: '<目录路径>',
  whenToUse: '当你需要切换或添加工作目录时',
  load: async () => import('./AddDir.js').then((m) => ({ execute: m.default.execute })),
};

export default addDirCommand;
