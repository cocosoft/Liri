/**
 * 容器作用域管理器
 * 管理 singleton/transient/request 三种作用域的服务实例生命周期
 */
import {
  type ContainerConfig,
  DEFAULT_CONTAINER_CONFIG,
  type ServiceDescriptor,
  type ServiceScope,
  type CycleDetectionResult,
} from './types';
import { CycleDetector } from './CycleDetector';
import { DisposeManager } from './DisposeManager';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('DIContainer');

export class ContainerScope {
  private singletonInstances = new Map<string, unknown>();
  private requestInstances = new Map<string, unknown>();
  private requestScopeActive = false;

  private descriptors = new Map<string, ServiceDescriptor>();
  private cycleDetector = new CycleDetector();
  private disposeManager = new DisposeManager();
  private config: ContainerConfig;

  /** 实例创建回调列表 */
  private onInstanceCreatedCallbacks: Array<
    (id: string, instance: unknown) => void
  > = [];

  constructor(config: ContainerConfig = DEFAULT_CONTAINER_CONFIG) {
    this.config = config;
  }

  /**
   * 注册实例创建回调
   */
  onInstanceCreated(callback: (id: string, instance: unknown) => void): void {
    this.onInstanceCreatedCallbacks.push(callback);
  }

  /**
   * 取消注册实例创建回调
   */
  offInstanceCreated(callback: (id: string, instance: unknown) => void): void {
    const idx = this.onInstanceCreatedCallbacks.indexOf(callback);
    if (idx !== -1) {
      this.onInstanceCreatedCallbacks.splice(idx, 1);
    }
  }

  private emitInstanceCreated(id: string, instance: unknown): void {
    for (const callback of this.onInstanceCreatedCallbacks) {
      try {
        callback(id, instance);
      } catch (error) {
        logger.error('onInstanceCreated 回调执行失败', {
          id,
          error: String(error),
        });
      }
    }
  }

  /**
   * 注册服务描述符
   */
  registerDescriptor<T>(descriptor: ServiceDescriptor<T>): void {
    this.descriptors.set(descriptor.id, descriptor as ServiceDescriptor);
  }

  /**
   * 获取服务描述符
   */
  getDescriptor(id: string): ServiceDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /**
   * 检查服务是否存在
   */
  hasDescriptor(id: string): boolean {
    return this.descriptors.has(id);
  }

  /**
   * 获取所有服务描述符
   */
  getAllDescriptors(): ServiceDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  /**
   * 解析服务实例
   */
  resolve<T>(id: string, factory: () => T, scope: ServiceScope): T {
    switch (scope) {
      case 'singleton': {
        if (!this.singletonInstances.has(id)) {
          const instance = factory();
          this.singletonInstances.set(id, instance);
          const desc = this.descriptors.get(id);
          if (desc) {
            this.disposeManager.register(id, desc, instance);
          }
          this.emitInstanceCreated(id, instance);
        }
        return this.singletonInstances.get(id) as T;
      }
      case 'transient':
        return factory();
      case 'request': {
        if (!this.requestScopeActive) {
          return factory();
        }
        if (!this.requestInstances.has(id)) {
          const instance = factory();
          this.requestInstances.set(id, instance);
          this.emitInstanceCreated(id, instance);
        }
        return this.requestInstances.get(id) as T;
      }
    }
  }

  /**
   * 开始请求作用域
   */
  beginRequest(): void {
    this.requestScopeActive = true;
    this.requestInstances.clear();
  }

  /**
   * 结束请求作用域
   */
  endRequest(): void {
    this.requestScopeActive = false;
    this.requestInstances.clear();
  }

  /**
   * 按拓扑序调用所有服务的 onLoad 钩子
   */
  async loadAll(): Promise<void> {
    const order = this.getTopologicalOrder();
    for (const id of order) {
      const desc = this.descriptors.get(id);
      if (!desc?.onLoad) continue;
      const instance =
        this.singletonInstances.get(id) ?? this.requestInstances.get(id);
      if (!instance) continue;
      try {
        await desc.onLoad(instance);
      } catch (error) {
        logger.error(`服务 onLoad 钩子执行失败: ${id}`, {
          error: String(error),
        });
        throw error;
      }
    }
  }

  /**
   * 按拓扑序调用所有服务的 onReady 钩子
   */
  async readyAll(): Promise<void> {
    const order = this.getTopologicalOrder();
    for (const id of order) {
      const desc = this.descriptors.get(id);
      if (!desc?.onReady) continue;
      const instance =
        this.singletonInstances.get(id) ?? this.requestInstances.get(id);
      if (!instance) continue;
      try {
        await desc.onReady(instance);
      } catch (error) {
        logger.error(`服务 onReady 钩子执行失败: ${id}`, {
          error: String(error),
        });
        throw error;
      }
    }
  }

  /**
   * 释放所有服务
   */
  async disposeAll(): Promise<void> {
    const order = this.getTopologicalOrder();
    await this.disposeManager.disposeAll(order);
    this.singletonInstances.clear();
  }

  /**
   * 检测循环依赖
   */
  detectCycles(): CycleDetectionResult {
    return this.cycleDetector.detect(this.descriptors);
  }

  /**
   * 获取拓扑排序
   */
  getTopologicalOrder(): string[] {
    return this.cycleDetector.topologicalSort(this.descriptors);
  }

  /**
   * 查找依赖指定服务的所有服务（反向依赖查询）
   * 对应 ModuleDependencyManager.getDependents()
   */
  getDependents(id: string): string[] {
    return this.cycleDetector.findDependents(this.descriptors, id);
  }

  /**
   * 获取指定服务的依赖列表（必选依赖）
   * 对应 ModuleDependencyManager.getDependencies()
   */
  getDependencies(id: string): string[] {
    const desc = this.descriptors.get(id);
    return desc?.dependencies ?? [];
  }

  /**
   * 检查指定服务是否为可选依赖
   * 对应 ModuleDependencyManager.isOptionalDependency()
   */
  isOptionalDependency(id: string): boolean {
    for (const [, desc] of this.descriptors) {
      const optDeps = desc.optionalDependencies ?? [];
      if (optDeps.includes(id)) return true;
    }
    return false;
  }

  /**
   * 移除服务
   */
  remove(id: string): void {
    this.descriptors.delete(id);
    this.singletonInstances.delete(id);
    this.requestInstances.delete(id);
    this.disposeManager.unregister(id);
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.singletonInstances.clear();
    this.requestInstances.clear();
    this.descriptors.clear();
    this.disposeManager.clear();
    this.requestScopeActive = false;
  }
}
