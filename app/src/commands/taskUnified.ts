//
/**
 * Task 模块统一出口（任务系统模块收敛后单一入口）
 *
 * 用法：import { BaseTask, LocalBashTask, TaskRegistry } from '@modules/commands/task-unified';
 */

export { BaseTask } from '@modules/tasks/BaseTask';
export { LocalBashTask, looksLikePrompt } from '@modules/tasks/LocalBashTask';
export type { LocalBashTaskOptions } from '@modules/tasks/LocalBashTask';
export { TaskRegistry } from '@modules/tasks/TaskRegistry';
export { TaskStatus } from '@modules/tasks/types';
export type { TaskState } from '@modules/tasks/types';
