import { asyncContextStorage } from './AsyncContextStorage';
import type { Context } from './types/Context';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ContextErrorCode } from './types/ContextErrorCode';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'context:isolator',
  level: LogLevel.INFO,
});

export type IsolationLevel = 'strict' | 'inherited' | 'shared';

export interface IsolationScope {
  id: string;
  parentId: string | null;
  level: IsolationLevel;
  createdAt: Date;
}

interface IsolationSnapshot {
  contexts: Record<string, Context>;
  scope: IsolationScope;
}

export interface ContextIsolatorOptions {
  maxScopes?: number;
  maxSnapshots?: number;
  maxStackDepth?: number;
}

export class ContextIsolator {
  private scopes: Map<string, IsolationScope> = new Map();
  private snapshots: Map<string, IsolationSnapshot> = new Map();
  private scopeStack: string[] = [];
  private maxScopes: number;
  private maxSnapshots: number;
  private maxStackDepth: number;

  constructor(options: ContextIsolatorOptions = {}) {
    this.maxScopes = options.maxScopes ?? 1000;
    this.maxSnapshots = options.maxSnapshots ?? 500;
    this.maxStackDepth = options.maxStackDepth ?? 100;
  }

  createScope(
    id: string,
    parentId?: string,
    level: IsolationLevel = 'inherited'
  ): IsolationScope {
    if (this.scopes.has(id)) {
      throw new AppError(
        `Scope already exists: ${id}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    if (parentId && !this.scopes.has(parentId)) {
      throw new AppError(
        `Parent scope not found: ${parentId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    if (this.scopes.size >= this.maxScopes) {
      throw new AppError(
        `Maximum number of scopes reached: ${this.maxScopes}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    const scope: IsolationScope = {
      id,
      parentId: parentId || null,
      level,
      createdAt: new Date(),
    };

    this.scopes.set(id, scope);
    return scope;
  }

  scopeExists(id: string): boolean {
    return this.scopes.has(id);
  }

  getScope(id: string): IsolationScope | undefined {
    return this.scopes.get(id);
  }

  getCurrentScopeId(): string | undefined {
    if (this.scopeStack.length === 0) {
      return undefined;
    }
    return this.scopeStack[this.scopeStack.length - 1];
  }

  getCurrentScope(): IsolationScope | undefined {
    const id = this.getCurrentScopeId();
    return id ? this.scopes.get(id) : undefined;
  }

  removeScope(id: string): void {
    const childScopes = Array.from(this.scopes.values())
      .filter((s) => s.parentId === id)
      .map((s) => s.id);

    for (const childId of childScopes) {
      this.removeScope(childId);
    }

    this.scopes.delete(id);
    this.snapshots.delete(id);
  }

  async runIsolated<T>(
    scopeId: string,
    contexts: Record<string, Context>,
    fn: () => T | Promise<T>
  ): Promise<T> {
    if (this.scopeStack.length >= this.maxStackDepth) {
      throw new AppError(
        `Maximum stack depth reached: ${this.maxStackDepth}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    const scope = this.scopes.get(scopeId);
    if (!scope) {
      throw new AppError(
        `Scope not found: ${scopeId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    const currentStore = asyncContextStorage.getStore() || {};
    let isolatedContexts: Record<string, Context>;

    switch (scope.level) {
      case 'strict':
        isolatedContexts = { ...contexts };
        break;
      case 'inherited':
        isolatedContexts = { ...currentStore, ...contexts };
        break;
      case 'shared':
        // 复制而非引用 currentStore，避免泄漏修改到父作用域
        isolatedContexts = { ...currentStore };
        for (const [key, ctx] of Object.entries(contexts)) {
          isolatedContexts[key] = ctx;
        }
        break;
    }

    this.scopeStack.push(scopeId);
    try {
      const result = asyncContextStorage.run(isolatedContexts, fn as () => T);
      return result instanceof Promise ? await result : result;
    } finally {
      this.scopeStack.pop();
    }
  }

  snapshot(scopeId: string): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      throw new AppError(
        `Scope not found: ${scopeId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    if (this.snapshots.size >= this.maxSnapshots) {
      throw new AppError(
        `Maximum number of snapshots reached: ${this.maxSnapshots}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    this.snapshots.set(scopeId, {
      contexts: { ...(asyncContextStorage.getStore() || {}) },
      scope: { ...scope },
    });
  }

  restore(scopeId: string): void {
    const snapshot = this.snapshots.get(scopeId);
    if (!snapshot) {
      throw new AppError(
        `Snapshot not found for scope: ${scopeId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        ContextErrorCode.ISOLATION_VIOLATED
      );
    }

    this.scopes.set(scopeId, { ...snapshot.scope });
    // 恢复 contexts 到 AsyncLocalStorage
    asyncContextStorage.restoreStore(snapshot.contexts);
    this.snapshots.delete(scopeId);
  }

  hasSnapshot(scopeId: string): boolean {
    return this.snapshots.has(scopeId);
  }

  clearSnapshot(scopeId: string): void {
    this.snapshots.delete(scopeId);
  }

  clearAllSnapshots(): void {
    this.snapshots.clear();
  }

  createChildScope(
    parentId: string,
    childId: string,
    level: IsolationLevel = 'inherited'
  ): IsolationScope {
    return this.createScope(childId, parentId, level);
  }

  getAncestorIds(scopeId: string): string[] {
    const ancestors: string[] = [];
    let current = this.scopes.get(scopeId);

    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = this.scopes.get(current.parentId);
    }

    return ancestors;
  }

  isDescendantOf(scopeId: string, ancestorId: string): boolean {
    const ancestors = this.getAncestorIds(scopeId);
    return ancestors.includes(ancestorId);
  }

  getAllScopeIds(): string[] {
    return Array.from(this.scopes.keys());
  }

  getStats() {
    return {
      scopeCount: this.scopes.size,
      maxScopes: this.maxScopes,
      snapshotCount: this.snapshots.size,
      maxSnapshots: this.maxSnapshots,
      stackDepth: this.scopeStack.length,
      maxStackDepth: this.maxStackDepth,
      scopeUsagePercent: Math.round((this.scopes.size / this.maxScopes) * 100),
      snapshotUsagePercent: Math.round(
        (this.snapshots.size / this.maxSnapshots) * 100
      ),
    };
  }

  clear(): void {
    this.scopes.clear();
    this.snapshots.clear();
    this.scopeStack = [];
  }
}

export const contextIsolator = new ContextIsolator();
