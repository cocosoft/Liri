/**
 * Cron命令模块入口
 * 定时作业管理与调度
 */
import type { Command } from '@modules/commands/types';

const cronCommand: Command = {
  type: 'local',
  name: 'cron',
  description: '定时作业管理（创建/查看/暂停/恢复/删除/统计）',
  aliases: ['scheduler', 'scheduled'],
  argumentHint: '[list|add|pause|resume|delete|status|stats|help]',
  load: () => import('./Cron.js').then((m) => m.default),
};

export { cronCommand };
