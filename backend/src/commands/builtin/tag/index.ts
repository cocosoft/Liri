/**
 * 标签命令
 * 管理会话标签
 */
import type { Command } from '@modules/commands/types';

/**
 * tag 命令定义
 */
export const tagCommand: Command = {
  type: 'action',
  name: 'tag',
  description: '标签管理',
  aliases: [],
  argumentHint: '[list|add|remove|sessions|help]',
  whenToUse: '当你需要管理会话标签时',
  load: async () => import('./Tag.js').then((m) => ({ execute: m.default.execute })),
};

