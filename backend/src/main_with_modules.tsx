/**
 * 应用主入口（集成模块管理版本）
 * 使用统一的模块管理系统来初始化应用的各个组件和服务
 */

import { profileCheckpoint, profileReport } from './utils/startupProfiler';
import {
  markConfigInitialized,
  markAnalyticsInitialized,
  markAuthInitialized,
  markPluginsInitialized,
  markSkillsInitialized,
  markStartupComplete,
  markAppRunning,
} from './bootstrap/state.js';

// 导入模块管理系统
import { 
  quickInitialize,
  destroyModules,
  checkModuleInitialization,
  importFromRegistry 
} from './modules/index.js';

/**
 * 主应用入口函数（集成模块管理）
 */
export async function mainWithModules(): Promise<void> {
  // Windows路径安全设置：防止Windows执行当前目录中的命令
  if (process.platform === 'win32') {
    process.env.NoDefaultCurrentDirectoryInExePath = '1';
  }

  profileCheckpoint('main_start');

  try {
    // 阶段1: 模块管理系统初始化
    profileCheckpoint('module_system_init_start');
    console.log('开始初始化模块管理系统...');
    
    // 快速初始化所有模块
    await quickInitialize();
    
    // 检查模块初始化状态
    const { allInitialized, states } = checkModuleInitialization();
    if (!allInitialized) {
      console.error('模块初始化失败，状态:', states);
      throw new Error('模块初始化失败');
    }
    
    console.log('模块管理系统初始化完成');
    profileCheckpoint('module_system_init_complete');

    // 阶段2: 核心模块初始化
    profileCheckpoint('core_modules_init_start');
    
    // 2.1 初始化配置模块
    profileCheckpoint('config_init_start');
    await initializeConfigWithModules();
    markConfigInitialized();
    profileCheckpoint('config_init_complete');

    // 2.2 初始化分析系统
    profileCheckpoint('analytics_init_start');
    await initializeAnalyticsWithModules();
    markAnalyticsInitialized();
    profileCheckpoint('analytics_init_complete');

    // 2.3 初始化认证
    profileCheckpoint('auth_init_start');
    await initializeAuthWithModules();
    markAuthInitialized();
    profileCheckpoint('auth_init_complete');

    // 2.4 初始化插件系统
    profileCheckpoint('plugins_init_start');
    await initializePluginsWithModules();
    markPluginsInitialized();
    profileCheckpoint('plugins_init_complete');

    // 2.5 初始化技能系统
    profileCheckpoint('skills_init_start');
    await initializeSkillsWithModules();
    markSkillsInitialized();
    profileCheckpoint('skills_init_complete');

    // 2.6 初始化监控系统
    profileCheckpoint('monitoring_init_start');
    initializeMonitoringWithModules();
    profileCheckpoint('monitoring_init_complete');

    profileCheckpoint('core_modules_init_complete');

    // 阶段3: 应用启动
    profileCheckpoint('app_start');
    await startAppWithModules();
    markAppRunning();
    profileCheckpoint('app_running');

    // 生成性能报告
    profileReport();
    
    console.log('应用启动完成（模块管理版本）');
    
  } catch (error) {
    console.error('Error during initialization:', error);
    profileCheckpoint('initialization_error');
    profileReport();
    
    // 销毁模块
    try {
      await destroyModules();
    } catch (destroyError) {
      console.error('Error during module destruction:', destroyError);
    }
    
    process.exit(1);
  } finally {
    // 关闭模块系统
    try {
      await destroyModules();
      console.log('模块系统已关闭');
    } catch (error) {
      console.error('Error during module destruction:', error);
    }
  }
}

/**
 * 使用模块管理系统初始化配置
 */
async function initializeConfigWithModules(): Promise<void> {
  try {
    // 从注册表导入配置模块
    const configModule = await importFromRegistry('config');
    console.log('配置模块初始化完成（模块管理版本）');
  } catch (error) {
    console.error('配置模块初始化失败:', error);
    // 回退到原有方式
    const { getConfig } = await import('./config/index.js');
    const config = getConfig();
    console.log('Configuration initialized (fallback):', { version: config.version, app: config.app.name });
  }
}

/**
 * 使用模块管理系统初始化分析系统
 */
async function initializeAnalyticsWithModules(): Promise<void> {
  try {
    // 从注册表导入分析模块
    const analyticsModule = await importFromRegistry('analytics');
    console.log('分析模块初始化完成（模块管理版本）');
  } catch (error) {
    console.error('分析模块初始化失败:', error);
    // 回退到原有方式
    const sinksModule = await import('./utils/sinks.js');
    const initSinks = sinksModule.initSinks as () => void;
    initSinks();
  }
}

/**
 * 使用模块管理系统初始化认证
 */
async function initializeAuthWithModules(): Promise<void> {
  try {
    // 从注册表导入认证模块
    const authModule = await importFromRegistry('security');
    console.log('认证模块初始化完成（模块管理版本）');
  } catch (error) {
    console.error('认证模块初始化失败:', error);
    // 回退到原有方式
    const { createAuthManager } = await import('./core/auth/AuthManager.js');
    const authManager = createAuthManager();
  }
}

/**
 * 使用模块管理系统初始化插件系统
 */
async function initializePluginsWithModules(): Promise<void> {
  try {
    // 从注册表导入插件模块
    const pluginsModule = await importFromRegistry('plugins');
    console.log('插件模块初始化完成（模块管理版本）');
  } catch (error) {
    console.error('插件模块初始化失败:', error);
    // 回退到原有方式
    const { pluginManager } = await import('./plugins/PluginManager.js');
    await pluginManager.loadPlugins();
  }
}

/**
 * 使用模块管理系统初始化技能系统
 */
async function initializeSkillsWithModules(): Promise<void> {
  try {
    // 从注册表导入技能模块
    const skillsModule = await importFromRegistry('tools');
    console.log('技能模块初始化完成（模块管理版本）');
  } catch (error) {
    console.error('技能模块初始化失败:', error);
    // 回退到原有方式
    const { SkillManager } = await import('./skills/SkillManager.js');
    const skillManager = new SkillManager();
    await skillManager.initialize();
  }
}

/**
 * 使用模块管理系统初始化监控系统
 */
function initializeMonitoringWithModules(): void {
  try {
    // 从注册表导入监控模块
    const monitoringModule = require('./modules').importFromRegistry('monitoring');
    console.log('监控模块初始化完成（模块管理版本）');
  } catch (error) {
    console.error('监控模块初始化失败:', error);
    // 回退到原有方式
    const { getAndStartMonitoringService } = require('./monitoring/MonitoringService.js');
    getAndStartMonitoringService();
  }
}

/**
 * 使用模块管理系统启动应用
 */
async function startAppWithModules(): Promise<void> {
  try {
    // 从注册表导入CLI模块
    const cliModule = await importFromRegistry('cli');
    console.log('应用启动完成（模块管理版本）');
  } catch (error) {
    console.error('应用启动失败（模块管理版本）:', error);
    // 回退到原有方式
    const { launchRepl } = await import('./entrypoints/repl.js');
    await launchRepl();
  }
}

/**
 * 模块管理测试函数
 */
export async function testModuleSystem(): Promise<void> {
  console.log('开始测试模块管理系统...');
  
  try {
    // 初始化模块系统
    await quickInitialize();
    
    // 检查模块状态
    const { allInitialized, states } = checkModuleInitialization();
    console.log('模块初始化状态:', { allInitialized, states });
    
    // 测试导入功能
    const configModule = await importFromRegistry('config');
    console.log('配置模块导入测试成功');
    
    const aiModule = await importFromRegistry('ai');
    console.log('AI模块导入测试成功');
    
    console.log('模块管理系统测试完成');
    
  } catch (error) {
    console.error('模块管理系统测试失败:', error);
    throw error;
  } finally {
    // 清理
    await destroyModules();
  }
}

// 导出新的主函数
export { mainWithModules as main };

// 启动应用（模块管理版本）
// void mainWithModules();