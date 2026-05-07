/**
 * 项目初始化命令
 * 初始化一个新的项目目录
 */
import type { Command } from '@modules/commands/types';

/**
 * init 命令定义
 */
export const initCommand: Command = {
  type: 'action',
  name: 'init',
  description: '初始化项目',
  aliases: ['create'],
  argumentHint: '[项目名称]',
  whenToUse: '当你需要创建一个新的项目目录时',
  load: async () => import('./Init.js').then((m) => ({ execute: m.default.execute.bind(m.default) })),
};