import { contextIsolator } from './ContextIsolator';
import type { Context } from './types/Context';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'context\ContextSharingManager',
  level: LogLevel.INFO,
});

export interface SharedContextEntry {
  context: Context;
  sourceScopeId: string;
  sharedAt: Date;
}

export interface ContextSharingManagerOptions {
  maxSharedContexts?: number;
  maxSharesPerScope?: number;
}

export class ContextSharingManager {
  private sharedContexts: Map<string, SharedContextEntry> = new Map();
  private scopeShares: Map<string, Set<string>> = new Map();
  private maxSharedContexts: number;
  private maxSharesPerScope: number;

  constructor(options: ContextSharingManagerOptions = {}) {
    this.maxSharedContexts = options.maxSharedContexts ?? 5000;
    this.maxSharesPerScope = options.maxSharesPerScope ?? 500;
  }

  shareToScope(
    contextKey: string,
    context: Context,
    targetScopeId: string,
    sourceScopeId?: string
  ): void {
    const sourceId =
      sourceScopeId || contextIsolator.getCurrentScopeId() || 'global';
    const scope = contextIsolator.getScope(targetScopeId);

    if (!scope) {
      throw new AppError(
        `Target scope not found: ${targetScopeId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const entryKey = `${targetScopeId}:${contextKey}`;

    if (
      this.scopeShares.has(targetScopeId) &&
      this.scopeShares.get(targetScopeId)!.size >= this.maxSharesPerScope
    ) {
      throw new AppError(
        `Maximum shares per scope reached: ${this.maxSharesPerScope}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (this.sharedContexts.size >= this.maxSharedContexts) {
      this.evictOldest();
    }

    this.sharedContexts.set(entryKey, {
      context,
      sourceScopeId: sourceId,
      sharedAt: new Date(),
    });

    if (!this.scopeShares.has(targetScopeId)) {
      this.scopeShares.set(targetScopeId, new Set());
    }
    this.scopeShares.get(targetScopeId)!.add(contextKey);
  }

  shareToAllScopes(
    contextKey: string,
    context: Context,
    sourceScopeId?: string
  ): void {
    const sourceId =
      sourceScopeId || contextIsolator.getCurrentScopeId() || 'global';
    const allScopeIds = contextIsolator.getAllScopeIds();

    for (const scopeId of allScopeIds) {
      this.shareToScope(contextKey, context, scopeId, sourceId);
    }
  }

  getSharedContext(
    contextKey: string,
    scopeId?: string
  ): SharedContextEntry | undefined {
    const sid = scopeId || contextIsolator.getCurrentScopeId();
    if (!sid) {
      return undefined;
    }

    const entryKey = `${sid}:${contextKey}`;
    return this.sharedContexts.get(entryKey);
  }

  getSharedContextsForScope(scopeId?: string): Map<string, SharedContextEntry> {
    const sid = scopeId || contextIsolator.getCurrentScopeId();
    if (!sid) {
      return new Map();
    }

    const result = new Map<string, SharedContextEntry>();
    const keys = this.scopeShares.get(sid);

    if (keys) {
      for (const key of keys) {
        const entry = this.sharedContexts.get(`${sid}:${key}`);
        if (entry) {
          result.set(key, entry);
        }
      }
    }

    return result;
  }

  applySharedContexts(
    targetContexts: Record<string, Context>,
    scopeId?: string
  ): Record<string, Context> {
    const sid = scopeId || contextIsolator.getCurrentScopeId();
    if (!sid) {
      return targetContexts;
    }

    const result = { ...targetContexts };
    const shared = this.getSharedContextsForScope(sid);

    for (const [key, entry] of shared.entries()) {
      if (!(key in result)) {
        result[key] = entry.context;
      }
    }

    return result;
  }

  hasSharedContext(contextKey: string, scopeId?: string): boolean {
    const sid = scopeId || contextIsolator.getCurrentScopeId();
    if (!sid) {
      return false;
    }
    return this.sharedContexts.has(`${sid}:${contextKey}`);
  }

  unshareContext(contextKey: string, scopeId?: string): void {
    const sid = scopeId || contextIsolator.getCurrentScopeId();
    if (!sid) {
      return;
    }

    const entryKey = `${sid}:${contextKey}`;
    this.sharedContexts.delete(entryKey);
    this.scopeShares.get(sid)?.delete(contextKey);
  }

  unshareAllForScope(scopeId?: string): void {
    const sid = scopeId || contextIsolator.getCurrentScopeId();
    if (!sid) {
      return;
    }

    const keys = this.scopeShares.get(sid);
    if (keys) {
      for (const key of keys) {
        this.sharedContexts.delete(`${sid}:${key}`);
      }
    }

    this.scopeShares.delete(sid);
  }

  clear(): void {
    this.sharedContexts.clear();
    this.scopeShares.clear();
  }

  getStats() {
    return {
      totalSharedContexts: this.sharedContexts.size,
      maxSharedContexts: this.maxSharedContexts,
      totalScopesWithShares: this.scopeShares.size,
      maxSharesPerScope: this.maxSharesPerScope,
      usagePercent: Math.round(
        (this.sharedContexts.size / this.maxSharedContexts) * 100
      ),
    };
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.sharedContexts.entries()) {
      if (entry.sharedAt.getTime() < oldestTime) {
        oldestTime = entry.sharedAt.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const colonIdx = oldestKey.indexOf(':');
      if (colonIdx !== -1) {
        const targetScopeId = oldestKey.substring(0, colonIdx);
        const contextKey = oldestKey.substring(colonIdx + 1);
        this.scopeShares.get(targetScopeId)?.delete(contextKey);
      }
      this.sharedContexts.delete(oldestKey);
    }
  }
}

export const contextSharingManager = new ContextSharingManager();
