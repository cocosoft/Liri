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
import { computeNextCronRunMs } from '@modules/tasks/cron/CronParser';
import type { DreamSchedulerConfig, DreamTriggerSource } from './types';
import { DEFAULT_DREAM_SCHEDULER_CONFIG } from './types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

export type DreamTriggerCallback = (
  source: DreamTriggerSource
) => Promise<void>;

const DREAM_CRON_EXPRESSION = '0 2 * * *';
const CHECK_INTERVAL_MS = 60_000;

export class DreamScheduler {
  private idleDetector: DreamIdleDetector;
  private persistence: DreamPersistence;
  private cronTimerId: ReturnType<typeof setInterval> | null = null;
  private nextCronRunMs: number | null = null;
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
    this.stopCronTrigger();
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

  /** 启动 cron 定时触发（使用 setInterval + cron 表达式校验替代旧的 InMemoryScheduler） */
  private startCronTrigger(): void {
    if (this.cronTimerId) return;

    const cronExp = this.config.cronTrigger || DREAM_CRON_EXPRESSION;
    this.nextCronRunMs = computeNextCronRunMs(cronExp, Date.now()) ?? null;

    this.cronTimerId = setInterval(() => {
      if (this.nextCronRunMs === null) {
        this.nextCronRunMs = computeNextCronRunMs(cronExp, Date.now()) ?? null;
        return;
      }

      const now = Date.now();
      if (now >= this.nextCronRunMs) {
        logger.info('[DreamScheduler] cron 触发梦境');
        this.tryTrigger('cron');
        this.nextCronRunMs = computeNextCronRunMs(cronExp, now) ?? null;
      }
    }, CHECK_INTERVAL_MS);

    logger.info(`[DreamScheduler] cron 触发已注册: ${cronExp}`);
  }

  /** 停止 cron 定时触发 */
  private stopCronTrigger(): void {
    if (this.cronTimerId !== null) {
      clearInterval(this.cronTimerId);
      this.cronTimerId = null;
    }
    this.nextCronRunMs = null;
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
