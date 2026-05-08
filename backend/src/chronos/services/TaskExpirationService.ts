//
/**
 * 任务过期服务
 * 实现任务过期机制，支持周期性任务自动过期
 * 参考CC源码: cc_code/backend/utils/cronScheduler.ts
 */

import { EventEmitter } from 'events';
import { taskJitterService } from './TaskJitterService.js';

/**
 * 任务信息
 */
export interface Task {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  lastFiredAt?: number;
  recurring?: boolean;
  permanent?: boolean;
  durable?: boolean;
  agentId?: string;
}

/**
 * 过期任务事件
 */
export interface TaskExpiredEvent {
  task: Task;
  reason: string;
  timestamp: number;
}

/**
 * 过期统计
 */
export interface ExpirationStats {
  totalChecked: number;
  expiredCount: number;
  permanentCount: number;
  lastCheckTime: number;
}

/**
 * 任务过期服务类
 */
export class TaskExpirationService extends EventEmitter {
  private static instance: TaskExpirationService;
  private tasks: Map<string, Task> = new Map();
  private expirationHistory: TaskExpiredEvent[] = [];
  private maxHistorySize: number = 100;
  private stats: ExpirationStats = {
    totalChecked: 0,
    expiredCount: 0,
    permanentCount: 0,
    lastCheckTime: 0,
  };
  private checkInterval: NodeJS.Timeout | null = null;
  private autoCheckEnabled: boolean = false;
  private checkIntervalMs: number = 60000;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): TaskExpirationService {
    if (!TaskExpirationService.instance) {
      TaskExpirationService.instance = new TaskExpirationService();
    }
    return TaskExpirationService.instance;
  }

  /**
   * 添加任务
   * @param task 任务
   */
  addTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  /**
   * 移除任务
   * @param taskId 任务ID
   */
  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /**
   * 更新任务
   * @param taskId 任务ID
   * @param updates 更新内容
   */
  updateTask(taskId: string, updates: Partial<Task>): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, ...updates });
    }
  }

  /**
   * 获取任务
   * @param taskId 任务ID
   * @returns 任务
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   * @returns 所有任务
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 检查单个任务是否过期
   * @param taskId 任务ID
   * @returns 是否过期
   */
  checkTaskExpiration(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    this.stats.totalChecked++;

    if (task.permanent) {
      this.stats.permanentCount++;
      return false;
    }

    if (!task.recurring) {
      return false;
    }

    const isExpired = taskJitterService.isTaskExpired(
      task.createdAt,
      task.recurring,
      task.permanent
    );

    if (isExpired) {
      this.stats.expiredCount++;
      this.recordExpiration(task, 'max_age_reached');
      this.emit('taskExpired', task);
      return true;
    }

    return false;
  }

  /**
   * 检查所有任务是否过期
   * @returns 过期任务列表
   */
  checkAllTaskExpiration(): Task[] {
    this.stats.lastCheckTime = Date.now();
    const expiredTasks: Task[] = [];

    for (const [taskId, task] of this.tasks) {
      if (this.checkTaskExpiration(taskId)) {
        expiredTasks.push(task);
      }
    }

    this.emit('expirationCheckComplete', {
      totalChecked: this.tasks.size,
      expiredCount: expiredTasks.length,
      timestamp: this.stats.lastCheckTime,
    });

    return expiredTasks;
  }

  /**
   * 删除过期任务
   * @returns 删除的任务数量
   */
  removeExpiredTasks(): number {
    const expiredTasks = this.checkAllTaskExpiration();
    let removedCount = 0;

    for (const task of expiredTasks) {
      if (this.tasks.has(task.id)) {
        this.tasks.delete(task.id);
        removedCount++;
        this.emit('taskRemoved', task);
      }
    }

    return removedCount;
  }

  /**
   * 启动自动过期检查
   * @param intervalMs 检查间隔（毫秒）
   */
  startAutoCheck(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      return;
    }

    this.autoCheckEnabled = true;
    this.checkIntervalMs = intervalMs;

    this.checkInterval = setInterval(() => {
      this.removeExpiredTasks();
    }, intervalMs);

    this.emit('autoCheckStarted', { intervalMs });
  }

  /**
   * 停止自动过期检查
   */
  stopAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.autoCheckEnabled = false;
      this.emit('autoCheckStopped');
    }
  }

  /**
   * 检查自动检查是否已启动
   * @returns 是否已启动
   */
  isAutoCheckEnabled(): boolean {
    return this.autoCheckEnabled;
  }

  /**
   * 获取过期统计
   * @returns 过期统计
   */
  getStats(): ExpirationStats {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalChecked: 0,
      expiredCount: 0,
      permanentCount: 0,
      lastCheckTime: 0,
    };
  }

  /**
   * 获取过期历史
   * @returns 过期历史
   */
  getExpirationHistory(): TaskExpiredEvent[] {
    return [...this.expirationHistory];
  }

  /**
   * 记录过期事件
   * @param task 任务
   * @param reason 原因
   */
  private recordExpiration(task: Task, reason: string): void {
    const event: TaskExpiredEvent = {
      task,
      reason,
      timestamp: Date.now(),
    };

    this.expirationHistory.push(event);

    if (this.expirationHistory.length > this.maxHistorySize) {
      this.expirationHistory.shift();
    }
  }

  /**
   * 清除过期历史
   */
  clearExpirationHistory(): void {
    this.expirationHistory = [];
  }

  /**
   * 获取任务年龄（毫秒）
   * @param taskId 任务ID
   * @returns 任务年龄
   */
  getTaskAge(taskId: string): number {
    const task = this.tasks.get(taskId);
    if (!task) {
      return 0;
    }
    return Date.now() - task.createdAt;
  }

  /**
   * 获取任务的剩余生存时间（毫秒）
   * @param taskId 任务ID
   * @returns 剩余生存时间（如果是永久任务或已过期，返回0）
   */
  getTaskRemainingTime(taskId: string): number {
    const task = this.tasks.get(taskId);
    if (!task) {
      return 0;
    }

    if (task.permanent) {
      return Infinity;
    }

    if (!task.recurring) {
      return Infinity;
    }

    const config = taskJitterService.getConfig();
    const maxAge = config.recurringMaxAgeMs;

    if (maxAge === 0) {
      return Infinity;
    }

    const age = this.getTaskAge(taskId);
    const remaining = maxAge - age;

    return remaining > 0 ? remaining : 0;
  }

  /**
   * 检查任务是否即将过期（在未来24小时内）
   * @param taskId 任务ID
   * @returns 是否即将过期
   */
  isTaskExpiringSoon(taskId: string): boolean {
    const remaining = this.getTaskRemainingTime(taskId);
    return remaining > 0 && remaining <= 24 * 60 * 60 * 1000;
  }

  /**
   * 获取即将过期的任务列表
   * @returns 即将过期的任务
   */
  getExpiringSoonTasks(): Task[] {
    const expiringSoon: Task[] = [];

    for (const task of this.tasks.values()) {
      if (this.isTaskExpiringSoon(task.id)) {
        expiringSoon.push(task);
      }
    }

    return expiringSoon;
  }

  /**
   * 清除所有任务
   */
  clearAllTasks(): void {
    this.tasks.clear();
    this.emit('allTasksCleared');
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.stopAutoCheck();
    this.clearAllTasks();
    this.clearExpirationHistory();
    this.resetStats();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const taskExpirationService = TaskExpirationService.getInstance();
