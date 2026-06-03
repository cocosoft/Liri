// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * DreamScheduler — 梦境调度器
 *
 * 组合空闲检测 + 定时触发，独立于守护进程运行。
 * 当条件满足时触发 DreamEngine 执行梦境。
 */

import { DreamIdleDetector } from './DreamIdleDetector';
import { DreamPersistence } from './DreamPersistence';
import {
  createInMemoryScheduler,
} from '../chronos/CronScheduler';
import type { InMemoryScheduler, ScheduledTask } from '../chronos/types';
import type {
  DreamSchedulerConfig,
  DreamTriggerSource,
} from './types';
import { DEFAULT_DREAM_SCHEDULER_CONFIG } from './types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export type DreamTriggerCallback = (source: DreamTriggerSource) => Promise<void>;

const DREAM_CRON_TASK_ID = 'dream-auto-consolidation';
const DREAM_CRON_EXPRESSION = '0 2 * * *';

export class DreamScheduler {
  private idleDetector: DreamIdleDetector;
  private persistence: DreamPersistence;
  private cronScheduler: InMemoryScheduler | null = null;
  private config: DreamSchedulerConfig;
  private onTrigger: DreamTriggerCallback | null = null;
  private started = false;

  constructor(config?: Partial<DreamSchedulerConfig>) {
    this.config = { ...DEFAULT_DREAM_SCHEDULER_CONFIG, ...config };
    this.idleDetector = new DreamIdleDetector(
      this.config.idleThresholdMs,
      this.config.idleCheckIntervalMs
    );
    this.persistence = new DreamPersistence();
  }

  /** 注册触发回调 */
  setTriggerCallback(callback: DreamTriggerCallback): void {
    this.onTrigger = callback;
  }

  /** 获取持久化实例 */
  getPersistence(): DreamPersistence {
    return this.persistence;
  }

  /** 获取空闲检测器（供外部更新活动时间） */
  getIdleDetector(): DreamIdleDetector {
    return this.idleDetector;
  }

  /** 启动调度器 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.persistence.load();

    // 1. 启动空闲检测
    this.idleDetector.start(() => {
      this.tryTrigger('idle');
    });

    // 2. 启动定时触发
    if (this.config.cronTrigger) {
      this.startCronTrigger();
    }

    logger.info('[DreamScheduler] 调度器已启动');
  }

  /** 停止调度器 */
  stop(): void {
    this.started = false;
    this.idleDetector.stop();
    if (this.cronScheduler) {
      this.cronScheduler.stop();
      this.cronScheduler = null;
    }
    logger.info('[DreamScheduler] 调度器已停止');
  }

  /** 检查调度器是否运行中 */
  isRunning(): boolean {
    return this.started;
  }

  /** 手动触发 */
  async triggerManual(): Promise<void> {
    await this.tryTrigger('manual');
  }

  /** 启动 cron 定时触发 */
  private startCronTrigger(): void {
    if (this.cronScheduler) return;

    this.cronScheduler = createInMemoryScheduler({
      checkIntervalMs: 60_000,
      onTaskExecute: async (task) => {
        if (task.id !== DREAM_CRON_TASK_ID) {
          return { success: false, error: `未知任务: ${task.id}` };
        }
        logger.info('[DreamScheduler] cron 触发梦境');
        await this.tryTrigger('cron');
        return { success: true, stdout: '梦境触发成功' };
      },
    });

    const dreamTask: ScheduledTask = {
      id: DREAM_CRON_TASK_ID,
      cron: this.config.cronTrigger || DREAM_CRON_EXPRESSION,
      prompt: '__SYSTEM_DREAM_CONSOLIDATION__',
      createdAt: Date.now(),
      recurring: true,
      permanent: true,
      durable: false,
      taskType: '_system',
      metadata: {
        type: 'auto-dream',
        description: '每天凌晨 2:00 自动执行记忆整合',
      },
    };

    this.cronScheduler.addTask(dreamTask);
    this.cronScheduler.start();

    logger.info(
      `[DreamScheduler] cron 触发已注册: ${this.config.cronTrigger}`
    );
  }

  /** 检查是否可以做梦 */
  private canDream(): boolean {
    const lastCompletedAt = this.persistence.getLastCompletedAt();
    const elapsed = Date.now() - lastCompletedAt;
    if (elapsed < this.config.minIntervalMs) {
      logger.info(
        `[DreamScheduler] 距上次梦境仅 ${Math.round(elapsed / 60_000)}min，跳过（需 >= ${this.config.minIntervalMs / 60_000}min）`
      );
      return false;
    }
    return true;
  }

  /** 触发梦境 */
  private async tryTrigger(source: DreamTriggerSource): Promise<void> {
    if (!this.canDream()) return;
    if (!this.onTrigger) {
      logger.warn('[DreamScheduler] 未注册触发回调');
      return;
    }
    logger.info(`[DreamScheduler] 触发梦境（来源: ${source}）`);
    await this.onTrigger(source);
  }
}
