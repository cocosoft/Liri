/**
 * Tasks命令模块入口
 * 任务管理与跟踪
 */
import type { Command } from '@modules/commands/types';

const tasksCommand: Command = {
  type: 'local',
  name: 'tasks',
  description: '任务管理与跟踪（创建/查看/完成/删除/统计）',
  aliases: ['task', 'todo', 'todos'],
  argumentHint: '[list|add|done|delete|priority|stats|<ID>|help]',
  load: () => import('./Tasks.js').then((m) => m.default),
};

export { tasksCommand };
