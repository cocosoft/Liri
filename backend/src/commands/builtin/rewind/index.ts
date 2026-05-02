/**
 * 回退会话命令
 * 回退会话到之前的状态
 */
import type { Command } from '../../types/index.js';

/**
 * rewind 命令定义
 */
export const rewindCommand: Command = {
  type: 'action',
  name: 'rewind',
  description: '回退会话',
  aliases: ['undo'],
  argumentHint: '[步数或消息ID]',
  whenToUse: '当你需要撤销之前的对话内容时',
  load: async () => import('./Rewind.js').then((m) => ({ execute: m.default.execute })),
};

export default rewindCommand;
