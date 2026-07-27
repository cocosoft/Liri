/**
 * CronTaskTimer 定时器管理
 * 对标 OpenClaw 的 timer 机制
 */

/**
 * 定时器状态
 */
export interface TimerHandle {
  id: string;
  taskId: string;
  nextRun: number;
  interval: number;
  cron: string;
  active: boolean;
}

/**
 * 定时器回调
 */
export type TimerCallback = (taskId: string) => Promise<void>;

/**
 * CRON 表达式解析器 (简化版)
 */
function parseCronExpression(cron: string): number[] {
  const parts = cron.trim().split(/\s+/);

  if (parts.length !== 5) {
    return [];
  }

  const parsePart = (part: string, min: number, max: number): number[] => {
    if (part === '*') {
      const result: number[] = [];

      for (let i = min; i <= max; i++) {
        result.push(i);
      }

      return result;
    }

    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const stepNum = parseInt(step, 10);
      const start = range === '*' ? min : parseInt(range, 10);
      const result: number[] = [];

      for (let i = start; i <= max; i += stepNum) {
        result.push(i);
      }

      return result;
    }

    if (part.includes(',')) {
      return part.split(',').map((p) => parseInt(p, 10));
    }

    if (part.includes('-')) {
      const [start, end] = part.split('-').map((p) => parseInt(p, 10));
      const result: number[] = [];

      for (let i = start; i <= end; i++) {
        result.push(i);
      }

      return result;
    }

    return [parseInt(part, 10)];
  };

  return [
    ...parsePart(parts[0], 0, 59),
    ...parsePart(parts[1], 0, 23),
    ...parsePart(parts[2], 1, 31),
    ...parsePart(parts[3], 1, 12),
    ...parsePart(parts[4], 0, 7),
  ];
}

/**
 * 定时器管理器
 */
export class CronTaskTimer {
  private timers: Map<string, TimerHandle> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private callback: TimerCallback;

  constructor(callback: TimerCallback) {
    this.callback = callback;
  }

  /**
   * 注册定时器
   */
  register(taskId: string, cron: string): TimerHandle {
    const parsed = parseCronExpression(cron);

    const handle: TimerHandle = {
      id: `timer_${Date.now()}_${taskId}`,
      taskId,
      nextRun: Date.now() + 60000,
      interval: 60000,
      cron,
      active: true,
    };

    this.timers.set(taskId, handle);

    const intervalId = setInterval(() => {
      if (!handle.active) {
        this.stop(taskId);
        return;
      }

      handle.nextRun = Date.now() + handle.interval;
      // @ignore-catch — 定时任务回调fire-and-forget，失败由任务自身处理
      this.callback(taskId).catch(() => {});
    }, 60000);

    this.intervals.set(taskId, intervalId);

    return handle;
  }

  /**
   * 停止定时器
   */
  stop(taskId: string): void {
    const handle = this.timers.get(taskId);

    if (handle) {
      handle.active = false;
      this.timers.delete(taskId);
    }

    const intervalId = this.intervals.get(taskId);

    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(taskId);
    }
  }

  /**
   * 获取定时器信息
   */
  getTimer(taskId: string): TimerHandle | undefined {
    return this.timers.get(taskId);
  }

  /**
   * 获取所有定时器
   */
  getAllTimers(): TimerHandle[] {
    return Array.from(this.timers.values());
  }

  /**
   * 停止所有定时器
   */
  stopAll(): void {
    for (const [taskId] of this.timers) {
      this.stop(taskId);
    }
  }
}
