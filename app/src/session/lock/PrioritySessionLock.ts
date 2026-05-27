/**
 * PrioritySessionLock — 优先级写入锁
 *
 * 在 SessionLock（文件级互斥）之上增加优先级队列：
 * - 更高优先级的请求者可以抢占低优先级锁
 * - 同优先级按 FIFO 顺序
 * - 持有时间超时自动释放
 * - Watchdog 定期清理过期锁
 *
 * 参考 OpenClaw session-write-lock.ts 的设计：
 * - 进程级 heldLocks 追踪
 * - 最大持有时间限制
 * - 优雅退出时释放所有锁
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { SessionLock } from '../SessionLock';
import type { LockOptions, LockAcquireResult } from '../SessionLock';

const logger = new Logger({ level: LogLevel.INFO });

export type LockPriority = 'low' | 'normal' | 'high' | 'critical';

export const PRIORITY_ORDER: Record<LockPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

export const PRIORITY_VALUES = Object.keys(PRIORITY_ORDER) as LockPriority[];

export interface PriorityLockRequest {
  sessionId: string;
  priority: LockPriority;
  requester: string;
  maxHoldMs: number;
  timeoutMs: number;
  timestamp: number;
  id: string;
}

export interface PriorityLockAcquireResult extends LockAcquireResult {
  queuePosition?: number;
  requestId?: string;
}

export interface PriorityLockConfig {
  lockOptions?: LockOptions;
  defaultMaxHoldMs?: number;
  defaultTimeoutMs?: number;
  watchdogIntervalMs?: number;
  priorityAgingIntervalMs?: number;
  enablePriorityAging?: boolean;
}

export interface HeldPriorityLock {
  request: PriorityLockRequest;
  acquiredAt: number;
  expiresAt: number;
}

const DEFAULT_MAX_HOLD_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 60_000;
const DEFAULT_PRIORITY_AGING_MS = 120_000;

export class PrioritySessionLock {
  private baseLock: SessionLock;
  private defaultMaxHoldMs: number;
  private defaultTimeoutMs: number;
  private watchdogIntervalMs: number;
  private priorityAgingIntervalMs: number;
  private enablePriorityAging: boolean;

  private pendingQueue: Map<string, PriorityLockRequest[]> = new Map();
  private heldLocks: Map<string, HeldPriorityLock> = new Map();
  private requestCounter = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private agingTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private readonly instanceId: string;
  private readonly priorityCounters: Map<string, Map<LockPriority, number>> =
    new Map();

  constructor(config: PriorityLockConfig = {}) {
    this.baseLock = new SessionLock(config.lockOptions);
    this.defaultMaxHoldMs = config.defaultMaxHoldMs ?? DEFAULT_MAX_HOLD_MS;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.watchdogIntervalMs =
      config.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
    this.priorityAgingIntervalMs =
      config.priorityAgingIntervalMs ?? DEFAULT_PRIORITY_AGING_MS;
    this.enablePriorityAging = config.enablePriorityAging ?? false;
    this.instanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.watchdogTimer = setInterval(() => {
      this.runWatchdog();
    }, this.watchdogIntervalMs);

    if (this.enablePriorityAging) {
      this.agingTimer = setInterval(() => {
        this.runPriorityAging();
      }, this.priorityAgingIntervalMs);
    }

    logger.info('PrioritySessionLock started', {
      watchdogMs: this.watchdogIntervalMs,
      agingEnabled: this.enablePriorityAging,
    });
  }

  stop(): void {
    this.started = false;

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (this.agingTimer) {
      clearInterval(this.agingTimer);
      this.agingTimer = null;
    }

    this.releaseAll();
  }

  async acquire(
    sessionId: string,
    options?: {
      priority?: LockPriority;
      requester?: string;
      maxHoldMs?: number;
      timeoutMs?: number;
    }
  ): Promise<PriorityLockAcquireResult> {
    const request = this.createRequest(sessionId, options);
    const held = this.heldLocks.get(sessionId);

    if (!held) {
      return this.acquireWithBaseLock(request);
    }

    const currentPriority = PRIORITY_ORDER[held.request.priority];
    const newPriority = PRIORITY_ORDER[request.priority];

    if (newPriority > currentPriority) {
      logger.warning('优先级抢占', {
        sessionId,
        oldPriority: held.request.priority,
        newPriority: request.priority,
        oldRequester: held.request.requester,
        newRequester: request.requester,
      });

      await this.releaseLock(sessionId, held.request.requester);
      return this.acquireWithBaseLock(request);
    }

    return this.enqueueRequest(sessionId, request);
  }

  async release(sessionId: string, requester?: string): Promise<boolean> {
    const released = await this.releaseLock(sessionId, requester);
    if (!released) return false;

    await this.processQueue(sessionId);
    return true;
  }

  async isLocked(sessionId: string): Promise<boolean> {
    const held = this.heldLocks.get(sessionId);
    if (held) {
      if (this.isExpired(held)) {
        await this.releaseLock(sessionId, held.request.requester);
        return false;
      }
      return true;
    }

    return this.baseLock.isLocked(sessionId);
  }

  getQueueLength(sessionId: string): number {
    return this.pendingQueue.get(sessionId)?.length ?? 0;
  }

  getHeldLock(sessionId: string): HeldPriorityLock | undefined {
    return this.heldLocks.get(sessionId);
  }

  getQueueInfo(sessionId: string): {
    held: HeldPriorityLock | null;
    queue: PriorityLockRequest[];
  } {
    return {
      held: this.heldLocks.get(sessionId) ?? null,
      queue: this.pendingQueue.get(sessionId) ?? [],
    };
  }

  getQueueStats(): Record<string, { held: boolean; queueLength: number }> {
    const stats: Record<string, { held: boolean; queueLength: number }> = {};
    for (const [sessionId] of this.heldLocks) {
      stats[sessionId] = {
        held: true,
        queueLength: this.getQueueLength(sessionId),
      };
    }
    for (const [sessionId, queue] of this.pendingQueue) {
      if (!stats[sessionId]) {
        stats[sessionId] = { held: false, queueLength: queue.length };
      }
    }
    return stats;
  }

  async releaseAll(): Promise<void> {
    const keys = Array.from(this.heldLocks.keys());
    for (const sessionId of keys) {
      await this.releaseLock(sessionId);
    }
    this.pendingQueue.clear();
  }

  isStarted(): boolean {
    return this.started;
  }

  private createRequest(
    sessionId: string,
    options?: {
      priority?: LockPriority;
      requester?: string;
      maxHoldMs?: number;
      timeoutMs?: number;
    }
  ): PriorityLockRequest {
    this.requestCounter++;
    return {
      sessionId,
      priority: options?.priority ?? 'normal',
      requester: options?.requester ?? this.instanceId,
      maxHoldMs: options?.maxHoldMs ?? this.defaultMaxHoldMs,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
      timestamp: Date.now(),
      id: `${this.instanceId}-${this.requestCounter}`,
    };
  }

  private async acquireWithBaseLock(
    request: PriorityLockRequest
  ): Promise<PriorityLockAcquireResult> {
    const baseResult = await this.baseLock.acquire(
      request.sessionId,
      request.timeoutMs
    );

    if (baseResult.success) {
      const expiresAt = Date.now() + request.maxHoldMs;
      const held: HeldPriorityLock = {
        request,
        acquiredAt: Date.now(),
        expiresAt,
      };
      this.heldLocks.set(request.sessionId, held);
      this.incrementCounter(request.sessionId, request.priority);
    }

    return {
      success: baseResult.success,
      holder: baseResult.holder,
      acquiredAt: baseResult.acquiredAt,
      requestId: request.id,
    };
  }

  private async enqueueRequest(
    sessionId: string,
    request: PriorityLockRequest
  ): Promise<PriorityLockAcquireResult> {
    const queue = this.pendingQueue.get(sessionId) ?? [];
    const insertIndex = this.findInsertIndex(queue, request);
    queue.splice(insertIndex, 0, request);
    this.pendingQueue.set(sessionId, queue);

    const queuePosition = queue.indexOf(request);

    if (queuePosition === 0) {
      const held = this.heldLocks.get(sessionId);
      if (!held || this.isExpired(held)) {
        this.pendingQueue.delete(sessionId);
        return this.acquireWithBaseLock(request);
      }
    }

    return {
      success: false,
      queuePosition: queuePosition + 1,
      requestId: request.id,
    };
  }

  private findInsertIndex(
    queue: PriorityLockRequest[],
    request: PriorityLockRequest
  ): number {
    const newPriorityValue = PRIORITY_ORDER[request.priority];
    let index = queue.length;
    for (let i = 0; i < queue.length; i++) {
      const existingPriority = PRIORITY_ORDER[queue[i].priority];
      if (newPriorityValue > existingPriority) {
        index = i;
        break;
      }
    }
    return index;
  }

  private async releaseLock(
    sessionId: string,
    requester?: string
  ): Promise<boolean> {
    const held = this.heldLocks.get(sessionId);
    if (!held) return false;

    if (requester && held.request.requester !== requester) {
      logger.warning('无法释放锁：请求者不匹配', {
        sessionId,
        expected: held.request.requester,
        actual: requester,
      });
      return false;
    }

    this.heldLocks.delete(sessionId);
    return this.baseLock.release(sessionId);
  }

  private async processQueue(sessionId: string): Promise<void> {
    const queue = this.pendingQueue.get(sessionId);
    if (!queue || queue.length === 0) {
      this.pendingQueue.delete(sessionId);
      return;
    }

    const nextRequest = queue.shift()!;
    if (queue.length === 0) {
      this.pendingQueue.delete(sessionId);
    } else {
      this.pendingQueue.set(sessionId, queue);
    }

    const result = await this.acquireWithBaseLock(nextRequest);
    if (result.success) {
      logger.info('队列锁已授予', {
        sessionId,
        requester: nextRequest.requester,
        priority: nextRequest.priority,
        remainingQueue: queue.length,
      });
    }
  }

  private runWatchdog(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, held] of this.heldLocks) {
      if (this.isExpired(held)) {
        expired.push(sessionId);
      }
    }

    for (const sessionId of expired) {
      const held = this.heldLocks.get(sessionId);
      if (!held) continue;
      logger.warning('看门狗释放过期锁', {
        sessionId,
        requester: held.request.requester,
        acquiredAt: held.acquiredAt,
        expiresAt: held.expiresAt,
      });
      this.releaseLock(sessionId, held.request.requester);
      this.processQueue(sessionId);
    }
  }

  private runPriorityAging(): void {
    if (!this.enablePriorityAging) return;

    for (const [sessionId, queue] of this.pendingQueue) {
      for (const request of queue) {
        const waitTime = Date.now() - request.timestamp;
        if (waitTime >= this.priorityAgingIntervalMs) {
          const currentIdx = PRIORITY_ORDER[request.priority];
          const nextPriority: LockPriority | undefined =
            PRIORITY_VALUES[
              Math.min(currentIdx + 1, PRIORITY_VALUES.length - 1)
            ];
          if (nextPriority && nextPriority !== request.priority) {
            request.priority = nextPriority;
            logger.info('优先级老化提升', {
              sessionId,
              requester: request.requester,
              newPriority: nextPriority,
              waitMs: waitTime,
            });
          }
        }
      }
      queue.sort(
        (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]
      );
    }
  }

  private incrementCounter(sessionId: string, priority: LockPriority): void {
    let sessionCounters = this.priorityCounters.get(sessionId);
    if (!sessionCounters) {
      sessionCounters = new Map();
      this.priorityCounters.set(sessionId, sessionCounters);
    }
    sessionCounters.set(priority, (sessionCounters.get(priority) ?? 0) + 1);
  }

  getAcquisitionCount(sessionId: string, priority: LockPriority): number {
    return this.priorityCounters.get(sessionId)?.get(priority) ?? 0;
  }

  private isExpired(held: HeldPriorityLock): boolean {
    return Date.now() > held.expiresAt;
  }
}
