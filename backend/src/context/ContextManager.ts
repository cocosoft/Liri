/**
 * 上下文管理器
 * 统一管理Git状态、用户上下文和系统上下文
 * 集成ContextStore、ContextInjector、LifecycleManager
 */

import { GitContextService, getGitContextService } from './GitContextService.js';
import { UserContextService, getUserContextService } from './UserContextService.js';
import { ContextCacheService, getContextCacheService, ContextCacheKeys } from './ContextCacheService.js';
import { ContextStore, contextStore } from './ContextStore';
import { ContextInjector, contextInjector } from './ContextInjector';
import { LifecycleManager, lifecycleManager } from './LifecycleManager';
import { contextRegistry, type ContextTypeOptions } from './ContextRegistry';
import { AsyncContextStorage, asyncContextStorage } from './AsyncContextStorage';
import { ContextIsolator, contextIsolator } from './ContextIsolator';
import { ContextSharingManager, contextSharingManager, type SharedContextEntry } from './ContextSharingManager';
import type { ContextData } from './types/ContextData';
import type { Context } from './types/Context';

/**
 * 系统上下文
 */
export interface SystemContext {
  gitStatus: string | null;
  userContext: string | null;
  currentDate: string;
}

/**
 * 上下文管理器选项
 */
export interface ContextManagerOptions {
  /** 是否启用Git状态注入 */
  enableGitStatus?: boolean;
  /** 是否启用用户上下文 */
  enableUserContext?: boolean;
  /** 缓存TTL（毫秒） */
  cacheTTL?: number;
  /** 是否监听文件变化 */
  watchFileChanges?: boolean;
}

/**
 * 上下文管理器
 */
export class ContextManager {
  private static instance: ContextManager;
  private gitService: GitContextService;
  private userService: UserContextService;
  private cacheService: ContextCacheService;
  private options: Required<ContextManagerOptions>;
  private store: ContextStore;
  private injector: ContextInjector;
  private lifecycle: LifecycleManager;
  private isolator: ContextIsolator;
  private sharingManager: ContextSharingManager;

  private constructor(options: ContextManagerOptions = {}) {
    this.options = {
      enableGitStatus: options.enableGitStatus ?? true,
      enableUserContext: options.enableUserContext ?? true,
      cacheTTL: options.cacheTTL ?? 300000,
      watchFileChanges: options.watchFileChanges ?? true,
    };

    this.gitService = getGitContextService();
    this.userService = getUserContextService();
    this.cacheService = getContextCacheService();
    this.store = contextStore;
    this.injector = contextInjector;
    this.lifecycle = lifecycleManager;
    this.isolator = contextIsolator;
    this.sharingManager = contextSharingManager;

    this.cacheService.setDefaultTTL(this.options.cacheTTL);

    this.gitService.setCacheClearCallback(() => {
      this.cacheService.delete(ContextCacheKeys.GIT_STATUS);
    });

    this.userService.setCacheClearCallback(() => {
      this.cacheService.delete(ContextCacheKeys.USER_CONTEXT);
    });

    if (this.options.watchFileChanges) {
      this.setupFileWatchers();
    }
  }

  static getInstance(options?: ContextManagerOptions): ContextManager {
    if (!ContextManager.instance) {
      ContextManager.instance = new ContextManager(options);
    }
    return ContextManager.instance;
  }

  private setupFileWatchers(): void {
    const gitPath = '.git';
    this.cacheService.watchDirectory(gitPath, [
      ContextCacheKeys.GIT_STATUS,
    ]);

    const userContextPath = 'PY_APP.md';
    this.cacheService.watchFile(userContextPath, [
      ContextCacheKeys.USER_CONTEXT,
    ]);

    const claudeMdPath = 'CLAUDE.md';
    this.cacheService.watchFile(claudeMdPath, [
      ContextCacheKeys.USER_CONTEXT,
    ]);
  }

  async getGitStatus(): Promise<string | null> {
    const cached = this.cacheService.get<string>(ContextCacheKeys.GIT_STATUS);
    if (cached !== null) {
      return cached;
    }

    if (!this.options.enableGitStatus) {
      return null;
    }

    const gitStatus = await this.gitService.getGitStatusAsSystemPrompt();
    this.cacheService.set(ContextCacheKeys.GIT_STATUS, gitStatus, this.options.cacheTTL);
    return gitStatus;
  }

  async getUserContext(): Promise<{ userContext: string | null; currentDate: string }> {
    const cached = this.cacheService.get<{ userContext: string | null; currentDate: string }>(
      ContextCacheKeys.USER_CONTEXT
    );
    if (cached !== null) {
      return cached;
    }

    if (!this.options.enableUserContext) {
      return {
        userContext: null,
        currentDate: this.userService.formatCurrentDate(),
      };
    }

    const userContext = await this.userService.getUserContext();
    this.cacheService.set(ContextCacheKeys.USER_CONTEXT, userContext, this.options.cacheTTL);
    return userContext;
  }

  async getSystemContext(): Promise<SystemContext> {
    const [gitStatus, { userContext, currentDate }] = await Promise.all([
      this.getGitStatus(),
      this.getUserContext(),
    ]);

    return {
      gitStatus,
      userContext,
      currentDate,
    };
  }

  async formatSystemPrompt(): Promise<string> {
    const context = await this.getSystemContext();
    const parts: string[] = [];

    if (context.gitStatus) {
      parts.push(context.gitStatus);
    }

    if (context.userContext) {
      parts.push(`User Context:\n${context.userContext}`);
    }

    parts.push(context.currentDate);

    return parts.join('\n\n');
  }

  clearCache(): void {
    this.cacheService.clear();
  }

  clearGitStatusCache(): void {
    this.cacheService.delete(ContextCacheKeys.GIT_STATUS);
  }

  clearUserContextCache(): void {
    this.cacheService.delete(ContextCacheKeys.USER_CONTEXT);
  }

  updateOptions(options: Partial<ContextManagerOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };

    if (options.cacheTTL) {
      this.cacheService.setDefaultTTL(options.cacheTTL);
    }
  }

  getCacheStats() {
    return this.cacheService.getStats();
  }

  runWithContext<T>(key: string, context: Context, fn: () => T): T {
    const store = { ...asyncContextStorage.getStore() };
    store[key] = context;
    return asyncContextStorage.run(store, fn);
  }

  runWithContexts<T>(contexts: Record<string, Context>, fn: () => T): T {
    const merged = { ...asyncContextStorage.getStore(), ...contexts };
    return asyncContextStorage.run(merged, fn);
  }

  getContext(key: string): Context | undefined {
    const store = asyncContextStorage.getStore();
    return store?.[key];
  }

  hasContext(key: string): boolean {
    const store = asyncContextStorage.getStore();
    return store?.[key] !== undefined;
  }

  getAllContexts(): Record<string, Context> {
    return asyncContextStorage.getStore() || {};
  }

  destroyContextAndRun<T>(key: string, fn: () => T): T {
    const prevStore = { ...asyncContextStorage.getStore() };
    delete prevStore[key];
    return asyncContextStorage.run(prevStore, fn);
  }

  destroyAllContexts(): void {
    asyncContextStorage.clearStore();
  }

  registerContextType(type: string, options?: ContextTypeOptions): void {
    contextRegistry.register(type, options);
  }

  unregisterContextType(type: string): void {
    contextRegistry.unregister(type);
  }

  async createContext(data: ContextData): Promise<Context> {
    const context = await this.store.create(data);
    await this.lifecycle.initialize(context);
    return context;
  }

  isolateScope<T>(
    scopeId: string,
    contexts: Record<string, Context>,
    fn: () => T | Promise<T>
  ): Promise<T> {
    const mergedContexts = this.sharingManager.applySharedContexts(contexts, scopeId);
    return this.isolator.runIsolated(scopeId, mergedContexts, fn);
  }

  createIsolationScope(scopeId: string, parentId?: string): void {
    this.isolator.createScope(scopeId, parentId);
  }

  scopeExists(scopeId: string): boolean {
    return this.isolator.scopeExists(scopeId);
  }

  removeIsolationScope(scopeId: string): void {
    this.isolator.removeScope(scopeId);
  }

  shareContext(contextKey: string, context: Context, targetScopeId: string): void {
    this.sharingManager.shareToScope(contextKey, context, targetScopeId);
  }

  shareContextToAllScopes(contextKey: string, context: Context): void {
    this.sharingManager.shareToAllScopes(contextKey, context);
  }

  getSharedContext(contextKey: string): SharedContextEntry | undefined {
    return this.sharingManager.getSharedContext(contextKey);
  }

  hasSharedContext(contextKey: string): boolean {
    return this.sharingManager.hasSharedContext(contextKey);
  }

  unshareContext(contextKey: string): void {
    this.sharingManager.unshareContext(contextKey);
  }

  snapshotScope(scopeId: string): void {
    this.isolator.snapshot(scopeId);
  }

  restoreScope(scopeId: string): void {
    this.isolator.restore(scopeId);
  }

  getContextStore(): ContextStore {
    return this.store;
  }

  getContextInjector(): ContextInjector {
    return this.injector;
  }

  getLifecycleManager(): LifecycleManager {
    return this.lifecycle;
  }

  getContextIsolator(): ContextIsolator {
    return this.isolator;
  }

  getContextSharingManager(): ContextSharingManager {
    return this.sharingManager;
  }
}

export function getContextManager(options?: ContextManagerOptions): ContextManager {
  return ContextManager.getInstance(options);
}

export async function fetchSystemContext(): Promise<SystemContext> {
  const manager = getContextManager();
  return manager.getSystemContext();
}

export async function fetchFormattedSystemPrompt(): Promise<string> {
  const manager = getContextManager();
  return manager.formatSystemPrompt();
}

export const contextManager = ContextManager.getInstance();
