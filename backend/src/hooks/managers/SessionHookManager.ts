/**
 * 会话钩子管理器
 * 管理会话级别的钩子
 * 参考CC源码: cc_code/backend/utils/hooks/sessionHooks.ts
 */

import { EventEmitter } from 'events';
import type { HookEvent } from '../types';

/**
 * 函数钩子回调类型
 */
export type FunctionHookCallback = (
  messages: any[],
  signal?: AbortSignal
) => boolean | Promise<boolean>;

/**
 * 函数钩子类型
 */
export interface FunctionHook {
  type: 'function';
  id?: string;
  timeout?: number;
  callback: FunctionHookCallback;
  errorMessage: string;
  statusMessage?: string;
}

/**
 * 钩子命令类型
 */
export interface HookCommand {
  type: 'command' | 'prompt' | 'http' | 'agent';
  [key: string]: any;
}

/**
 * 会话钩子匹配器
 */
export interface SessionHookMatcher {
  matcher: string;
  skillRoot?: string;
  hooks: Array<{
    hook: HookCommand | FunctionHook;
    onHookSuccess?: (hook: HookCommand | FunctionHook, result: any) => void;
  }>;
}

/**
 * 会话存储
 */
export interface SessionStore {
  hooks: {
    [event in HookEvent]?: SessionHookMatcher[];
  };
}

/**
 * 会话钩子状态
 */
export type SessionHooksState = Map<string, SessionStore>;

/**
 * 会话钩子管理器类
 */
export class SessionHookManager extends EventEmitter {
  private static instance: SessionHookManager;
  private sessionHooks: SessionHooksState = new Map();

  private constructor() {
    super();
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
   * 添加会话钩子
   */
  addSessionHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    hook: HookCommand,
    onHookSuccess?: (hook: HookCommand | FunctionHook, result: any) => void,
    skillRoot?: string
  ): void {
    this.addHookToSession(
      sessionId,
      event,
      matcher,
      hook,
      onHookSuccess,
      skillRoot
    );
  }

  /**
   * 添加函数钩子
   */
  addFunctionHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    callback: FunctionHookCallback,
    errorMessage: string,
    options?: {
      timeout?: number;
      id?: string;
    }
  ): string {
    const id = options?.id || `function-hook-${Date.now()}-${Math.random()}`;
    const hook: FunctionHook = {
      type: 'function',
      id,
      timeout: options?.timeout || 5000,
      callback,
      errorMessage,
    };
    this.addHookToSession(sessionId, event, matcher, hook);
    return id;
  }

  /**
   * 移除函数钩子
   */
  removeFunctionHook(
    sessionId: string,
    event: HookEvent,
    hookId: string
  ): void {
    const store = this.sessionHooks.get(sessionId);
    if (!store) {
      return;
    }

    const eventMatchers = store.hooks[event] || [];

    // 从所有匹配器中移除指定ID的钩子
    const updatedMatchers = eventMatchers
      .map((matcher) => {
        const updatedHooks = matcher.hooks.filter((h) => {
          if (h.hook.type !== 'function') return true;
          return h.hook.id !== hookId;
        });

        return updatedHooks.length > 0
          ? { ...matcher, hooks: updatedHooks }
          : null;
      })
      .filter((m): m is SessionHookMatcher => m !== null);

    const newHooks =
      updatedMatchers.length > 0
        ? { ...store.hooks, [event]: updatedMatchers }
        : {
            ...store.hooks,
          };

    if (updatedMatchers.length === 0) {
      delete newHooks[event];
    }

    this.sessionHooks.set(sessionId, { ...store, hooks: newHooks });
    this.emit('hookRemoved', { sessionId, event, hookId });
  }

  /**
   * 添加钩子到会话
   */
  private addHookToSession(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    hook: HookCommand | FunctionHook,
    onHookSuccess?: (hook: HookCommand | FunctionHook, result: any) => void,
    skillRoot?: string
  ): void {
    const store = this.sessionHooks.get(sessionId) || { hooks: {} };
    const eventMatchers = store.hooks[event] || [];

    // 查找现有匹配器
    const existingMatcher = eventMatchers.find((m) => m.matcher === matcher);

    if (existingMatcher) {
      // 更新现有匹配器
      existingMatcher.hooks.push({ hook, onHookSuccess });
    } else {
      // 创建新匹配器
      eventMatchers.push({
        matcher,
        skillRoot,
        hooks: [{ hook, onHookSuccess }],
      });
    }

    store.hooks[event] = eventMatchers;
    this.sessionHooks.set(sessionId, store);
    this.emit('hookAdded', { sessionId, event, matcher, hook });
  }

  /**
   * 获取会话钩子
   */
  getSessionHooks(sessionId: string): SessionStore | undefined {
    return this.sessionHooks.get(sessionId);
  }

  /**
   * 获取指定事件的会话钩子
   */
  getSessionHooksByEvent(
    sessionId: string,
    event: HookEvent
  ): SessionHookMatcher[] {
    const store = this.sessionHooks.get(sessionId);
    return store?.hooks[event] || [];
  }

  /**
   * 清除会话钩子
   */
  clearSessionHooks(sessionId: string): void {
    this.sessionHooks.delete(sessionId);
    this.emit('sessionCleared', { sessionId });
  }

  /**
   * 清除所有会话钩子
   */
  clearAllSessionHooks(): void {
    this.sessionHooks.clear();
    this.emit('allSessionsCleared');
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.sessionHooks.size;
  }

  /**
   * 执行会话钩子
   */
  async executeSessionHooks(
    sessionId: string,
    event: HookEvent,
    data: any,
    toolNames: string[] = []
  ): Promise<any[]> {
    const matchers = this.getSessionHooksByEvent(sessionId, event);
    const results: any[] = [];

    for (const matcher of matchers) {
      // 检查匹配器
      if (!this.matchesMatcher(matcher.matcher, data)) {
        continue;
      }

      for (const hookEntry of matcher.hooks) {
        const hook = hookEntry.hook;

        try {
          let result: any;

          if (hook.type === 'function') {
            // 执行函数钩子
            result = await this.executeFunctionHook(hook, data, toolNames);
          } else {
            // 对于其他类型的钩子，返回配置
            result = { hook, matched: true };
          }

          results.push(result);

          // 执行成功回调
          if (hookEntry.onHookSuccess) {
            hookEntry.onHookSuccess(hook, result);
          }
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return results;
  }

  /**
   * 执行函数钩子
   */
  private async executeFunctionHook(
    hook: FunctionHook,
    data: any,
    toolNames: string[]
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      hook.timeout || 5000
    );

    try {
      const result = await hook.callback(
        data.messages || [],
        controller.signal
      );
      clearTimeout(timeoutId);
      return {
        success: true,
        result,
        hookId: hook.id,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Hook execution failed',
        hookId: hook.id,
      };
    }
  }

  /**
   * 检查是否匹配匹配器
   */
  private matchesMatcher(matcher: string, data: any): boolean {
    if (!matcher) {
      return true;
    }

    if (data.tool_name) {
      return data.tool_name === matcher;
    }
    if (data.notification_type) {
      return data.notification_type === matcher;
    }
    if (data.source) {
      return data.source === matcher;
    }
    if (data.reason) {
      return data.reason === matcher;
    }
    if (data.error) {
      return data.error === matcher;
    }
    if (data.file_path) {
      const pattern = new RegExp(
        matcher.replace(/\./g, '\\.').replace(/\*/g, '.*')
      );
      return pattern.test(data.file_path);
    }

    return true;
  }

  /**
   * 重置管理器
   */
  reset(): void {
    this.sessionHooks.clear();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const sessionHookManager = SessionHookManager.getInstance();
