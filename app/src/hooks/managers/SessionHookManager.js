/**
 * 会话级钩子管理器
 * 管理会话级别的钩子配置和执行
 * 参考CC源码: cc_code/backend/utils/hooks/sessionHooks.ts
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { resolveConfigDir } from '@modules/config/paths';

/**
 * 会话级钩子匹配器
 */
export interface SessionHookMatcher {
  id: string;
  name: string;
  event: string;
  matcher: string | RegExp;
  enabled: boolean;
  config: {
    type: 'command' | 'prompt' | 'http' | 'agent';
    command?: string;
    prompt?: string;
    timeout?: number;
  };
}

/**
 * 会话钩子
 */
export interface SessionHook {
  id: string;
  sessionId: string;
  event: string;
  matcher: string;
  config: any;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  executionCount: number;
  lastExecutedAt?: number;
  lastExecutionResult?: {
    success: boolean;
    duration: number;
    error?: string;
  };
}

/**
 * 会话钩子统计
 */
export interface SessionHookStats {
  sessionId: string;
  totalHooks: number;
  enabledHooks: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecutionAt?: number;
}

/**
 * 会话钩子管理器类
 */
class SessionHookManager extends EventEmitter {
  private static instance: SessionHookManager;
  private sessionHooks: Map<string, SessionHook[]> = new Map();
  private sessionStats: Map<string, SessionHookStats> = new Map();
  private configPath: string;

  private constructor() {
    super();
    this.configPath = this.getConfigPath();
    this.ensureConfigDirectory();
    this.loadSessionHooks();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SessionHookManager {
    if (!SessionHookManager.instance) {
      SessionHookManager.instance = new SessionHookManager();
    }
    return SessionHookManager.instance;
  }

  /**
   * 获取配置路径
   */
  private getConfigPath(): string {
    return join(resolveConfigDir(), 'session_hooks.json');
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDirectory(): void {
    const configDir = dirname(this.configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

  /**
   * 加载会话钩子配置
   */
  private loadSessionHooks(): void {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8');
        const data = JSON.parse(content);

        this.sessionHooks.clear();
        if (data.sessionHooks) {
          for (const [sessionId, hooks] of Object.entries(data.sessionHooks)) {
            this.sessionHooks.set(sessionId, hooks as SessionHook[]);
          }
        }

        if (data.sessionStats) {
          for (const [sessionId, stats] of Object.entries(data.sessionStats)) {
            this.sessionStats.set(sessionId, stats as SessionHookStats);
          }
        }
      } catch (error) {
        console.error('Failed to load session hooks:', error);
      }
    }
  }

  /**
   * 保存会话钩子配置
   */
  private saveSessionHooks(): void {
    try {
      const data: any = {
        sessionHooks: {},
        sessionStats: {},
      };

      for (const [sessionId, hooks] of this.sessionHooks) {
        data.sessionHooks[sessionId] = hooks;
      }

      for (const [sessionId, stats] of this.sessionStats) {
        data.sessionStats[sessionId] = stats;
      }

      writeFileSync(this.configPath, JSON.stringify(data, null, 2) + '\n');
    } catch (error) {
      console.error('Failed to save session hooks:', error);
    }
  }

  /**
   * 注册会话钩子
   */
  registerSessionHook(
    sessionId: string,
    event: string,
    matcher: string,
    config: any
  ): SessionHook {
    const hook: SessionHook = {
      id: `session_hook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId,
      event,
      matcher,
      config,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      executionCount: 0,
    };

    if (!this.sessionHooks.has(sessionId)) {
      this.sessionHooks.set(sessionId, []);
    }

    this.sessionHooks.get(sessionId)!.push(hook);
    this.saveSessionHooks();

    this.emit('hookRegistered', {
      sessionId,
      hookId: hook.id,
      event,
      matcher,
    });

    return hook;
  }

  /**
   * 获取会话钩子
   */
  getSessionHooks(sessionId: string): SessionHook[] {
    return this.sessionHooks.get(sessionId) || [];
  }

  /**
   * 获取会话启用的钩子
   */
  getEnabledSessionHooks(sessionId: string): SessionHook[] {
    const hooks = this.sessionHooks.get(sessionId) || [];
    return hooks.filter(hook => hook.enabled);
  }

  /**
   * 获取特定事件的会话钩子
   */
  getSessionHooksForEvent(sessionId: string, event: string): SessionHook[] {
    const hooks = this.getEnabledSessionHooks(sessionId);
    return hooks.filter(hook => hook.event === event);
  }

  /**
   * 匹配会话钩子
   */
  matchSessionHook(sessionId: string, event: string, target: string): SessionHook | null {
    const hooks = this.getEnabledSessionHooks(sessionId);

    for (const hook of hooks) {
      if (hook.event !== event) {
        continue;
      }

      // 精确匹配
      if (hook.matcher === target) {
        return hook;
      }

      // 前缀匹配
      if (target.startsWith(hook.matcher)) {
        return hook;
      }

      // 通配符匹配
      if (hook.matcher.includes('*')) {
        const pattern = new RegExp(
          '^' + hook.matcher.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        if (pattern.test(target)) {
          return hook;
        }
      }
    }

    return null;
  }

  /**
   * 更新会话钩子
   */
  updateSessionHook(
    sessionId: string,
    hookId: string,
    updates: Partial<SessionHook>
  ): boolean {
    const hooks = this.sessionHooks.get(sessionId);
    if (!hooks) {
      return false;
    }

    const index = hooks.findIndex(h => h.id === hookId);
    if (index === -1) {
      return false;
    }

    const hook = hooks[index];
    hooks[index] = {
      ...hook,
      ...updates,
      updatedAt: Date.now(),
    };

    this.saveSessionHooks();

    this.emit('hookUpdated', {
      sessionId,
      hookId,
      updates,
    });

    return true;
  }

  /**
   * 删除会话钩子
   */
  deleteSessionHook(sessionId: string, hookId: string): boolean {
    const hooks = this.sessionHooks.get(sessionId);
    if (!hooks) {
      return false;
    }

    const index = hooks.findIndex(h => h.id === hookId);
    if (index === -1) {
      return false;
    }

    hooks.splice(index, 1);
    this.saveSessionHooks();

    this.emit('hookDeleted', {
      sessionId,
      hookId,
    });

    return true;
  }

  /**
   * 启用会话钩子
   */
  enableSessionHook(sessionId: string, hookId: string): boolean {
    return this.updateSessionHook(sessionId, hookId, { enabled: true });
  }

  /**
   * 禁用会话钩子
   */
  disableSessionHook(sessionId: string, hookId: string): boolean {
    return this.updateSessionHook(sessionId, hookId, { enabled: false });
  }

  /**
   * 记录钩子执行
   */
  recordHookExecution(
    sessionId: string,
    hookId: string,
    result: { success: boolean; duration: number; error?: string }
  ): void {
    const hooks = this.sessionHooks.get(sessionId);
    if (!hooks) {
      return;
    }

    const hook = hooks.find(h => h.id === hookId);
    if (!hook) {
      return;
    }

    hook.executionCount++;
    hook.lastExecutedAt = Date.now();
    hook.lastExecutionResult = result;

    // 更新统计
    this.updateSessionStats(sessionId, result);

    this.saveSessionHooks();

    this.emit('hookExecuted', {
      sessionId,
      hookId,
      result,
    });
  }

  /**
   * 更新会话统计
   */
  private updateSessionStats(
    sessionId: string,
    result: { success: boolean; duration: number; error?: string }
  ): void {
    let stats = this.sessionStats.get(sessionId);
    if (!stats) {
      stats = {
        sessionId,
        totalHooks: this.sessionHooks.get(sessionId)?.length || 0,
        enabledHooks: this.getEnabledSessionHooks(sessionId).length,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
      };
      this.sessionStats.set(sessionId, stats);
    }

    stats.totalExecutions++;
    if (result.success) {
      stats.successfulExecutions++;
    } else {
      stats.failedExecutions++;
    }

    // 计算新的平均执行时间
    const totalTime = stats.averageExecutionTime * (stats.totalExecutions - 1);
    stats.averageExecutionTime = (totalTime + result.duration) / stats.totalExecutions;
    stats.lastExecutionAt = Date.now();
    stats.enabledHooks = this.getEnabledSessionHooks(sessionId).length;
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId: string): SessionHookStats | null {
    return this.sessionStats.get(sessionId) || null;
  }

  /**
   * 获取所有会话统计
   */
  getAllSessionStats(): SessionHookStats[] {
    return Array.from(this.sessionStats.values());
  }

  /**
   * 清除会话钩子
   */
  clearSessionHooks(sessionId: string): void {
    this.sessionHooks.delete(sessionId);
    this.sessionStats.delete(sessionId);
    this.saveSessionHooks();

    this.emit('sessionHooksCleared', {
      sessionId,
    });
  }

  /**
   * 复制会话钩子到新会话
   */
  copySessionHooks(
    sourceSessionId: string,
    targetSessionId: string,
    events?: string[]
  ): SessionHook[] {
    const sourceHooks = this.sessionHooks.get(sourceSessionId) || [];
    const copiedHooks: SessionHook[] = [];

    for (const hook of sourceHooks) {
      if (events && !events.includes(hook.event)) {
        continue;
      }

      const newHook = this.registerSessionHook(
        targetSessionId,
        hook.event,
        hook.matcher,
        hook.config
      );
      copiedHooks.push(newHook);
    }

    return copiedHooks;
  }

  /**
   * 导入会话钩子
   */
  importSessionHooks(sessionId: string, hooks: Partial<SessionHook>[]): SessionHook[] {
    const importedHooks: SessionHook[] = [];

    for (const hookData of hooks) {
      if (!hookData.event || !hookData.matcher) {
        continue;
      }

      const hook = this.registerSessionHook(
        sessionId,
        hookData.event,
        hookData.matcher,
        hookData.config || {}
      );
      importedHooks.push(hook);
    }

    return importedHooks;
  }

  /**
   * 导出会话钩子
   */
  exportSessionHooks(sessionId: string, events?: string[]): Partial<SessionHook>[] {
    const hooks = this.sessionHooks.get(sessionId) || [];

    return hooks
      .filter(hook => !events || events.includes(hook.event))
      .map(hook => ({
        event: hook.event,
        matcher: hook.matcher,
        config: hook.config,
        enabled: hook.enabled,
      }));
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.sessionHooks.clear();
    this.sessionStats.clear();
    this.saveSessionHooks();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
SessionHookManager.instance = new SessionHookManager();

export { SessionHookManager };
export const sessionHookManager = SessionHookManager.getInstance();
