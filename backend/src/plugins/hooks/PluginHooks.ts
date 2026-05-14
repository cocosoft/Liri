/**
 * PluginHooks 插件钩子系统
 * 在插件的各个生命周期阶段插入自定义行为
 */

/**
 * 钩子阶段
 */
export type HookStage = 'before' | 'after' | 'around' | 'onError';

/**
 * 钩子类型
 */
export type HookType =
  | 'plugin:load'
  | 'plugin:unload'
  | 'plugin:activate'
  | 'plugin:deactivate'
  | 'plugin:install'
  | 'plugin:uninstall'
  | 'plugin:update'
  | 'plugin:configChange'
  | 'command:before'
  | 'command:after'
  | 'tool:before'
  | 'tool:after'
  | 'session:start'
  | 'session:end'
  | 'app:startup'
  | 'app:shutdown';

/**
 * 钩子上下文
 */
export interface HookContext {
  type: HookType;
  stage: HookStage;
  pluginName?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/**
 * 钩子函数
 */
export type HookFunction = (
  context: HookContext
) => Promise<HookResult> | HookResult;

/**
 * 钩子执行结果
 */
export interface HookResult {
  continue: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * 钩子注册信息
 */
export interface HookRegistration {
  id: string;
  type: HookType;
  stage: HookStage;
  pluginName: string;
  priority: number;
  fn: HookFunction;
  description?: string;
}

/**
 * 插件钩子管理器
 * 对标 OpenClaw 的 hooks 系统（global-runner/host-hooks/stage-hooks）
 */
export class PluginHooks {
  private hooks: Map<string, HookRegistration[]> = new Map();
  private counter: number = 0;

  /**
   * 注册钩子
   */
  register(
    type: HookType,
    stage: HookStage,
    pluginName: string,
    fn: HookFunction,
    options?: { priority?: number; description?: string }
  ): string {
    const key = `${type}:${stage}`;
    const registration: HookRegistration = {
      id: `hook_${++this.counter}`,
      type,
      stage,
      pluginName,
      priority: options?.priority ?? 100,
      fn,
      description: options?.description,
    };

    const hooks = this.hooks.get(key) || [];
    hooks.push(registration);
    hooks.sort((a, b) => a.priority - b.priority);
    this.hooks.set(key, hooks);

    return registration.id;
  }

  /**
   * 注销钩子
   */
  unregister(hookId: string): boolean {
    for (const [key, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex((h) => h.id === hookId);
      if (index !== -1) {
        hooks.splice(index, 1);
        if (hooks.length === 0) {
          this.hooks.delete(key);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * 按插件名注销所有钩子
   */
  unregisterByPlugin(pluginName: string): number {
    let count = 0;
    for (const [key, hooks] of this.hooks.entries()) {
      const filtered = hooks.filter((h) => h.pluginName !== pluginName);
      count += hooks.length - filtered.length;
      if (filtered.length === 0) {
        this.hooks.delete(key);
      } else {
        this.hooks.set(key, filtered);
      }
    }
    return count;
  }

  /**
   * 执行钩子
   */
  async execute(
    type: HookType,
    stage: HookStage,
    data?: Record<string, unknown>
  ): Promise<HookResult[]> {
    const key = `${type}:${stage}`;
    const hooks = this.hooks.get(key);

    if (!hooks || hooks.length === 0) {
      return [{ continue: true }];
    }

    const results: HookResult[] = [];

    for (const hook of hooks) {
      const context: HookContext = {
        type,
        stage,
        pluginName: hook.pluginName,
        timestamp: Date.now(),
        data,
      };

      try {
        const result = await hook.fn(context);
        results.push(result);

        if (!result.continue) {
          break;
        }
      } catch (err) {
        const errorResult: HookResult = {
          continue: stage === 'after',
          error: err instanceof Error ? err.message : String(err),
        };
        results.push(errorResult);
      }
    }

    return results;
  }

  /**
   * 获取指定类型的钩子列表
   */
  getHooks(type?: HookType): HookRegistration[] {
    if (type) {
      const all: HookRegistration[] = [];
      for (const stage of [
        'before',
        'after',
        'around',
        'onError',
      ] as HookStage[]) {
        const hooks = this.hooks.get(`${type}:${stage}`);
        if (hooks) all.push(...hooks);
      }
      return all;
    }

    const all: HookRegistration[] = [];
    for (const hooks of this.hooks.values()) {
      all.push(...hooks);
    }
    return all;
  }

  /**
   * 清除所有钩子
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * 获取钩子统计
   */
  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    let total = 0;

    for (const [key, hooks] of this.hooks.entries()) {
      byType[key] = hooks.length;
      total += hooks.length;
    }

    return { total, byType };
  }
}

export const pluginHooks = new PluginHooks();
