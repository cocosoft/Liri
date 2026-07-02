import { Logger, LogLevel } from '@modules/monitoring';
import { parseCronExpression, computeNextCronRun } from '../cron';
import { listAllCronTasks } from '../CronTasks';
import type { ScheduledTask } from '../types';

const logger = new Logger({
  module: 'chronos:recovery:cronLostTaskDetector',
  level: LogLevel.INFO,
});

export interface MissedTaskInfo {
  taskId: string;
  cronExpression: string;
  lastFiredAt: number | undefined;
  expectedFireAt: number;
  missedBy: number;
}

export class CronLostTaskDetector {
  private dir: string | undefined;
  private gracePeriodMs: number;

  constructor(dir?: string, gracePeriodMs: number = 60000) {
    this.dir = dir;
    this.gracePeriodMs = gracePeriodMs;
  }

  async detect(): Promise<MissedTaskInfo[]> {
    const tasks = await listAllCronTasks(this.dir);
    const now = Date.now();
    const missed: MissedTaskInfo[] = [];

    for (const task of tasks) {
      if (!task.cron || !task.lastFiredAt) continue;
      const expectedNext = this.computeNextExpectedFire(
        task.cron,
        task.lastFiredAt
      );
      if (expectedNext === null) continue;
      if (now - expectedNext > this.gracePeriodMs) {
        missed.push({
          taskId: task.id,
          cronExpression: task.cron,
          lastFiredAt: task.lastFiredAt,
          expectedFireAt: expectedNext,
          missedBy: now - expectedNext,
        });
      }
    }

    if (missed.length > 0) {
      logger.warn('[CronLostTask] 检测到丢失的任务', {
        count: missed.length,
        tasks: missed.map((m) => m.taskId),
      });
    }

    return missed;
  }

  private computeNextExpectedFire(
    cron: string,
    lastFiredAt: number
  ): number | null {
    const fields = parseCronExpression(cron);
    if (!fields) return null;
    const next = computeNextCronRun(fields, new Date(lastFiredAt));
    return next ? next.getTime() : null;
  }
}
