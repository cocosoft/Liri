import { EventEmitter } from 'events';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { HeartbeatRecord, HeartbeatTimeoutEvent, HeartbeatManagerOptions } from './types';

const logger = new Logger({ level: LogLevel.INFO });

export class HeartbeatManager extends EventEmitter {
  private records: Map<string, HeartbeatRecord> = new Map();
  private detectTimer: ReturnType<typeof setInterval> | null = null;
  private readonly detectIntervalMs: number;
  private readonly defaultTtlMs: number;

  constructor(options: HeartbeatManagerOptions = {}) {
    super();
    this.detectIntervalMs = options.detectIntervalMs ?? 30_000;
    this.defaultTtlMs = options.defaultTtlMs ?? 300_000;
  }

  register(taskId: string, ttlMs?: number): void {
    const now = Date.now();
    this.records.set(taskId, {
      taskId,
      lastHeartbeatAt: now,
      startedAt: now,
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
    logger.debug('[HeartbeatManager] 注册心跳', { taskId, ttlMs: ttlMs ?? this.defaultTtlMs });
  }

  unregister(taskId: string): void {
    this.records.delete(taskId);
    logger.debug('[HeartbeatManager] 注销心跳', { taskId });
  }

  beat(taskId: string): boolean {
    const record = this.records.get(taskId);
    if (!record) return false;
    record.lastHeartbeatAt = Date.now();
    return true;
  }

  isRegistered(taskId: string): boolean {
    return this.records.has(taskId);
  }

  getRecord(taskId: string): HeartbeatRecord | undefined {
    return this.records.get(taskId);
  }

  getStaleTasks(): string[] {
    const now = Date.now();
    const stale: string[] = [];
    for (const [taskId, record] of this.records) {
      const elapsed = now - record.lastHeartbeatAt;
      if (elapsed > record.ttlMs) {
        stale.push(taskId);
      }
    }
    return stale;
  }

  detectTimeout(): HeartbeatTimeoutEvent[] {
    const now = Date.now();
    const events: HeartbeatTimeoutEvent[] = [];
    const stale = this.getStaleTasks();

    for (const taskId of stale) {
      const record = this.records.get(taskId)!;
      const event: HeartbeatTimeoutEvent = {
        taskId,
        elapsedMs: now - record.lastHeartbeatAt,
        ttlMs: record.ttlMs,
        lastHeartbeatAt: record.lastHeartbeatAt,
      };
      events.push(event);
      this.emit('timeout', event);
      this.unregister(taskId);
    }

    return events;
  }

  startAutoDetect(): void {
    if (this.detectTimer) return;
    logger.info('[HeartbeatManager] 启动自动检测', {
      detectIntervalMs: this.detectIntervalMs,
    });
    this.detectTimer = setInterval(() => {
      this.detectTimeout();
    }, this.detectIntervalMs);
    if (this.detectTimer && typeof this.detectTimer === 'object' && 'unref' in this.detectTimer) {
      this.detectTimer.unref();
    }
  }

  stopAutoDetect(): void {
    if (this.detectTimer) {
      clearInterval(this.detectTimer);
      this.detectTimer = null;
      logger.info('[HeartbeatManager] 停止自动检测');
    }
  }

  getActiveCount(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }

  shutdown(): void {
    this.stopAutoDetect();
    this.clear();
    this.removeAllListeners();
  }
}
