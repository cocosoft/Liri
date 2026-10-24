/**
 * 容器作用域管理器
 * 管理 singleton/transient/request 三种作用域的服务实例生命周期
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ContainerConfig,
  DEFAULT_CONTAINER_CONFIG,
  type ServiceDescriptor,
  type ServiceScope,
  type CycleDetectionResult,
} from './types';
import { CycleDetector } from './CycleDetector';
import { DisposeManager } from './DisposeManager';
import { getLogger } from '../loggerFacade.js';
import { handleError } from '../errorHandler.js';
import { AppError, ErrorCategory, ErrorSeverity } from '../errors.js';

const logger = getLogger('DIContainer');

export class ContainerScope {
  private singletonInstances = new Map<string, unknown>();
  /**
   * 请求作用域实例表挂在 ALS 上（评审 #3：原「容器一份 Map + 全局布尔」在并发请求下互相清空）。
   */
  private readonly requestStorage = new AsyncLocalStorage<
    Map<string, unknown> | undefined
  >();

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
        handleError(error, {
          module: 'core:di:scope',
          action: 'instance_created_callback',
        });
      }
    }
  }

  /** 注册描述符。`onDispose` 仅 singleton 支持 ⇒ 其余作用域在**注册期**直接拒（评审 #4） */
  registerDescriptor<T>(descriptor: ServiceDescriptor<T>): void {
    if (descriptor.scope !== 'singleton' && descriptor.onDispose) {
      throw new AppError(
        `Service ${descriptor.id}: onDispose 仅支持 singleton 作用域（当前 ${descriptor.scope}）`,
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH,
        'DI_ONDISPOSE_REQUIRES_SINGLETON',
        { serviceId: descriptor.id, scope: descriptor.scope }
      );
    }
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
        // 评审 #3：实例表取自**当前异步上下文**的 Map；不在请求作用域内 ⇒ 退化为 transient
        const store = this.requestStorage.getStore();
        if (!store) return factory();
        if (!store.has(id)) {
          const instance = factory();
          store.set(id, instance);
          this.emitInstanceCreated(id, instance);
        }
        return store.get(id) as T;
      }
    }
  }

  /** 开始请求作用域：在当前异步上下文开一份独立实例表（评审 #3） */
  beginRequest(): void {
    this.requestStorage.enterWith(new Map<string, unknown>());
  }

  /** 结束请求作用域：解除当前上下文的作用域绑定 */
  endRequest(): void {
    this.requestStorage.enterWith(undefined);
  }

  /** 取（必要时按 `eager` 创建）钩子实例（评审 #8：钩子不再依赖「谁先被 resolve」） */
  private hookInstance(id: string, desc: ServiceDescriptor): unknown {
    const existing =
      this.singletonInstances.get(id) ?? this.requestStorage.getStore()?.get(id);
    if (existing) return existing;
    if (!desc.eager) {
      logger.debug('生命周期钩子跳过：服务未实例化且未声明 eager', {
        serviceId: id,
      });
      return undefined;
    }
    return this.resolve(id, desc.factory, desc.scope);
  }

  /**
   * 按拓扑序调用所有服务的 onLoad 钩子
   */
  async loadAll(): Promise<void> {
    const order = this.getTopologicalOrder();
    for (const id of order) {
      const desc = this.descriptors.get(id);
      if (!desc?.onLoad) continue;
      const instance = this.hookInstance(id, desc);
      if (!instance) continue;
      try {
        await desc.onLoad(instance);
      } catch (error) {
        await handleError(error, {
          module: 'core:di:scope',
          action: 'onLoad_hook',
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
      const instance = this.hookInstance(id, desc);
      if (!instance) continue;
      try {
        await desc.onReady(instance);
      } catch (error) {
        await handleError(error, {
          module: 'core:di:scope',
          action: 'onReady_hook',
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
    // 评审 #7：dispose 抛错时也必须清空实例表
    try {
      await this.disposeManager.disposeAll(order);
    } finally {
      this.singletonInstances.clear();
    }
  }

  /**
   * 检测循环依赖
   */
  detectCycles(): CycleDetectionResult {
    return this.cycleDetector.detect(this.descriptors);
  }

  /** 增量检测：只从 `startId` 出发找环（注册期用，见 CycleDetector.detectFrom） */
  detectCyclesFrom(startId: string): CycleDetectionResult {
    return this.cycleDetector.detectFrom(this.descriptors, startId);
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

  /** 移除服务（请求作用域实例随其异步上下文结束而失效，不在此清理 —— 评审 #3） */
  remove(id: string): void {
    this.descriptors.delete(id);
    this.singletonInstances.delete(id);
    this.disposeManager.unregister(id);
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.singletonInstances.clear();
    this.descriptors.clear();
    this.disposeManager.clear();
  }
}
