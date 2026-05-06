/**
 * 思考回放命令
 * 回放AI思考过程
 */
import type { Command } from '@modules/commands/types';

/**
 * thinkback 命令定义
 */
export const thinkbackCommand: Command = {
  type: 'action',
  name: 'thinkback',
  description: '思考回放',
  aliases: ['thinking', 'thoughts'],
  argumentHint: '[list|play|show|delete|help]',
  whenToUse: '当你需要回放之前的思考过程时',
  load: async () => import('./Thinkback.js').then((m) => ({ execute: m.default.execute })),
};

