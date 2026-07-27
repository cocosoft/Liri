/**
 * BootPipelineIntegrator — 启动管道集成器
 *
 * 将现有启动代码（main.ts launch()、entrypoints/init.ts、AppCore.initialize()）
 * 迁移到 BootPipeline 的 8 阶段架构。
 *
 * 职责:
 * 1. 注册各阶段的标准处理器（从现有代码迁移而来）
 * 2. 提供单步执行入口，替代 launch() 中直接调用 DIContainer.bootstrap()
 * 3. 保持与现有代码的向后兼容
 */

import { getLogger } from '@modules/monitoring';
import { BootPhase } from './BootPhase';
import { bootPipeline } from './BootPipeline';
import type { BootContext } from './BootPipeline';
import type { RouterTier } from '@modules/ai/router';

const logger = getLogger('BootPipelineIntegrator');

/**
 * 注册标准启动处理器
 *
 * 将当前 launch() 中的初始化逻辑按阶段注册到 BootPipeline。
 * 各阶段职责与现有代码的映射关系：
 *
 *   Phase 1 ENV_DETECT    ← main.ts 环境检测部分（setupWindowsSecurity, 信号处理）
 *   Phase 2 CONFIG_LOAD   ← entrypoints/init.ts 配置加载部分（startup.yaml, enableConfigs）
 *   Phase 3 CORE_INFRA    ← 核心基础设施就绪确认（Logger/Error/EventBus 已在 import 时初始化）
 *   Phase 4 DI_STARTUP    ← launch() V2 路径: DIContainer.bootstrap()
 *   Phase 5 DOMAIN_INIT   ← launch() T1.25-T1.8: ModelRegistry, SmartRouter, ACP 桥接
 *   Phase 6 INFRA_STARTUP ← entrypoints/init.ts 并行初始化部分（tools, commands, monitoring, gateway）
 *   Phase 7 INTERFACE_START ← launch() T2 模式分发
 *   Phase 8 BOOT_COMPLETE  ← 启动完成报告
 */
export function registerStandardHandlers(): void {
  // ============================================================
  // Phase 1: 环境检测
  // 说明：setupWindowsSecurity()、checkSingletonInstance()、uncaughtException 信号处理
  //   必须在所有模块加载之前注册，因此由 main.ts launch() 直接执行，不在管道中重复。
  //   此处理器仅做就绪确认和日志记录。
  // ============================================================
  bootPipeline.register({
    id: 'env:detect',
    phase: BootPhase.ENV_DETECT,
    handler: async (ctx: BootContext) => {
      logger.info(`[Phase 1] 环境检测 — 模式: ${ctx.mode}`);

      // 验证 LIRI_HOME 已设置（由 main.ts 在调用管道前设置）
      if (!process.env.LIRI_HOME) {
        logger.warn('[Phase 1] LIRI_HOME 未设置，启动路径可能不完整');
      }

      // 验证 Windows 安全适配已执行（由 main.ts 在调用管道前执行）
      if (process.platform === 'win32') {
        logger.debug('[Phase 1] Windows 安全适配就绪');
      }

      logger.info('[Phase 1] 环境检测完成');
    },
    priority: 0,
    description: '运行时环境检测与系统兼容性检查',
  });

  // ============================================================
  // Phase 2: 配置加载
  // 迁移自: entrypoints/init.ts init()
  //   0. 加载 startup.yaml
  //   1. 加载用户数据目录配置
  //   2. 启用配置系统 enableConfigs()
  //   3. 确保数据目录结构完整
  //   4. 设置优雅关闭
  // ============================================================
  bootPipeline.register({
    id: 'config:load',
    phase: BootPhase.CONFIG_LOAD,
    handler: async (_ctx: BootContext) => {
      logger.info('[Phase 2] 配置加载');

      // 0. 加载 startup.yaml（在 enableConfigs 之前，以影响配置加载行为）
      const { loadStartupConfig, formatConfigSummary } =
        await import('@modules/bootstrap/StartupYamlLoader.js');
      const startupResult = loadStartupConfig();
      if (startupResult.found) {
        logger.info(
          `startup.yaml 配置摘要: ${formatConfigSummary(startupResult.config)}`
        );
      }
      // 将 startup 配置写入上下文供后续阶段使用
      _ctx.data.set('startupConfig', startupResult.config);

      // 1. 加载用户数据目录配置
      try {
        const { loadUserSettings } =
          await import('../../config/settings/userSettings.js');
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
      } catch (err) {
        logger.debug('加载用户数据目录配置失败（使用默认值）');
      }

      // 2. 启用配置系统
      const { enableConfigs } = await import('@modules/config');
      enableConfigs();

      // 3. 确保所有数据目录结构完整
      const { ensureDataDirectories } = await import('@modules/core');
      ensureDataDirectories();

      // 4. 设置优雅关闭
      const { setupGracefulShutdown } =
        await import('@modules/utils/gracefulShutdown.js');
      setupGracefulShutdown();

      logger.info('[Phase 2] 配置加载完成');
    },
    priority: 0,
    description: '配置加载与 ConfigManager 初始化',
  });

  // ============================================================
  // Phase 3: 核心基础设施初始化
  // 说明：Logger/Error/EventBus/State 已在模块 import 时完成初始化。
  //   此阶段确认这些基础设施已就绪，可被下游使用。
  // ============================================================
  bootPipeline.register({
    id: 'core:infra',
    phase: BootPhase.CORE_INFRA,
    handler: async (_ctx: BootContext) => {
      logger.info('[Phase 3] 核心基础设施 — 就绪确认');

      // Logger 已在模块级初始化，确认可用
      logger.debug('[Phase 3] Logger 就绪');

      // 确认 Error 系统可用（ErrorService 模块尚未实现，跳过）
      logger.debug('[Phase 3] Error 服务检查跳过（模块未实现）');

      // 注册启动配置到日志系统（如果配置已加载）
      try {
        const { configManager } = await import('@modules/config');
        if (configManager) {
          logger.debug('[Phase 3] ConfigManager 就绪');
        }
      } catch (err) {
        // config 可能尚未完全就绪，跳过
      }

      logger.info('[Phase 3] 核心基础设施确认完成');
    },
    priority: 0,
    description: 'Logger, Error, State, EventBus 就绪确认',
  });

  // ============================================================
  // Phase 4: DIContainer 启动
  // 迁移自: launch() V2 路径: DIContainer.bootstrap()
  // ============================================================
  bootPipeline.register({
    id: 'di:startup',
    phase: BootPhase.DI_STARTUP,
    handler: async (ctx: BootContext) => {
      logger.info('[Phase 4] DIContainer 启动');
      const { getDIContainer } = await import('../DIContainer');
      const { moduleRegistry } = await import('../../modules/ModuleRegistry');
      await getDIContainer().bootstrap(moduleRegistry, {
        mode: ctx.mode,
        args: ctx.args,
        debug: ctx.debug,
        verbose: ctx.verbose,
        skipEnvInit: ctx.skipEnvInit,
      });
    },
    priority: 0,
    description: 'DIContainer 启动 — 服务注册 → 依赖解析 → 自动装配',
  });

  // ============================================================
  // Phase 5: 领域模块初始化
  // 迁移自: launch() T1.25-T1.8
  //   - ModelRegistry 加载默认模型 + 用户配置
  //   - ModelPricingService 初始化
  //   - ACP 模块桥接
  //   - SmartRouter 初始化
  // ============================================================
  bootPipeline.register({
    id: 'domain:init',
    phase: BootPhase.DOMAIN_INIT,
    handler: async (ctx: BootContext) => {
      logger.info('[Phase 5] 领域模块初始化');

      // T1.2: 从环境变量读取信任的工作区
      try {
        const { configManager } = await import('@modules/config');
        const trustedWorkspace = process.env['LIRI_TRUSTED_WORKSPACE'];
        if (trustedWorkspace) {
          const existing = configManager.getConfigValue<any>('permission');
          if (!existing?.trustedWorkspaces?.length) {
            let wsPath = trustedWorkspace;
            let wsLevel = 'development';
            const pipeIdx = trustedWorkspace.lastIndexOf('|');
            if (pipeIdx > 0) {
              wsPath = trustedWorkspace.slice(0, pipeIdx);
              wsLevel = trustedWorkspace.slice(pipeIdx + 1);
            }
            configManager.setConfigValue('permission', {
              mode: 'default',
              trustedWorkspaces: [
                { path: wsPath, trustLevel: wsLevel, enabled: true },
              ],
            });
          }
        }
      } catch (err) {
        // 非致命：env 读取失败时静默跳过
      }

      // T1.25: 加载模型配置
      try {
        const { ModelRegistry } =
          await import('@modules/ai/models/ModelRegistry');
        const registry = ModelRegistry.getInstance();
        registry.loadDefaultModels();
        registry.loadUserConfigs();

        // 初始化模型注册表 DB
        const { modelPricingService } =
          await import('@modules/ai/models/ModelPricingService.js').catch(
            () => ({
              modelPricingService: null as unknown as {
                initialize: () => Promise<void>;
              },
            })
          );
        if (modelPricingService) {
          await modelPricingService.initialize();
        } else {
          await registry.loadDbPricing();
        }
        logger.info('[Phase 5] ModelRegistry 加载完成');
      } catch (e) {
        logger.warning('[Phase 5] 加载模型配置失败（非致命）', e as Error);
      }

      // T1.75: 初始化 ACP 模块桥接（非阻塞）
      try {
        const { setupModuleBridgeOnStartup } =
          await import('../../bridge/ModuleBridgeSetup.js');
        await setupModuleBridgeOnStartup();
        logger.info('[Phase 5] ACP 模块桥接初始化完成');
      } catch (e) {
        logger.warning(
          '[Phase 5] ACP 模块桥接初始化异常（非致命）',
          e as Error
        );
      }

      // T1.8: 初始化 SmartRouter 智能路由
      try {
        const { SmartRouter } = await import('@modules/ai/router/SmartRouter');
        const { providerRegistry } =
          await import('@modules/ai/providers/ProviderRegistry');
        const { configManager } = await import('@modules/config/ConfigManager');

        const routerCfg =
          (configManager.getConfigValue<Record<string, unknown>>(
            'models.router'
          ) as Record<string, unknown>) || {};
        const routerConfig = {
          enabled: routerCfg?.enabled !== false,
          defaultTier: ((routerCfg?.defaultTier as RouterTier) ||
            'medium') as RouterTier,
          sessionSticky: routerCfg?.sessionSticky !== false,
          tiers: {
            simple: { model: 'deepseek-v4-flash', providerHint: 'deepseek' },
            medium: { model: 'deepseek-v4-flash', providerHint: 'deepseek' },
            complex: { model: 'deepseek-v4-pro', providerHint: 'deepseek' },
            reasoning: { model: 'deepseek-reasoner', providerHint: 'deepseek' },
          },
        };

        const smartRouter = new SmartRouter({
          config: routerConfig,
          providerRegistry,
        });

        const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
        getCoreAPI().setSmartRouter(smartRouter);
        logger.info('[Phase 5] SmartRouter 已初始化并注入 CoreAPIImpl');
      } catch (e) {
        logger.warning(
          '[Phase 5] SmartRouter 初始化失败（非致命，使用静态路由）',
          e as Error
        );
      }

      logger.info('[Phase 5] 领域模块初始化完成');
    },
    priority: 0,
    description: 'Agent, Chat, Session, Memory 等业务模块',
  });

  // ============================================================
  // Phase 6: 基础设施启动
  // 迁移自: entrypoints/init.ts 并行初始化部分
  //   - 工具系统 (createToolManager)
  //   - 命令系统 (initializeCommands)
  //   - 监控服务 (getMonitoringService().start())
  //   - 模型管理 (initializeModelManagementServices)
  //   - Gateway + CoreAPI
  // ============================================================
  bootPipeline.register({
    id: 'infra:startup',
    phase: BootPhase.INFRA_STARTUP,
    handler: async (_ctx: BootContext) => {
      logger.info('[Phase 6] 基础设施启动');

      const results = await Promise.allSettled([
        // 6a: 初始化工具系统
        (async () => {
          try {
            const { createToolManager } =
              await import('../../tools/ToolManager.js');
            createToolManager();
            logger.info('[Phase 6] 工具系统初始化完成');
          } catch (e) {
            logger.warning('[Phase 6] 工具系统初始化失败', {
              error: String(e),
            });
          }
        })(),

        // 6b: 初始化命令系统
        (async () => {
          try {
            const { initializeCommands } = await import('@modules/commands');
            await initializeCommands();
            logger.info('[Phase 6] 命令系统初始化完成');
          } catch (e) {
            logger.warning('[Phase 6] 命令系统初始化失败', {
              error: String(e),
            });
          }
        })(),

        // 6c: 初始化监控服务
        (async () => {
          try {
            const { getMonitoringService } =
              await import('@modules/monitoring/index.js');
            const monitoringService = getMonitoringService();
            monitoringService.start();
            logger.info('[Phase 6] 监控服务已启动');
          } catch (e) {
            logger.warning('[Phase 6] 监控服务启动失败', {
              error: String(e),
            });
          }
        })(),

        // 6d: 初始化模型管理服务
        (async () => {
          try {
            const { initializeModelManagementServices } =
              await import('../../ai/ModelManagementBootstrap.js');
            await initializeModelManagementServices();
            logger.info('[Phase 6] 模型管理服务初始化完成');
          } catch (e) {
            logger.warning('[Phase 6] 模型管理服务初始化失败', {
              error: String(e),
            });
          }
        })(),

        // 6e: 初始化 CoreAPI + Gateway
        (async () => {
          try {
            const { getCoreAPI } =
              await import('../../runtime/api/CoreAPIImpl.js');
            getCoreAPI();

            const { configManager } =
              await import('@modules/config/ConfigManager');
            const globalConfig = configManager.getGlobalConfig();
            const channelsConfig = globalConfig.channels;

            if (channelsConfig?.gateway?.enabled) {
              try {
                const { cliConfigManager } =
                  await import('../../cli/config.js');
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
              try {
                const { cliConfigManager } =
                  await import('../../cli/config.js');
                const gatewayConfig = cliConfigManager.getGatewayConfig();
                gatewayConfig.enabled = false;
                gatewayConfig.websocket.enabled = false;
              } catch (err) {
                // 忽略
              }
            }

            // Gateway 旧通道系统已于 2026-07 清理，由 channels/ 体系完全替代

            logger.info('[Phase 6] CoreAPI + Gateway 初始化完成');
          } catch (e) {
            logger.warning('[Phase 6] CoreAPI/Gateway 初始化失败（非关键）', {
              error: String(e),
            });
          }
        })(),
      ]);

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        logger.warning(
          `[Phase 6] ${failed} 个基础设施组件启动失败（均非关键）`
        );
      }
      logger.info('[Phase 6] 基础设施启动完成');
    },
    priority: 0,
    description: 'Cache, Channels, Security, Monitoring',
  });

  // ============================================================
  // Phase 7: 接口层启动
  // 说明：模式分发（CLI/REPL/MCP/DAEMON/TEST）由 launch() T2 处理，
  //   此阶段目前仅记录，实际分发仍在 launch() 中完成以保持兼容。
  //   后续版本可逐步将各模式启动器注册为 Phase 7 的子处理器。
  // ============================================================
  bootPipeline.register({
    id: 'interface:start',
    phase: BootPhase.INTERFACE_START,
    handler: async (ctx: BootContext) => {
      logger.info(`[Phase 7] 接口层启动 — 准备模式分发: ${ctx.mode}`);
      // 模式分发由 launch() 的 switch/case 处理
    },
    priority: 0,
    description: 'CLI, API, WebSocket 等外部接口',
  });

  // ============================================================
  // Phase 8: 启动完成回调
  // 迁移自: launch() T3 延迟加载 + 性能报告
  // ============================================================
  bootPipeline.register({
    id: 'boot:complete',
    phase: BootPhase.BOOT_COMPLETE,
    handler: async (_ctx: BootContext) => {
      logger.info('[Phase 8] 启动完成');

      // 记录启动链路 SLO 报告
      try {
        const { getStartupChainProfiler } =
          await import('@modules/bootstrap/StartupChainProfiler.js');
        const sloReport = getStartupChainProfiler().generateSLOReport();
        if (getStartupChainProfiler().getFailures().length > 0) {
          logger.warning('启动阶段存在性能红线超标', {
            failures: getStartupChainProfiler().getFailures().length,
          });
        }
      } catch (err) {
        // profiler 可能未启用，跳过
      }

      try {
        const { profileReport } =
          await import('@modules/performance/StartupProfiler.js');
        profileReport();
      } catch (err) {
        // profiler 可能未启用，跳过
      }

      logger.info('[Phase 8] 启动管道完成');
    },
    priority: 0,
    description: '启动完成回调',
  });
}

/**
 * 执行完整启动管道（便捷入口）
 *
 * 注册标准处理器后执行管道，适合从 launch() 或测试中调用。
 *
 * @param options - 启动选项
 * @returns 启动结果
 */
export async function executePipeline(options?: {
  mode?: BootContext['mode'];
  args?: string[];
  debug?: boolean;
  verbose?: boolean;
  skipEnvInit?: boolean;
}) {
  registerStandardHandlers();
  return await bootPipeline.execute(options);
}
