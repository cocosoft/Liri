import type { Context } from './types/Context';
import type { ContextData } from './types/ContextData';
import type { ValidationResult } from './types/ValidationResult';
import { createValidResult, createInvalidResult } from './types/ValidationResult';

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
      throw new Error(`Context validation failed: ${validation.errors.join(', ')}`);
    }

    if (this.store.size >= this.maxSize) {
      this.evictOldest();
    }

    const id = data.id as string || crypto.randomUUID();
    const now = new Date();

    const context: Context = {
      id,
      ...data,
      createdAt: now,
    } as unknown as Context;

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
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.store.delete(id);
      return null;
    }

    return entry.context;
  }

  async update(id: string, data: Partial<ContextData>): Promise<void> {
    const entry = this.store.get(id);
    if (!entry) {
      throw new Error(`Context not found: ${id}`);
    }

    if (this.isExpired(entry)) {
      this.store.delete(id);
      throw new Error(`Context expired: ${id}`);
    }

    entry.context = {
      ...entry.context,
      ...data,
      updatedAt: new Date(),
    } as unknown as Context;

    entry.updatedAt = new Date();
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) {
      throw new Error(`Context not found: ${id}`);
    }
    this.store.delete(id);
  }

  async list(): Promise<Context[]> {
    this.cleanupStale();
    return Array.from(this.store.values()).map(e => e.context);
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
    return this.store.size;
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

    for (const [id, entry] of this.store.entries()) {
      if (entry.createdAt.getTime() < oldestTime) {
        oldestTime = entry.createdAt.getTime();
        oldestId = id;
      }
    }

    if (oldestId) {
      this.store.delete(oldestId);
    }
  }
}

export const contextStore = new ContextStore();
