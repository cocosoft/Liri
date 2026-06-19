/**
 * 会话级钩子服务
 * 提供会话级别的钩子注册和管理功能
 */

import { IndividualHookConfig, HookEvent } from '../types';

/**
 * 会话级钩子函数类型
 */
export type SessionFunctionHook = {
  type: 'function';
  id: string;
  timeout?: number;
  callback: (data: any) => boolean | Promise<boolean>;
  errorMessage: string;
  statusMessage?: string;
};

/**
 * 会话钩子匹配器
 */
interface SessionHookMatcher {
  matcher: string;
  skillRoot?: string;
  hooks: Array<{
    hook: IndividualHookConfig | SessionFunctionHook;
    onHookSuccess?: (result: any) => void;
  }>;
}

/**
 * 会话钩子存储
 */
interface SessionStore {
  hooks: Partial<Record<HookEvent, SessionHookMatcher[]>>;
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * 会话钩子服务
 */
export class SessionHookService {
  private static instance: SessionHookService;
  private sessions: Map<string, SessionStore> = new Map();
  private maxSessions: number = 100;
  private hookTimeout: number = 5000;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): SessionHookService {
    if (!SessionHookService.instance) {
      SessionHookService.instance = new SessionHookService();
    }
    return SessionHookService.instance;
  }

  /**
   * 创建会话
   */
  public createSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        hooks: {},
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
      this.cleanupOldSessions();
    }
  }

  /**
   * 获取会话
   */
  private getSession(sessionId: string): SessionStore | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = Date.now();
    }
    return session;
  }

  /**
   * 添加命令或提示钩子到会话
   */
  public addSessionHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    hook: IndividualHookConfig,
    onHookSuccess?: (result: any) => void,
    skillRoot?: string
  ): void {
    this.createSession(sessionId);

    const session = this.getSession(sessionId)!;
    const eventMatchers = session.hooks[event] || [];

    const existingMatcherIndex = eventMatchers.findIndex(
      (m) => m.matcher === matcher && m.skillRoot === skillRoot
    );

    if (existingMatcherIndex >= 0) {
      eventMatchers[existingMatcherIndex].hooks.push({ hook, onHookSuccess });
    } else {
      eventMatchers.push({
        matcher,
        skillRoot,
        hooks: [{ hook, onHookSuccess }],
      });
    }

    session.hooks[event] = eventMatchers;
  }

  /**
   * 添加函数钩子到会话
   * @returns 钩子ID
   */
  public addFunctionHook(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    callback: (data: any) => boolean | Promise<boolean>,
    errorMessage: string,
    options?: {
      timeout?: number;
      id?: string;
    }
  ): string {
    const id =
      options?.id ||
      `function-hook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const hook: SessionFunctionHook = {
      type: 'function',
      id,
      timeout: options?.timeout || this.hookTimeout,
      callback,
      errorMessage,
    };

    this.addSessionHook(sessionId, event, matcher, hook as any);

    return id;
  }

  /**
   * 移除函数钩子
   */
  public removeFunctionHook(
    sessionId: string,
    event: HookEvent,
    hookId: string
  ): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    const eventMatchers = session.hooks[event];
    if (!eventMatchers) {
      return false;
    }

    let removed = false;

    for (const matcher of eventMatchers) {
      const originalLength = matcher.hooks.length;
      matcher.hooks = matcher.hooks.filter((h) => {
        if (h.hook.type !== 'function') return true;
        return (h.hook as SessionFunctionHook).id !== hookId;
      });

      if (matcher.hooks.length < originalLength) {
        removed = true;
      }
    }

    return removed;
  }

  /**
   * 移除特定钩子
   */
  public removeSessionHook(
    sessionId: string,
    event: HookEvent,
    hook: IndividualHookConfig
  ): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    const eventMatchers = session.hooks[event];
    if (!eventMatchers) {
      return false;
    }

    let removed = false;

    for (const matcher of eventMatchers) {
      const originalLength = matcher.hooks.length;
      matcher.hooks = matcher.hooks.filter((h) => {
        if (h.hook.type === 'function') return true;
        return !this.isHookEqual(h.hook as IndividualHookConfig, hook);
      });

      if (matcher.hooks.length < originalLength) {
        removed = true;
      }
    }

    return removed;
  }

  /**
   * 比较两个钩子是否相等
   */
  private isHookEqual(
    a: IndividualHookConfig,
    b: IndividualHookConfig
  ): boolean {
    if (a.event !== b.event) return false;
    if (a.matcher !== b.matcher) return false;
    if (a.config.type !== b.config.type) return false;
    if (a.config.command !== b.config.command) return false;
    if (a.config.prompt !== b.config.prompt) return false;
    return true;
  }

  /**
   * 获取会话的所有钩子
   */
  public getSessionHooks(
    sessionId: string,
    event?: HookEvent
  ): Map<HookEvent, SessionHookMatcher[]> {
    const session = this.getSession(sessionId);
    if (!session) {
      return new Map();
    }

    const result = new Map<HookEvent, SessionHookMatcher[]>();

    if (event) {
      const hooks = session.hooks[event];
      if (hooks) {
        result.set(event, hooks);
      }
      return result;
    }

    for (const [evt, matchers] of Object.entries(session.hooks)) {
      if (matchers && matchers.length > 0) {
        result.set(evt as HookEvent, matchers);
      }
    }

    return result;
  }

  /**
   * 获取会话的函数钩子
   */
  public getSessionFunctionHooks(
    sessionId: string,
    event?: HookEvent
  ): Map<HookEvent, SessionHookMatcher[]> {
    const session = this.getSession(sessionId);
    if (!session) {
      return new Map();
    }

    const result = new Map<HookEvent, SessionHookMatcher[]>();

    const processMatchers = (matchers: SessionHookMatcher[] | undefined) => {
      if (!matchers) return;

      for (const matcher of matchers) {
        const functionHooks = matcher.hooks.filter(
          (h) => h.hook.type === 'function'
        );
        if (functionHooks.length > 0) {
          const entry: SessionHookMatcher = {
            matcher: matcher.matcher,
            skillRoot: matcher.skillRoot,
            hooks: functionHooks,
          };

          if (!result.has(event!)) {
            result.set(event!, []);
          }
          result.get(event!)!.push(entry);
        }
      }
    };

    if (event) {
      processMatchers(session.hooks[event]);
    } else {
      for (const [evt, matchers] of Object.entries(session.hooks)) {
        processMatchers(matchers);
      }
    }

    return result;
  }

  /**
   * 获取会话钩子回调
   */
  public getSessionHookCallback(
    sessionId: string,
    event: HookEvent,
    matcher: string,
    hook: IndividualHookConfig | SessionFunctionHook
  ):
    | {
        hook: IndividualHookConfig | SessionFunctionHook;
        onHookSuccess?: (result: any) => void;
      }
    | undefined {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    const eventMatchers = session.hooks[event];
    if (!eventMatchers) {
      return undefined;
    }

    for (const matcherEntry of eventMatchers) {
      if (matcherEntry.matcher === matcher || matcher === '') {
        const hookEntry = matcherEntry.hooks.find((h) => {
          if (h.hook.type === 'function') {
            return (
              (h.hook as SessionFunctionHook).id ===
              (hook as SessionFunctionHook).id
            );
          }
          return this.isHookEqual(
            h.hook as IndividualHookConfig,
            hook as IndividualHookConfig
          );
        });

        if (hookEntry) {
          return hookEntry;
        }
      }
    }

    return undefined;
  }

  /**
   * 清除会话的所有钩子
   */
  public clearSessionHooks(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (session) {
      session.hooks = {};
    }
  }

  /**
   * 删除会话
   */
  public deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * 清理旧会话
   */
  private cleanupOldSessions(): void {
    if (this.sessions.size <= this.maxSessions) {
      return;
    }

    const sessionsArray = Array.from(this.sessions.entries()).sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt
    );

    const sessionsToRemove = sessionsArray.slice(
      0,
      this.sessions.size - this.maxSessions
    );

    for (const [sessionId] of sessionsToRemove) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 获取会话统计
   */
  public getStatistics(): {
    totalSessions: number;
    sessionsWithHooks: number;
    hooksByEvent: Record<string, number>;
    oldestSession: number;
    newestSession: number;
  } {
    const stats = {
      totalSessions: this.sessions.size,
      sessionsWithHooks: 0,
      hooksByEvent: {} as Record<string, number>,
      oldestSession: 0,
      newestSession: 0,
    };

    for (const session of this.sessions.values()) {
      let hasHooks = false;

      for (const [event, matchers] of Object.entries(session.hooks)) {
        if (matchers && matchers.length > 0) {
          hasHooks = true;
          stats.hooksByEvent[event] =
            (stats.hooksByEvent[event] || 0) +
            matchers.reduce((sum, m) => sum + m.hooks.length, 0);
        }
      }

      if (hasHooks) {
        stats.sessionsWithHooks++;
      }
    }

    if (this.sessions.size > 0) {
      const timestamps = Array.from(this.sessions.values()).map(
        (s) => s.createdAt
      );
      stats.oldestSession = Math.min(...timestamps);
      stats.newestSession = Math.max(...timestamps);
    }

    return stats;
  }

  /**
   * 获取所有会话ID
   */
  public getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * 重置服务
   */
  public reset(): void {
    this.sessions.clear();
  }
}

/**
 * 导出单例
 */
export const sessionHookService = SessionHookService.getInstance();
