/**
 * 会话级任务服务
 * 实现会话级任务支持，包括内存中的临时任务和生命周期管理
 * 参考CC源码: cc_code/backend/utils/cronTasks.ts
 */

import { EventEmitter } from 'events';

/**
 * 会话级任务
 */
export interface SessionTask {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  lastFiredAt?: number;
  recurring?: boolean;
  agentId?: string;
  sessionId: string;
  durable: false;
}

/**
 * 会话任务事件
 */
export interface SessionTaskEvent {
  task: SessionTask;
  timestamp: number;
}

/**
 * 会话任务统计
 */
export interface SessionTaskStats {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
}

/**
 * 会话级任务服务类
 */
export class SessionTaskService extends EventEmitter {
  private static instance: SessionTaskService;
  private sessionTasks: Map<string, SessionTask> = new Map();
  private completedTasks: Map<string, SessionTask[]> = new Map();
  private failedTasks: Map<string, SessionTask[]> = new Map();
  private taskHistory: SessionTaskEvent[] = [];
  private maxHistorySize: number = 100;
  private activeSessionIds: Set<string> = new Set();

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SessionTaskService {
    if (!SessionTaskService.instance) {
      SessionTaskService.instance = new SessionTaskService();
    }
    return SessionTaskService.instance;
  }

  /**
   * 添加会话级任务
   * @param task 任务
   * @returns 任务ID
   */
  addSessionTask(task: Omit<SessionTask, 'durable'>): string {
    const fullTask: SessionTask = {
      ...task,
      durable: false,
    };

    this.sessionTasks.set(task.id, fullTask);
    this.activeSessionIds.add(task.sessionId);

    this.recordEvent('taskAdded', fullTask);
    this.emit('taskAdded', fullTask);

    return task.id;
  }

  /**
   * 移除会话级任务
   * @param taskId 任务ID
   * @param sessionId 会话ID
   */
  removeSessionTask(taskId: string, sessionId?: string): void {
    const task = this.sessionTasks.get(taskId);

    if (!task) {
      return;
    }

    if (sessionId && task.sessionId !== sessionId) {
      return;
    }

    this.sessionTasks.delete(taskId);
    this.recordEvent('taskRemoved', task);
    this.emit('taskRemoved', task);

    this.cleanupSessionIfNeeded(task.sessionId);
  }

  /**
   * 更新会话级任务
   * @param taskId 任务ID
   * @param updates 更新内容
   */
  updateSessionTask(taskId: string, updates: Partial<SessionTask>): void {
    const task = this.sessionTasks.get(taskId);
    if (!task) {
      return;
    }

    const updatedTask = { ...task, ...updates };
    this.sessionTasks.set(taskId, updatedTask);
    this.recordEvent('taskUpdated', updatedTask);
    this.emit('taskUpdated', updatedTask);
  }

  /**
   * 获取会话级任务
   * @param taskId 任务ID
   * @returns 任务
   */
  getSessionTask(taskId: string): SessionTask | undefined {
    return this.sessionTasks.get(taskId);
  }

  /**
   * 获取所有会话级任务
   * @returns 所有任务
   */
  getAllSessionTasks(): SessionTask[] {
    return Array.from(this.sessionTasks.values());
  }

  /**
   * 获取指定会话的任务
   * @param sessionId 会话ID
   * @returns 会话任务列表
   */
  getSessionTasks(sessionId: string): SessionTask[] {
    const tasks: SessionTask[] = [];
    for (const task of this.sessionTasks.values()) {
      if (task.sessionId === sessionId) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  /**
   * 获取指定Agent的任务
   * @param agentId 代理ID
   * @returns 代理任务列表
   */
  getAgentTasks(agentId: string): SessionTask[] {
    const tasks: SessionTask[] = [];
    for (const task of this.sessionTasks.values()) {
      if (task.agentId === agentId) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  /**
   * 标记任务已执行
   * @param taskId 任务ID
   */
  markTaskFired(taskId: string): void {
    const task = this.sessionTasks.get(taskId);
    if (!task) {
      return;
    }

    const updatedTask = {
      ...task,
      lastFiredAt: Date.now(),
    };

    this.sessionTasks.set(taskId, updatedTask);
    this.recordEvent('taskFired', updatedTask);
    this.emit('taskFired', updatedTask);
  }

  /**
   * 标记任务已完成
   * @param taskId 任务ID
   */
  markTaskCompleted(taskId: string): void {
    const task = this.sessionTasks.get(taskId);
    if (!task) {
      return;
    }

    this.sessionTasks.delete(taskId);

    if (!this.completedTasks.has(task.sessionId)) {
      this.completedTasks.set(task.sessionId, []);
    }
    this.completedTasks.get(task.sessionId)!.push(task);

    this.recordEvent('taskCompleted', task);
    this.emit('taskCompleted', task);

    this.cleanupSessionIfNeeded(task.sessionId);
  }

  /**
   * 标记任务失败
   * @param taskId 任务ID
   * @param error 错误信息
   */
  markTaskFailed(taskId: string, error?: string): void {
    const task = this.sessionTasks.get(taskId);
    if (!task) {
      return;
    }

    this.sessionTasks.delete(taskId);

    if (!this.failedTasks.has(task.sessionId)) {
      this.failedTasks.set(task.sessionId, []);
    }
    this.failedTasks.get(task.sessionId)!.push(task);

    this.recordEvent('taskFailed', task);
    this.emit('taskFailed', { task, error });

    this.cleanupSessionIfNeeded(task.sessionId);
  }

  /**
   * 获取会话已完成的任务
   * @param sessionId 会话ID
   * @returns 已完成任务列表
   */
  getCompletedTasks(sessionId: string): SessionTask[] {
    return this.completedTasks.get(sessionId) || [];
  }

  /**
   * 获取会话失败的任务
   * @param sessionId 会话ID
   * @returns 失败任务列表
   */
  getFailedTasks(sessionId: string): SessionTask[] {
    return this.failedTasks.get(sessionId) || [];
  }

  /**
   * 获取任务统计
   * @returns 任务统计
   */
  getStats(): SessionTaskStats {
    let completedCount = 0;
    for (const tasks of this.completedTasks.values()) {
      completedCount += tasks.length;
    }

    let failedCount = 0;
    for (const tasks of this.failedTasks.values()) {
      failedCount += tasks.length;
    }

    return {
      totalTasks: this.sessionTasks.size + completedCount + failedCount,
      activeTasks: this.sessionTasks.size,
      completedTasks: completedCount,
      failedTasks: failedCount,
    };
  }

  /**
   * 清理会话的所有任务
   * @param sessionId 会话ID
   */
  cleanupSession(sessionId: string): void {
    const taskIds = [];
    for (const [taskId, task] of this.sessionTasks.entries()) {
      if (task.sessionId === sessionId) {
        taskIds.push(taskId);
      }
    }

    for (const taskId of taskIds) {
      this.sessionTasks.delete(taskId);
    }

    this.completedTasks.delete(sessionId);
    this.failedTasks.delete(sessionId);
    this.activeSessionIds.delete(sessionId);

    this.emit('sessionCleaned', { sessionId, removedCount: taskIds.length });
  }

  /**
   * 清理不再活跃的会话
   */
  cleanupInactiveSessions(): number {
    const activeSessions = new Set<string>();

    for (const task of this.sessionTasks.values()) {
      activeSessions.add(task.sessionId);
    }

    let removedCount = 0;
    for (const sessionId of this.activeSessionIds) {
      if (!activeSessions.has(sessionId)) {
        this.cleanupSession(sessionId);
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * 获取活跃的会话ID列表
   * @returns 会话ID列表
   */
  getActiveSessions(): string[] {
    const activeSessions = new Set<string>();
    for (const task of this.sessionTasks.values()) {
      activeSessions.add(task.sessionId);
    }
    return Array.from(activeSessions);
  }

  /**
   * 获取任务历史
   * @returns 任务历史
   */
  getTaskHistory(): SessionTaskEvent[] {
    return [...this.taskHistory];
  }

  /**
   * 清除任务历史
   */
  clearTaskHistory(): void {
    this.taskHistory = [];
  }

  /**
   * 记录事件
   * @param type 事件类型
   * @param task 任务
   */
  private recordEvent(type: string, task: SessionTask): void {
    const event: SessionTaskEvent = {
      task,
      timestamp: Date.now(),
    };

    this.taskHistory.push(event);

    if (this.taskHistory.length > this.maxHistorySize) {
      this.taskHistory.shift();
    }
  }

  /**
   * 如果会话没有更多任务，清理会话相关的已完成/失败记录
   * @param sessionId 会话ID
   */
  private cleanupSessionIfNeeded(sessionId: string): void {
    for (const task of this.sessionTasks.values()) {
      if (task.sessionId === sessionId) {
        return;
      }
    }

    this.activeSessionIds.delete(sessionId);
  }

  /**
   * 检查是否有待执行的任务
   * @returns 是否有待执行任务
   */
  hasPendingTasks(): boolean {
    return this.sessionTasks.size > 0;
  }

  /**
   * 获取下一个待执行的任务（按创建时间排序）
   * @returns 下一个任务
   */
  getNextTask(): SessionTask | null {
    if (this.sessionTasks.size === 0) {
      return null;
    }

    let oldest: SessionTask | null = null;
    for (const task of this.sessionTasks.values()) {
      if (!oldest || task.createdAt < oldest.createdAt) {
        oldest = task;
      }
    }

    return oldest;
  }

  /**
   * 清除所有会话级任务
   */
  clearAllTasks(): void {
    this.sessionTasks.clear();
    this.completedTasks.clear();
    this.failedTasks.clear();
    this.activeSessionIds.clear();
    this.taskHistory = [];
    this.emit('allTasksCleared');
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.clearAllTasks();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const sessionTaskService = SessionTaskService.getInstance();
