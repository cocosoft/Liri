/**
 * Tasks命令
 * 列出和管理后台任务
 * 参考CC源码 cc_code/backend/commands/tasks/index.ts 实现
 */

import type { Command } from '../types/index.js';

/**
 * Tasks命令实现
 */
const tasks: Command = {
  type: 'local',
  name: 'tasks',
  aliases: ['bashes'],
  description: '列出和管理后台任务',
  load: async () => {
    const { executeTasks } = await import('./tasks.js');
    return {
      execute: executeTasks,
    };
  },
};

export default tasks;
