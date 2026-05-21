/**
 * @deprecated 请使用 TaskRegistry + BackgroundAgentTask 替代。
 * BackgroundTaskManager 将在后续版本中移除。
 * 迁移路径：BackgroundAgentTask extends BaseTask，通过 TaskRegistry 管理生命周期。
 *
 * BackgroundTaskManager - 后台 Agent 任务管理器
 *
 * 对标 CC LocalAgentTask.ts 实现后台任务生命周期管理：
 * - 注册/注销后台任务
 * - 任务进度跟踪
 * - 任务完成/失败通知
 * - 查询活跃任务列表
 */

import { randomUUID } from 'crypto';

/**
 * 后台任务状态
 */
export type BackgroundTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

/**
 * 后台任务信息
 */
export interface BackgroundTaskInfo {
  /** 任务 ID */
  taskId: string;
  /** Agent 名称 */
  agentName: string;
  /** Agent 类型 */
  agentType: string;
  /** 任务描述 */
  description: string;
  /** 当前状态 */
  status: BackgroundTaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 进度消息 */
  progressMessage?: string;
  /** 执行结果 */
  result?: string;
  /** 错误信息 */
  error?: string;
  /** 使用的 Token 数 */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 任务执行时长（毫秒） */
  durationMs?: number;
}

/**
 * 后台任务管理器事件类型
 */
export type BackgroundTaskEvent =
  | { type: 'created'; task: BackgroundTaskInfo }
  | { type: 'started'; taskId: string }
  | { type: 'progress'; taskId: string; message: string }
  | { type: 'completed'; task: BackgroundTaskInfo }
  | { type: 'failed'; taskId: string; error: string }
  | { type: 'aborted'; taskId: string };

/**
 * 后台任务管理器
 *
 * 管理所有后台运行的 Agent 任务，提供注册、查询、通知功能。
 */
export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTaskInfo> = new Map();
  private listeners: Set<(event: BackgroundTaskEvent) => void> = new Set();

  /**
   * 创建后台任务
   *
   * @param agentName Agent 名称
   * @param agentType Agent 类型
   * @param description 任务描述
   * @returns 任务 ID
   */
  createTask(
    agentName: string,
    agentType: string,
    description: string
  ): string {
    const taskId = `bg-${randomUUID().replace(/-/g, '').substring(0, 12)}`;
    const now = Date.now();

    const task: BackgroundTaskInfo = {
      taskId,
      agentName,
      agentType,
      description,
      status: 'pending',
      createdAt: now,
    };

    this.tasks.set(taskId, task);
    this.emit({ type: 'created', task });

    return taskId;
  }

  /**
   * 开始执行任务
   *
   * @param taskId 任务 ID
   */
  startTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = 'running';
    task.startedAt = Date.now();
    this.emit({ type: 'started', taskId });

    return true;
  }

  /**
   * 更新任务进度
   *
   * @param taskId 任务 ID
   * @param message 进度消息
   */
  updateProgress(taskId: string, message: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.progressMessage = message;
    this.emit({ type: 'progress', taskId, message });

    return true;
  }

  /**
   * 完成任务
   *
   * @param taskId 任务 ID
   * @param result 执行结果
   * @param tokenUsage Token 使用情况
   */
  completeTask(
    taskId: string,
    result: string,
    tokenUsage?: BackgroundTaskInfo['tokenUsage']
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const now = Date.now();
    task.status = 'completed';
    task.result = result;
    task.completedAt = now;
    task.durationMs = task.startedAt ? now - task.startedAt : 0;
    if (tokenUsage) task.tokenUsage = tokenUsage;

    this.emit({ type: 'completed', task });

    return true;
  }

  /**
   * 标记任务失败
   *
   * @param taskId 任务 ID
   * @param error 错误信息
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = 'failed';
    task.error = error;
    task.completedAt = Date.now();
    task.durationMs = task.startedAt ? Date.now() - task.startedAt : 0;

    this.emit({ type: 'failed', taskId, error });

    return true;
  }

  /**
   * 中断任务
   *
   * @param taskId 任务 ID
   */
  abortTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') {
      return false;
    }

    task.status = 'aborted';
    task.completedAt = Date.now();
    this.emit({ type: 'aborted', taskId });

    return true;
  }

  /**
   * 获取任务信息
   *
   * @param taskId 任务 ID
   */
  getTask(taskId: string): BackgroundTaskInfo | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   *
   * @param filterStatus 可选的状态过滤
   */
  getAllTasks(filterStatus?: BackgroundTaskStatus): BackgroundTaskInfo[] {
    const allTasks = Array.from(this.tasks.values());

    if (filterStatus) {
      return allTasks.filter((t) => t.status === filterStatus);
    }

    return allTasks;
  }

  /**
   * 获取活跃（正在运行）的任务
   */
  getActiveTasks(): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'pending' || t.status === 'running'
    );
  }

  /**
   * 获取已完成的任务（最近 N 条）
   *
   * @param limit 限制数量
   */
  getCompletedTasks(limit = 10): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values())
      .filter(
        (t) =>
          t.status === 'completed' ||
          t.status === 'failed' ||
          t.status === 'aborted'
      )
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, limit);
  }

  /**
   * 订阅事件
   *
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  onEvent(listener: (event: BackgroundTaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 清理已完成的任务
   *
   * @param olderThanMs 清理早于指定时间的任务（默认 1 小时）
   */
  cleanup(olderThanMs = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, task] of this.tasks.entries()) {
      if (task.status !== 'pending' && task.status !== 'running') {
        const age = now - (task.completedAt || task.createdAt);
        if (age > olderThanMs) {
          this.tasks.delete(id);
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  /**
   * 获取任务统计
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    aborted: number;
  } {
    const all = Array.from(this.tasks.values());

    return {
      total: all.length,
      pending: all.filter((t) => t.status === 'pending').length,
      running: all.filter((t) => t.status === 'running').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
      aborted: all.filter((t) => t.status === 'aborted').length,
    };
  }

  /**
   * 格式化任务列表为可读字符串
   */
  formatTaskList(): string {
    const stats = this.getStats();

    let output = `## 后台任务统计\n\n`;
    output += `- 总任务数: ${stats.total}\n`;
    output += `- 等待中: ${stats.pending}\n`;
    output += `- 运行中: ${stats.running}\n`;
    output += `- 已完成: ${stats.completed}\n`;
    output += `- 失败: ${stats.failed}\n`;
    output += `- 已中断: ${stats.aborted}\n\n`;

    const activeTasks = this.getActiveTasks();
    if (activeTasks.length > 0) {
      output += `### 活跃任务\n\n`;
      for (const task of activeTasks) {
        const elapsed = task.startedAt
          ? `${Math.round((Date.now() - task.startedAt) / 1000)}s`
          : '等待中';
        output += `- **${task.description}** [${task.agentType}] (${elapsed})\n`;
        if (task.progressMessage) {
          output += `  - ${task.progressMessage}\n`;
        }
      }
      output += '\n';
    }

    const recentCompleted = this.getCompletedTasks(5);
    if (recentCompleted.length > 0) {
      output += `### 最近完成的任务\n\n`;
      for (const task of recentCompleted) {
        const statusIcon =
          task.status === 'completed'
            ? '✓'
            : task.status === 'failed'
              ? '✗'
              : '—';
        output += `- ${statusIcon} **${task.description}** [${task.agentType}]\n`;
        if (task.durationMs !== undefined) {
          output += `  - 耗时: ${(task.durationMs / 1000).toFixed(1)}s\n`;
        }
      }
      output += '\n';
    }

    return output;
  }

  /**
   * 触发事件
   */
  private emit(event: BackgroundTaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略单个监听器的错误
      }
    }
  }
}

/**
 * 全局后台任务管理器实例
 */
let defaultManager: BackgroundTaskManager | null = null;

export function getBackgroundTaskManager(): BackgroundTaskManager {
  if (!defaultManager) {
    defaultManager = new BackgroundTaskManager();
  }
  return defaultManager;
}

export function setBackgroundTaskManager(manager: BackgroundTaskManager): void {
  defaultManager = manager;
}
