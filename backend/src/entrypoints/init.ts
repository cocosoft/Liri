/**
 * 环境初始化入口
 * 负责应用的初始化配置和系统设置
 */

import { enableConfigs } from '../utils/config.js';
import { initializeCommands } from '../commands/index.js';
import { getExtensibilityService } from '../core/extensibility/index.js';
import { profileCheckpoint, profileReport } from '../utils/startupProfiler';
// @ts-ignore
import * as gracefulShutdownModule from '../utils/gracefulShutdown.js';
const { gracefulShutdown, setupGracefulShutdown } =
  gracefulShutdownModule as any;
import { getMonitoringService } from '../monitoring/index.js';

// 记录入口点
profileCheckpoint('cli_entry');

// 记录导入完成
profileCheckpoint('main_imports_loaded');

// 记录环境变量加载
profileCheckpoint('env_vars_loaded');

export async function init(): Promise<void> {
  // 记录初始化开始
  profileCheckpoint('init_function_start');

  // 1. 首先启用配置系统
  profileCheckpoint('load_settings_start');
  await enableConfigs();
  profileCheckpoint('load_settings_end');

  // 2. 设置优雅关闭
  profileCheckpoint('setup_graceful_shutdown_start');
  setupGracefulShutdown();
  profileCheckpoint('setup_graceful_shutdown_end');

  // 3. 并行初始化其他核心系统（优化：最大化并行度）
  const [toolsResult, pluginsResult, commandsResult, monitoringResult] =
    await Promise.all([
      // 初始化工具系统
      (async () => {
        profileCheckpoint('load_tools_start');
        const startTime = Date.now();
        try {
          const { createToolManager } = await import('../tools/ToolManager.js');
          createToolManager();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            console.warn(`工具系统加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          console.warn('预加载工具系统失败:', error);
          return { success: false, error };
        } finally {
          profileCheckpoint('load_tools_end');
        }
      })(),

      // 初始化可扩展性服务（包含插件系统）
      (async () => {
        profileCheckpoint('load_plugins_start');
        const startTime = Date.now();
        try {
          const extensibilityService = getExtensibilityService();
          await extensibilityService.init();
          await extensibilityService.startAllModules();
          const duration = Date.now() - startTime;
          if (duration > 100) {
            console.warn(`插件系统加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          console.warn('预加载插件系统失败:', error);
          return { success: false, error };
        } finally {
          profileCheckpoint('load_plugins_end');
        }
      })(),

      // 初始化命令系统
      (async () => {
        profileCheckpoint('load_commands_start');
        const startTime = Date.now();
        try {
          await initializeCommands();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            console.warn(`命令系统加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          console.warn('预加载命令系统失败:', error);
          return { success: false, error };
        } finally {
          profileCheckpoint('load_commands_end');
        }
      })(),

      // 初始化监控服务
      (async () => {
        profileCheckpoint('load_monitoring_start');
        const startTime = Date.now();
        try {
          const monitoringService = getMonitoringService();
          monitoringService.start();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            console.warn(`监控服务加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          console.warn('预加载监控服务失败:', error);
          return { success: false, error };
        } finally {
          profileCheckpoint('load_monitoring_end');
        }
      })(),
    ]);

  // 4. 启动延迟预加载（非阻塞）
  profileCheckpoint('start_deferred_prefetches_start');
  startDeferredPrefetches();
  profileCheckpoint('start_deferred_prefetches_end');

  // 记录初始化结束
  profileCheckpoint('init_function_end');

  // 记录应用准备就绪
  profileCheckpoint('app_ready');

  // 生成性能报告
  profileReport();
}

/**
 * 启动延迟预加载，不阻塞启动流程
 * 优化：将重量级模块的加载延迟到应用启动后执行
 */
async function startDeferredPrefetches(): Promise<void> {
  try {
    // 并行执行多个延迟预加载任务
    const prefetchTasks = [
      // 预加载系统上下文
      (async () => {
        try {
          // @ts-ignore
          const contextModule = await import('../context/context.js');
          const { getSystemContext, getUserContext } = contextModule as any;
          void getSystemContext();
          void getUserContext();
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载工具系统（如果尚未加载）
      (async () => {
        try {
          const { getToolManager } = await import('../tools/index.js');
          const toolManager = getToolManager();
          if (toolManager) {
            toolManager.getAllTools(); // 触发工具加载
          }
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载AI客户端
      (async () => {
        try {
          await import('../ai/clients/DeepSeekClient.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载治理管理器
      (async () => {
        try {
          await import('../governance/managers/GovernanceManager.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载沙箱管理器
      (async () => {
        try {
          await import('../sandbox/managers/SandboxManager.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载历史管理器
      (async () => {
        try {
          await import('../utils/history.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载UI增强器
      (async () => {
        try {
          await import('../ui/UIEnhancer.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载会话管理器
      (async () => {
        try {
          await import('../session/SessionManager.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载聊天管理器
      (async () => {
        try {
          await import('../chat/ChatManager.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载记忆管理器
      (async () => {
        try {
          await import('../memory/MemoryManager.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载文档系统
      (async () => {
        try {
          await import('../docs/HelpSystem.js');
        } catch (error) {
          // 忽略预加载错误
        }
      })(),
    ];

    // 并行执行所有预加载任务
    await Promise.allSettled(prefetchTasks);
  } catch (error) {
    // 忽略预加载错误
    console.warn('延迟预加载失败:', error);
  }
}

export default { init };
