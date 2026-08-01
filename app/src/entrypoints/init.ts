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

import { configManager, enableConfigs } from '@modules/config';
import { initializeCommands } from '@modules/commands';
import { getExtensibilityService } from '@modules/core/extensibility/index.js';
import {
  profileCheckpoint,
  profileReport,
} from '@modules/performance/StartupProfiler.js';
// @ts-ignore
import * as gracefulShutdownModule from '@modules/utils/gracefulShutdown.js';
const { gracefulShutdown, setupGracefulShutdown, registerShutdownHandler } =
  gracefulShutdownModule as unknown as {
    gracefulShutdown: () => void;
    setupGracefulShutdown: () => void;
    registerShutdownHandler: (handler: () => void) => void;
  };
import { getMonitoringService } from '@modules/monitoring/index.js';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  resolvePyappHome,
  ensureDataDirectories,
  globalEventBus,
} from '@modules/core';
import { getStartupChainProfiler } from '@modules/bootstrap/StartupChainProfiler.js';
import {
  loadStartupConfig,
  formatConfigSummary,
} from '@modules/bootstrap/StartupYamlLoader.js';
import type { StartupConfig } from '@modules/bootstrap/StartupConfig.js';

const logger = new Logger({ module: 'entrypoints:init', level: LogLevel.INFO });

/** 全局 startup 配置引用 */
let _startupConfig: StartupConfig | null = null;

/** 后台定时器引用数组，进程退出时统一清理 */
const backgroundTimers: ReturnType<typeof setInterval>[] = [];

/** 知识事件订阅引用数组，热重载时先退订再重订 */
const _knowledgeSubscriptions: { unsubscribe(): void }[] = [];

// 注册退出钩子：清理所有后台定时器
registerShutdownHandler(() => {
  for (const t of backgroundTimers) clearInterval(t);
  backgroundTimers.length = 0;
});

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
    const { setUserDataDirOverride } = await import('@modules/core/paths');

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

/**
 * @deprecated 环境初始化已集成到 ModuleRegistry.bootstrap()。
 * bootstrap() 内部通过 initializeEnvironment() 调用此函数，
 * 不再需要外部直接调用。将在未来版本中移除。
 */
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

      // 初始化可扩展性服务（包含插件系统）
      // Extensibility 子系统止血开关：设置 USE_LEGACY_EXTENSIBILITY=true 可启用旧的独立子系统
      // 默认跳过，使用 plugins/ PluginSystem 作为唯一插件入口
      (async () => {
        if (configManager.env('USE_LEGACY_EXTENSIBILITY') !== 'true') {
          profileCheckpoint('load_plugins_skip');
          return { success: true, duration: 0, skipped: true };
        }
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

      // 初始化模型管理服务（DB Provider 创建 + 环境变量种子 + 同步到 Registry）
      (async () => {
        profileCheckpoint('load_providers_start');
        getStartupChainProfiler().markPhaseStart('provider_init');
        const startTime = Date.now();
        try {
          const { initializeModelManagementServices } =
            await import('../ai/ModelManagementBootstrap.js');
          await initializeModelManagementServices();
          const duration = Date.now() - startTime;
          if (duration > 50) {
            logger.warning(`模型管理服务初始化较慢: ${duration}ms`);
          }
          return { success: true, duration };
        } catch (error) {
          logger.warning('模型管理服务初始化失败', { error });
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
            } catch (err) {
              // 忽略
            }
          } else {
            // Gateway 未启用 — 强制关闭
            try {
              const { cliConfigManager } = await import('../cli/config.js');
              const gatewayConfig = cliConfigManager.getGatewayConfig();
              gatewayConfig.enabled = false;
              gatewayConfig.websocket.enabled = false;
            } catch (err) {
              // 忽略
            }
          }

          // 预创建 CoreAPI 单例（使用全局默认依赖）
          const { getCoreAPI } = await import('../runtime/api/CoreAPIImpl.js');
          getCoreAPI();

          // Gateway 旧通道系统已于 2026-07 清理，由 channels/ 体系完全替代
          // 保留断路器记录以维持监控兼容

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
          const { getSystemContext, getUserContext } =
            contextModule as unknown as {
              getSystemContext: () => unknown;
              getUserContext: () => unknown;
            };
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
          await import('../ai/providers/OpenAIProvider.js');
        } catch (error) {
          // 忽略预加载错�?
        }
      })(),

      // 预加载治理管理器（仅在启用时）
      (async () => {
        try {
          const govCfg = await import('../../config/governance.json');
          if ((govCfg.default as { enabled?: boolean })?.enabled !== false) {
            await import('../governance/managers/GovernanceManager');
          }
        } catch {
          // 配置文件加载失败或 governance 已禁用，跳过
        }
      })(),

      // 预加载沙箱管理器
      (async () => {
        try {
          await import('../sandbox/SandboxManager.js');
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

      // 注册记忆查询提供者（MemorySummarizer → MemoryQueryProvider 适配）+ 启动老化清理
      (async () => {
        try {
          const { MemoryManagerImpl } =
            await import('../memory/MemoryManager.js');
          const { MemorySummarizer } =
            await import('../memory/services/MemorySummarizer.js');
          const { setMemoryQueryProvider, getCurrentSessionContext } =
            await import('../services/prompt/MemoryPromptProvider.js');
          const memoryManager = new MemoryManagerImpl();
          const summarizer = new MemorySummarizer(memoryManager);
          setMemoryQueryProvider({
            async getMemorySummaries(limit?: number) {
              const ctx = getCurrentSessionContext();
              return summarizer.getSummaries(limit, ctx ?? undefined);
            },
          });

          // 记忆老化自动清理（任务 1）：启动时先清理一次
          try {
            const cleaned = await memoryManager.cleanupExpiredMemories();
            if (cleaned > 0) {
              logger.info(`启动时清理了 ${cleaned} 条过期记忆`);
            }
          } catch (error) {
            logger.warning('启动时清理过期记忆失败', { error });
          }

          // 注册定时清理（每 6 小时），保存引用以便退出时清理
          backgroundTimers.push(
            setInterval(
              async () => {
                try {
                  const cleaned = await memoryManager.cleanupExpiredMemories();
                  if (cleaned > 0) {
                    logger.info(`定时清理了 ${cleaned} 条过期记忆`);
                  }
                } catch (error) {
                  logger.warning('定时清理过期记忆失败', { error });
                }
              },
              6 * 60 * 60 * 1000
            )
          );

          // 检查旧目录残留记忆文件（问题 2）
          try {
            const { mkdir, readdir, copyFile } = await import('fs/promises');
            const { existsSync } = await import('fs');
            const { join } = await import('path');
            const { resolveDataDir } = await import('@modules/core/paths');
            const legacyDir = join(resolveDataDir(), 'pyapp', 'data', 'memory');
            if (existsSync(legacyDir)) {
              const legacyFiles = await readdir(legacyDir);
              const mdFiles = legacyFiles.filter((f: string) =>
                f.endsWith('.md')
              );
              if (mdFiles.length > 0) {
                logger.warning(`发现 ${mdFiles.length} 个旧目录残留记忆文件`, {
                  legacyDir,
                });
                // 以归档方式复制到新目录，不做格式转换
                const archiveDir = join(resolveDataDir(), 'memory', '.legacy');
                await mkdir(archiveDir, { recursive: true });
                for (const file of mdFiles) {
                  await copyFile(join(legacyDir, file), join(archiveDir, file));
                }
                logger.info(`已将旧目录残留文件归档至 ${archiveDir}`);
              }
            }
          } catch (err) {
            // 旧目录检查失败不阻塞启动
          }
        } catch (error) {
          logger.warning('记忆查询提供者注册失败', { error });
        }
      })(),

      // P3-9: 自动记忆心跳 — 定期触发记忆老化检查与整合
      (async () => {
        try {
          const { AutoMemoryHeartbeat } =
            await import('../memory/AutoMemoryHeartbeat.js');
          const { startAutoArchive, stopAutoArchive } =
            await import('../memory/utils/MemoryAgeManager.js');
          const heartbeat = new AutoMemoryHeartbeat(async (action) => {
            try {
              switch (action.type) {
                case 'memory_age':
                  startAutoArchive();
                  return true;
                case 'dream':
                  // 记忆整合 — 当前为空操作，后续可接入 MemoryConsolidator
                  return true;
                default:
                  return false;
              }
            } catch {
              return false;
            }
          });
          heartbeat.start();
          registerShutdownHandler(() => {
            heartbeat.stop();
            stopAutoArchive();
          });
        } catch {
          // 心跳初始化失败不阻塞启动
        }
      })(),

      // 注册知识库查询提供者（HybridKnowledgeRouter → KnowledgeSummarizer → KnowledgeQueryProvider 适配）
      (async () => {
        try {
          const { knowledgeDocsProvider, fileDocsProvider } =
            await import('../docs/FileDocsProvider.js');
          const { KnowledgeSummarizer } =
            await import('../knowledge/KnowledgeSummarizer.js');
          const { setKnowledgeQueryProvider } =
            await import('../services/prompt/KnowledgePromptProvider.js');
          const { SemanticStore } =
            await import('@modules/knowledge/semantic/store.js');
          const { SemanticIndexUpdater } =
            await import('@modules/knowledge/SemanticIndexUpdater.js');
          const { globalEmbeddingManager } =
            await import('@modules/ai/embedding/EmbeddingManager.js');
          const { resolveDataSubDir } = await import('@modules/core/paths.js');

          // 创建共享 SemanticStore（路径与 SemanticIndexUpdater 保持一致）
          const indexDir = resolveDataSubDir('semantic-index');
          const semanticStore = new SemanticStore(indexDir, {
            provider: 'local',
            model: 'nomic-embed-text',
          });
          await semanticStore.load();

          // 初始化语义索引增量更新器（监听 knowledge:changed 事件）
          const semanticIndexUpdater = new SemanticIndexUpdater(
            globalEmbeddingManager,
            { indexDir },
            globalEventBus
          );
          await semanticIndexUpdater.initialize();

          // 创建 KnowledgeRouter 并注入 SemanticStore
          // 使用共享单例 knowledgeRouter，确保 KnowledgeDeleteTool 等模块可共享索引
          const { knowledgeRouter } =
            await import('@modules/knowledge/KnowledgeRouter.js');
          knowledgeRouter['providers'] = [
            fileDocsProvider,
            knowledgeDocsProvider,
          ];
          knowledgeRouter['semanticStore'] = semanticStore;

          // 注入 KnowledgeGraph 用于 GraphRAG 增强
          try {
            const { KnowledgeGraph } =
              await import('@modules/knowledge/graph/KnowledgeGraph.js');
            const { resolveDbPath } = await import('@modules/core/paths.js');
            const graph = new KnowledgeGraph(resolveDbPath());
            await graph.init();
            knowledgeRouter['knowledgeGraph'] = graph;
            logger.info('KnowledgeGraph 已注入 KnowledgeRouter');
          } catch (graphErr) {
            // GraphRAG 初始化失败不阻塞搜索
            logger.warning('KnowledgeGraph 注入失败，GraphRAG 暂不可用', {
              error: String(graphErr),
            });
          }

          // 注入 EventBus 实现增量索引更新（先退订防止热重载重复订阅）
          for (const sub of _knowledgeSubscriptions) sub.unsubscribe();
          _knowledgeSubscriptions.length = 0;
          _knowledgeSubscriptions.push(
            globalEventBus.subscribe('knowledge:changed', (event: unknown) => {
              const evt = event as { action: string; filePath: string };
              if (evt.action === 'deleted') {
                (knowledgeRouter['removeFromIndex'] as (fp: string) => void)?.(
                  evt.filePath
                );
              }
            })
          );
          await knowledgeRouter.buildIndex();
          const summarizer = new KnowledgeSummarizer(knowledgeRouter);
          setKnowledgeQueryProvider(summarizer);

          logger.info('语义索引更新器已启动', { indexDir });
        } catch (error) {
          logger.warning('知识库查询提供者注册失败', { error });
        }
      })(),

      // 初始化知识图谱孤儿边自动清理
      (async () => {
        try {
          // 延迟获取 KnowledgeRouter 中的 KnowledgeGraph（异步初始化可能尚未完成）
          const { knowledgeRouter: kr } =
            await import('@modules/knowledge/KnowledgeRouter.js');
          const graph = kr['knowledgeGraph'] as
            | import('@modules/knowledge/graph/KnowledgeGraph').KnowledgeGraph
            | undefined;

          if (!graph) {
            logger.info('KnowledgeGraph 未可用，跳过孤儿边清理注册');
            return;
          }

          // 监听删除事件，自动清理悬挂边（先退订防止热重载重复订阅）
          _knowledgeSubscriptions.push(
            globalEventBus.subscribe('knowledge:changed', (event: unknown) => {
              const evt = event as { action: string };
              if (evt.action === 'deleted') {
                // 延迟异步清理，不阻塞删除主流程
                setTimeout(async () => {
                  try {
                    // 获取所有当前有效的实体 ID（基于知识库文档标题）
                    const { knowledgeDocsProvider } =
                      await import('../docs/FileDocsProvider.js');
                    const docs = await knowledgeDocsProvider.buildIndex();
                    const validIds = new Set(
                      docs.map((d) =>
                        d.title.toLowerCase().replace(/\s+/g, '_')
                      )
                    );
                    const cleaned = await graph.cleanupOrphans(validIds);
                    if (cleaned > 0) {
                      logger.info('已清理知识图谱孤儿边', { cleaned });
                    }
                  } catch (cleanErr) {
                    // 清理失败不报错，下次操作时再清理
                  }
                }, 5000);
              }
            })
          );

          logger.info('知识图谱孤儿边清理监听已注册');
        } catch (error) {
          logger.warning('知识图谱初始化失败', { error: String(error) });
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
        } catch (err) {
          // 更新检查失败不影响启动
        }
      })(),

      // 初始化内置技能（BundledSkillLoader → SkillRegistry 注册）
      (async () => {
        try {
          const { initBuiltinSkills } =
            await import('../constants/systemPromptSections.js');
          await initBuiltinSkills();
          logger.info('内置技能初始化完成');
        } catch (error) {
          logger.warning('内置技能初始化失败（非关键）', { error });
        }
      })(),

      // 初始化技能生命周期（辅助组件 DB 持久化 + 事件订阅）
      (async () => {
        try {
          const { skillRegistry } =
            await import('../constants/systemPromptSections.js');
          const { getSkillDB, initializeSkillLifecycle } =
            await import('../skills/persistence/index.js');
          const skillDB = getSkillDB();
          await initializeSkillLifecycle(skillRegistry, skillDB);
          logger.info('技能生命周期初始化完成');
        } catch (error) {
          logger.warning('技能生命周期初始化失败（非关键）', { error });
        }
      })(),

      // 注册第三方适配器（ClawHubAdapter → ThirdPartyAdapterRegistry）
      (async () => {
        try {
          const { ClawHubAdapter } =
            await import('../skills/loaders/adapter/clawhub/ClawHubAdapter.js');
          const { thirdPartyAdapterRegistry, getSkillHub } =
            await import('../skills/index.js');
          const { skillRegistry } =
            await import('../constants/systemPromptSections.js');
          const adapter = ClawHubAdapter.getInstance();
          await adapter.initialize();
          // 注入 SkillRegistry 引用，使安装/卸载操作同步通知 Registry
          adapter.setSkillRegistry(skillRegistry);
          thirdPartyAdapterRegistry.register(adapter);
          logger.info('ClawHubAdapter 已注册到 ThirdPartyAdapterRegistry');
        } catch (error) {
          logger.warning('ClawHubAdapter 注册失败（非关键）', {
            error: error instanceof Error ? error.message : String(error),
          });
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
