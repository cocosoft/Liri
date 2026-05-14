/**
 * PluginLifecycleManager 插件生命周期管理器
 * 对标 CC 的插件生命周期管理
 */
import { EventEmitter } from 'node:events';

/**
 * 生命周期配置
 */
export interface LifecycleConfig {
  timeout: number;
  retryCount: number;
}

/**
 * 插件状态
 */
export type PluginState = 'registered' | 'loading' | 'loaded' | 'activating' | 'activated' | 'deactivating' | 'deactivated' | 'error';

/**
 * 状态转换
 */
const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
  registered: ['loading'],
  loading: ['loaded', 'error'],
  loaded: ['activating', 'registered'],
  activating: ['activated', 'error'],
  activated: ['deactivating', 'registered'],
  deactivating: ['deactivated', 'error'],
  deactivated: ['registered'],
  error: ['registered', 'loading'],
};

/**
 * 生命周期管理器
 */
export class PluginLifecycleManager extends EventEmitter {
  private states: Map<string, PluginState> = new Map();
  private config: LifecycleConfig;

  constructor(config?: Partial<LifecycleConfig>) {
    super();

    this.config = {
      timeout: config?.timeout || 30000,
      retryCount: config?.retryCount || 3,
    };
  }

  /**
   * 注册插件
   */
  register(name: string): boolean {
    if (this.states.has(name)) return false;

    this.states.set(name, 'registered');
    this.emit('registered', { name });

    return true;
  }

  /**
   * 转换状态
   */
  async transition(name: string, target: PluginState): Promise<boolean> {
    const current = this.states.get(name);

    if (!current) return false;

    if (!VALID_TRANSITIONS[current]?.includes(target)) {
      this.emit('transition:invalid', { name, current, target });

      return false;
    }

    this.states.set(name, target);
    this.emit('transition', { name, from: current, to: target });

    return true;
  }

  /**
   * 获取状态
   */
  getState(name: string): PluginState | undefined {
    return this.states.get(name);
  }

  /**
   * 加载插件
   */
  async load(name: string): Promise<boolean> {
    return this.transitionWithRetry(name, 'loading', 'loaded', async () => {
      await this.delay(50);
    });
  }

  /**
   * 激活插件
   */
  async activate(name: string): Promise<boolean> {
    return this.transitionWithRetry(name, 'activating', 'activated', async () => {
      await this.delay(50);
    });
  }

  /**
   * 停用插件
   */
  async deactivate(name: string): Promise<boolean> {
    const success = await this.transition(name, 'deactivating');
    if (!success) return false;

    await this.delay(50);

    return this.transition(name, 'deactivated');
  }

  /**
   * 注销插件
   */
  unregister(name: string): boolean {
    const existed = this.states.delete(name);

    if (existed) {
      this.emit('unregistered', { name });
    }

    return existed;
  }

  /**
   * 获取所有插件状态
   */
  getAllStates(): Record<string, PluginState> {
    const result: Record<string, PluginState> = {};

    for (const [name, state] of this.states.entries()) {
      result[name] = state;
    }

    return result;
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byState: Record<PluginState, number> } {
    const byState: Record<string, number> = {
      registered: 0, loading: 0, loaded: 0,
      activating: 0, activated: 0,
      deactivating: 0, deactivated: 0, error: 0,
    };

    for (const state of this.states.values()) {
      byState[state] = (byState[state] || 0) + 1;
    }

    return { total: this.states.size, byState: byState as Record<PluginState, number> };
  }

  /**
   * 带重试的状态转换
   */
  private async transitionWithRetry(name: string, intermediate: PluginState, final: PluginState, action: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      if (!(await this.transition(name, intermediate))) {
        if (attempt < this.config.retryCount) continue;

        return false;
      }

      const timer = setTimeout(() => {
        this.states.set(name, 'error');
      }, this.config.timeout);

      try {
        await action();
        clearTimeout(timer);

        return await this.transition(name, final);
      } catch {
        clearTimeout(timer);
        this.states.set(name, 'error');
        this.emit('error', { name, intermediate, attempt });

        if (attempt < this.config.retryCount) {
          await this.transition(name, 'registered');
        }
      }
    }

    return false;
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const pluginLifecycleManager = new PluginLifecycleManager();
