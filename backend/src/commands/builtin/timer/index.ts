/**
 * 计时器命令
 * 管理计时器
 */
import type { Command } from '@modules/commands/types';

/**
 * timer 命令定义
 */
export const timerCommand: Command = {
  type: 'action',
  name: 'timer',
  description: '计时器',
  aliases: ['stopwatch', 'countdown'],
  argumentHint: '[start|stop|pause|resume|status|help]',
  whenToUse: '当你需要使用计时器时',
  load: async () => import('./Timer.js').then((m) => ({ execute: m.default.execute.bind(m.default) })),
};

