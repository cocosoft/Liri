import { EventEmitter } from 'events';
import { getLogger } from '@modules/monitoring';
import type {
  HeartbeatRecord,
  HeartbeatTimeoutEvent,
  HeartbeatManagerOptions,
} from './types';

const logger = getLogger('tasks:heartbeat');

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

  /** 注册心跳 + 租约认领（owner 缺省时不启用租约校验，兼容既有心跳用法） */
  register(taskId: string, options?: { ttlMs?: number; owner?: string }): void {
    const now = Date.now();
    this.records.set(taskId, {
      taskId,
      lastHeartbeatAt: now,
      startedAt: now,
      ttlMs: options?.ttlMs ?? this.defaultTtlMs,
      owner: options?.owner,
    });
    logger.debug('[HeartbeatManager] 注册心跳', {
      taskId,
      ttlMs: options?.ttlMs ?? this.defaultTtlMs,
      owner: options?.owner,
    });
  }

  unregister(taskId: string): void {
    this.records.delete(taskId);
    logger.debug('[HeartbeatManager] 注销心跳', { taskId });
  }

  /**
   * 心跳续租。owner 已设置时校验归属：非持有者的 beat 被拒绝（防多进程抢占同一任务）。
   */
  beat(taskId: string, owner?: string): boolean {
    const record = this.records.get(taskId);
    if (!record) return false;
    if (record.owner !== undefined && owner !== record.owner) {
      logger.warn('[HeartbeatManager] 拒绝非持有者续租', {
        taskId,
        owner,
        currentOwner: record.owner,
      });
      return false;
    }
    record.lastHeartbeatAt = Date.now();
    return true;
  }

  /**
   * P1-5（2026-08-31）：过期抢占——强制将任务租约转移给新 owner
   * （对标 Hermes kanban claim_lock/claim_expires：锁过期后可被其他 worker 接管）。
   * 仅当租约已过期（或从未认领）时允许，未过期直接抢占视为异常。
   * @returns 是否抢占成功
   */
  forceClaim(taskId: string, newOwner: string, ttlMs?: number): boolean {
    const record = this.records.get(taskId);
    const now = Date.now();
    if (!record) {
      this.register(taskId, { ttlMs, owner: newOwner });
      return true;
    }
    if (now - record.lastHeartbeatAt <= record.ttlMs) {
      logger.warn('[HeartbeatManager] 租约未过期，拒绝抢占', {
        taskId,
        newOwner,
        currentOwner: record.owner,
      });
      return false;
    }
    record.owner = newOwner;
    record.lastHeartbeatAt = now;
    if (ttlMs) record.ttlMs = ttlMs;
    logger.warn('[HeartbeatManager] 租约过期已被抢占', {
      taskId,
      newOwner,
    });
    return true;
  }

  /** 当前租约持有者（未认领返回 undefined） */
  getOwner(taskId: string): string | undefined {
    return this.records.get(taskId)?.owner;
  }

  /** 租约是否仍有效（未过期） */
  isLeaseValid(taskId: string): boolean {
    const record = this.records.get(taskId);
    if (!record) return false;
    return Date.now() - record.lastHeartbeatAt <= record.ttlMs;
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
    if (
      this.detectTimer &&
      typeof this.detectTimer === 'object' &&
      'unref' in this.detectTimer
    ) {
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
