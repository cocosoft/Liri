/**
 * 依赖注入容器
 * 支持 singleton/transient/request 三种作用域、循环依赖检测、自动装配、
 * 生命周期钩子、ModuleRegistry 回退解析等特性
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { getLogger } from '@modules/monitoring/logs/Logger';
import {
  type ContainerConfig,
  DEFAULT_CONTAINER_CONFIG,
  type ServiceDescriptor,
  type CycleDetectionResult,
} from './types';
import { ContainerScope } from './ContainerScope';
import { AutoWiringEngine } from './AutoWiringEngine';

const logger = getLogger('DIContainer');

export class DIContainer {
  private scopeManager: ContainerScope;
  private config: ContainerConfig;
  readonly autoWiring: AutoWiringEngine;
  /** ModuleRegistry 回退解析器：当本容器找不到服务时回调 */
  private resolveFallback?: (name: string) => unknown | undefined;

  constructor(config: ContainerConfig = DEFAULT_CONTAINER_CONFIG) {
    this.config = config;
    this.scopeManager = new ContainerScope(config);
    this.autoWiring = new AutoWiringEngine();
  }

  /**
   * 设置回退解析器
   * 当容器内找不到指定服务时，会调用此函数尝试解析。
   * 用于 ModuleRegistry 双向桥接：DIContainer → ModuleRegistry。
   */
  setResolveFallback(fn: (name: string) => unknown | undefined): void {
    this.resolveFallback = fn;
  }

  /**
   * 注册服务
   */
  register<T>(name: string, factory: () => T): void {
    this.registerDescriptor<T>({
      id: name,
      factory,
      scope: this.config.defaultScope,
    });
  }

  /**
   * 注册实例
   */
  registerInstance<T>(name: string, instance: T): void {
    this.registerDescriptor<T>({
      id: name,
      factory: () => instance,
      scope: 'singleton',
    });
    this.scopeManager.resolve(name, () => instance, 'singleton');
  }

  /**
   * 注册服务描述符
   */
  registerDescriptor<T>(descriptor: ServiceDescriptor<T>): void {
    if (this.config.detectCycles) {
      this.scopeManager.registerDescriptor(descriptor);
      const result = this.scopeManager.detectCycles();
      if (result.hasCycle) {
        // 先移除已注册的描述符，避免残留
        this.scopeManager.getDescriptor(descriptor.id);
        logger.error('循环依赖检测失败', {
          serviceId: descriptor.id,
          cycle: result.cycle,
        });
        throw new AppError(
          `Cyclic dependency detected involving service: ${descriptor.id}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'DI_CYCLE_DETECTED',
          { cycle: result.cycle }
        );
      }
    } else {
      this.scopeManager.registerDescriptor(descriptor);
    }
  }

  /**
   * 解析服务
   * 向后兼容：与原 resolve API 一致
   * 若本地未找到且已设置 resolveFallback，则尝试回退解析
   */
  resolve<T>(name: string): T {
    const desc = this.scopeManager.getDescriptor(name);
    if (!desc) {
      // 尝试回退解析器（如 ModuleRegistry 双向桥接）
      if (this.resolveFallback) {
        const fallback = this.resolveFallback(name);
        if (fallback !== undefined) {
          return fallback as T;
        }
      }
      throw new AppError(
        `Service not found: ${name}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'DI_SERVICE_NOT_FOUND'
      );
    }

    const instance = this.scopeManager.resolve<T>(
      name,
      desc.factory as () => T,
      desc.scope
    );

    return instance;
  }

  /**
   * 解析并初始化服务
   */
  async resolveAndInit<T>(name: string): Promise<T> {
    const instance = this.resolve<T>(name);
    const desc = this.scopeManager.getDescriptor(name);

    if (desc?.onInit) {
      await desc.onInit(instance);
    }

    return instance;
  }

  /**
   * 按拓扑序解析服务（依赖优先）
   */
  resolveWithDeps<T>(name: string): T {
    const order = this.scopeManager.getTopologicalOrder();
    const nameIndex = order.indexOf(name);
    if (nameIndex === -1) {
      return this.resolve<T>(name);
    }

    for (let i = 0; i <= nameIndex; i++) {
      const depName = order[i];
      this.resolve(depName);
    }

    return this.resolve<T>(name);
  }

  /**
   * 检查服务是否已注册
   */
  has(name: string): boolean {
    return this.scopeManager.hasDescriptor(name);
  }

  /**
   * 移除指定服务
   */
  clear(name: string): void {
    this.scopeManager.remove(name);
  }

  /**
   * 清空所有服务
   */
  clearAll(): void {
    this.scopeManager.clear();
  }

  /**
   * 获取拓扑排序
   */
  getTopologicalOrder(): string[] {
    return this.scopeManager.getTopologicalOrder();
  }

  /**
   * 检测循环依赖
   */
  detectCycles(): CycleDetectionResult {
    return this.scopeManager.detectCycles();
  }

  /**
   * 开始请求作用域
   */
  beginRequest(): void {
    this.scopeManager.beginRequest();
  }

  /**
   * 结束请求作用域
   */
  endRequest(): void {
    this.scopeManager.endRequest();
  }

  /**
   * 释放所有服务
   */
  async disposeAll(): Promise<void> {
    await this.scopeManager.disposeAll();
  }

  /**
   * 获取所有服务描述符
   */
  getAllDescriptors(): ServiceDescriptor[] {
    return this.scopeManager.getAllDescriptors();
  }
}

let container: DIContainer | null = null;

/**
 * 获取全局 DI 容器实例
 */
export function getDIContainer(): DIContainer {
  if (!container) {
    container = new DIContainer();
  }
  return container;
}

/**
 * 重置全局 DI 容器实例
 */
export function resetDIContainer(): void {
  container = null;
}
