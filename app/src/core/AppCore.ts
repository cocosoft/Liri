/**
 * 应用核心类
 * 整合所有子系统，提供统一的入口和管理接口
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger } from '@modules/monitoring/logs/Logger';
import { TerminalComponents } from '@modules/ui/TerminalComponents.js';
import { TerminalUIIntegration } from '@modules/ui/TerminalUIIntegration.js';
import {
  ModuleDependencyManager,
  type ModuleDefinition,
} from './ModuleDependencyManager.js';
import { PluginEcosystem } from './PluginEcosystem.js';
import { pluginSystem } from '@modules/plugins/index.js';
import type { PluginSystem } from '@modules/plugins/index.js';
import { PluginSDK, type Plugin, type PluginSDKConfig } from './PluginSDK.js';
import { StartupProfiler } from '@modules/utils/startupProfiler.js';
import {
  StartupPreloader,
  initializeAndStartPreloading,
} from './performance/StartupPreloader.js';
import { LazyModuleLoader } from './utils/LazyModuleLoader.js';
import type { AppCoreConfig, AppCoreStartupOptions } from './AppCoreConfig';
import {
  setupGitWorktree,
  loadSessionPersistence,
  saveTerminalState,
  restoreTerminalState,
  showStartupReport,
} from './AppCoreStartupHelper';
import { initializeOTelSystem } from './AppCoreOTelHelper';

const logger = new Logger({ module: 'AppCore' });

/**
 * 应用核心
 */
export class AppCore {
  private static instance: AppCore;
  private config: AppCoreConfig;
  private profiler: StartupProfiler;
  private initialized: boolean = false;
  private sessionFactory:
    | import('../session/SessionFactory.js').SessionFactory
    | null = null;
  private worktreePath: string | null = null;
  private terminalBackupPath: string | null = null;

  private readonly lazyModuleManager: LazyModuleLoader<ModuleDependencyManager>;
  private readonly lazyEcosystem: LazyModuleLoader<PluginEcosystem>;
  private readonly lazyPluginSDK: LazyModuleLoader<PluginSDK>;
  private readonly lazyTerminalUI: LazyModuleLoader<TerminalUIIntegration>;

  /**
   * 是否使用旧版模块系统
   * 私有 getter，每次判断时读取最新配置
   */
  private get useLegacyModuleSystem(): boolean {
    return this.config.useLegacyModuleSystem === true;
  }

  constructor(config: AppCoreConfig) {
    this.config = {
      debug: false,
      // 如果环境变量设置了旧版标志，自动启用
      useLegacyModuleSystem:
        process.env.LIRI_USE_LEGACY_MODULE_SYSTEM === '1',
      ...config,
    };

    this.profiler = new StartupProfiler();

    // 旧版模块系统才需要 ModuleDependencyManager
    this.lazyModuleManager = new LazyModuleLoader(
      () => new ModuleDependencyManager()
    );

    this.lazyEcosystem = new LazyModuleLoader(
      () => new PluginEcosystem(this.config.ecosystem)
    );

    this.lazyTerminalUI = new LazyModuleLoader(() =>
      TerminalUIIntegration.getInstance()
    );

    this.lazyPluginSDK = new LazyModuleLoader(async () => {
      const ecosystem = await this.lazyEcosystem.get();

      // 非旧版模式下 PluginSDK 不需要 ModuleDependencyManager
      if (!this.useLegacyModuleSystem) {
        const sdkConfig: PluginSDKConfig = {
          ecosystem,
          moduleManager: undefined as any,
        };
        return new PluginSDK(sdkConfig);
      }

      const moduleManager = await this.lazyModuleManager.get();
      const sdkConfig: PluginSDKConfig = {
        ecosystem,
        moduleManager,
      };
      return new PluginSDK(sdkConfig);
    });
  }

  private get moduleManager(): ModuleDependencyManager {
    return this.lazyModuleManager.getSync();
  }

  private get ecosystem(): PluginEcosystem {
    return this.lazyEcosystem.getSync();
  }

  private get pluginSDK(): PluginSDK {
    return this.lazyPluginSDK.getSync();
  }

  private get terminalUI(): TerminalUIIntegration {
    return this.lazyTerminalUI.getSync();
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: AppCoreConfig): AppCore {
    if (!AppCore.instance) {
      if (!config) {
        throw new AppError(
          'AppCore must be initialized with config first',
          ErrorCategory.CONFIGURATION,
          ErrorSeverity.HIGH
        );
      }
      AppCore.instance = new AppCore(config);
    }
    return AppCore.instance;
  }

  /**
   * 初始化应用
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('AppCore is already initialized');
      return;
    }

    this.profiler.start();
    this.profiler.checkpoint('initialization_start');

    try {
      TerminalComponents.printHeader(
        `初始化 ${this.config.name} v${this.config.version}`
      );

      // T0: 启动流程增强
      // T0.1: 终端状态备份
      if (this.config.startup?.terminalBackup) {
        this.terminalBackupPath = await saveTerminalState();
        this.profiler.checkpoint('terminal_backup_done');
      }

      // T0.2: Session 持久化加载
      if (this.config.startup?.session?.enabled) {
        this.sessionFactory = await loadSessionPersistence(this.config);
        this.profiler.checkpoint('session_loaded');
      }

      // T1: 并行预加载
      const preloader = initializeAndStartPreloading();
      this.profiler.checkpoint('preload_started');

      if (this.useLegacyModuleSystem) {
        // 旧版路径：并行加载独立核心子系统（ModuleManager、Ecosystem、TerminalUI 互无依赖）
        await Promise.all([
          this.lazyModuleManager.get(),
          this.lazyEcosystem.get(),
          this.lazyTerminalUI.get(),
        ]);
        this.profiler.checkpoint('core_subsystems_loaded');

        // PluginSDK 依赖 ModuleManager + Ecosystem，在前两者加载完成后初始化
        await this.lazyPluginSDK.get();
        this.profiler.checkpoint('plugin_sdk_loaded');

        await this.initializeCoreModules();
        this.profiler.checkpoint('core_modules_initialized');
      } else {
        // 统一路径：Ecosystem 和 TerminalUI 仍然需要，ModuleManager 由 ModuleRegistry 管理
        await Promise.all([
          this.lazyEcosystem.get(),
          this.lazyTerminalUI.get(),
        ]);
        this.profiler.checkpoint('core_subsystems_loaded');

        // PluginSDK 在非旧版模式下不需要 ModuleDependencyManager
        await this.lazyPluginSDK.get();
        this.profiler.checkpoint('plugin_sdk_loaded');
      }

      // 初始化成本跟踪系统
      await this.initializeCostTrackingSystem();
      this.profiler.checkpoint('cost_tracking_initialized');

      // 初始化 OpenTelemetry 观测系统（依赖核心模块完成）
      await initializeOTelSystem();
      this.profiler.checkpoint('otel_initialized');

      // 等待预加载完成
      const preloadResult = await preloader.ensureAllCompleted();
      this.profiler.checkpoint('preload_completed');

      if (!preloadResult.success) {
        logger.warn(`${preloadResult.failedTasks.length} preload tasks failed`);
      }

      // T0.3: Git 工作树创建
      if (this.config.startup?.worktree?.enabled) {
        this.worktreePath = await setupGitWorktree(this.config);
        this.profiler.checkpoint('worktree_created');
      }

      // 初始化插件系统
      await this.initializePluginSystem();
      this.profiler.checkpoint('plugin_system_initialized');

      // 初始化终端UI
      await this.initializeTerminalUI();
      this.profiler.checkpoint('terminal_ui_initialized');

      this.initialized = true;

      // 显示性能报告
      showStartupReport(
        this.config,
        this.profiler,
        this.useLegacyModuleSystem,
        this.useLegacyModuleSystem ? this.moduleManager : undefined,
        this.ecosystem
      );

      TerminalComponents.printSuccess(`${this.config.name} 初始化完成`);
      logger.info(
        `${this.config.name} v${this.config.version} initialized successfully`
      );
    } catch (error) {
      logger.error('Failed to initialize AppCore:', error as Error);
      throw error;
    }
  }

  /**
   * 初始化核心模块（旧版 ModuleDependencyManager 路径）
   */
  private async initializeCoreModules(): Promise<void> {
    // 注册核心模块
    const coreModules: ModuleDefinition[] = [
      {
        name: 'logger',
        version: '1.0.0',
        description: '日志系统',
        dependencies: [],
        priority: 100,
        init: async () => {
          logger.info('Logger module initialized');
        },
      },
      {
        name: 'terminal',
        version: '1.0.0',
        description: '终端UI系统',
        dependencies: ['logger'],
        priority: 90,
        init: async () => {
          logger.info('Terminal module initialized');
        },
      },
      {
        name: 'ecosystem',
        version: '1.0.0',
        description: '插件生态系统',
        dependencies: ['logger'],
        priority: 80,
        init: async () => {
          logger.info('Ecosystem module initialized');
        },
      },
      {
        name: 'sdk',
        version: '1.0.0',
        description: '插件SDK',
        dependencies: ['ecosystem'],
        priority: 70,
        init: async () => {
          logger.info('SDK module initialized');
        },
      },
    ];

    for (const module of coreModules) {
      this.moduleManager.registerModule(module);
    }

    await this.moduleManager.initializeAll();
  }

  /**
   * 初始化成本跟踪系统
   */
  private async initializeCostTrackingSystem(): Promise<void> {
    try {
      const { initializeCostTrackingSystem: initCostTracking } =
        await import('@modules/cost/index.js');
      await initCostTracking();
      logger.info('成本跟踪系统初始化完成');
    } catch (error) {
      logger.error(
        '成本跟踪系统初始化失败',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 初始化插件系统
   * 启动 PluginSystem（懒加载核心），并绑定到 PluginEcosystem（展示层）
   */
  private async initializePluginSystem(): Promise<void> {
    // 初始化 PluginSystem（懒加载模式，注册内核服务）
    await pluginSystem.initialize();

    // 绑定到 PluginEcosystem，使展示层可查询 PluginSystem 数据
    this.ecosystem.bindPluginSystem(pluginSystem);

    // 注册示例插件（通过 SDK）
    const examplePlugin = PluginSDK.createExamplePlugin();
    await this.pluginSDK.registerPlugin(examplePlugin);

    logger.info('Plugin system initialized');
  }

  /**
   * 初始化终端UI
   */
  private async initializeTerminalUI(): Promise<void> {
    this.terminalUI.showWelcomeScreen();
    logger.info('Terminal UI initialized');
  }

  // ==================== 插件 Facade 方法 ====================

  /**
   * 注册插件
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    await this.pluginSDK.registerPlugin(plugin);
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<void> {
    await this.pluginSDK.activatePlugin(pluginId);
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    await this.pluginSDK.deactivatePlugin(pluginId);
  }

  /**
   * 执行技能
   */
  async executeSkill(
    pluginId: string,
    skillId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.pluginSDK.executeSkill(pluginId, skillId, args);
  }

  // ==================== 弃用方法（旧版模块系统） ====================

  /**
   * 注册模块
   * @deprecated 使用 ModuleRegistry 替代。旧版模块系统（ModuleDependencyManager）的接口。
   *   在非旧版模式下调用此方法将产生警告并忽略。
   */
  registerModule(module: ModuleDefinition): void {
    if (!this.useLegacyModuleSystem) {
      logger.warn('registerModule() 已被弃用，请使用 ModuleRegistry 替代');
      return;
    }
    this.moduleManager.registerModule(module);
  }

  /**
   * 获取模块管理器
   * @deprecated 使用 ModuleRegistry 替代。旧版模块系统（ModuleDependencyManager）的接口。
   *   在非旧版模式下调用此方法将抛出错误。
   */
  getModuleManager(): ModuleDependencyManager {
    if (!this.useLegacyModuleSystem) {
      throw new AppError(
        'getModuleManager() 已被弃用。非旧版模式下请使用 ModuleRegistry 替代。',
        ErrorCategory.CONFIGURATION,
        ErrorSeverity.HIGH
      );
    }
    return this.moduleManager;
  }

  // ==================== 访问器 ====================

  /**
   * 获取插件系统
   * 返回 PluginSystem 实例（数据源）
   */
  getPluginSystem(): PluginSystem {
    return pluginSystem;
  }

  /**
   * 获取插件生态系统（Deprecated）
   * @deprecated 请使用 getPluginSystem() 代替
   */
  getEcosystem(): PluginEcosystem {
    return this.ecosystem;
  }

  /**
   * 获取插件SDK
   */
  getPluginSDK(): PluginSDK {
    return this.pluginSDK;
  }

  /**
   * 获取终端UI
   */
  getTerminalUI(): TerminalUIIntegration {
    return this.terminalUI;
  }

  /**
   * 显示系统状态
   */
  showSystemStatus(): void {
    TerminalComponents.clearScreen();
    TerminalComponents.printHeader(`${this.config.name} 系统状态`);

    const stats: [string, string][] = [
      ['应用名称', `${this.config.name} v${this.config.version}`],
      ['初始化状态', this.initialized ? '已完成' : '未初始化'],
      ['模块数量', this.useLegacyModuleSystem
        ? this.moduleManager.getModules().length.toString()
        : '由 ModuleRegistry 管理'],
      ['插件数量', this.ecosystem.getAllPlugins().length.toString()],
      ['技能数量', this.ecosystem.getAllSkills().length.toString()],
    ];

    TerminalComponents.printKeyValue(stats);
  }
}

/**
 * 创建 AppCore 实例（便捷工厂函数）
 */
export function createAppCore(config: AppCoreConfig): AppCore {
  return new AppCore(config);
}

// 向后兼容：保持从 core/index.ts 的导入路径不变
export type { AppCoreConfig } from './AppCoreConfig';
