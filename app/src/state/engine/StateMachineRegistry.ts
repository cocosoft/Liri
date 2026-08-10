/**
 * StateMachineRegistry — 状态机实例注册中心
 *
 * 统一管理应用中长生命周期状态机实例的创建、查找、销毁。
 * 提供基于 lastAccessedAt 的空闲超时清理机制（gc）。
 *
 * === register / unregister 调用归属 ===
 * - SessionStateMachine：由 SessionManager 在创建会话时注册，会话销毁时注销
 * - AppStateMachine：应用启动时由依赖注入容器注册，应用关闭时注销
 *
 * === find 的类型安全 ===
 * find<S> 的泛型参数仅用于调用方便利，实际运行时不做类型校验。
 * 调用方应确保传入的 id 对应的确实是目标类型的状态机。
 * 这是一个已知的权衡：保持泛型签名可以在调用方减少断言代码。
 */

import { getLogger } from '@modules/monitoring';
import type { StateMachine } from './StateMachine';

const logger = getLogger('state:registry');

/**
 * 注册中心配置
 */
export interface RegistryConfig {
  /** 超过此数量的空闲实例将被清理（默认 100） */
  maxIdleInstances?: number;
  /** 实例空闲超时时间（毫秒，默认 30 分钟） */
  idleTimeout?: number;
}

/**
 * 注册条目
 *
 * 包装状态机实例及其生命周期元数据，供 gc 判断。
 */
export interface RegistryEntry {
  /** 状态机实例 */
  machine: StateMachine<string>;
  /** 创建时间戳 */
  createdAt: number;
  /** 上次查询时间（find() 命中时更新） */
  lastAccessedAt: number;
}

const DEFAULT_CONFIG: Required<RegistryConfig> = {
  maxIdleInstances: 100,
  idleTimeout: 30 * 60 * 1000, // 30 分钟
};

export class StateMachineRegistry {
  private static instance: StateMachineRegistry;
  private readonly entries: Map<string, RegistryEntry>;
  private readonly config: Required<RegistryConfig>;

  private constructor(config?: RegistryConfig) {
    this.entries = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取全局单例
   */
  static getInstance(config?: RegistryConfig): StateMachineRegistry {
    if (!StateMachineRegistry.instance) {
      StateMachineRegistry.instance = new StateMachineRegistry(config);
    }
    return StateMachineRegistry.instance;
  }

  /**
   * 注册一个状态机实例
   *
   * @param id - 唯一标识（如 sessionId）
   * @param machine - 状态机实例
   * @throws 当 id 已存在时抛出
   */
  register(id: string, machine: StateMachine<string>): void {
    if (this.entries.has(id)) {
      throw new Error(`状态机实例已存在: ${id}`);
    }

    const now = Date.now();
    this.entries.set(id, {
      machine,
      createdAt: now,
      lastAccessedAt: now,
    });

    logger.debug(`状态机已注册: ${id}`, { contextId: id });
  }

  /**
   * 根据 ID 查找状态机
   *
   * 命中时更新 lastAccessedAt，供 gc() 判断空闲超时。
   *
   * @param id - 状态机标识
   * @returns 状态机实例，未找到时返回 undefined
   */
  find<S extends string>(id: string): StateMachine<S> | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    entry.lastAccessedAt = Date.now();

    // 类型断言：调用方应确保 id 对应的确实是目标类型的状态机
    return entry.machine as unknown as StateMachine<S>;
  }

  /**
   * 获取注册的状态机数量
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * 注销并销毁一个状态机实例
   *
   * 从注册表中移除，并清理监听器以防止内存泄漏。
   */
  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    // 清理监听器
    entry.machine.removeAllListeners();
    this.entries.delete(id);

    logger.debug(`状态机已注销: ${id}`, { contextId: id });
  }

  /**
   * 清理所有空闲超时的状态机
   *
   * 遍历所有条目，将 lastAccessedAt 超过 idleTimeout 的实例注销。
   * 建议由定时任务定期调用（如每 5 分钟）。
   *
   * @returns 本次清理的实例数量
   */
  gc(): number {
    const now = Date.now();
    const staleIds: string[] = [];

    for (const [id, entry] of this.entries) {
      const idleTime = now - entry.lastAccessedAt;
      if (idleTime > this.config.idleTimeout) {
        staleIds.push(id);
      }
    }

    for (const id of staleIds) {
      this.unregister(id);
    }

    if (staleIds.length > 0) {
      logger.debug(`GC 清理了 ${staleIds.length} 个空闲状态机`, {
        ids: staleIds,
      });
    }

    return staleIds.length;
  }

  /**
   * 获取所有活跃的实例 ID 列表
   */
  listActive(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * 重置注册中心（仅用于测试）
   */
  static reset(): void {
    StateMachineRegistry.instance =
      undefined as unknown as StateMachineRegistry;
  }
}
