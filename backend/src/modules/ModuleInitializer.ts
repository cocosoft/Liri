/**
 * 模块初始化器
 * 统一管理模块的注册、初始化和生命周期
 */

import { ModuleDefinition, moduleRegistry } from './ModuleRegistry';
import {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
  validateModuleDependencies,
} from './ModuleDefinitions';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

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
      throw new Error('模块依赖关系验证失败');
    }

    // 注册所有模块
    for (const definition of Object.values(MODULE_DEFINITIONS)) {
      try {
        moduleRegistry.register(definition);
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
      throw new Error(`模块 ${moduleId} 未注册`);
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
      await moduleRegistry.initialize(moduleId);

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
      await moduleRegistry.destroy(moduleId);

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
    const stats = moduleRegistry.getStatistics();
    const states = this.getAllModuleStates();

    logger.info('\n=== 模块初始化统计 ===');
    logger.info(`总模块数: ${stats.total}`);
    logger.info(`已初始化: ${stats.initialized}`);

    // 按状态统计
    const statusCounts: Record<string, number> = {};
    for (const state of Object.values(states)) {
      statusCounts[state.status] = (statusCounts[state.status] || 0) + 1;
    }

    logger.info('状态分布:');
    for (const [status, count] of Object.entries(statusCounts)) {
      logger.info(`  ${status}: ${count}`);
    }

    logger.info('分类分布:');
    for (const [category, count] of Object.entries(stats.byCategory)) {
      logger.info(`  ${category}: ${count}`);
    }

    // 初始化耗时统计
    let totalDuration = 0;
    let maxDuration = 0;
    let slowestModule = '';

    for (const [moduleId, state] of Object.entries(states)) {
      if (state.status === 'initialized' && state.startTime && state.endTime) {
        const duration = state.endTime - state.startTime;
        totalDuration += duration;

        if (duration > maxDuration) {
          maxDuration = duration;
          slowestModule = moduleId;
        }
      }
    }

    logger.info(`总初始化耗时: ${totalDuration}ms`);
    logger.info(
      `平均模块耗时: ${Math.round(totalDuration / stats.initialized)}ms`
    );
    logger.info(`最慢模块: ${slowestModule} (${maxDuration}ms)`);
    logger.info('========================\n');
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
