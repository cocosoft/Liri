/**
 * 任务队列共享类型
 * 从 TaskQueue.ts 提取，避免 QueueBackend ↔ TaskQueue 循环依赖
 */

/**
 * 任务优先级
 */
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * 任务接口
 */
export interface Task<T = unknown> {
  id: string;
  name: string;
  priority: TaskPriority;
  execute: (
    signal: AbortSignal,
    onProgress: (pct: number) => void
  ) => Promise<T>;
  timeout?: number;
  retryCount?: number;
  maxRetries?: number;
}

/**
 * 任务执行结果
 */
export interface TaskResult<T = unknown> {
  taskId: string;
  success: boolean;
  data?: T;
  error?: string;
  startedAt: number;
  completedAt: number;
  duration: number;
}
