/**
 * 任务管理模块统一出口
 *
 * 低层任务管理器（CC 兼容风格）位于本目录
 * 高层应用任务服务位于 src/task/
 */

// 低层任务管理器（CC 兼容）
export * from './types';
export * from './TaskManager';

// 高层应用任务服务
export {
  Task,
  TaskPriority,
  TaskService,
  createTaskService,
  taskService,
} from '../../task/index.js';

export type { TaskCreateOptions, TaskUpdateOptions } from '../../task/index.js';
export { TaskStatus as AppTaskStatus, TaskType as AppTaskType } from '../../task/index.js';
