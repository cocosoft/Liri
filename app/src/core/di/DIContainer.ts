/**
 * 依赖注入容器
 * 支持 singleton/transient/request 三种作用域、循环依赖检测、自动装配、
 * 生命周期钩子、ModuleRegistry 回退解析、统一启动入口等特性
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import {
  type ContainerConfig,
  DEFAULT_CONTAINER_CONFIG,
  type ServiceDescriptor,
  type CycleDetectionResult,
  type BootstrapOptions,
} from './types';
import { ContainerScope } from './ContainerScope';

const logger = getLogger('DIContainer');

export class DIContainer {
  private scopeManager: ContainerScope;
  private config: ContainerConfig;
  /** ModuleRegistry 回退解析器：当本容器找不到服务时回调 */
  private resolveFallback?: (name: string) => unknown | undefined;

  constructor(config: ContainerConfig = DEFAULT_CONTAINER_CONFIG) {
    this.config = config;
    this.scopeManager = new ContainerScope(config);
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
   * 检查服务描述符是否存在（兼容旧版 API）
   */
  hasDescriptor(id: string): boolean {
    return this.scopeManager.hasDescriptor(id);
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
   * 按拓扑序调用所有服务的 onLoad 钩子
   */
  async loadAll(): Promise<void> {
    await this.scopeManager.loadAll();
  }

  /**
   * 按拓扑序调用所有服务的 onReady 钩子
   */
  async readyAll(): Promise<void> {
    await this.scopeManager.readyAll();
  }

  /**
   * 查找依赖指定服务（ID）的所有服务（反向依赖查询）
   * 对应 ModuleDependencyManager.getDependents()
   */
  getDependents(id: string): string[] {
    return this.scopeManager.getDependents(id);
  }

  /**
   * 获取指定服务的必选依赖列表
   * 对应 ModuleDependencyManager.getDependencies()
   */
  getDependencies(id: string): string[] {
    return this.scopeManager.getDependencies(id);
  }

  /**
   * 检查指定服务是否为某个已注册服务的可选依赖
   * 对应 ModuleDependencyManager.isOptionalDependency()
   */
  isOptionalDependency(id: string): boolean {
    return this.scopeManager.isOptionalDependency(id);
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

  /**
   * 启动容器（统一入口）
   *
   * 封装完整的启动流程，委托给 ModuleRegistry 的 bootstrap 实现：
   * 1. 注册所有模块到容器
   * 2. 初始化必需模块（CRITICAL 优先级）
   * 3. 在后台调度延迟模块的异步加载
   *
   * 替代直接调用 ModuleRegistry.bootstrap()，
   * 使 DIContainer 成为启动入口。
   * ModuleRegistry 保留作为元数据查询层。
   *
   * 使用方式（main.ts 入口处）：
   *
   *   import { getDIContainer } from '@modules/core';
   *   import { moduleRegistry } from '@modules/modules/ModuleRegistry';
   *   await getDIContainer().bootstrap(moduleRegistry, { mode: 'repl' });
   *
   * 注：ModuleRegistry 由调用方传入而非动态导入，
   * 以避免 madge 静态分析将动态 import 计入循环依赖。
   *
   * @param moduleRegistry - 模块注册表实例（由调用方传入，避免循环依赖）
   * @param options - 启动选项
   */
  async bootstrap(
    moduleRegistry?: {
      bootstrap: (
        container: DIContainer,
        options?: BootstrapOptions
      ) => Promise<void>;
    },
    options?: BootstrapOptions
  ): Promise<void> {
    const startTime = performance.now();

    try {
      logger.info('DIContainer: 启动容器...');

      if (moduleRegistry) {
        await moduleRegistry.bootstrap(this, {
          mode: options?.mode ?? 'repl',
          args: options?.args,
          debug: options?.debug,
          verbose: options?.verbose,
          skipEnvInit: options?.skipEnvInit,
        });
      }

      // 注册 Logger SPI 实现（容器就绪后）
      try {
        const { registerLoggerSpi } = await import('../spi/LoggerService');
        await registerLoggerSpi(this);
      } catch (spiError) {
        logger.warn('Logger SPI 注册失败（非致命，使用回退路径）', {
          error: spiError instanceof Error ? spiError.message : String(spiError),
        });
      }

      // 完成 ModuleRegistry 注册后，执行 onLoad → onReady 生命周期
      await this.loadAll();
      await this.readyAll();

      const duration = performance.now() - startTime;
      logger.info(`DIContainer: 容器启动完成 (${duration.toFixed(0)}ms)`);
    } catch (error) {
      logger.error('DIContainer: 容器启动失败', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
