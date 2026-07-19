/**
 * CronTaskStore 持久化任务存储
 * 对标 OpenClaw 的 task store 机制
 */
import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'chronos\service\CronTaskStore',
  level: LogLevel.INFO,
});

/**
 * 任务状态
 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 存储任务
 */
export interface StoredTask {
  id: string;
  name: string;
  cron: string;
  command: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  lastRun?: number;
  nextRun?: number;
  retryCount: number;
  maxRetries: number;
  timeout: number;
  tags: string[];
  enabled: boolean;
}

/**
 * 任务存储
 */
export class CronTaskStore {
  private storePath: string;
  private tasks: Map<string, StoredTask> = new Map();

  constructor(storePath?: string) {
    this.storePath =
      storePath || path.join(resolvePyappHome(), 'chronos', 'tasks.json');
    this.load();
  }

  /**
   * 保存任务
   */
  save(task: StoredTask): void {
    task.updatedAt = Date.now();
    this.tasks.set(task.id, task);
    this.persist();
  }

  /**
   * 批量保存
   */
  saveAll(tasks: StoredTask[]): void {
    for (const task of tasks) {
      task.updatedAt = Date.now();
      this.tasks.set(task.id, task);
    }

    this.persist();
  }

  /**
   * 获取任务
   */
  get(id: string): StoredTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * 删除任务
   */
  delete(id: string): boolean {
    const result = this.tasks.delete(id);

    if (result) {
      this.persist();
    }

    return result;
  }

  /**
   * 获取所有任务
   */
  getAll(): StoredTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  /**
   * 查询任务
   */
  query(filter: Partial<StoredTask>): StoredTask[] {
    return this.getAll().filter((task) => {
      for (const [key, value] of Object.entries(filter)) {
        if ((task as any)[key] !== value) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    enabled: number;
    running: number;
    failed: number;
  } {
    const all = this.getAll();

    return {
      total: all.length,
      enabled: all.filter((t) => t.enabled).length,
      running: all.filter((t) => t.status === 'running').length,
      failed: all.filter((t) => t.status === 'failed').length,
    };
  }

  /**
   * 从文件加载
   */
  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        const tasks: StoredTask[] = JSON.parse(content);

        for (const task of tasks) {
          this.tasks.set(task.id, task);
        }
      }
    } catch {
      this.tasks.clear();
    }
  }

  /**
   * 持久化到文件
   */
  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const tasks = this.getAll();
      fs.writeFileSync(this.storePath, JSON.stringify(tasks, null, 2), 'utf-8');
    } catch (err) {
      void handleError(err, {
        module: 'chronos:service',
        action: 'catch_error',
      });
    }
  }
}

export const cronTaskStore = new CronTaskStore();
