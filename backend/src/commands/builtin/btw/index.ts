/**
 * btw命令
 * 快速记录简短备注
 */
import type { Command } from '@modules/commands/types';

/**
 * btw 命令定义
 */
export const btwCommand: Command = {
  type: 'action',
  name: 'btw',
  description: '快速备注',
  aliases: [],
  argumentHint: '<备注内容>',
  whenToUse: '当你需要快速记录一个简短备注时',
  load: async () => import('./Btw.js').then((m) => ({ execute: m.default.execute.bind(m.default) })),
};

