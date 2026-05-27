/**
 * 依赖注入容器
 *
 * 升级版 DI 容器，支持：
 * - 作用域管理（singleton / transient / request）
 * - 生命周期钩子（init / dispose）
 * - 循环依赖静态检测
 * - 自动装配（Phase 2: AutoWiringEngine）
 *
 * 使用方式（向后兼容）：
 *   const container = getDIContainer();
 *   container.register('service', () => new Service());  // 默认 singleton
 *   container.registerInstance('db', dbInstance);         // 注册实例
 *   const svc = container.resolve<Service>('service');   // 解析
 *
 * 新 API：
 *   container.registerDescriptor({
 *     id: 'service',
 *     factory: () => new Service(),
 *     scope: 'transient',
 *     dependencies: ['config'],
 *     onInit: async (svc) => { await svc.init(); },
 *     onDispose: async (svc) => { await svc.dispose(); },
 *   });
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

// ==================== 类型定义 ====================

export type ServiceScope = 'singleton' | 'transient' | 'request';

export interface ContainerConfig {
  defaultScope: ServiceScope;
  autoDispose: boolean;
  detectCycles: boolean;
}

export const DEFAULT_CONTAINER_CONFIG: ContainerConfig = {
  defaultScope: 'singleton',
  autoDispose: true,
  detectCycles: true,
};

export interface ServiceDescriptor<T = unknown> {
  id: string;
  factory: () => T;
  scope: ServiceScope;
  dependencies?: string[];
  onInit?: (instance: T) => Promise<void>;
  onDispose?: (instance: T) => Promise<void>;
}

export interface CycleDetectionResult {
  hasCycle: boolean;
  cycle?: string[];
}

// ==================== 循环依赖检测器 ====================

export class CycleDetector {
  detect(descriptors: Map<string, ServiceDescriptor>): CycleDetectionResult {
    const adjacency = new Map<string, string[]>();
    for (const [id, desc] of descriptors) {
      adjacency.set(id, desc.dependencies ?? []);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): boolean => {
      if (visiting.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          const cycle = [...path.slice(cycleStart), node];
          return true;
        }
        return false;
      }
      if (visited.has(node)) return false;

      visiting.add(node);
      path.push(node);

      const deps = adjacency.get(node) ?? [];
      for (const dep of deps) {
        if (dfs(dep)) return true;
      }

      visiting.delete(node);
      path.pop();
      visited.add(node);
      return false;
    };

    for (const id of descriptors.keys()) {
      if (!visited.has(id)) {
        if (dfs(id)) {
          return { hasCycle: true, cycle: [...path] };
        }
      }
    }

    return { hasCycle: false };
  }

  topologicalSort(descriptors: Map<string, ServiceDescriptor>): string[] {
    const adjacency = new Map<string, string[]>();
    for (const [id, desc] of descriptors) {
      adjacency.set(id, desc.dependencies ?? []);
    }

    const visited = new Set<string>();
    const result: string[] = [];

    const dfs = (node: string): void => {
      if (visited.has(node)) return;
      visited.add(node);
      const deps = adjacency.get(node) ?? [];
      for (const dep of deps) {
        dfs(dep);
      }
      result.push(node);
    };

    for (const id of descriptors.keys()) {
      dfs(id);
    }

    return result;
  }
}

// ==================== 容器作用域管理 ====================

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
   * 对标 OpenClaw container.onInstanceCreated：前端响应式订阅 DI 事件
   *
   * @param callback 回调函数，接收服务 ID 和实例
   */
  onInstanceCreated(callback: (id: string, instance: unknown) => void): void {
    this.onInstanceCreatedCallbacks.push(callback);
  }

  /**
   * 移除实例创建回调
   * @param callback 要移除的回调函数
   */
  offInstanceCreated(callback: (id: string, instance: unknown) => void): void {
    const idx = this.onInstanceCreatedCallbacks.indexOf(callback);
    if (idx !== -1) {
      this.onInstanceCreatedCallbacks.splice(idx, 1);
    }
  }

  /**
   * 触发实例创建事件
   * @param id 服务 ID
   * @param instance 已创建的实例
   */
  private emitInstanceCreated(id: string, instance: unknown): void {
    for (const callback of this.onInstanceCreatedCallbacks) {
      try {
        callback(id, instance);
      } catch (error) {
        console.error(`onInstanceCreated 回调执行失败: ${id}`, error);
      }
    }
  }

  registerDescriptor<T>(descriptor: ServiceDescriptor<T>): void {
    this.descriptors.set(descriptor.id, descriptor as ServiceDescriptor);
  }

  getDescriptor(id: string): ServiceDescriptor | undefined {
    return this.descriptors.get(id);
  }

  hasDescriptor(id: string): boolean {
    return this.descriptors.has(id);
  }

  getAllDescriptors(): ServiceDescriptor[] {
    return Array.from(this.descriptors.values());
  }

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

  beginRequest(): void {
    this.requestScopeActive = true;
    this.requestInstances.clear();
  }

  endRequest(): void {
    this.requestScopeActive = false;
    this.requestInstances.clear();
  }

  async disposeAll(): Promise<void> {
    const order = this.getTopologicalOrder();
    await this.disposeManager.disposeAll(order);
    this.singletonInstances.clear();
  }

  detectCycles(): CycleDetectionResult {
    return this.cycleDetector.detect(this.descriptors);
  }

  getTopologicalOrder(): string[] {
    return this.cycleDetector.topologicalSort(this.descriptors);
  }

  remove(id: string): void {
    this.descriptors.delete(id);
    this.singletonInstances.delete(id);
    this.requestInstances.delete(id);
    this.disposeManager.unregister(id);
  }

  clear(): void {
    this.singletonInstances.clear();
    this.requestInstances.clear();
    this.descriptors.clear();
    this.disposeManager.clear();
    this.requestScopeActive = false;
  }
}

// ==================== 自动装配引擎 ====================

export class AutoWiringEngine {
  getParameterNames<T>(target: new (...args: unknown[]) => T): string[] {
    const fnStr = target.toString();
    const parenOpen = fnStr.indexOf('(');
    const parenClose = fnStr.indexOf(')');
    if (parenOpen === -1 || parenClose === -1 || parenClose <= parenOpen + 1) {
      return [];
    }

    const params = fnStr.slice(parenOpen + 1, parenClose);
    return params
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  resolveConstructor<T>(
    target: new (...args: unknown[]) => T,
    container: DIContainer
  ): T {
    const paramNames = this.getParameterNames(target);
    const resolvedParams = paramNames.map((name) => {
      try {
        return container.resolve(name);
      } catch {
        throw new AppError(
          `AutoWiring: cannot resolve parameter "${name}" for ${target.name}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'DI_AUTOWIRE_FAILED',
          { targetName: target.name, parameterName: name }
        );
      }
    });
    return new target(...resolvedParams);
  }
}

// ==================== 生命周期管理器 ====================

export class DisposeManager {
  private disposeEntries = new Map<
    string,
    { onDispose: (instance: unknown) => Promise<void>; instance: unknown }
  >();

  register<T>(id: string, descriptor: ServiceDescriptor<T>, instance: T): void {
    if (descriptor.onDispose) {
      this.disposeEntries.set(id, {
        onDispose: descriptor.onDispose as (instance: unknown) => Promise<void>,
        instance,
      });
    }
  }

  unregister(id: string): void {
    this.disposeEntries.delete(id);
  }

  async dispose(id: string): Promise<void> {
    const entry = this.disposeEntries.get(id);
    if (!entry) return;

    try {
      await entry.onDispose(entry.instance);
    } finally {
      this.disposeEntries.delete(id);
    }
  }

  async disposeAll(order: string[]): Promise<void> {
    for (let i = order.length - 1; i >= 0; i--) {
      await this.dispose(order[i]);
    }
  }

  clear(): void {
    this.disposeEntries.clear();
  }
}

// ==================== DI 容器主类 ====================

export class DIContainer {
  private scopeManager: ContainerScope;
  private config: ContainerConfig;
  readonly autoWiring: AutoWiringEngine;

  constructor(config: ContainerConfig = DEFAULT_CONTAINER_CONFIG) {
    this.config = config;
    this.scopeManager = new ContainerScope(config);
    this.autoWiring = new AutoWiringEngine();
  }

  /**
   * 注册服务工厂（默认 singleton 作用域）
   * 向后兼容：与原 register API 一致
   */
  register<T>(name: string, factory: () => T): void {
    this.registerDescriptor<T>({
      id: name,
      factory,
      scope: this.config.defaultScope,
    });
  }

  /**
   * 注册服务实例（singleton 作用域）
   * 向后兼容：与原 registerInstance API 一致
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
   * 注册完整服务描述符
   */
  registerDescriptor<T>(descriptor: ServiceDescriptor<T>): void {
    if (this.config.detectCycles) {
      this.scopeManager.registerDescriptor(descriptor);
      const result = this.scopeManager.detectCycles();
      if (result.hasCycle) {
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
   */
  resolve<T>(name: string): T {
    const desc = this.scopeManager.getDescriptor(name);
    if (!desc) {
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
   * 解析服务并触发初始化钩子
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
   * 解析服务及其依赖
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
   * 检查服务是否存在
   */
  has(name: string): boolean {
    return this.scopeManager.hasDescriptor(name);
  }

  /**
   * 清除指定服务
   */
  clear(name: string): void {
    this.scopeManager.remove(name);
  }

  /**
   * 清除所有服务
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
   * 释放所有 singleton 服务
   */
  async disposeAll(): Promise<void> {
    await this.scopeManager.disposeAll();
  }

  /**
   * 获取所有已注册的服务描述符
   */
  getAllDescriptors(): ServiceDescriptor[] {
    return this.scopeManager.getAllDescriptors();
  }
}

// ==================== 全局单例管理 ====================

let container: DIContainer | null = null;

/**
 * 获取全局依赖注入容器实例
 */
export function getDIContainer(): DIContainer {
  if (!container) {
    container = new DIContainer();
  }
  return container;
}

/**
 * 重置全局容器（仅用于测试）
 */
export function resetDIContainer(): void {
  container = null;
}
