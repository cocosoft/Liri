/**
 * DiscoveryScheduler — 5min tick 调度器
 *
 * P0-2: 对标 PilotDeck DiscoveryScheduler。
 */
import { cg3Log } from '../cg3Env';

export class DiscoveryScheduler {
  private intervalMs: number;
  private callback: () => Promise<void>;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(intervalMinutes: number, callback: () => Promise<void>) {
    this.intervalMs = intervalMinutes * 60_000;
    this.callback = callback;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
    cg3Log('tasks:alwayson:scheduler', 'info', 'started', {
      intervalMinutes: this.intervalMs / 60_000,
    });
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.callback();
      } catch (err) {
        cg3Log('tasks:alwayson:scheduler', 'error', 'tickFailed', {
          error: String(err),
        });
      }
      this.scheduleNext();
    }, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    cg3Log('tasks:alwayson:scheduler', 'info', 'stopped');
  }

  isRunning(): boolean {
    return this.running;
  }
}
