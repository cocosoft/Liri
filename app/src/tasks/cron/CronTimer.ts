/**
 * Cron 动态定时器
 * 替代固定 setInterval 轮询，根据下次最早到期时间精确休眠
 * 对标 openclaw src/cron/service/timer.ts
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'tasks:cron:timer', level: LogLevel.INFO });

const MAX_TIMER_DELAY_MS = 60_000; // 最大休眠时长 60s，防止长时间无 tick

export class CronTimer {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private nextWakeMs: number | null = null;
  private onTick: (() => Promise<void>) | null = null;

  /** 启动定时器，传入 tick 回调 */
  start(onTick: () => Promise<void>): void {
    this.onTick = onTick;
    this.scheduleNextWake(Date.now() + 1000); // 启动后 1s 首次 tick
  }

  /** 停止定时器 */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.nextWakeMs = null;
    this.onTick = null;
  }

  /** 重调度：更新下次唤醒时间 */
  reschedule(nextJobMs: number | undefined): void {
    if (nextJobMs === undefined) {
      this.scheduleNextWake(Date.now() + MAX_TIMER_DELAY_MS);
      return;
    }
    this.scheduleNextWake(nextJobMs);
  }

  /** 获取下次唤醒时间 */
  getNextWakeMs(): number | null {
    return this.nextWakeMs;
  }

  /** 检查是否有定时器在运行 */
  isActive(): boolean {
    return this.timeoutId !== null;
  }

  /**
   * 调度下次唤醒
   * 如果目标时间比当前调度更晚，忽略（保留更早的唤醒）
   */
  private scheduleNextWake(targetMs: number): void {
    const now = Date.now();
    // 确保唤醒时间不早于当前时间
    const wakeMs = Math.max(now + 100, targetMs);
    // 限制最大延迟
    const cappedMs = Math.min(wakeMs, now + MAX_TIMER_DELAY_MS);
    const delayMs = Math.max(0, cappedMs - now);

    // 如果已有更早的唤醒，忽略
    if (this.nextWakeMs !== null && this.nextWakeMs < cappedMs) {
      return;
    }

    this.clearTimer();
    this.nextWakeMs = cappedMs;

    this.timeoutId = setTimeout(() => {
      this.nextWakeMs = null;
      if (this.onTick) {
        this.onTick().catch((err) => {
          logger.error('[CronTimer] tick 执行失败', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }, delayMs);

    logger.debug('[CronTimer] 调度下次唤醒', {
      delayMs,
      targetMs: cappedMs,
    });
  }

  private clearTimer(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
