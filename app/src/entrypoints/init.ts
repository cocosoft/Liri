// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 环境初始化入口
 * 负责应用的初始化配置和系统设�?
 */

import { enableConfigs } from '@modules/config';
import { initializeCommands } from '@modules/commands/index.js';
import { getExtensibilityService } from '@modules/core/extensibility/index.js';
import {
  profileCheckpoint,
  profileReport,
} from '@modules/utils/startupProfiler';
// @ts-ignore
import * as gracefulShutdownModule from '@modules/utils/gracefulShutdown.js';
const { gracefulShutdown, setupGracefulShutdown, registerShutdownHandler } =
  gracefulShutdownModule as any;
import { getMonitoringService } from '@modules/monitoring/index.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolvePyappHome, ensureDataDirectories } from '@modules/config/paths';
import { getStartupChainProfiler } from '@modules/bootstrap/StartupChainProfiler.js';
import {
  loadStartupConfig,
  formatConfigSummary,
} from '@modules/bootstrap/StartupYamlLoader.js';
import type { StartupConfig } from '@modules/bootstrap/StartupConfig.js';

const logger = new Logger({ level: LogLevel.INFO });

/** 全局 startup 配置引用 */
let _startupConfig: StartupConfig | null = null;

/**
 * 获取已加载的 startup 配置
 */
export function getStartupConfig(): StartupConfig | null {
  return _startupConfig;
}

// 记录入口�?// 记录入口
profileCheckpoint('cli_entry');

// 记录导入完成
profileCheckpoint('main_imports_loaded');

// 记录环境变量加载
profileCheckpoint('env_vars_loaded');

/**
 * 从用户设置加载数据目录配置
 * 在应用启动时优先应用用户配置的数据目录
 */
async function loadUserDataDirectory(): Promise<void> {
  try {
    const { loadUserSettings } =
      await import('../config/settings/userSettings.js');
    const { setUserDataDirOverride } = await import('../config/paths.js');

    const settings = loadUserSettings();
    const dataDirectory = settings.dataDirectory as string | undefined;

    if (
      dataDirectory &&
      typeof dataDirectory === 'string' &&
      dataDirectory.trim()
    ) {
      setUserDataDirOverride(dataDirectory.trim());
      logger.info(`用户数据目录已从设置加载: ${dataDirectory}`);
    }
  } catch (error) {
    logger.debug('加载用户数据目录配置失败（使用默认值）', { error });
  }
}

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

  // 1. 加载用户数据目录配置（在配置系统启用前）
  profileCheckpoint('load_user_data_dir_start');
  await loadUserDataDirectory();
  profileCheckpoint('load_user_data_dir_end');

  // 2. 启用配置系统
  profileCheckpoint('load_settings_start');
  getStartupChainProfiler().markPhaseStart('config_load');
  enableConfigs();
  profileCheckpoint('load_settings_end');
  getStartupChainProfiler().markPhaseEnd('config_load');

  // 2.1. 确保所有数据目录结构完整（第二层 + 第三层子目录）
  // 此时 userDataDirOverride 已从设置加载，ensureDataDirectories 会使用正确路径
  ensureDataDirectories();

  // 2.2. 设置优雅关闭
  profileCheckpoint('setup_graceful_shutdown_start');
  setupGracefulShutdown();
  profileCheckpoint('setup_graceful_shutdown_end');

  // 环境初始化阶段结束（配置 + 优雅关闭已就绪，后续是模块级并行加载）
  getStartupChainProfiler().markPhaseEnd('env_init');

  // 3. 并行初始化其他核心系统（优化：最大化并行度）
  const [toolsResult, pluginsResult, commandsResult, monitoringResult] =
    await Promise.all([
      // 初始化工具系统
      (async () => {
        profileCheckpoint('load_tools_start');
        getStartupChainProfiler().markPhaseStart('tool_init');
        const startTime = Date.now();
        try {
          const { createToolManager } = await import('../tools/ToolManager.js');
          createToolManager();
          const duration = Date.now() - startTime;
          if (duration > 1500) {
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

      // 初始化监控服务
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

        // 检查 Gateway 断路器状态
        const { CircuitBreaker } =
          await import('../diagnostics/CircuitBreaker.js');
        const gatewayBreaker = CircuitBreaker.getOrCreate('gateway-init', {
          maxFailures: 2,
          baseDelayMs: 10000,
          maxDelayMs: 300000,
        });
        if (gatewayBreaker.isOpen()) {
          logger.debug('Gateway 断路器已断开，跳过本次预加载', {
            cooldown: gatewayBreaker.getRemainingCooldown(),
          });
          profileCheckpoint('load_gateway_end');
          getStartupChainProfiler().markPhaseEnd('gateway_init');
          return { success: false, error: new Error('断路器已断开') };
        }

        try {
          // 根据 GlobalConfig.channels 决定 Gateway 通道服务启停
          const { configManager } = await import('../config/ConfigManager.js');
          const globalConfig = configManager.getGlobalConfig();
          const channelsConfig = globalConfig.channels;

          if (channelsConfig?.gateway?.enabled) {
            // Gateway 已启用 — 同步各通道入站开关到 CLI config
            try {
              const { cliConfigManager } = await import('../cli/config.js');
              const gatewayConfig = cliConfigManager.getGatewayConfig();
              gatewayConfig.telegram.enabled =
                channelsConfig.telegram?.enabled ?? false;
              gatewayConfig.websocket.enabled =
                (channelsConfig.qq?.enabled ?? false) ||
                (channelsConfig.discord?.enabled ?? false);
            } catch {
              // 忽略
            }
          } else {
            // Gateway 未启用 — 强制关闭
            try {
              const { cliConfigManager } = await import('../cli/config.js');
              const gatewayConfig = cliConfigManager.getGatewayConfig();
              gatewayConfig.enabled = false;
              gatewayConfig.websocket.enabled = false;
            } catch {
              // 忽略
            }
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
            logger.debug('Gateway 通道自动启动失败（非关键）', {
              error: setupError,
            });
          }

          // 通道已由 Gateway 系统（ChannelPluginRegistry）统一管理
          // ChannelRegistry（channels/registry/）作为其薄代理自动同步

          // 注册 Gateway 优雅关闭处理
          const { disconnectAllChannels } =
            await import('../core/gateway/index.js');
          registerShutdownHandler(() => disconnectAllChannels());

          const duration = Date.now() - startTime;
          if (duration > 100) {
            logger.warning(`Gateway 服务加载较慢: ${duration}ms`);
          }
          gatewayBreaker.recordSuccess();
          return { success: true, duration };
        } catch (error) {
          gatewayBreaker.recordFailure();
          logger.debug('预加载 Gateway 服务失败（非关键）', { error });
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

  // 记录初始化结束
  profileCheckpoint('init_function_end');

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

      // 预加载会话网关（替代 SessionManager）
      (async () => {
        try {
          await import('../session/SessionGateway.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 初始化 SessionStateBridge：将 SessionLifecycleEventBus 桥接到 SessionStateService
      (async () => {
        try {
          const { getGlobalEventBus } =
            await import('../session/lifecycle/SessionLifecycleEventBus.js');
          const { SessionStateBridge } =
            await import('../chat/services/SessionStateBridge.js');
          const bridge = new SessionStateBridge(getGlobalEventBus());
          bridge.connect();
          logger.info('SessionStateBridge 已连接: 生命周期事件 → 会话状态服务');
        } catch (error) {
          logger.warning('SessionStateBridge 初始化失败，流量不受影响', {
            error,
          });
        }
      })(),

      // 启动 Chronos 后台维护（梦境定时任务 + 周期性清理）
      (async () => {
        try {
          const { startBackgroundHousekeeping, stopBackgroundHousekeeping } =
            await import('../chronos/maintenance/ChronosBackgroundHousekeeping.js');
          startBackgroundHousekeeping();
          registerShutdownHandler(() => stopBackgroundHousekeeping());
          logger.info('Chronos 后台维护已启动（梦境定时任务 + 周期性清理）');
        } catch (error) {
          logger.debug('Chronos 后台维护启动失败（非关键）', { error });
        }
      })(),

      // 启动 SessionSupervisor 会话监管器（空闲检测 + 自动回收）
      (async () => {
        try {
          const { SessionGateway } =
            await import('../session/SessionGateway.js');
          const { SessionManagerAdapter } =
            await import('../session/SessionManagerAdapter.js');
          const { SessionSupervisor } =
            await import('../core/session/SessionSupervisor.js');
          const { createSupervisorStore } =
            await import('../core/session/SessionStoreAdapter.js');
          const gateway = new SessionGateway();
          const adapter = new SessionManagerAdapter(gateway);
          const store = createSupervisorStore(adapter.store);
          const supervisor = new SessionSupervisor(store, {
            resetPolicy: {
              mode: 'idle',
              idleMinutes: 30,
              preserveMetadata: true,
            },
          });
          supervisor.start();
          (globalThis as Record<string, unknown>)['__sessionSupervisor'] =
            supervisor;
          registerShutdownHandler(() => {
            const sup = (globalThis as Record<string, unknown>)[
              '__sessionSupervisor'
            ];
            if (
              sup &&
              typeof (sup as Record<string, unknown>).dispose === 'function'
            ) {
              (sup as { dispose: () => void }).dispose();
            }
          });
          logger.info(
            'SessionSupervisor 已启动: 空闲检测 30min, 检查周期 5min'
          );
        } catch (error) {
          logger.warning('SessionSupervisor 启动失败，会话监管功能不可用', {
            error,
          });
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

      // 注册记忆查询提供者（MemorySummarizer → MemoryQueryProvider 适配）
      (async () => {
        try {
          const { MemoryManagerImpl } =
            await import('../memory/MemoryManager.js');
          const { MemorySummarizer } =
            await import('../memory/services/MemorySummarizer.js');
          const { setMemoryQueryProvider, getCurrentSessionContext } =
            await import('../services/prompt/MemoryPromptProvider.js');
          const summarizer = new MemorySummarizer(new MemoryManagerImpl());
          setMemoryQueryProvider({
            async getMemorySummaries(limit?: number) {
              const ctx = getCurrentSessionContext();
              return summarizer.getSummaries(limit, ctx ?? undefined);
            },
          });
        } catch (error) {
          logger.warning('记忆查询提供者注册失败', { error });
        }
      })(),

      // 注册知识库查询提供者（HybridKnowledgeRouter → KnowledgeSummarizer → KnowledgeQueryProvider 适配）
      (async () => {
        try {
          const { knowledgeDocsProvider, fileDocsProvider } =
            await import('../docs/FileDocsProvider.js');
          const { HybridKnowledgeRouter } =
            await import('@modules/knowledge/HybridKnowledgeRouter.js');
          const { KnowledgeSummarizer } =
            await import('../memory/services/KnowledgeSummarizer.js');
          const { setKnowledgeQueryProvider } =
            await import('../services/prompt/KnowledgePromptProvider.js');
          const router = new HybridKnowledgeRouter([
            fileDocsProvider,
            knowledgeDocsProvider,
          ]);
          const summarizer = new KnowledgeSummarizer(router);
          setKnowledgeQueryProvider(summarizer);
        } catch (error) {
          logger.warning('知识库查询提供者注册失败', { error });
        }
      })(),

      // 初始化用户知识库目录 + 旧路径数据迁移
      (async () => {
        try {
          const { mkdir } = await import('fs/promises');
          const { existsSync } = await import('fs');
          const { join } = await import('path');

          const userKnowledgeDir = join(resolvePyappHome(), 'knowledge');
          if (!existsSync(userKnowledgeDir)) {
            await mkdir(userKnowledgeDir, { recursive: true });
            logger.info('用户知识库目录已创建', { path: userKnowledgeDir });
          }

          const { migrateKnowledgeBase } =
            await import('../knowledge/KnowledgeMigration.js');
          const result = await migrateKnowledgeBase();
          if (result.migrated > 0) {
            logger.info(
              `旧知识库文档已迁移: ${result.migrated} 个迁移, ${result.skipped} 个跳过`
            );
          }
        } catch (error) {
          logger.warning('用户知识库目录初始化失败', { error });
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
