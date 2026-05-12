/**
 * 查询依赖管理（参考CC源码 cc_code/query/deps.ts）
 * 统一管理QueryEngine所需的依赖项
 */

import type { ChatManager } from '../chat/ChatManager';
import type { AnalyticsService } from '../analytics';
import type { CostAnalyticsTracker } from '../analytics/CostAnalyticsTracker';
import type { PostSamplingHookManager } from '../hooks/managers/PostSamplingHookManager';
import type { TokenBudgetManager } from './TokenBudget';
import type { StopHookManager } from './StopHooks';
import type { QueryConfigManager } from './config';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export interface QueryDependencies {
  chatManager: ChatManager;
  analyticsService: AnalyticsService;
  costTracker: CostAnalyticsTracker;
  postSamplingHookManager: PostSamplingHookManager;
  tokenBudgetManager: TokenBudgetManager;
  stopHookManager: StopHookManager;
  configManager: QueryConfigManager;
}

export class QueryDepsManager {
  private deps: Map<string, any> = new Map();
  private aliases: Map<string, string[]> = new Map();

  constructor() {
    this.registerDefaultAliases();
  }

  private registerDefaultAliases(): void {
    this.aliases.set('chatManager', ['chat', 'chatManager', 'ChatManager']);
    this.aliases.set('analyticsService', [
      'analytics',
      'analyticsService',
      'AnalyticsService',
    ]);
    this.aliases.set('costTracker', [
      'cost',
      'costTracker',
      'CostAnalyticsTracker',
    ]);
    this.aliases.set('postSamplingHookManager', [
      'hooks',
      'postSamplingHookManager',
      'PostSamplingHookManager',
    ]);
    this.aliases.set('tokenBudgetManager', [
      'budget',
      'tokenBudgetManager',
      'TokenBudgetManager',
    ]);
    this.aliases.set('stopHookManager', [
      'stopHooks',
      'stopHookManager',
      'StopHookManager',
    ]);
    this.aliases.set('configManager', [
      'config',
      'configManager',
      'QueryConfigManager',
    ]);
  }

  register<T>(key: string, instance: T): void {
    this.deps.set(key, instance);
  }

  get<T>(key: string): T | undefined {
    return this.deps.get(key) as T | undefined;
  }

  getOrThrow<T>(key: string): T {
    const instance = this.get<T>(key);
    if (!instance) {
      throw new AppError(`Dependency not found: ${key}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }
    return instance;
  }

  getByAlias<T>(alias: string): T | undefined {
    const canonicalKey = this.findCanonicalKey(alias);
    if (canonicalKey) {
      return this.get<T>(canonicalKey);
    }
    return undefined;
  }

  private findCanonicalKey(alias: string): string | undefined {
    for (const [canonical, aliases] of this.aliases.entries()) {
      if (aliases.includes(alias) || canonical === alias) {
        return canonical;
      }
    }
    return undefined;
  }

  has(key: string): boolean {
    return this.deps.has(key) || this.getByAlias(key) !== undefined;
  }

  unregister(key: string): boolean {
    return this.deps.delete(key);
  }

  clear(): void {
    this.deps.clear();
  }

  listKeys(): string[] {
    return Array.from(this.deps.keys());
  }

  registerAlias(canonical: string, aliases: string[]): void {
    this.aliases.set(canonical, [
      ...(this.aliases.get(canonical) || []),
      ...aliases,
    ]);
  }

  createResolver<T>(key: string): () => T {
    return () => {
      const instance = this.get<T>(key);
      if (!instance) {
        throw new AppError(`Dependency not found: ${key}`, ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }
      return instance;
    };
  }
}

let globalDepsManager: QueryDepsManager | null = null;

export function getGlobalDepsManager(): QueryDepsManager {
  if (!globalDepsManager) {
    globalDepsManager = new QueryDepsManager();
  }
  return globalDepsManager;
}

export function createQueryDepsManager(): QueryDepsManager {
  return new QueryDepsManager();
}
