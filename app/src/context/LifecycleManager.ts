import type { Context } from './types/Context';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ContextErrorCode } from './types/ContextErrorCode';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:lifecycle');

export enum LifecycleState {
  PENDING = 'pending',
  INITIALIZED = 'initialized',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DESTROYED = 'destroyed',
}

export interface LifecycleHook {
  onInitialize?: (context: Context) => Promise<void>;
  onActivate?: (context: Context) => Promise<void>;
  onSuspend?: (context: Context) => Promise<void>;
  onDestroy?: (context: Context) => Promise<void>;
}

export interface LifecycleManagerOptions {
  maxEntries?: number;
  cleanupIntervalMs?: number;
}

interface LifecycleEntry {
  context: Context;
  state: LifecycleState;
  hooks: LifecycleHook;
  createdAt: Date;
  lastTransitionAt: Date;
}

export class LifecycleManager {
  private entries: Map<string, LifecycleEntry> = new Map();
  private globalHooks: LifecycleHook = {};
  private maxEntries: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LifecycleManagerOptions = {}) {
    this.maxEntries = options.maxEntries ?? 5000;
    if (options.cleanupIntervalMs) {
      this.startCleanupTimer(options.cleanupIntervalMs);
    }
  }

  setGlobalHooks(hooks: LifecycleHook): void {
    this.globalHooks = hooks;
  }

  async initialize(context: Context, hooks?: LifecycleHook): Promise<void> {
    const id = (context as unknown as { id?: string }).id || context.type;

    if (this.entries.size >= this.maxEntries) {
      const destroyedCount = this.cleanup();
      if (this.entries.size >= this.maxEntries && destroyedCount === 0) {
        this.evictOldest();
      }
    }

    const mergedHooks = { ...this.globalHooks, ...hooks };

    const entry: LifecycleEntry = {
      context,
      state: LifecycleState.PENDING,
      hooks: mergedHooks,
      createdAt: new Date(),
      lastTransitionAt: new Date(),
    };

    this.entries.set(id, entry);

    if (mergedHooks.onInitialize) {
      await mergedHooks.onInitialize(context);
    }

    entry.state = LifecycleState.INITIALIZED;
    entry.lastTransitionAt = new Date();
  }

  async activate(context: Context): Promise<void> {
    const id = (context as unknown as { id?: string }).id || context.type;
    const entry = this.entries.get(id);

    if (!entry) {
      throw new AppError(
        `Context not found: ${id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.LIFECYCLE_INVALID
      );
    }

    if (entry.hooks.onActivate) {
      await entry.hooks.onActivate(context);
    }

    entry.state = LifecycleState.ACTIVE;
    entry.lastTransitionAt = new Date();
  }

  async suspend(context: Context): Promise<void> {
    const id = (context as unknown as { id?: string }).id || context.type;
    const entry = this.entries.get(id);

    if (!entry) {
      throw new AppError(
        `Context not found: ${id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.LIFECYCLE_INVALID
      );
    }

    if (entry.hooks.onSuspend) {
      await entry.hooks.onSuspend(context);
    }

    entry.state = LifecycleState.SUSPENDED;
    entry.lastTransitionAt = new Date();
  }

  async destroy(context: Context): Promise<void> {
    const id = (context as unknown as { id?: string }).id || context.type;
    const entry = this.entries.get(id);

    if (!entry) {
      // 已清理，静默跳过——非错误场景
      return;
    }

    if (entry.hooks.onDestroy) {
      await entry.hooks.onDestroy(context);
    }

    entry.state = LifecycleState.DESTROYED;
    entry.lastTransitionAt = new Date();
    this.entries.delete(id);
  }

  async destroyAll(): Promise<void> {
    const entries = Array.from(this.entries.entries());
    const results = await Promise.allSettled(
      entries.map(([, entry]) => this.destroy(entry.context))
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn('destroyAll 部分失败', { count: failures.length });
    }
  }

  getState(context: Context): LifecycleState {
    const id = (context as unknown as { id?: string }).id || context.type;
    const entry = this.entries.get(id);
    return entry?.state ?? LifecycleState.PENDING;
  }

  isInitialized(context: Context): boolean {
    const state = this.getState(context);
    return (
      state === LifecycleState.INITIALIZED || state === LifecycleState.ACTIVE
    );
  }

  isActive(context: Context): boolean {
    return this.getState(context) === LifecycleState.ACTIVE;
  }

  isDestroyed(context: Context): boolean {
    return this.getState(context) === LifecycleState.DESTROYED;
  }

  getActiveCount(): number {
    return Array.from(this.entries.values()).filter(
      (e) => e.state === LifecycleState.ACTIVE
    ).length;
  }

  getAllStates(): Map<string, LifecycleState> {
    const states = new Map<string, LifecycleState>();
    for (const [id, entry] of this.entries.entries()) {
      states.set(id, entry.state);
    }
    return states;
  }

  cleanup(): number {
    let cleaned = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.state === LifecycleState.DESTROYED) {
        this.entries.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  getStats() {
    const stateCounts: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      stateCounts[entry.state] = (stateCounts[entry.state] || 0) + 1;
    }

    return {
      totalEntries: this.entries.size,
      maxEntries: this.maxEntries,
      usagePercent: Math.round((this.entries.size / this.maxEntries) * 100),
      stateCounts,
      hasCleanupTimer: this.cleanupTimer !== null,
    };
  }

  startCleanupTimer(intervalMs: number): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  setMaxEntries(max: number): void {
    this.maxEntries = max;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestTime = Infinity;

    for (const [id, entry] of this.entries.entries()) {
      if (entry.createdAt.getTime() < oldestTime) {
        oldestTime = entry.createdAt.getTime();
        oldestId = id;
      }
    }

    if (oldestId) {
      this.entries.delete(oldestId);
    }
  }
}

export const lifecycleManager = new LifecycleManager();
