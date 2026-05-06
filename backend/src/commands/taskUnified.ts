// @ts-nocheck
/**
 * Task 模块统一出口（架构优化 §6.1: task/ + tasks/ 双模块统一）
 *
 * 统一 task/models/ 和 tasks/ 两个目录到单一 import 入口。
 * 使用方无需关心 task 的具体目录结构。
 *
 * 用法：import { BaseTask, LocalBashTask, TaskRegistry } from '@modules/commands/task-unified';
 */

export { BaseTask } from '@modules/tasks/BaseTask';
export { LocalBashTask, looksLikePrompt } from '@modules/tasks/LocalBashTask';
export type { LocalBashTaskOptions } from '@modules/tasks/LocalBashTask';
export { TaskRegistry } from '@modules/tasks/TaskRegistry';
export type { Task, TaskConfig, TaskResult, TaskStatus } from '@modules/tasks/BaseTask';
