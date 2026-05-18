/**
 * 模块管理模块入口文件
 * 统一导出所有模块管理相关功能
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

// 导出模块注册表
export type { ModuleDefinition } from './ModuleRegistry';
export { ModuleCategory, moduleRegistry } from './ModuleRegistry';

// 导出导入管理器
export {
  importManager,
  importModule,
  importFromRegistry,
} from './ImportManager';

// 导出模块定义
export {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
  getModuleDefinition,
  getAllModuleDefinitions,
} from './ModuleDefinitions';

// 导出模块初始化器
export {
  moduleInitializer,
  initializeModules,
  destroyModules,
  checkModuleInitialization,
} from './ModuleInitializer';

/**
 * 模块管理工具函数
 */

/**
 * 快速初始化所有模块
 */
export async function quickInitialize(): Promise<void> {
  logger.info('快速初始化模块管理系统...');

  try {
    // 注册所有模块
    const moduleInitializer = (await import('./ModuleInitializer'))
      .moduleInitializer;
    moduleInitializer.registerAllModules();

    // 初始化所有模块
    await moduleInitializer.initializeAllModules();

    logger.info('模块管理系统初始化完成');
  } catch (error) {
    logger.error('模块管理系统初始化失败:', { error });
    throw error;
  }
}

/**
 * 获取模块统计信息
 */
export function getModuleStatistics() {
  const moduleRegistry = require('./ModuleRegistry').moduleRegistry;
  const moduleInitializer = require('./ModuleInitializer').moduleInitializer;

  const registryStats = moduleRegistry.getStatistics();
  const initializationStates = moduleInitializer.getAllModuleStates();

  return {
    registry: registryStats,
    initialization: {
      total: Object.keys(initializationStates).length,
      initialized: Object.values(initializationStates).filter(
        (s: any) => s.status === 'initialized'
      ).length,
      pending: Object.values(initializationStates).filter(
        (s: any) => s.status === 'pending'
      ).length,
      error: Object.values(initializationStates).filter(
        (s: any) => s.status === 'error'
      ).length,
    },
  };
}

/**
 * 模块使用示例
 */
export const ModuleUsageExamples = {
  /**
   * 示例1：使用别名路径导入模块
   */
  async example1() {
    // 使用别名路径导入模块
    const { importModule } = await import('./ImportManager');

    try {
      // 使用别名路径
      const agentModule = await importModule('@modules/agent');
      const aiModule = await importModule('@modules/ai');

      logger.info('模块导入成功');
      return { agentModule, aiModule };
    } catch (error) {
      logger.error('模块导入失败:', { error });
      throw error;
    }
  },

  /**
   * 示例2：从注册表导入模块
   */
  async example2() {
    const { importFromRegistry } = await import('./ImportManager');

    try {
      // 从注册表导入模块
      const coreModule = await importFromRegistry('core');
      const configModule = await importFromRegistry('config');

      logger.info('从注册表导入模块成功');
      return { coreModule, configModule };
    } catch (error) {
      logger.error('从注册表导入模块失败:', { error });
      throw error;
    }
  },

  /**
   * 示例3：批量导入模块
   */
  async example3() {
    const { importManager } = await import('./ImportManager');

    try {
      // 批量导入模块
      const modules = await importManager.importMultiple([
        '@modules/core',
        '@modules/ai',
        '@modules/agent',
        '@modules/bridge',
      ]);

      logger.info('批量导入模块成功');
      return modules;
    } catch (error) {
      logger.error('批量导入模块失败:', { error });
      throw error;
    }
  },

  /**
   * 示例4：检查模块初始化状态
   */
  example4() {
    const { checkModuleInitialization } = require('./ModuleInitializer');

    const { allInitialized, states } = checkModuleInitialization();

    logger.info('所有模块是否已初始化:', allInitialized);
    logger.info('模块初始化状态:');

    for (const [moduleId, state] of Object.entries(states)) {
      logger.info(`  ${moduleId}: ${(state as any).status}`);
    }

    return { allInitialized, states };
  },
};
