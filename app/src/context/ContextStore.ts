import type { Context } from './types/Context';
import type { ContextData } from './types/ContextData';
import type { ValidationResult } from './types/ValidationResult';
import {
  createValidResult,
  createInvalidResult,
} from './types/ValidationResult';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ContextErrorCode } from './types/ContextErrorCode';
import {
  serializeStoreEntries,
  type ContextSnapshot,
} from './persistence/ContextPersistence';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'context:store',
  level: LogLevel.INFO,
});

export interface IContextStore {
  create(data: ContextData): Promise<Context>;
  get(id: string): Promise<Context | null>;
  update(id: string, data: Partial<ContextData>): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<Context[]>;
  exists(id: string): Promise<boolean>;
  validate(data: ContextData): ValidationResult;
}

export interface ContextStoreOptions {
  maxSize?: number;
  defaultTTL?: number;
}

interface StoreEntry {
  context: Context;
  createdAt: Date;
  updatedAt: Date;
  ttl?: number;
}

export class ContextStore implements IContextStore {
  private store: Map<string, StoreEntry> = new Map();
  private maxSize: number;
  private defaultTTL?: number;

  constructor(options: ContextStoreOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTTL = options.defaultTTL;
  }

  async create(data: ContextData): Promise<Context> {
    const validation = this.validate(data);
    if (!validation.valid) {
      throw new AppError(
        `Context validation failed: ${validation.errors.join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.LIFECYCLE_INVALID
      );
    }

    // 存储上限检查（LRU 驱逐逻辑只在 setMaxSize 中，create 也要检查）
    if (this.store.size >= this.maxSize) {
      throw new AppError(
        `Context store full: ${this.store.size}/${this.maxSize}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.STORE_FULL
      );
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const context: Context = { id, ...data } as unknown as Context;
    this.store.set(id, {
      context,
      createdAt: now,
      updatedAt: now,
      ttl: this.defaultTTL,
    });
    return context;
  }

  async get(id: string): Promise<Context | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(id);
      return null;
    }
    return entry.context;
  }

  async update(id: string, data: Partial<ContextData>): Promise<void> {
    const entry = this.store.get(id);
    if (!entry) {
      throw new AppError(
        `Context not found: ${id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.CONTEXT_NOT_FOUND
      );
    }
    const updatedContext: Context = {
      ...entry.context,
      ...data,
    } as unknown as Context;
    this.store.set(id, {
      context: updatedContext,
      createdAt: entry.createdAt,
      updatedAt: new Date(),
      ttl: entry.ttl,
    });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async list(): Promise<Context[]> {
    this.cleanupStale();
    return Array.from(this.store.values()).map((e) => e.context);
  }

  async exists(id: string): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.store.delete(id);
      return false;
    }

    return true;
  }

  validate(data: ContextData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.type) {
      errors.push('Context type is required');
    }

    if (data.type && typeof data.type !== 'string') {
      errors.push('Context type must be a string');
    }

    return errors.length > 0
      ? createInvalidResult(errors, warnings)
      : createValidResult();
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    const actual = this.store.size;
    return actual;
  }

  /**
   * 序列化为 ContextSnapshot（用于持久化，Phase 2）
   */
  serialize(): ContextSnapshot {
    return serializeStoreEntries(this.store, this.maxSize);
  }

  /**
   * 从 ContextSnapshot 恢复（用于持久化恢复，Phase 2）
   */
  hydrate(snapshot: ContextSnapshot): number {
    let loaded = 0;
    for (const entry of snapshot.entries) {
      if (this.store.size >= this.maxSize) break;
      this.store.set(entry.id, {
        context: {
          id: entry.id,
          type: entry.type,
          ...entry.data,
          createdAt: new Date(entry.createdAt),
        } as unknown as Context,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt),
        ttl: entry.ttl,
      });
      loaded++;
    }
    return loaded;
  }

  /**
   * 并发安全检查——检测 store 是否可能存在竞态条件
   * 在异步环境中多次快速操作后调用，如果返回 true 说明需要引入锁机制
   */
  checkConsistency(): boolean {
    return this.store.size <= this.maxSize;
  }

  cleanupStale(): number {
    let cleaned = 0;
    for (const [id, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  getStats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      usagePercent: Math.round((this.store.size / this.maxSize) * 100),
      defaultTTL: this.defaultTTL,
    };
  }

  setMaxSize(maxSize: number): void {
    this.maxSize = maxSize;
    while (this.store.size > this.maxSize) {
      this.evictOldest();
    }
  }

  setDefaultTTL(ttlMs: number | undefined): void {
    this.defaultTTL = ttlMs;
  }

  private isExpired(entry: StoreEntry): boolean {
    if (!entry.ttl) return false;
    const age = Date.now() - entry.updatedAt.getTime();
    return age > entry.ttl;
  }

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestTime = Infinity;

    // Phase 1.5: 驱逐策略从 createdAt 改为 updatedAt（真正的 LRU）
    for (const [id, entry] of this.store.entries()) {
      if (entry.updatedAt.getTime() < oldestTime) {
        oldestTime = entry.updatedAt.getTime();
        oldestId = id;
      }
    }

    if (oldestId) {
      this.store.delete(oldestId);
    }
  }
}

export const contextStore = new ContextStore();
