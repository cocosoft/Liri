/**
 * 任务调度器
 * 实现高级任务调度功能，包括任务优先级、依赖关系和优化调度算法
 * 参考CC源码: cc_code/backend/utils/cronScheduler.ts
 */

import { EventEmitter } from 'events';
import { taskJitterService } from './TaskJitterService.js';
import { taskExpirationService } from './TaskExpirationService.js';
import { sessionTaskService } from './SessionTaskService.js';

/**
 * 任务类型
 */
export interface ScheduledTask {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  lastFiredAt?: number;
  recurring?: boolean;
  permanent?: boolean;
  durable?: boolean;
  agentId?: string;
  priority?: number;
  dependencies?: string[];
  taskType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 任务调度选项
 */
export interface TaskSchedulerOptions {
  checkIntervalMs?: number;
  enableJitter?: boolean;
  enableExpiration?: boolean;
  enableSessionTasks?: boolean;
  maxConcurrentTasks?: number;
}

/**
 * 调度器统计
 */
export interface SchedulerStats {
  totalTasks: number;
  activeTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  lastCheckTime: number;
  nextFireTime: number | null;
}

/**
 * 任务调度器类
 */
export class TaskScheduler extends EventEmitter {
  private static instance: TaskScheduler;
  private tasks: Map<string, ScheduledTask> = new Map();
  private nextFireTimes: Map<string, number> = new Map();
  private inFlightTasks: Set<string> = new Set();
  private completedTaskHistory: string[] = [];
  private failedTaskHistory: string[] = [];
  private maxHistorySize: number = 100;
  private options: Required<TaskSchedulerOptions>;
  private checkTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private stats: SchedulerStats = {
    totalTasks: 0,
    activeTasks: 0,
    pendingTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    lastCheckTime: 0,
    nextFireTime: null,
  };

  private constructor(options: TaskSchedulerOptions = {}) {
    super();
    this.options = {
      checkIntervalMs: options.checkIntervalMs || 1000,
      enableJitter: options.enableJitter !== false,
      enableExpiration: options.enableExpiration !== false,
      enableSessionTasks: options.enableSessionTasks !== false,
      maxConcurrentTasks: options.maxConcurrentTasks || 10,
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(options?: TaskSchedulerOptions): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler(options);
    }
    return TaskScheduler.instance;
  }

  /**
   * 添加任务
   * @param task 任务
   */
  addTask(task: ScheduledTask): void {
    this.tasks.set(task.id, task);
    this.stats.totalTasks++;
    this.stats.activeTasks++;
    this.stats.pendingTasks++;

    if (this.options.enableExpiration && taskExpirationService) {
      taskExpirationService.addTask(task as any);
    }

    this.calculateNextFireTime(task.id);

    this.emit('taskAdded', task);
  }

  /**
   * 移除任务
   * @param taskId 任务ID
   */
  removeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    this.tasks.delete(taskId);
    this.nextFireTimes.delete(taskId);
    this.stats.activeTasks--;
    this.stats.pendingTasks--;

    if (this.options.enableExpiration) {
      taskExpirationService.removeTask(taskId);
    }

    this.emit('taskRemoved', task);
  }

  /**
   * 更新任务
   * @param taskId 任务ID
   * @param updates 更新内容
   */
  updateTask(taskId: string, updates: Partial<ScheduledTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    const updatedTask = { ...task, ...updates };
    this.tasks.set(taskId, updatedTask);

    if (this.options.enableExpiration) {
      taskExpirationService.updateTask(taskId, updates as any);
    }

    this.calculateNextFireTime(taskId);

    this.emit('taskUpdated', updatedTask);
  }

  /**
   * 获取任务
   * @param taskId 任务ID
   * @returns 任务
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   * @returns 所有任务
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取待执行的任务（按优先级排序）
   * @returns 待执行任务列表
   */
  getPendingTasks(): ScheduledTask[] {
    const now = Date.now();
    const pending: ScheduledTask[] = [];

    for (const [taskId, task] of this.tasks) {
      if (this.inFlightTasks.has(taskId)) {
        continue;
      }

      const nextFireTime = this.nextFireTimes.get(taskId);
      if (nextFireTime !== undefined && nextFireTime <= now) {
        if (this.checkDependencies(taskId)) {
          pending.push(task);
        }
      }
    }

    return pending.sort((a, b) => {
      const priorityA = a.priority || 0;
      const priorityB = b.priority || 0;
      if (priorityB !== priorityA) {
        return priorityB - priorityA;
      }
      const fireTimeA = this.nextFireTimes.get(a.id) || 0;
      const fireTimeB = this.nextFireTimes.get(b.id) || 0;
      return fireTimeA - fireTimeB;
    });
  }

  /**
   * 检查任务依赖是否满足
   * @param taskId 任务ID
   * @returns 依赖是否满足
   */
  private checkDependencies(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || !task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    for (const depId of task.dependencies) {
      if (this.inFlightTasks.has(depId)) {
        return false;
      }
      if (!this.completedTaskHistory.includes(depId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 计算任务下一次执行时间
   * @param taskId 任务ID
   */
  private calculateNextFireTime(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    let nextFireTime: number | null = null;

    if (this.options.enableJitter) {
      if (task.recurring) {
        nextFireTime = taskJitterService.calculateNextRecurringFireTime(
          task.cron,
          task.lastFiredAt || task.createdAt,
          task.id
        );
      } else {
        nextFireTime = taskJitterService.calculateNextOneShotFireTime(
          task.cron,
          task.createdAt,
          task.id
        );
      }
    } else {
      nextFireTime = this.calculateBasicNextFireTime(
        task.cron,
        task.lastFiredAt || task.createdAt
      );
    }

    if (nextFireTime !== null) {
      this.nextFireTimes.set(taskId, nextFireTime);
    } else {
      this.nextFireTimes.delete(taskId);
    }

    this.updateNextFireTime();
  }

  /**
   * 计算基础下一次执行时间（不考虑抖动）
   * @param cronExpression cron表达式
   * @param fromTime 起始时间
   * @returns 下一次执行时间
   */
  private calculateBasicNextFireTime(
    cronExpression: string,
    fromTime: number
  ): number | null {
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) {
      return null;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const fromDate = new Date(fromTime);
    let targetMinute = this.parseCronField(
      minute,
      fromDate.getMinutes(),
      0,
      59
    );
    let targetHour = this.parseCronField(hour, fromDate.getHours(), 0, 23);
    let targetDayOfMonth = this.parseCronField(
      dayOfMonth,
      fromDate.getDate(),
      1,
      31
    );
    let targetMonth = this.parseCronField(
      month,
      fromDate.getMonth() + 1,
      1,
      12
    );

    if (
      targetMinute === null ||
      targetHour === null ||
      targetDayOfMonth === null ||
      targetMonth === null
    ) {
      return null;
    }

    const candidate = new Date(
      fromDate.getFullYear(),
      targetMonth - 1,
      targetDayOfMonth,
      targetHour,
      targetMinute
    );

    if (candidate.getTime() <= fromTime) {
      candidate.setMinutes(candidate.getMinutes() + 1);
    }

    return candidate.getTime();
  }

  /**
   * 解析cron字段
   */
  private parseCronField(
    field: string,
    current: number,
    min: number,
    max: number
  ): number | null {
    if (field === '*') {
      return current;
    }

    if (field.includes('/')) {
      const [range, step] = field.split('/');
      const stepNum = parseInt(step, 10);
      if (range === '*') {
        return Math.floor(current / stepNum) * stepNum;
      }
      const [start] = range.split('-').map((n) => parseInt(n, 10));
      const adjustedCurrent = Math.max(current, start);
      return Math.floor((adjustedCurrent - start) / stepNum) * stepNum + start;
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map((n) => parseInt(n, 10));
      if (current < start || current > end) {
        return start;
      }
      return current;
    }

    if (field.includes(',')) {
      const values = field.split(',').map((n) => parseInt(n, 10));
      for (const v of values.sort((a, b) => a - b)) {
        if (v >= current) {
          return v;
        }
      }
      return values[0];
    }

    const value = parseInt(field, 10);
    if (isNaN(value) || value < min || value > max) {
      return null;
    }

    return value;
  }

  /**
   * 更新下一次执行时间
   */
  private updateNextFireTime(): void {
    let minFireTime: number | null = null;

    for (const fireTime of this.nextFireTimes.values()) {
      if (minFireTime === null || fireTime < minFireTime) {
        minFireTime = fireTime;
      }
    }

    this.stats.nextFireTime = minFireTime;
  }

  /**
   * 标记任务开始执行
   * @param taskId 任务ID
   */
  markTaskStarted(taskId: string): void {
    if (this.inFlightTasks.has(taskId)) {
      return;
    }

    this.inFlightTasks.add(taskId);
    this.stats.pendingTasks--;
    this.stats.runningTasks++;

    if (this.options.enableSessionTasks) {
      sessionTaskService.markTaskFired(taskId);
    }

    this.emit('taskStarted', this.tasks.get(taskId));
  }

  /**
   * 标记任务完成
   * @param taskId 任务ID
   */
  markTaskCompleted(taskId: string): void {
    if (!this.inFlightTasks.has(taskId)) {
      return;
    }

    this.inFlightTasks.delete(taskId);
    this.stats.runningTasks--;
    this.stats.completedTasks++;

    this.completedTaskHistory.push(taskId);
    if (this.completedTaskHistory.length > this.maxHistorySize) {
      this.completedTaskHistory.shift();
    }

    const task = this.tasks.get(taskId);
    if (task) {
      const updatedTask = { ...task, lastFiredAt: Date.now() };
      this.tasks.set(taskId, updatedTask);

      if (task.recurring) {
        this.calculateNextFireTime(taskId);
      } else {
        this.removeTask(taskId);
      }
    }

    if (this.options.enableSessionTasks) {
      sessionTaskService.markTaskCompleted(taskId);
    }

    this.emit('taskCompleted', task);
  }

  /**
   * 标记任务失败
   * @param taskId 任务ID
   * @param error 错误信息
   */
  markTaskFailed(taskId: string, error?: string): void {
    if (!this.inFlightTasks.has(taskId)) {
      return;
    }

    this.inFlightTasks.delete(taskId);
    this.stats.runningTasks--;
    this.stats.failedTasks++;

    this.failedTaskHistory.push(taskId);
    if (this.failedTaskHistory.length > this.maxHistorySize) {
      this.failedTaskHistory.shift();
    }

    if (this.options.enableSessionTasks) {
      sessionTaskService.markTaskFailed(taskId, error);
    }

    const task = this.tasks.get(taskId);
    this.emit('taskFailed', { task, error });
  }

  /**
   * 检查任务是否可以执行
   * @param taskId 任务ID
   * @returns 是否可以执行
   */
  canExecuteTask(taskId: string): boolean {
    if (this.stats.runningTasks >= this.options.maxConcurrentTasks) {
      return false;
    }

    if (this.inFlightTasks.has(taskId)) {
      return false;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    return this.checkDependencies(taskId);
  }

  /**
   * 获取下一个待执行的任务
   * @returns 下一个任务
   */
  getNextExecutableTask(): ScheduledTask | null {
    const pendingTasks = this.getPendingTasks();

    for (const task of pendingTasks) {
      if (this.canExecuteTask(task.id)) {
        return task;
      }
    }

    return null;
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    if (this.options.enableExpiration) {
      taskExpirationService.startAutoCheck();
    }

    this.checkTimer = setInterval(() => {
      this.check();
    }, this.options.checkIntervalMs);

    this.emit('started');
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    if (this.options.enableExpiration) {
      taskExpirationService.stopAutoCheck();
    }

    this.emit('stopped');
  }

  /**
   * 检查任务状态
   */
  private check(): void {
    this.stats.lastCheckTime = Date.now();

    if (this.options.enableExpiration) {
      const expiredTasks = taskExpirationService.checkAllTaskExpiration();
      for (const task of expiredTasks) {
        this.removeTask(task.id);
      }
    }

    if (this.options.enableSessionTasks) {
      sessionTaskService.cleanupInactiveSessions();
    }

    this.emit('check', {
      stats: this.getStats(),
      pendingTasks: this.getPendingTasks().length,
    });
  }

  /**
   * 获取调度器统计
   * @returns 统计信息
   */
  getStats(): SchedulerStats {
    return { ...this.stats };
  }

  /**
   * 获取下一次执行时间
   * @returns 下一次执行时间
   */
  getNextFireTime(): number | null {
    return this.stats.nextFireTime;
  }

  /**
   * 获取任务历史
   * @returns 任务历史
   */
  getTaskHistory(): { completed: string[]; failed: string[] } {
    return {
      completed: [...this.completedTaskHistory],
      failed: [...this.failedTaskHistory],
    };
  }

  /**
   * 获取优先级列表
   * @returns 按优先级分组的任务
   */
  getTasksByPriority(): Map<number, ScheduledTask[]> {
    const priorityMap = new Map<number, ScheduledTask[]>();

    for (const task of this.tasks.values()) {
      const priority = task.priority || 0;
      if (!priorityMap.has(priority)) {
        priorityMap.set(priority, []);
      }
      priorityMap.get(priority)!.push(task);
    }

    return priorityMap;
  }

  /**
   * 获取依赖任务图
   * @returns 依赖关系图
   */
  getDependencyGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const task of this.tasks.values()) {
      if (task.dependencies && task.dependencies.length > 0) {
        graph.set(task.id, task.dependencies);
      }
    }

    return graph;
  }

  /**
   * 检测循环依赖
   * @returns 是否有循环依赖
   */
  hasCircularDependencies(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (taskId: string): boolean => {
      visited.add(taskId);
      recursionStack.add(taskId);

      const task = this.tasks.get(taskId);
      if (task && task.dependencies) {
        for (const depId of task.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        if (dfs(taskId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 清除所有任务
   */
  clearAllTasks(): void {
    this.tasks.clear();
    this.nextFireTimes.clear();
    this.inFlightTasks.clear();
    this.completedTaskHistory = [];
    this.failedTaskHistory = [];
    this.stats = {
      totalTasks: 0,
      activeTasks: 0,
      pendingTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      lastCheckTime: 0,
      nextFireTime: null,
    };

    this.emit('allTasksCleared');
  }

  /**
   * 重置调度器
   */
  reset(): void {
    this.stop();
    this.clearAllTasks();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const taskScheduler = TaskScheduler.getInstance();
