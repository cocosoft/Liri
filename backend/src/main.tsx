/**
 * 应用主入口
 * 负责初始化应用的各个组件和服务
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
import { initializeCommands } from './commands/manager/CommandManager.js';
import { initializePerformanceSystem, shutdownPerformanceSystem } from './performance/index.js';
import { initializeCostTrackingSystem, shutdownCostTrackingSystem } from './cost/index.js';
import { initializeCacheSystem, shutdownCacheSystem } from './cache/index.js';
import { initializeErrorSystem, shutdownErrorSystem } from './error/index.js';
import { startMdmPrefetch, startKeychainPrefetch, ensureMdmPrefetchCompleted, ensureKeychainPrefetchCompleted } from './infrastructure/startup/index.js';

/**
 * 主应用入口函数
 */
export async function main(): Promise<void> {
  // 启动并行预读取优化（在最早期启动）
  startMdmPrefetch();
  startKeychainPrefetch(['py-app', 'py-app-legacy'], 'default');

  // Windows路径安全设置：防止Windows执行当前目录中的命令
  // 这必须在任何命令执行之前设置，以防止PATH劫持攻击
  // 参考：https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
  if (process.platform === 'win32') {
    process.env.NoDefaultCurrentDirectoryInExePath = '1';
  }

  profileCheckpoint('main_start');

  try {
    // 等待预读取完成（非阻塞，仅确保数据就绪）
    await ensureMdmPrefetchCompleted();
    await ensureKeychainPrefetchCompleted();
    profileCheckpoint('startup_prefetch_complete');

    // 1. 初始化配置
    profileCheckpoint('config_init_start');
    await initializeConfig();
    markConfigInitialized();
    profileCheckpoint('config_init_complete');

    // 2. 初始化分析系统
    profileCheckpoint('analytics_init_start');
    await initializeAnalytics();
    markAnalyticsInitialized();
    profileCheckpoint('analytics_init_complete');

    // 3. 初始化认证
    profileCheckpoint('auth_init_start');
    await initializeAuth();
    markAuthInitialized();
    profileCheckpoint('auth_init_complete');

    // 4. 初始化插件系统
    profileCheckpoint('plugins_init_start');
    await initializePlugins();
    markPluginsInitialized();
    profileCheckpoint('plugins_init_complete');

    // 5. 初始化技能系统
    profileCheckpoint('skills_init_start');
    await initializeSkills();
    markSkillsInitialized();
    profileCheckpoint('skills_init_complete');

    // 6. 初始化监控系统
    profileCheckpoint('monitoring_init_start');
    initializeMonitoring();
    profileCheckpoint('monitoring_init_complete');

    // 7. 初始化性能优化系统
    profileCheckpoint('performance_init_start');
    await initializePerformanceSystem();
    profileCheckpoint('performance_init_complete');

    // 8. 初始化成本跟踪系统
    profileCheckpoint('cost_init_start');
    await initializeCostTrackingSystem();
    profileCheckpoint('cost_init_complete');

    // 9. 初始化缓存系统
    profileCheckpoint('cache_init_start');
    await initializeCacheSystem();
    profileCheckpoint('cache_init_complete');

    // 10. 初始化错误处理系统
    profileCheckpoint('error_init_start');
    initializeErrorSystem();
    profileCheckpoint('error_init_complete');

    // 11. 初始化命令系统
    profileCheckpoint('commands_init_start');
    await initializeCommands();
    profileCheckpoint('commands_init_complete');

    // 12. 初始化完成
    markStartupComplete();
    profileCheckpoint('startup_complete');

    // 13. 启动应用
    profileCheckpoint('app_start');
    await startApp();
    markAppRunning();
    profileCheckpoint('app_running');

    // 生成性能报告
    profileReport();
  } catch (error) {
    console.error('Error during initialization:', error);
    profileCheckpoint('initialization_error');
    profileReport();
    process.exit(1);
  } finally {
    // 关闭错误处理系统
    shutdownErrorSystem();
    
    // 关闭缓存系统
    await shutdownCacheSystem();
    
    // 关闭成本跟踪系统
    await shutdownCostTrackingSystem();
    
    // 关闭性能优化系统
    await shutdownPerformanceSystem();
  }
}

/**
 * 初始化配置
 */
async function initializeConfig(): Promise<void> {
  // 导入新的配置系统
  const { getConfig, configManager } = await import('./config/index.js');
  configManager.enableConfigs();
  const config = getConfig();
  console.log('Configuration initialized:', { version: config.version, app: config.app.name });
}

/**
 * 初始化分析系统
 */
async function initializeAnalytics(): Promise<void> {
  // 导入分析模块
  const sinksModule = await import('./utils/sinks.js');
  const initSinks = sinksModule.initSinks as () => void;
  initSinks();
}

/**
 * 初始化认证
 */
async function initializeAuth(): Promise<void> {
  // 导入认证模块
  const { createAuthManager } = await import('./core/auth/AuthManager.js');
  const authManager = createAuthManager();
  // 注意：DefaultAuthManager 没有 initialize 方法
}

/**
 * 初始化插件系统
 */
async function initializePlugins(): Promise<void> {
  // 导入插件模块
  const { pluginManager } = await import('./plugins/PluginManager.js');
  await pluginManager.loadPlugins();
}

/**
 * 初始化技能系统
 */
async function initializeSkills(): Promise<void> {
  // 导入技能模块
  const { SkillManager } = await import('./skills/SkillManager.js');
  const skillManager = new SkillManager();
  await skillManager.initialize();
}

/**
 * 初始化监控系统
 */
function initializeMonitoring(): void {
  // 导入监控模块
  const { getAndStartMonitoringService } = require('./monitoring/MonitoringService.js');
  getAndStartMonitoringService();
}

/**
 * 启动应用
 */
async function startApp(): Promise<void> {
  // 导入REPL模块
  const { launchRepl } = await import('./entrypoints/repl.js');
  await launchRepl();
}

// 启动应用
void main();
