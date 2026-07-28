/**
 * 上下文管理器
 * 统一管理Git状态、用户上下文和系统上下文
 * 集成ContextStore、ContextInjector、LifecycleManager
 */

import {
  GitContextService,
  getGitContextService,
} from './GitContextService.js';
import * as path from 'path';
import {
  UserContextService,
  getUserContextService,
} from './UserContextService.js';
import {
  ContextCacheService,
  getContextCacheService,
  ContextCacheKeys,
} from './ContextCacheService.js';
import { ContextStore, contextStore } from './ContextStore';
import { ContextInjector, contextInjector } from './ContextInjector';
import { LifecycleManager, lifecycleManager } from './LifecycleManager';
import { contextRegistry, type ContextTypeOptions } from './ContextRegistry';
import {
  AsyncContextStorage,
  asyncContextStorage,
} from './AsyncContextStorage';
import { ContextIsolator, contextIsolator } from './ContextIsolator';
import {
  ContextSharingManager,
  contextSharingManager,
  type SharedContextEntry,
} from './ContextSharingManager';
import {
  ContextEngine,
  type ContextEntry,
  type ContextQuery,
  type ContextResult,
} from '../context-engine/ContextEngine';
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
 * 上下文管理器依赖注入选项（Phase 4: 构造参数注入）
 */
export interface ContextManagerDependencies {
  gitService?: GitContextService;
  userService?: UserContextService;
  cacheService?: ContextCacheService;
  store?: ContextStore;
  injector?: ContextInjector;
  lifecycle?: LifecycleManager;
  isolator?: ContextIsolator;
  sharingManager?: ContextSharingManager;
  /** Phase 5: scope-aware KV 上下文引擎 */
  engine?: ContextEngine;
}

/**
 * 上下文管理器
 *
 * Phase 4: 支持构造参数注入（createContextManager），替代原有 Singleton 模式。
 * 测试时可通过 createContextManager({ store: new MockStore() }) 创建 mock 实例。
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
  /** Phase 5: scope-aware KV 上下文引擎 */
  private engine: ContextEngine | null;

  private constructor(
    options: ContextManagerOptions = {},
    deps?: ContextManagerDependencies
  ) {
    this.options = {
      enableGitStatus: options.enableGitStatus ?? true,
      enableUserContext: options.enableUserContext ?? true,
      cacheTTL: options.cacheTTL ?? 300000,
      watchFileChanges: options.watchFileChanges ?? true,
    };

    // Phase 4: 支持依赖注入，默认使用单例
    this.gitService = deps?.gitService ?? getGitContextService();
    this.userService = deps?.userService ?? getUserContextService();
    this.cacheService = deps?.cacheService ?? getContextCacheService();
    this.store = deps?.store ?? contextStore;
    this.injector = deps?.injector ?? contextInjector;
    this.lifecycle = deps?.lifecycle ?? lifecycleManager;
    this.isolator = deps?.isolator ?? contextIsolator;
    this.sharingManager = deps?.sharingManager ?? contextSharingManager;
    // Phase 5: Engine 可选注入，未注入时 scope-aware 功能不可用
    this.engine = deps?.engine ?? null;

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

  /**
   * 创建新实例（支持依赖注入，用于测试）
   * Phase 4: 创建非单例实例，绕过 getInstance 缓存
   */
  static create(
    options?: ContextManagerOptions,
    deps?: ContextManagerDependencies
  ): ContextManager {
    return new ContextManager(options, deps);
  }

  private setupFileWatchers(): void {
    const gitPath = path.resolve('.git');
    this.cacheService.watchDirectory(gitPath, [ContextCacheKeys.GIT_STATUS]);

    const userContextPath = path.resolve('Liri.md');
    this.cacheService.watchFile(userContextPath, [
      ContextCacheKeys.USER_CONTEXT,
    ]);

    const claudeMdPath = 'CLAUDE.md';
    this.cacheService.watchFile(claudeMdPath, [ContextCacheKeys.USER_CONTEXT]);
  }

  async getGitStatus(): Promise<string | null> {
    const cached = this.cacheService.get<string>(ContextCacheKeys.GIT_STATUS);
    if (cached !== undefined) {
      return cached;
    }

    if (!this.options.enableGitStatus) {
      return null;
    }

    const gitStatus = await this.gitService.getGitStatusAsSystemPrompt();
    this.cacheService.set(
      ContextCacheKeys.GIT_STATUS,
      gitStatus,
      this.options.cacheTTL
    );
    return gitStatus;
  }

  async getUserContext(): Promise<{
    userContext: string | null;
    currentDate: string;
  }> {
    const cached = this.cacheService.get<{
      userContext: string | null;
      currentDate: string;
    }>(ContextCacheKeys.USER_CONTEXT);
    if (cached !== undefined) {
      return cached;
    }

    if (!this.options.enableUserContext) {
      return {
        userContext: null,
        currentDate: this.userService.formatCurrentDate(),
      };
    }

    const userContext = await this.userService.getUserContext();
    this.cacheService.set(
      ContextCacheKeys.USER_CONTEXT,
      userContext,
      this.options.cacheTTL
    );
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
    const cacheStats = this.cacheService.getStats();
    const engineStats = this.engine?.getStats() ?? null;
    return { cache: cacheStats, engine: engineStats };
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

  /**
   * Phase 5: 销毁管理器，清理引擎
   */
  destroy(): void {
    this.clearCache();
    this.engine?.destroy();
    this.destroyAllContexts();
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
    const mergedContexts = this.sharingManager.applySharedContexts(
      contexts,
      scopeId
    );
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

  shareContext(
    contextKey: string,
    context: Context,
    targetScopeId: string
  ): void {
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

  // ── Phase 5: Scope-aware KV Engine bridge ──────────────────────────

  /**
   * 获取 scope-aware KV 引擎（可能为 null，调用方需判空）
   */
  getEngine(): ContextEngine | null {
    return this.engine;
  }

  /**
   * 缓存条目到 scope-aware 引擎
   * 引擎未注入时静默跳过
   */
  setEngineEntry(
    key: string,
    value: unknown,
    options?: {
      scope?: ContextEntry['scope'];
      priority?: number;
      ttl?: number;
      tags?: string[];
    }
  ): void {
    this.engine?.set(key, value, options);
  }

  /**
   * 从引擎按 scope 查询
   * 引擎未注入时返回空结果
   */
  queryEngine(query: ContextQuery): ContextResult {
    return this.engine?.query(query) ?? { entries: [], total: 0, query };
  }

  /**
   * 清除引擎中指定 scope 的条目
   */
  clearEngineScope(scope: ContextEntry['scope']): void {
    this.engine?.clear(scope);
  }

  // ── 上下文装配 ─────────────────────────────────────────────────────

  /**
   * prepareForModel — 统一上下文装配接口（对标 PilotDeck ContextRuntime.prepareForModel）
   *
   * 为模型调用装配完整的上下文，返回可直接注入 LLM 请求的上下文对象。
   * 聚合：系统提示 → Git 状态 → 用户上下文 → 记忆 → 共享上下文
   */
  async prepareForModel(sessionId?: string): Promise<{
    systemPrompt: string;
    gitStatus?: string;
    userContext?: string;
    memoryContext?: string;
    sharedContexts: Record<string, unknown>;
  }> {
    const [gitStatus, userContextObj] = await Promise.all([
      this.getGitStatus().catch(
        () => undefined /* @ignore-catch: git status optional */
      ),
      this.getUserContext().catch(
        () => undefined /* @ignore-catch: user context optional */
      ),
    ]);

    const systemPrompt = await this.formatSystemPrompt();

    return {
      systemPrompt,
      gitStatus: gitStatus ?? undefined,
      userContext: userContextObj
        ? `User Context:\n${userContextObj.userContext ?? ''}\nCurrent Date: ${userContextObj.currentDate}`
        : undefined,
      sharedContexts: {},
    };
  }
}

export function getContextManager(
  options?: ContextManagerOptions
): ContextManager {
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

/**
 * 创建 ContextManager（支持依赖注入，用于测试）
 * Phase 4: 替代 Singleton 模式，生产环境仍用 contextManager 单例
 */
export function createContextManager(
  options?: ContextManagerOptions,
  deps?: ContextManagerDependencies
): ContextManager {
  return ContextManager.create(options, deps);
}
