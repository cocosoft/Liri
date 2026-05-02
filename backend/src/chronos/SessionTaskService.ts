/**
 * 会话级任务服务
 * 提供内存中的临时任务管理功能
 * 参考CC源码: cc_code/backend/bootstrap/state.ts (sessionCronTasks)
 */

import { EventEmitter } from 'events';
import type { ScheduledTask } from './types';

/**
 * 会话任务事件
 */
export interface SessionTaskEvent {
  type: 'added' | 'removed' | 'updated' | 'cleared';
  task?: ScheduledTask;
  tasks?: ScheduledTask[];
}

/**
 * 会话任务服务类
 */
export class SessionTaskService extends EventEmitter {
  private static instance: SessionTaskService;
  private sessionTasks: Map<string, ScheduledTask> = new Map();
  private maxSessionTasks: number = 100;

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
   * 添加会话任务
   * @param task 任务
   * @returns 任务ID
   */
  addSessionTask(task: ScheduledTask): string {
    if (this.sessionTasks.size >= this.maxSessionTasks) {
      this.evictOldestTask();
    }

    this.sessionTasks.set(task.id, task);
    this.emit('taskEvent', {
      type: 'added',
      task,
    });

    return task.id;
  }

  /**
   * 获取会话任务
   * @param id 任务ID
   * @returns 任务或undefined
   */
  getSessionTask(id: string): ScheduledTask | undefined {
    return this.sessionTasks.get(id);
  }

  /**
   * 获取所有会话任务
   * @returns 任务数组
   */
  getAllSessionTasks(): ScheduledTask[] {
    return Array.from(this.sessionTasks.values());
  }

  /**
   * 更新会话任务
   * @param id 任务ID
   * @param updates 更新内容
   * @returns 是否成功
   */
  updateSessionTask(
    id: string,
    updates: Partial<ScheduledTask>
  ): boolean {
    const task = this.sessionTasks.get(id);
    if (!task) {
      return false;
    }

    const updatedTask = { ...task, ...updates };
    this.sessionTasks.set(id, updatedTask);
    this.emit('taskEvent', {
      type: 'updated',
      task: updatedTask,
    });

    return true;
  }

  /**
   * 移除会话任务
   * @param id 任务ID
   * @returns 是否成功
   */
  removeSessionTask(id: string): boolean {
    const task = this.sessionTasks.get(id);
    if (!task) {
      return false;
    }

    this.sessionTasks.delete(id);
    this.emit('taskEvent', {
      type: 'removed',
      task,
    });

    return true;
  }

  /**
   * 清除所有会话任务
   */
  clearSessionTasks(): void {
    const tasks = this.getAllSessionTasks();
    this.sessionTasks.clear();
    this.emit('taskEvent', {
      type: 'cleared',
      tasks,
    });
  }

  /**
   * 检查是否存在会话任务
   * @param id 任务ID
   * @returns 是否存在
   */
  hasSessionTask(id: string): boolean {
    return this.sessionTasks.has(id);
  }

  /**
   * 获取会话任务数量
   * @returns 任务数量
   */
  getSessionTaskCount(): number {
    return this.sessionTasks.size;
  }

  /**
   * 根据条件查找会话任务
   * @param predicate 条件函数
   * @returns 任务数组
   */
  findSessionTasks(predicate: (task: ScheduledTask) => boolean): ScheduledTask[] {
    const results: ScheduledTask[] = [];
    for (const task of this.sessionTasks.values()) {
      if (predicate(task)) {
        results.push(task);
      }
    }
    return results;
  }

  /**
   * 标记任务为已触发
   * @param id 任务ID
   * @returns 是否成功
   */
  markTaskFired(id: string): boolean {
    return this.updateSessionTask(id, {
      lastFiredAt: Date.now(),
    });
  }

  /**
   * 获取待触发的任务
   * @param now 当前时间戳
   * @returns 待触发的任务数组
   */
  getTasksToFire(now: number): ScheduledTask[] {
    return this.findSessionTasks((task) => {
      if (!task.lastFiredAt) {
        return task.createdAt <= now;
      }
      return false;
    });
  }

  /**
   * 淘汰最旧的任务
   */
  private evictOldestTask(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, task] of this.sessionTasks.entries()) {
      if (task.createdAt < oldestTime) {
        oldestTime = task.createdAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.removeSessionTask(oldestId);
    }
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.sessionTasks.clear();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const sessionTaskService = SessionTaskService.getInstance();
