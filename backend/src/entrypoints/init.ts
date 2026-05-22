/**
 * 环境初始化入�?
 * 负责应用的初始化配置和系统设�?
 */

import { enableConfigs } from '@modules/config';
import { initializeCommands } from '../commands/index.js';
import { getExtensibilityService } from '../core/extensibility/index.js';
import { profileCheckpoint, profileReport } from '../utils/startupProfiler';
// @ts-ignore
import * as gracefulShutdownModule from '../utils/gracefulShutdown.js';
const { gracefulShutdown, setupGracefulShutdown, registerShutdownHandler } =
  gracefulShutdownModule as any;
import { getMonitoringService } from '../monitoring/index.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getStartupChainProfiler } from '../bootstrap/StartupChainProfiler.js';
import {
  loadStartupConfig,
  formatConfigSummary,
} from '../bootstrap/StartupYamlLoader.js';
import type { StartupConfig } from '../bootstrap/StartupConfig.js';

const logger = new Logger({ level: LogLevel.INFO });

/** 全局 startup 配置引用 */
let _startupConfig: StartupConfig | null = null;

/**
 * 获取已加载的 startup 配置
 */
export function getStartupConfig(): StartupConfig | null {
  return _startupConfig;
}

// 记录入口�?
profileCheckpoint('cli_entry');

// 记录导入完成
profileCheckpoint('main_imports_loaded');

// 记录环境变量加载
profileCheckpoint('env_vars_loaded');

export async function init(): Promise<void> {
  // 记录初始化开�?
  profileCheckpoint('init_function_start');
  getStartupChainProfiler().markPhaseStart('env_init');

  // 0. 加载 startup.yaml（在 enableConfigs 之前，以影响配置加载行为）
  profileCheckpoint('startup_config_load_start');
  getStartupChainProfiler().markPhaseStart('startup_config');
  const startupResult = loadStartupConfig();
  _startupConfig = startupResult.config;
  if (startupResult.found) {
    logger.info(
      `startup.yaml 配置摘要: ${formatConfigSummary(startupResult.config)}`
    );
  }
  profileCheckpoint('startup_config_load_end');
  getStartupChainProfiler().markPhaseEnd('startup_config');

  // 1. 启用配置系统
  profileCheckpoint('load_settings_start');
  getStartupChainProfiler().markPhaseStart('config_load');
  enableConfigs();
  profileCheckpoint('load_settings_end');
  getStartupChainProfiler().markPhaseEnd('config_load');

  // 2. 设置优雅关闭
  profileCheckpoint('setup_graceful_shutdown_start');
  setupGracefulShutdown();
  profileCheckpoint('setup_graceful_shutdown_end');

  // 3. 并行初始化其他核心系统（优化：最大化并行度）
  const [toolsResult, pluginsResult, commandsResult, monitoringResult] =
    await Promise.all([
      // 初始化工具系�?
      (async () => {
        profileCheckpoint('load_tools_start');
        getStartupChainProfiler().markPhaseStart('tool_init');
        const startTime = Date.now();
        try {
          const { createToolManager } = await import('../tools/ToolManager.js');
          createToolManager();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            logger.warning(`工具系统加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('预加载工具系统失败', { error });
          return { success: false, error };
        } finally {
          profileCheckpoint('load_tools_end');
          getStartupChainProfiler().markPhaseEnd('tool_init');
        }
      })(),

      // 初始化可扩展性服务（包含插件系统�?
      (async () => {
        profileCheckpoint('load_plugins_start');
        getStartupChainProfiler().markPhaseStart('extensibility_init');
        const startTime = Date.now();
        try {
          const extensibilityService = getExtensibilityService();
          await extensibilityService.init();
          await extensibilityService.startAllModules();
          const duration = Date.now() - startTime;
          if (duration > 100) {
            logger.warning(`插件系统加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('预加载插件系统失败', { error });
          return { success: false, error };
        } finally {
          profileCheckpoint('load_plugins_end');
          getStartupChainProfiler().markPhaseEnd('extensibility_init');
        }
      })(),

      // 初始化命令系�?
      (async () => {
        profileCheckpoint('load_commands_start');
        getStartupChainProfiler().markPhaseStart('command_init');
        const startTime = Date.now();
        try {
          await initializeCommands();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            logger.warning(`命令系统加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('预加载命令系统失败', { error });
          return { success: false, error };
        } finally {
          profileCheckpoint('load_commands_end');
          getStartupChainProfiler().markPhaseEnd('command_init');
        }
      })(),

      // 初始化监控服�?
      (async () => {
        profileCheckpoint('load_monitoring_start');
        getStartupChainProfiler().markPhaseStart('monitoring_init');
        const startTime = Date.now();
        try {
          const monitoringService = getMonitoringService();
          monitoringService.start();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            logger.warning(`监控服务加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('预加载监控服务失败', { error });
          return { success: false, error };
        } finally {
          profileCheckpoint('load_monitoring_end');
          getStartupChainProfiler().markPhaseEnd('monitoring_init');
        }
      })(),

      // 注册 AI Provider
      (async () => {
        profileCheckpoint('load_providers_start');
        getStartupChainProfiler().markPhaseStart('provider_init');
        const startTime = Date.now();
        try {
          const { registerDefaultProviders } =
            await import('../ai/providers/registerProviders.js');
          registerDefaultProviders();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            logger.warning(`AI Provider 注册较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('AI Provider 注册失败', { error });
          return { success: false, error };
        } finally {
          profileCheckpoint('load_providers_end');
          getStartupChainProfiler().markPhaseEnd('provider_init');
        }
      })(),

      // 初始化 CoreAPI + Gateway 通道服务
      (async () => {
        profileCheckpoint('load_gateway_start');
        getStartupChainProfiler().markPhaseStart('gateway_init');
        const startTime = Date.now();
        try {
          // 禁用 Gateway 通道服务（避免 WebSocket 端口冲突）
          try {
            const { cliConfigManager } = await import('../cli/config.js');
            const gatewayConfig = cliConfigManager.getGatewayConfig();
            gatewayConfig.enabled = false;
            gatewayConfig.websocket.enabled = false;
          } catch {
            // 忽略
          }

          // 预创建 CoreAPI 单例（使用全局默认依赖）
          const { getCoreAPI } = await import('../runtime/api/CoreAPIImpl.js');
          getCoreAPI();

          // 预创建 ChannelManager 单例
          const { getChannelManager } =
            await import('../core/gateway/ChannelManager.js');
          getChannelManager();

          // 根据配置自动注册并启动 Gateway 通道
          try {
            const { setupGatewayFromConfig } =
              await import('../core/gateway/GatewaySetup.js');
            const result = await setupGatewayFromConfig();
            if (result.registeredChannels > 0) {
              logger.info(
                `Gateway 通道自动启动: ${result.connectedChannels}/${result.registeredChannels} 已连接`
              );
            }
            if (result.errors.length > 0) {
              logger.warning('Gateway 通道启动存在错误', {
                errors: result.errors,
              });
            }
          } catch (setupError) {
            logger.warning('Gateway 通道自动启动失败', { error: setupError });
          }

          // 注册 Gateway 优雅关闭处理
          const { disconnectAllChannels } =
            await import('../core/gateway/index.js');
          registerShutdownHandler(() => disconnectAllChannels());

          const duration = Date.now() - startTime;
          if (duration > 100) {
            logger.warning(`Gateway 服务加载较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('预加载 Gateway 服务失败', { error });
          return { success: false, error };
        } finally {
          profileCheckpoint('load_gateway_end');
          getStartupChainProfiler().markPhaseEnd('gateway_init');
        }
      })(),
    ]);

  // 4. 启动延迟预加载（非阻塞）
  profileCheckpoint('start_deferred_prefetches_start');
  getStartupChainProfiler().markPhaseStart('deferred_prefetch_start');
  startDeferredPrefetches();
  profileCheckpoint('start_deferred_prefetches_end');
  getStartupChainProfiler().markPhaseEnd('deferred_prefetch_start');

  // 记录初始化结�?
  profileCheckpoint('init_function_end');
  getStartupChainProfiler().markPhaseEnd('env_init');

  // 记录应用准备就绪
  profileCheckpoint('app_ready');
  getStartupChainProfiler().markPhaseStart('app_ready');
  getStartupChainProfiler().markPhaseEnd('app_ready');

  // 生成性能报告
  profileReport();

  // 输出启动链路 SLO 报告
  const sloReport = getStartupChainProfiler().generateSLOReport();
  if (getStartupChainProfiler().getFailures().length > 0) {
    logger.warning('启动阶段存在性能红线超标', {
      failures: getStartupChainProfiler().getFailures().length,
    });
  }
}

/**
 * 启动延迟预加载，不阻塞启动流�?
 * 优化：将重量级模块的加载延迟到应用启动后执行
 */
async function startDeferredPrefetches(): Promise<void> {
  try {
    // 并行执行多个延迟预加载任�?
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
          // 忽略预加载错�?
        }
      })(),

      // 预加载工具系统（如果尚未加载�?
      (async () => {
        try {
          const { globalToolManager } = await import('../tools/index.js');
          if (globalToolManager) {
            globalToolManager.getTools(); // 触发工具加载
          }
        } catch (error) {
          // 忽略预加载错误
        }
      })(),

      // 预加载AI客户�?
      (async () => {
        try {
          await import('../ai/providers/DeepSeekProvider.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载治理管理器
      (async () => {
        try {
          await import('../governance/managers/GovernanceManager');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载沙箱管理器
      (async () => {
        try {
          await import('../sandbox/managers/SandboxManager.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载历史管理器
      (async () => {
        try {
          await import('../utils/history.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载UI增强�?
      (async () => {
        try {
          await import('../ui/UIEnhancer.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载会话管理器
      (async () => {
        try {
          await import('../session/SessionManager.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载聊天管理器
      (async () => {
        try {
          await import('../chat/ChatManager.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载记忆管理器
      (async () => {
        try {
          await import('../memory/MemoryManager.js');
        } catch (error) {
          // 忽略预加载错�?
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

      // 启动时静默检查更新（非阻塞）
      (async () => {
        try {
          const { autoUpdater } = await import('../cli/autoUpdater.js');
          await autoUpdater.checkAndNotify();
        } catch {
          // 更新检查失败不影响启动
        }
      })(),
    ];

    // 并行执行所有预加载任务
    await Promise.allSettled(prefetchTasks);
  } catch (error) {
    // 忽略预加载错�?
    logger.warning('延迟预加载失败', { error });
  }
}

export default { init };
