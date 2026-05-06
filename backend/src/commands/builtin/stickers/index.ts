/**
 * 贴纸命令
 * 管理贴纸
 */
import type { Command } from '@modules/commands/types';

/**
 * stickers 命令定义
 */
export const stickersCommand: Command = {
  type: 'action',
  name: 'stickers',
  description: '贴纸管理',
  aliases: ['emoji'],
  argumentHint: '[list|add|remove|help]',
  whenToUse: '当你需要管理贴纸时',
  load: async () => import('./Stickers.js').then((m) => ({ execute: m.default.execute })),
};