/**
 * Usage命令模块入口
 */
import type { Command } from '@modules/commands/types';

/**
 * Usage命令定义
 */
const usageCommand: Command = {
  type: 'local',
  name: 'usage',
  description: '显示详细的使用统计和趋势分析',
  aliases: ['statistics', 'usage-stats'],
  argumentHint:
    '[--trends|-t] [--commands|-c] [--tools|-o] [--behavior|-b] [--performance|-p] [status] [--json] [help]',

  /**
   * 懒加载命令实现
   */
  load: () => import('./Usage.js').then((m) => m.default),
};

export { usageCommand };
