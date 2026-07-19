/**
 * HostHooks 主机级钩子管理器
 * 对标 OpenClaw 的 host-hooks/，管理宿主环境级别的钩子
 */
import { EventEmitter } from 'events';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:hooks:HostHooks',
  level: LogLevel.INFO,
});

/**
 * 主机钩子类型
 */
export type HostHookType =
  | 'host:startup'
  | 'host:shutdown'
  | 'host:beforeRequest'
  | 'host:afterResponse'
  | 'host:error'
  | 'host:configChange'
  | 'host:healthCheck'
  | 'host:beforePluginLoad'
  | 'host:afterPluginLoad'
  | 'host:beforePluginUnload'
  | 'host:afterPluginUnload';

/**
 * 主机钩子上下文
 */
export interface HostHookContext {
  type: HostHookType;
  timestamp: number;
  hostVersion?: string;
  data?: Record<string, unknown>;
}

/**
 * 主机钩子函数
 */
export type HostHookFunction = (
  context: HostHookContext
) => Promise<HostHookResult> | HostHookResult;

/**
 * 主机钩子结果
 */
export interface HostHookResult {
  continue: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * 主机钩子注册信息
 */
export interface HostHookRegistration {
  id: string;
  type: HostHookType;
  name: string;
  priority: number;
  fn: HostHookFunction;
  description?: string;
  singleton: boolean;
}

/**
 * 主机钩子管理器
 */
export class HostHooks extends EventEmitter {
  private hooks: Map<HostHookType, HostHookRegistration[]> = new Map();
  private counter: number = 0;
  private hostVersion: string = '1.0.0';

  /**
   * 设置主机版本
   */
  setHostVersion(version: string): void {
    this.hostVersion = version;
  }

  /**
   * 注册主机钩子
   */
  register(
    type: HostHookType,
    name: string,
    fn: HostHookFunction,
    options?: { priority?: number; description?: string; singleton?: boolean }
  ): string {
    const id = `host_hook_${++this.counter}`;
    const registration: HostHookRegistration = {
      id,
      type,
      name,
      priority: options?.priority ?? 100,
      fn,
      description: options?.description,
      singleton: options?.singleton ?? false,
    };

    const existing = this.hooks.get(type) || [];

    if (registration.singleton && existing.some((h) => h.name === name)) {
      return existing.find((h) => h.name === name)!.id;
    }

    existing.push(registration);
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(type, existing);

    return id;
  }

  /**
   * 注销钩子
   */
  unregister(id: string): boolean {
    for (const [type, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex((h) => h.id === id);

      if (index !== -1) {
        hooks.splice(index, 1);

        if (hooks.length === 0) {
          this.hooks.delete(type);
        }

        return true;
      }
    }

    return false;
  }

  /**
   * 执行主机钩子
   */
  async execute(
    type: HostHookType,
    data?: Record<string, unknown>
  ): Promise<HostHookResult[]> {
    const hooks = this.hooks.get(type);

    if (!hooks || hooks.length === 0) {
      return [{ continue: true }];
    }

    const results: HostHookResult[] = [];

    this.emit('host:hook:before', { type, timestamp: Date.now() });

    for (const hook of hooks) {
      const context: HostHookContext = {
        type,
        timestamp: Date.now(),
        hostVersion: this.hostVersion,
        data,
      };

      try {
        const result = await hook.fn(context);

        results.push(result);

        if (!result.continue) {
          break;
        }
      } catch (err) {
        results.push({
          continue: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.emit('host:hook:after', { type, timestamp: Date.now(), results });

    return results;
  }

  /**
   * 一次性注册多个主机钩子
   */
  registerMany(
    registrations: Array<{
      type: HostHookType;
      name: string;
      fn: HostHookFunction;
      options?: {
        priority?: number;
        description?: string;
        singleton?: boolean;
      };
    }>
  ): string[] {
    return registrations.map((r) =>
      this.register(r.type, r.name, r.fn, r.options)
    );
  }

  /**
   * 获取指定类型的钩子
   */
  getHooks(type?: HostHookType): HostHookRegistration[] {
    if (type) {
      return this.hooks.get(type) || [];
    }

    const all: HostHookRegistration[] = [];

    for (const hooks of this.hooks.values()) {
      all.push(...hooks);
    }

    return all;
  }

  /**
   * 清除所有主机钩子
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    let total = 0;

    for (const [type, hooks] of this.hooks.entries()) {
      byType[type] = hooks.length;
      total += hooks.length;
    }

    return { total, byType };
  }
}

export const hostHooks = new HostHooks();
