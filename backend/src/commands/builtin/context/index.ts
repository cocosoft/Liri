/**
 * 上下文管理命令
 * 管理当前会话的上下文
 */
import type { Command } from '../../types/index.js';

/**
 * context 命令定义
 */
export const contextCommand: Command = {
  type: 'action',
  name: 'context',
  description: '上下文管理',
  aliases: ['ctx'],
  argumentHint: '[show|clear|compact|info|trim <tokens>]',
  whenToUse: '当你需要管理会话上下文时',
  load: async () => import('./Context.js').then((m) => ({ execute: m.default.execute })),
};