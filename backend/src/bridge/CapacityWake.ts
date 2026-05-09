/**
 * 容量唤醒（基于CC源码 bridge/capacityWake.ts）
 */
export class CapacityWake {
  private lastWakeTime: number = 0;
  private wakeIntervalMs: number;
  private maxRetries: number;

  constructor(intervalMs: number = 30_000, maxRetries: number = 3) {
    this.wakeIntervalMs = intervalMs;
    this.maxRetries = maxRetries;
  }

  canWake(): boolean {
    return Date.now() - this.lastWakeTime >= this.wakeIntervalMs;
  }

  async tryWake(wakeFn: () => Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const success = await wakeFn();
        if (success) {
          this.lastWakeTime = Date.now();
          return true;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return false;
  }

  getStatus(): { lastWakeMs: number; intervalMs: number; retries: number } {
    return {
      lastWakeMs: Date.now() - this.lastWakeTime,
      intervalMs: this.wakeIntervalMs,
      retries: this.maxRetries,
    };
  }
}
