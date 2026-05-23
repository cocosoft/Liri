/**
 * 模块注册表
 * 统一管理所有模块的注册、查找和依赖解析
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  getDIContainer,
  type DIContainer,
  type ServiceDescriptor,
} from '@modules/core/DIContainer';

const logger = new Logger({ level: LogLevel.INFO });

export enum ModuleCategory {
  // 核心模块
  CORE = 'core',
  INFRASTRUCTURE = 'infrastructure',

  // 功能模块
  AI = 'ai',
  AGENT = 'agent',
  BRIDGE = 'bridge',

  // 界面模块
  UI = 'ui',
  CLI = 'cli',

  // 工具模块
  TOOLS = 'tools',
  COMMANDS = 'commands',

  // 数据模块
  MEMORY = 'memory',
  CACHE = 'cache',

  // 系统模块
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  MONITORING = 'monitoring',

  // 其他模块
  OTHER = 'other',
}

/**
 * 模块定义接口
 */
export interface ModuleDefinition {
  // 基本信息
  id: string;
  name: string;
  displayName: string;
  version: string;

  // 功能信息
  category: ModuleCategory;
  description: string;

  // 依赖信息
  dependencies: string[];
  optionalDependencies: string[];

  // 配置信息
  configSchema?: object;

  // 生命周期
  initialize?: () => Promise<void>;
  destroy?: () => Promise<void>;

  // 模块实例
  instance?: any;
}

/**
 * 模块注册表类
 */
export class ModuleRegistry {
  private static instance: ModuleRegistry;
  private modules: Map<string, ModuleDefinition> = new Map();
  private initializedModules: Set<string> = new Set();
  private container: DIContainer | null = null;

  /**
   * 获取单例实例
   */
  public static getInstance(): ModuleRegistry {
    if (!ModuleRegistry.instance) {
      ModuleRegistry.instance = new ModuleRegistry();
    }
    return ModuleRegistry.instance;
  }

  /**
   * 绑定 DI 容器
   * 将所有已注册模块同步到容器中，后续注册的模块也会自动注册到容器
   */
  public useContainer(diContainer: DIContainer): void {
    this.container = diContainer;
    for (const module of this.modules.values()) {
      this.registerWithContainer(module);
    }
  }

  /**
   * 将模块注册到 DI 容器
   */
  private registerWithContainer(module: ModuleDefinition): void {
    if (!this.container) return;

    const descriptor: ServiceDescriptor = {
      id: module.id,
      factory: () => {
        if (module.instance) return module.instance;
        return module;
      },
      scope: 'singleton',
      dependencies: module.dependencies,
    };

    try {
      this.container.registerDescriptor(descriptor);
    } catch (e) {
      logger.warn('模块已注册到 DI 容器，跳过重复注册', {
        moduleId: module.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * 注册模块
   */
  public register(module: ModuleDefinition): void {
    if (this.modules.has(module.id)) {
      throw new AppError(
        ErrorCodes.INTERNAL.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_ALREADY_EXISTS',
        { moduleId: module.id }
      );
    }

    this.modules.set(module.id, module);
    this.registerWithContainer(module);
  }

  /**
   * 查找模块
   */
  public find(id: string): ModuleDefinition | undefined {
    return this.modules.get(id);
  }

  /**
   * 获取所有模块
   */
  public getAllModules(): ModuleDefinition[] {
    return Array.from(this.modules.values());
  }

  /**
   * 按分类获取模块
   */
  public getModulesByCategory(category: ModuleCategory): ModuleDefinition[] {
    return this.getAllModules().filter(
      (module) => module.category === category
    );
  }

  /**
   * 解析模块依赖
   */
  public resolveDependencies(moduleId: string): ModuleDefinition[] {
    const module = this.find(moduleId);
    if (!module) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_NOT_FOUND',
        { moduleId }
      );
    }

    const dependencies: ModuleDefinition[] = [];
    const visited = new Set<string>();

    const resolve = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const depModule = this.find(id);
      if (!depModule) {
        throw new AppError(
          ErrorCodes.ENTITY_NOT_FOUND.message,
          ErrorCategory.VALIDATION,
          ErrorSeverity.MEDIUM,
          'DEP_MODULE_NOT_FOUND',
          { moduleId: id }
        );
      }

      // 递归解析依赖
      depModule.dependencies.forEach((depId) => resolve(depId));

      dependencies.push(depModule);
    };

    module.dependencies.forEach((depId) => resolve(depId));

    return dependencies;
  }

  /**
   * 初始化模块
   */
  public async initialize(moduleId: string): Promise<void> {
    if (this.initializedModules.has(moduleId)) {
      return; // 已经初始化
    }

    const module = this.find(moduleId);
    if (!module) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_NOT_FOUND',
        { moduleId }
      );
    }

    // 先初始化依赖模块
    const dependencies = this.resolveDependencies(moduleId);
    for (const dep of dependencies) {
      await this.initialize(dep.id);
    }

    // 初始化当前模块
    if (module.initialize) {
      await module.initialize();
    }

    this.initializedModules.add(moduleId);
  }

  /**
   * 从 DI 容器解析模块实例
   * 如果容器已绑定，优先使用容器解析；否则返回 module.instance
   */
  public resolveModule<T = unknown>(moduleId: string): T | undefined {
    if (this.container) {
      try {
        return this.container.resolve<T>(moduleId);
      } catch {
        return undefined;
      }
    }

    const module = this.find(moduleId);
    return module?.instance as T | undefined;
  }

  /**
   * 销毁模块
   */
  public async destroy(moduleId: string): Promise<void> {
    const module = this.find(moduleId);
    if (!module) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_NOT_FOUND',
        { moduleId }
      );
    }

    if (module.destroy) {
      logger.info(`销毁模块: ${module.displayName}`);
      await module.destroy();
    }

    this.initializedModules.delete(moduleId);
  }

  /**
   * 获取模块统计信息
   */
  public getStatistics(): {
    total: number;
    initialized: number;
    byCategory: Record<ModuleCategory, number>;
  } {
    const modules = this.getAllModules();
    const byCategory: Record<ModuleCategory, number> = {} as any;

    // 初始化分类统计
    Object.values(ModuleCategory).forEach((category) => {
      byCategory[category as ModuleCategory] = 0;
    });

    modules.forEach((module) => {
      byCategory[module.category]++;
    });

    return {
      total: modules.length,
      initialized: this.initializedModules.size,
      byCategory,
    };
  }

  /**
   * 启动模块系统（统一入口）
   *
   * 封装完整的模块系统启动流程：
   * 1. 注册所有模块到注册表
   * 2. 初始化必需模块（CRITICAL 优先级）
   * 3. 在后台调度延迟模块的异步加载
   *
   * 使用方式（main.ts 入口处）：
   *
   *   import { moduleRegistry } from './modules/ModuleRegistry';
   *   await moduleRegistry.bootstrap();
   *
   * 该方法是整个模块系统的唯一推荐入口，替代直接调用
   * ModuleInitializer.registerAllModules / initializeEssentialModules / scheduleDeferredModules。
   */
  public async bootstrap(): Promise<void> {
    const moduleInitializerModule = await import('./ModuleInitializer');
    moduleInitializerModule.moduleInitializer.registerAllModules();

    this.useContainer(getDIContainer());

    await moduleInitializerModule.moduleInitializer.initializeEssentialModules();
    moduleInitializerModule.moduleInitializer.scheduleDeferredModules();
  }
}

/**
 * 全局模块注册表实例
 */
export const moduleRegistry = ModuleRegistry.getInstance();
