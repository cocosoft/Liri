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
import { getLogger } from '@modules/monitoring/logs/Logger';

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
