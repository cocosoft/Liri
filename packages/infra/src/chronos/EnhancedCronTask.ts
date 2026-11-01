/**
 * 增强的定时任务定义
 * 支持任务重试和任务依赖
 */

import { randomUUID } from 'crypto';

/**
 * 任务执行状态
 */
export type TaskExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'retrying'
  | 'cancelled';

/**
 * 任务重试策略
 */
export interface RetryPolicy {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始重试间隔（毫秒） */
  initialInterval: number;
  /** 重试间隔乘数（指数退避） */
  backoffMultiplier: number;
  /** 最大重试间隔（毫秒） */
  maxInterval: number;
}

/**
 * 任务执行记录
 */
export interface TaskExecutionRecord {
  /** 执行ID */
  executionId: string;
  /** 执行时间 */
  timestamp: number;
  /** 执行状态 */
  status: TaskExecutionStatus;
  /** 执行时长（毫秒） */
  duration?: number;
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retryCount?: number;
}

/**
 * 增强的定时任务
 */
export interface EnhancedCronTask {
  /** 任务ID */
  id: string;
  /** 5字段cron表达式（本地时间） */
  cron: string;
  /** 任务触发时执行的提示词 */
  prompt: string;
  /** 任务创建时间（时间戳） */
  createdAt: number;
  /** 上次触发时间（时间戳） */
  lastFiredAt?: number;
  /** 是否重复执行 */
  recurring?: boolean;
  /** 是否永久任务（不会自动过期） */
  permanent?: boolean;
  /** 是否持久化（false表示仅会话内有效） */
  durable?: boolean;
  /** 代理ID（由内进程代理创建的任务） */
  agentId?: string;

  /** 任务重试策略 */
  retryPolicy?: RetryPolicy;
  /** 已尝试的重试次数 */
  retryCount?: number;
  /** 下次重试时间（时间戳） */
  nextRetryAt?: number;

  /** 依赖的任务ID列表 */
  dependsOn?: string[];
  /** 依赖失败时的处理策略 */
  dependencyFailureStrategy?: 'skip' | 'fail' | 'retry';

  /** 执行历史记录 */
  executionHistory?: TaskExecutionRecord[];
  /** 最大历史记录数 */
  maxHistory?: number;
}

/**
 * 默认重试策略
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialInterval: 5000,
  backoffMultiplier: 2,
  maxInterval: 60000,
};

/**
 * 创建新的增强任务
 */
export function createEnhancedCronTask(
  cron: string,
  prompt: string,
  recurring: boolean,
  options: {
    durable?: boolean;
    agentId?: string;
    retryPolicy?: Partial<RetryPolicy>;
    dependsOn?: string[];
    dependencyFailureStrategy?: 'skip' | 'fail' | 'retry';
    maxHistory?: number;
  } = {}
): EnhancedCronTask {
  const task: EnhancedCronTask = {
    id: randomUUID().slice(0, 8),
    cron,
    prompt,
    createdAt: Date.now(),
    ...(recurring ? { recurring: true } : {}),
    ...(options.durable !== undefined ? { durable: options.durable } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.retryPolicy
      ? {
          retryPolicy: {
            ...DEFAULT_RETRY_POLICY,
            ...options.retryPolicy,
          },
        }
      : {}),
    ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
    ...(options.dependencyFailureStrategy
      ? {
          dependencyFailureStrategy: options.dependencyFailureStrategy,
        }
      : {}),
    ...(options.maxHistory ? { maxHistory: options.maxHistory } : {}),
  };

  return task;
}

/**
 * 计算下次重试时间
 */
export function calculateNextRetryTime(
  task: EnhancedCronTask,
  currentTime: number = Date.now()
): number {
  if (!task.retryPolicy) {
    return currentTime;
  }

  const retryCount = task.retryCount || 0;
  const policy = task.retryPolicy;

  // 指数退避算法
  const interval = Math.min(
    policy.initialInterval * Math.pow(policy.backoffMultiplier, retryCount),
    policy.maxInterval
  );

  return currentTime + interval;
}

/**
 * 检查任务是否可以重试
 */
export function canRetryTask(task: EnhancedCronTask): boolean {
  if (!task.retryPolicy) {
    return false;
  }

  const retryCount = task.retryCount || 0;
  return retryCount < task.retryPolicy.maxRetries;
}

/**
 * 检查任务依赖是否满足
 */
export function checkTaskDependencies(
  task: EnhancedCronTask,
  allTasks: Map<string, EnhancedCronTask>
): {
  satisfied: boolean;
  missingDependencies: string[];
  failedDependencies: string[];
} {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return { satisfied: true, missingDependencies: [], failedDependencies: [] };
  }

  const missing: string[] = [];
  const failed: string[] = [];

  for (const depId of task.dependsOn) {
    const depTask = allTasks.get(depId);
    if (!depTask) {
      missing.push(depId);
    } else if (depTask.executionHistory) {
      const lastExecution =
        depTask.executionHistory[depTask.executionHistory.length - 1];
      if (lastExecution && lastExecution.status === 'failed') {
        failed.push(depId);
      }
    }
  }

  return {
    satisfied: missing.length === 0 && failed.length === 0,
    missingDependencies: missing,
    failedDependencies: failed,
  };
}

/**
 * 记录任务执行
 */
export function recordTaskExecution(
  task: EnhancedCronTask,
  status: TaskExecutionStatus,
  options: {
    duration?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
  } = {}
): EnhancedCronTask {
  const record: TaskExecutionRecord = {
    executionId: randomUUID(),
    timestamp: Date.now(),
    status,
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
    ...(options.error ? { error: options.error } : {}),
    ...(task.retryCount ? { retryCount: task.retryCount } : {}),
  };

  const executionHistory = [...(task.executionHistory || []), record];

  // 限制历史记录数量
  if (task.maxHistory && executionHistory.length > task.maxHistory) {
    executionHistory.splice(0, executionHistory.length - task.maxHistory);
  }

  return {
    ...task,
    executionHistory,
  };
}

/**
 * 递增重试计数
 */
export function incrementRetryCount(task: EnhancedCronTask): EnhancedCronTask {
  const retryCount = (task.retryCount || 0) + 1;
  const nextRetryAt = calculateNextRetryTime(task);

  return {
    ...task,
    retryCount,
    nextRetryAt,
  };
}

/**
 * 重置重试状态
 */
export function resetRetryState(task: EnhancedCronTask): EnhancedCronTask {
  return {
    ...task,
    retryCount: undefined,
    nextRetryAt: undefined,
  };
}
