//
/**
 * LocalShellTask 终止辅助函数
 * 纯函数（非React），使 runAgent 等模块可以杀死 agent 级别的 shell 任务
 * 而无需将 React/Ink 拉入其模块图
 *
 * 基于 CC源码 cc_code/backend/tasks/LocalShellTask/killShellTasks.ts 实现
 */

import { TaskStatus } from '../types';
import { taskRegistry } from '../TaskRegistry';
import { isLocalShellTask } from './guards';
import type { LocalShellTaskState } from './guards';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'tasks:killShell', level: LogLevel.INFO });

/**
 * 终止指定 ID 的 shell 任务
 * 通过 TaskRegistry 查找并终止任务
 */
export function killTask(taskId: string): void {
  const task = taskRegistry.getTask(taskId);
  if (!task) {
    return;
  }

  const state = task.taskState;
  if (!isLocalShellTask(state)) {
    return;
  }

  task.kill().catch((error: Error) => {
    logger.error(`killTask: failed to kill shell task ${taskId}`, error);
  });
}

/**
 * 终止指定 agent 生成的所有运行中的 shell 任务
 * 当 agent 退出时调用，防止后台进程在 agent 结束后变成僵尸进程
 *
 * @param agentId agent 标识
 */
export function killShellTasksForAgent(agentId: string): void {
  const tasks = taskRegistry.getAllTasks();

  for (const task of tasks) {
    const state = task.taskState;
    if (
      isLocalShellTask(state) &&
      state.agentId === agentId &&
      state.status === TaskStatus.RUNNING
    ) {
      logger.info(
        `killShellTasksForAgent: killing orphaned shell task ${task.id} ` +
          `(agent ${agentId} exiting)`
      );
      killTask(task.id);
    }
  }
}
