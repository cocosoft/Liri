/**
 * Fast命令模块入口
 */
import type { Command } from '@modules/commands/types';

/**
 * Fast命令定义
 */
const fastCommand: Command = {
  type: 'local',
  name: 'fast',
  description: '快速模式切换',
  aliases: ['fast-mode'],
  argumentHint: '[on|off] [status] [--json] [help]',

  /**
   * 懒加载命令实现
   */
  load: () => import('./Fast.js').then((m) => m.default),
};

export { fastCommand };
