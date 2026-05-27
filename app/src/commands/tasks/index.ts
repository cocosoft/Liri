/**
 * Tasks 命令模块入口
 * 列出和管理后台任务
 * 对标 CC BackgroundTasksDialog 实现
 */
import type { Command } from '@modules/commands/types';

const tasksCommand: Command = {
  type: 'local',
  name: 'tasks',
  aliases: ['bashes'],
  description: '列出和管理后台任务',
  argumentHint:
    '[list|running|pending|completed|failed|aborted|show|stop|clear|stats|--json|help]',
  whenToUse: '当你需要查看或管理后台运行的任务时',
  load: () => import('./tasks.js').then((m) => m.default),
};

export { tasksCommand };
export default tasksCommand;
