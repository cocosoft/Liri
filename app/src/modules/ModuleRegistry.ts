/**
 * 模块注册表
 * 统一管理所有模块的注册、查找和依赖解析
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  ModuleCategory,
  type ModuleDefinition,
  initRegistry,
} from './moduleTypes';

const logger = new Logger({ level: LogLevel.INFO });

export { ModuleCategory, type ModuleDefinition };

/**
 * DI 容器最小接口
 * 定义 ModuleRegistry 对 DIContainer 的依赖契约，避免与 core/ 的循环依赖。
 * DIContainer 类隐式满足此接口（duck typing）。
 */
interface DIContainerLike {
  resolve<T>(name: string): T;
  registerInstance<T>(name: string, instance: T): void;
  setResolveFallback(fn: (name: string) => unknown | undefined): void;
}

/**
 * 模块注册表类
 *
 * @deprecated 模块管理已统一到 DIContainer。
 *   外部代码应使用 getDIContainer() 替代直接操作 ModuleRegistry。
 *   ModuleRegistry 内部仍被 DIContainer.bootstrap() 使用作为实现细节，
 *   但外部导入方应迁移到 DIContainer API。
 *   后续版本将把 ModuleRegistry 改为 DIContainer 的内部模块，不再作为公共 API 导出。
 */
export class ModuleRegistry {
  private static instance: ModuleRegistry;
  private modules: Map<string, ModuleDefinition> = new Map();
  private initializedModules: Set<string> = new Set();
  private container: DIContainerLike | null = null;

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
   * 将所有已注册模块同步到容器中，后续注册的模块也会自动注册到容器。
   * 同时设置回退解析器，使 DIContainer 可通过 ModuleRegistry 查找模块实例。
   */
  public useContainer(diContainer: DIContainerLike): void {
    this.container = diContainer;

    // 双向桥接：DIContainer → ModuleRegistry
    // 当 DIContainer.resolve() 找不到服务时，回退到 ModuleRegistry 查找模块实例
    diContainer.setResolveFallback((name: string) => {
      const module = this.modules.get(name);
      return module?.instance;
    });

    // 将已有模块同步到 DI 容器
    for (const module of this.modules.values()) {
      this.registerWithContainer(module);
    }
  }

  /**
   * 将模块实例注册到 DI 容器
   * 仅注册有实际实例（module.instance）的模块，避免污染 DI 容器。
   * 无实例的纯元数据模块通过 resolveFallback 回退查找。
   */
  private registerWithContainer(module: ModuleDefinition): void {
    if (!this.container || !module.instance) return;

    try {
      this.container.registerInstance(module.id, module.instance);
    } catch (e) {
      logger.warn('模块实例注册到 DI 容器失败，跳过', {
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
    const byCategory = {} as Record<ModuleCategory, number>;

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
   *   import { getDIContainer } from '@modules/core/DIContainer';
   *   await moduleRegistry.bootstrap(getDIContainer(), { mode: 'repl' });
   *
   * 为避免循环依赖，容器实例通过参数传入而非顶层导入获取。
   * DIContainer.bootstrap() 内部调用此方法时传递自身引用。
   *
   * @param container - DI 容器实例
   * @param options - 启动选项（模式、调试标志等）
   */
  public async bootstrap(
    container: DIContainerLike,
    options?: BootstrapOptions
  ): Promise<void> {
    initRegistry(this);
    const moduleInitializerModule = await import('./ModuleInitializer');
    moduleInitializerModule.moduleInitializer.registerAllModules();

    this.useContainer(container);

    // 初始化环境（startup.yaml → 配置系统 → 数据目录 → 优雅关闭）
    // 此步骤在模块初始化之前执行，确保配置系统就绪
    if (options?.skipEnvInit !== true) {
      await this.initializeEnvironment();
    }

    // 初始化必需模块（CRITICAL 优先级）
    await moduleInitializerModule.moduleInitializer.initializeEssentialModules();

    // 在后台调度延迟模块的异步加载
    moduleInitializerModule.moduleInitializer.scheduleDeferredModules();
  }

  /**
   * 初始化运行环境
   *
   * 封装了 entrypoints/init.ts:init() 的环境初始化逻辑：
   * - startup.yaml 加载
   * - 配置系统启用
   * - 数据目录确保
   * - 优雅关闭注册
   *
   * init.ts 中的工具/插件/命令/监控/模型管理/Gateway 等模块级
   * 初始化由各模块的 initialize() 生命周期管理，不属于环境初始化范畴。
   */
  private async initializeEnvironment(): Promise<void> {
    try {
      const { init } = await import('../entrypoints/init');
      await init();
    } catch (error) {
      logger.warning('环境初始化失败（非致命）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * 启动选项
 * 传递给 ModuleRegistry.bootstrap() 的统一启动配置
 */
export interface BootstrapOptions {
  /** 启动模式 */
  mode?: 'cli' | 'repl' | 'mcp' | 'daemon' | 'test';
  /** 调试模式 */
  debug?: boolean;
  /** 详细输出 */
  verbose?: boolean;
  /** 命令行参数 */
  args?: string[];
  /** 跳过环境初始化（用于测试） */
  skipEnvInit?: boolean;
}

/**
 * 全局模块注册表实例
 *
 * @deprecated 使用 getDIContainer() 替代。
 *   DIContainer.bootstrap() 内部会处理 ModuleRegistry，外部无需直接引用。
 */
export const moduleRegistry = ModuleRegistry.getInstance();
