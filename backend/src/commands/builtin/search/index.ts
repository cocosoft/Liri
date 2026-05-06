/**
 * 搜索命令
 * 在应用内搜索
 */
import type { Command } from '@modules/commands/types';

/**
 * search 命令定义
 */
export const searchCommand: Command = {
  type: 'action',
  name: 'search',
  description: '搜索',
  aliases: ['find'],
  argumentHint: '<关键词>',
  whenToUse: '当你需要搜索内容时',
  load: async () => import('./Search.js').then((m) => ({ execute: m.default.execute })),
};

