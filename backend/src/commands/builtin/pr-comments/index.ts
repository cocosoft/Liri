/**
 * PR评论命令
 * 管理PR评论
 */
import type { Command } from '@modules/commands/types';

/**
 * pr-comments 命令定义
 */
export const prCommentsCommand: Command = {
  type: 'action',
  name: 'pr-comments',
  description: 'PR评论',
  aliases: ['prc', 'comments'],
  argumentHint: '[list|show|add|resolve|help]',
  whenToUse: '当你需要管理PR评论时',
  load: async () => import('./PRComments.js').then((m) => ({ execute: m.default.execute })),
};

export default prCommentsCommand;
