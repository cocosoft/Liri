/**
 * 模块初始化器
 * 统一管理模块的注册、初始化和生命周期
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { type ModuleDefinition, getRegistry } from './moduleTypes';
import {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
  validateModuleDependencies,
} from './ModuleDefinitions';
import {
  getEssentialModuleIds,
  getDeferredModuleIds,
  getOnDemandModuleIds,
  deferredLoader,
  requestModule,
  isModuleOnDemand,
  DeferredLoadState,
} from './LazyModuleStrategy';
import {
  profilePhaseStart,
  profilePhaseEnd,
} from '../performance/StartupProfiler';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'modules:moduleInitializer',
  level: LogLevel.INFO,
});

/**
 * 模块初始化状态
 */
interface ModuleInitializationState {
  // 模块初始化状态
  status: 'pending' | 'initializing' | 'initialized' | 'error';

  // 初始化开始时间
  startTime?: number;

  // 初始化结束时间
  endTime?: number;

  // 错误信息
  error?: Error;
}

/**
 * 模块初始化器类
 */
export class ModuleInitializer {
  private static instance: ModuleInitializer;
  private initializationStates: Map<string, ModuleInitializationState> =
    new Map();
  private initializationPromise?: Promise<void>;

  /**
   * 获取单例实例
   */
  public static getInstance(): ModuleInitializer {
    if (!ModuleInitializer.instance) {
      ModuleInitializer.instance = new ModuleInitializer();
    }
    return ModuleInitializer.instance;
  }

  /**
   * 注册所有模块
   */
  public registerAllModules(): void {
    logger.info('开始注册所有模块...');

    // 验证模块依赖关系
    const validation = validateModuleDependencies();
    if (!validation.valid) {
      logger.error('模块依赖关系验证失败:', { errors: validation.errors });
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'MODULE_DEP_VALIDATION_FAILED',
        { errors: validation.errors }
      );
    }

    // 注册所有模块
    for (const definition of Object.values(MODULE_DEFINITIONS)) {
      try {
        getRegistry().register(definition);
        this.initializationStates.set(definition.id, { status: 'pending' });
      } catch (error) {
        logger.error(`注册模块失败: ${definition.id}`, { error });
        throw error;
      }
    }

    logger.info(
      `模块注册完成，共注册 ${Object.keys(MODULE_DEFINITIONS).length} 个模块`
    );
  }

  /**
   * 初始化所有模块
   */
  public async initializeAllModules(): Promise<void> {
    // 如果已经在初始化，返回同一个Promise
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initializeAllModules();
    return this.initializationPromise;
  }

  /**
   * 实际初始化方法
   */
  private async _initializeAllModules(): Promise<void> {
    logger.info('开始初始化所有模块...');
    const startTime = Date.now();

    try {
      // 按拓扑顺序初始化模块
      for (const moduleId of MODULE_INITIALIZATION_ORDER) {
        await this.initializeModule(moduleId);
      }

      const duration = Date.now() - startTime;
      logger.info(`所有模块初始化完成，耗时 ${duration}ms`);

      // 打印初始化统计信息
      this.printInitializationStats();
    } catch (error) {
      logger.error('模块初始化失败:', { error });
      throw error;
    }
  }

  /**
   * 初始化单个模块
   */
  public async initializeModule(moduleId: string): Promise<void> {
    const state = this.initializationStates.get(moduleId);
    if (!state) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_NOT_REGISTERED',
        { moduleId }
      );
    }

    // 如果已经初始化或正在初始化，直接返回
    if (state.status === 'initialized') {
      return;
    }
    if (state.status === 'initializing') {
      // 等待初始化完成
      while (state.status === 'initializing') {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return;
    }

    // 设置初始化状态
    state.status = 'initializing';
    state.startTime = Date.now();

    try {
      logger.info(`初始化模块: ${moduleId}`);

      // 使用模块注册表的初始化方法
      await getRegistry().initialize(moduleId);

      // 模块初始化后置钩子：session 模块初始化后注册 CombinedSessionGateway
      if (moduleId === 'session') {
        await this._registerCombinedGateway();
      }

      // 更新状态
      state.status = 'initialized';
      state.endTime = Date.now();

      const duration = state.endTime - state.startTime;
      logger.info(`模块初始化完成: ${moduleId} (${duration}ms)`);
    } catch (error) {
      // 更新错误状态
      state.status = 'error';
      state.error = error as Error;
      state.endTime = Date.now();

      logger.error(`模块初始化失败: ${moduleId}`, { error });
      throw error;
    }
  }

  /**
   * 销毁所有模块
   */
  public async destroyAllModules(): Promise<void> {
    logger.info('开始销毁所有模块...');
    const startTime = Date.now();

    try {
      // 按逆序销毁模块
      const reverseOrder = [...MODULE_INITIALIZATION_ORDER].reverse();

      for (const moduleId of reverseOrder) {
        await this.destroyModule(moduleId);
      }

      const duration = Date.now() - startTime;
      logger.info(`所有模块销毁完成，耗时 ${duration}ms`);
    } catch (error) {
      logger.error('模块销毁失败:', { error });
      throw error;
    }
  }

  /**
   * 销毁单个模块
   */
  public async destroyModule(moduleId: string): Promise<void> {
    const state = this.initializationStates.get(moduleId);
    if (!state || state.status !== 'initialized') {
      return; // 未初始化或已经销毁
    }

    try {
      logger.info(`销毁模块: ${moduleId}`);

      // 使用模块注册表的销毁方法
      await getRegistry().destroy(moduleId);

      // 更新状态
      state.status = 'pending';
      delete state.startTime;
      delete state.endTime;
      delete state.error;

      logger.info(`模块销毁完成: ${moduleId}`);
    } catch (error) {
      logger.error(`模块销毁失败: ${moduleId}`, { error });
      throw error;
    }
  }

  /**
   * 获取模块初始化状态
   */
  public getModuleState(
    moduleId: string
  ): ModuleInitializationState | undefined {
    return this.initializationStates.get(moduleId);
  }

  /**
   * 获取所有模块初始化状态
   */
  public getAllModuleStates(): Record<string, ModuleInitializationState> {
    const states: Record<string, ModuleInitializationState> = {};

    for (const [moduleId, state] of this.initializationStates) {
      states[moduleId] = { ...state };
    }

    return states;
  }

  /**
   * 检查所有模块是否已初始化
   */
  public isAllModulesInitialized(): boolean {
    for (const state of this.initializationStates.values()) {
      if (state.status !== 'initialized') {
        return false;
      }
    }
    return true;
  }

  /**
   * 打印初始化统计信息
   */
  private printInitializationStats(): void {
    const stats = getRegistry().getStatistics();
    const states = this.getAllModuleStates();

    let totalDuration = 0;
    for (const state of Object.values(states)) {
      if (state.status === 'initialized' && state.startTime && state.endTime) {
        totalDuration += state.endTime - state.startTime;
      }
    }

    logger.info(
      `${stats.initialized}/${stats.total} 模块已初始化 (${totalDuration}ms)`
    );
  }

  /**
   * 初始化必需模块（仅 CRITICAL 优先级模块）
   * 用于启动阶段快速完成核心依赖加载，减少启动时间
   */
  public async initializeEssentialModules(): Promise<void> {
    logger.info('开始初始化必需模块...');
    const startTime = Date.now();

    const essentialIds = getEssentialModuleIds(MODULE_INITIALIZATION_ORDER);

    profilePhaseStart('essential_modules_init');

    try {
      for (const moduleId of essentialIds) {
        const tracePhase = `init:${moduleId}`;
        profilePhaseStart(tracePhase);

        await this.initializeModule(moduleId);

        profilePhaseEnd(tracePhase);
      }

      const duration = Date.now() - startTime;
      profilePhaseEnd('essential_modules_init');
      logger.info(`必需模块初始化完成，耗时 ${duration}ms`);

      this.printInitializationStats();
    } catch (error) {
      logger.error('必需模块初始化失败:', { error });
      throw error;
    }
  }

  /**
   * 初始化指定的单个模块（按需加载）
   * 用于延迟加载场景，确保模块及其依赖被正确初始化
   */
  public async lazyInitializeModule(moduleId: string): Promise<void> {
    const state = this.initializationStates.get(moduleId);
    if (!state) {
      logger.warning(`模块未注册，尝试按需注册: ${moduleId}`);
      return;
    }

    // 如果已经初始化，直接返回
    if (state.status === 'initialized') return;

    // 如果正在初始化，等待完成
    if (state.status === 'initializing') {
      while (state.status === 'initializing') {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return;
    }

    const tracePhase = `lazy:${moduleId}`;
    profilePhaseStart(tracePhase);

    await this.initializeModule(moduleId);

    profilePhaseEnd(tracePhase);
  }

  /**
   * 调度延迟模块的异步加载
   * 在 T2 分发完成后调用，在后台批次加载 DEFERRED + BATCH 模块。
   * ON_DEMAND 模块不会被后台加载，仅在首次请求时通过动态 import() 加载。
   *
   * @param batchSize - 每批次并发加载数，默认 3
   */
  public scheduleDeferredModules(batchSize = 3): void {
    const deferredIds = getDeferredModuleIds(MODULE_INITIALIZATION_ORDER);
    const onDemandIds = getOnDemandModuleIds(MODULE_INITIALIZATION_ORDER);

    if (deferredIds.length > 0) {
      deferredLoader.schedule(
        deferredIds,
        (moduleId) => this.lazyInitializeModule(moduleId),
        batchSize
      );
    }

    if (onDemandIds.length > 0) {
      logger.info(`按需模块已就绪: ${onDemandIds.length} 个`);
    }
  }

  /**
   * 按需加载 ON_DEMAND 模式模块
   * 使用动态 import() 加载，重型依赖仅在首次请求时解析。
   * 与 scheduleDeferredModules 配合使用，onDemand 模块不会被后台加载。
   *
   * @param moduleId - 模块 ID
   * @returns 模块导出对象
   */
  public async requestOnDemandModule(moduleId: string): Promise<any> {
    const state = this.initializationStates.get(moduleId);

    if (state && state.status === 'initialized') {
      return;
    }

    if (!isModuleOnDemand(moduleId)) {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_NOT_ON_DEMAND',
        { moduleId, hint: '非 ON_DEMAND 模块，请使用 lazyInitializeModule' }
      );
    }

    const mod = await requestModule(moduleId);

    if (state && state.status === 'pending') {
      state.status = 'initialized';
      state.startTime = Date.now();
      state.endTime = Date.now();
    }

    return mod;
  }

  /**
   * 注册 CombinedSessionGateway 到 DI 容器
   * 在 session 模块初始化完成后调用，确保 gateway 实例可用于跨 Agent 会话聚合
   */
  private async _registerCombinedGateway(): Promise<void> {
    try {
      const { createCombinedGateway } =
        await import('../session/gateway/index.js');
      const { getDIContainer } = await import('../core/DIContainer.js');
      const container = getDIContainer();

      if (!container.has('combinedSessionGateway')) {
        const combinedGateway = createCombinedGateway();
        container.registerInstance('combinedSessionGateway', combinedGateway);
        logger.info('CombinedSessionGateway 已注册到 DI 容器');
      }
    } catch (e) {
      logger.warning('CombinedSessionGateway 注册失败（非致命）', e as Error);
    }
  }

  /**
   * 重置初始化状态
   */
  public reset(): void {
    this.initializationStates.clear();
    this.initializationPromise = undefined;

    // 重新注册所有模块
    this.registerAllModules();
  }
}

/**
 * 全局模块初始化器实例
 */
export const moduleInitializer = ModuleInitializer.getInstance();

/**
 * 便捷初始化函数
 */
export async function initializeModules(): Promise<void> {
  // 注册所有模块
  moduleInitializer.registerAllModules();

  // 初始化所有模块
  await moduleInitializer.initializeAllModules();
}

/**
 * 便捷销毁函数
 */
export async function destroyModules(): Promise<void> {
  await moduleInitializer.destroyAllModules();
}

/**
 * 检查模块初始化状态
 */
export function checkModuleInitialization(): {
  allInitialized: boolean;
  states: Record<string, ModuleInitializationState>;
} {
  return {
    allInitialized: moduleInitializer.isAllModulesInitialized(),
    states: moduleInitializer.getAllModuleStates(),
  };
}
