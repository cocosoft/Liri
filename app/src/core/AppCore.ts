/**
 * 应用核心类
 * 整合所有子系统，提供统一的入口和管理接口
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { logger } from '@modules/utils/log.js';
import { TerminalComponents } from '@modules/ui/TerminalComponents.js';
import { TerminalUIIntegration } from '@modules/ui/TerminalUIIntegration.js';
import {
  ModuleDependencyManager,
  ModuleDefinition,
} from './ModuleDependencyManager.js';
import { PluginEcosystem, EcosystemConfig } from './PluginEcosystem.js';
import { PluginSDK, Plugin, PluginSDKConfig } from './PluginSDK.js';
import { StartupProfiler } from '@modules/utils/startupProfiler.js';
import {
  StartupPreloader,
  initializeAndStartPreloading,
} from './performance/StartupPreloader.js';
import { LazyModuleLoader } from './utils/LazyModuleLoader.js';
import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { resolveSessionsDir, resolveDataDir } from '@modules/core/paths';

/**
 * Git 工作树创建选项
 */
export interface WorktreeOptions {
  enabled: boolean;
  name?: string;
  prNumber?: number;
  tmuxEnabled?: boolean;
}

/**
 * 会话持久化加载选项
 */
export interface SessionStartupOptions {
  enabled: boolean;
  sessionId?: string;
  storageDir?: string;
}

/**
 * 启动流程增强选项
 */
export interface AppCoreStartupOptions {
  worktree?: WorktreeOptions;
  session?: SessionStartupOptions;
  terminalBackup?: boolean;
}

/**
 * 应用配置
 */
export interface AppCoreConfig {
  name: string;
  version: string;
  debug?: boolean;
  ecosystem?: EcosystemConfig;
  startup?: AppCoreStartupOptions;
}

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

  constructor(config: AppCoreConfig) {
    this.config = {
      debug: false,
      ...config,
    };

    this.profiler = new StartupProfiler();

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
        await this.saveTerminalState();
        this.profiler.checkpoint('terminal_backup_done');
      }

      // T0.2: Session 持久化加载
      if (this.config.startup?.session?.enabled) {
        await this.loadSessionPersistence();
        this.profiler.checkpoint('session_loaded');
      }

      // T1: 并行预加载
      const preloader = initializeAndStartPreloading();
      this.profiler.checkpoint('preload_started');

      // 并行加载独立核心子系统（ModuleManager、Ecosystem、TerminalUI 互无依赖）
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

      // 初始化成本跟踪系统
      await this.initializeCostTrackingSystem();
      this.profiler.checkpoint('cost_tracking_initialized');

      // 初始化 OpenTelemetry 观测系统（依赖核心模块完成）
      await this.initializeOTelSystem();
      this.profiler.checkpoint('otel_initialized');

      // 等待预加载完成
      const preloadResult = await preloader.ensureAllCompleted();
      this.profiler.checkpoint('preload_completed');

      if (!preloadResult.success) {
        logger.warn(`${preloadResult.failedTasks.length} preload tasks failed`);
      }

      // T0.3: Git 工作树创建
      if (this.config.startup?.worktree?.enabled) {
        await this.setupGitWorktree();
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
      this.showStartupReport();

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
   * 初始化核心模块
   */
  private async initializeCoreModules(): Promise<void> {
    // 注册核心模块
    const coreModules: ModuleDefinition[] = [
      {
        name: 'logger',
        version: '1.0.0',
        description: '日志系统',
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
   * 初始化 OpenTelemetry 观测系统
   * 注册全局 MeterProvider/TracerProvider，创建 OTel 实例并连接桥接组件
   */
  private async initializeOTelSystem(): Promise<void> {
    try {
      const { initializeTelemetry } =
        await import('@modules/monitoring/instrumentation.js');

      await initializeTelemetry();
      logger.info('OTel 遥测初始化完成');

      // 主动创建 OTel 指标实例（注册到全局 MeterProvider）
      const { getOTelMetrics, getOTelTracing } =
        await import('@modules/monitoring/otel/index.js');

      const otelMetrics = getOTelMetrics();
      const otelTracing = getOTelTracing();

      // 创建并启动 MetricsBridge（MetricsService → OTelMetrics）
      const { getMetricsService, createMetricsBridge } =
        await import('@modules/monitoring/index.js');

      const metricsService = getMetricsService();
      const metricsBridge = createMetricsBridge(metricsService, otelMetrics);
      metricsBridge.start();

      // 创建 TraceBridge 供追踪使用
      const { createTraceBridge } =
        await import('@modules/monitoring/otel/index.js');

      const traceBridge = createTraceBridge(otelTracing);

      // 初始化会话追踪
      const { getSessionTracing } =
        await import('@modules/monitoring/tracing/SessionTracing.js');

      getSessionTracing();

      logger.info('OTel 桥接组件初始化完成');

      // 初始化集中日志配置（LogConfigManager 注册到 Logger）
      const { logConfigManager } =
        await import('@modules/monitoring/logs/config/LogConfig.js');
      const { setGlobalConfigProvider } =
        await import('@modules/monitoring/logs/Logger.js');
      setGlobalConfigProvider(() => {
        const cfg = logConfigManager.get();
        return {
          level: cfg.level,
          logFile: cfg.targets.find((t) => t.type === 'file')?.path,
          fileOutput: cfg.targets.some((t) => t.type === 'file'),
          format: cfg.format === 'pretty' ? 'text' : cfg.format,
        };
      });
      logger.info('集中日志配置已注册');

      // 创建 OTel 日志适配器（将 OTel Span 上下文注入日志）
      const { createOTelLoggerAdapter } =
        await import('@modules/monitoring/otel/OTelLoggerAdapter.js');
      createOTelLoggerAdapter(otelTracing, {
        module: 'app',
        traceEnabled: true,
        jsonOutput: true,
      });
      logger.info('OTel 日志适配器已创建');
    } catch (error) {
      logger.error(
        'OTel 系统初始化失败',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 初始化插件系统
   */
  private async initializePluginSystem(): Promise<void> {
    // 注册示例插件
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

  /**
   * 创建 Git 工作树（可选）
   */
  private async setupGitWorktree(): Promise<void> {
    const opts = this.config.startup?.worktree;
    if (!opts?.enabled) return;

    try {
      const cwd = process.cwd();
      const gitRoot = this.findGitRoot(cwd);
      if (!gitRoot) {
        logger.warn('Not in a git repository, skipping worktree creation');
        return;
      }

      const slug = opts.prNumber ? `pr-${opts.prNumber}` : (opts.name ?? 'dev');

      const worktreeBranch = `worktree/${slug}`;
      const worktreePath = resolve(gitRoot, '..', 'worktrees', slug);

      if (existsSync(worktreePath)) {
        logger.info(`Worktree already exists at ${worktreePath}`);
        this.worktreePath = worktreePath;
        return;
      }

      logger.info(
        `Creating git worktree: ${worktreeBranch} at ${worktreePath}`
      );

      execSync(`git worktree add --detach "${worktreePath}"`, {
        cwd: gitRoot,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      execSync(`git checkout -b "${worktreeBranch}"`, {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      process.chdir(worktreePath);
      this.worktreePath = worktreePath;

      logger.info(`Git worktree created and switched to ${worktreePath}`);
    } catch (error) {
      logger.warn('Failed to create git worktree', { error: String(error) });
    }
  }

  /**
   * 加载 Session 持久化
   */
  private async loadSessionPersistence(): Promise<void> {
    const opts = this.config.startup?.session;
    if (!opts?.enabled) return;

    try {
      const { SessionFactory } = await import('../session/SessionFactory.js');
      const { UnifiedStorageAdapter } =
        await import('../session/storage/UnifiedStorageAdapter.js');
      const { FileSystemUnifiedStorage } =
        await import('../session/storage/FileSystemUnifiedStorage.js');
      const { StorageType } =
        await import('../session/storage/UnifiedStorage.js');

      const storageDir = opts.storageDir ?? resolveSessionsDir();
      const unifiedStorage = new FileSystemUnifiedStorage({
        type: StorageType.FILESYSTEM,
        basePath: storageDir,
      });
      await unifiedStorage.initialize();
      const storage = new UnifiedStorageAdapter(unifiedStorage);
      this.sessionFactory = new SessionFactory(storage);

      if (opts.sessionId) {
        const session = await this.sessionFactory.loadSession(opts.sessionId);
        if (session) {
          logger.info(`Session loaded: ${opts.sessionId}`);
          TerminalComponents.printInfo(`恢复会话: ${opts.sessionId}`);
        } else {
          logger.info(`Session not found: ${opts.sessionId}, creating new`);
          const newSession = await this.sessionFactory.createSession({
            title: `Startup ${new Date().toISOString()}`,
          });
          logger.info(`New session created: ${newSession.id}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to load session persistence', {
        error: String(error),
      });
    }
  }

  /**
   * 保存终端状态备份
   */
  private async saveTerminalState(): Promise<void> {
    try {
      const backupDir = resolveDataDir();
      if (!existsSync(backupDir)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(backupDir, { recursive: true });
      }

      const backupPath = join(backupDir, 'terminal_state.json');

      const terminalState = {
        cwd: process.cwd(),
        env: {
          TERM: process.env.TERM,
          SHELL: process.env.SHELL,
          LANG: process.env.LANG,
        },
        timestamp: new Date().toISOString(),
      };

      writeFileSync(
        backupPath,
        JSON.stringify(terminalState, null, 2),
        'utf-8'
      );
      this.terminalBackupPath = backupPath;
      logger.info(`Terminal state saved to ${backupPath}`);
    } catch (error) {
      logger.warn('Failed to save terminal state', { error: String(error) });
    }
  }

  /**
   * 恢复终端状态
   */
  private async restoreTerminalState(): Promise<void> {
    if (!this.terminalBackupPath || !existsSync(this.terminalBackupPath))
      return;

    try {
      const data = readFileSync(this.terminalBackupPath, 'utf-8');
      const terminalState = JSON.parse(data);

      logger.info('Terminal state restored from backup');
      unlinkSync(this.terminalBackupPath);
      this.terminalBackupPath = null;
    } catch (error) {
      logger.warn('Failed to restore terminal state', { error: String(error) });
    }
  }

  /**
   * 查找 Git 仓库根目录
   */
  private findGitRoot(startPath: string): string | null {
    try {
      const output = execSync('git rev-parse --show-toplevel', {
        cwd: startPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * 显示启动报告
   */
  private showStartupReport(): void {
    this.profiler.stop();
    const report = this.profiler.generateReport();

    TerminalComponents.printHeader('启动报告');

    const stats: [string, string][] = [
      ['应用名称', this.config.name],
      ['版本', this.config.version],
      ['官网', 'https://openliri.com'],
      ['启动时间', `${report.totalDuration.toFixed(2)}ms`],
      ['模块数量', this.moduleManager.getModules().length.toString()],
      ['插件数量', this.ecosystem.getAllPlugins().length.toString()],
      ['技能数量', this.ecosystem.getAllSkills().length.toString()],
    ];

    TerminalComponents.printKeyValue(stats);
  }

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

  /**
   * 注册模块
   */
  registerModule(module: ModuleDefinition): void {
    this.moduleManager.registerModule(module);
  }

  /**
   * 获取模块管理器
   */
  getModuleManager(): ModuleDependencyManager {
    return this.moduleManager;
  }

  /**
   * 获取插件生态系统
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
    TerminalComponents.printHeader('系统状态');

    const status: [string, string][] = [
      ['应用名称', this.config.name],
      ['版本', this.config.version],
      ['运行状态', this.initialized ? '已初始化' : '未初始化'],
      ['模块数', this.moduleManager.getModules().length.toString()],
      ['插件数', this.ecosystem.getAllPlugins().length.toString()],
      ['技能数', this.ecosystem.getAllSkills().length.toString()],
    ];

    TerminalComponents.printKeyValue(status);

    TerminalComponents.printDivider();
    this.moduleManager.showModuleOverview();

    TerminalComponents.printDivider();
    this.ecosystem.showPluginList();

    TerminalComponents.printDivider();
    this.ecosystem.showSkillList();
  }

  /**
   * 显示帮助信息
   */
  showHelp(): void {
    TerminalComponents.printHeader('帮助信息');

    const commands = [
      { cmd: 'status', desc: '显示系统状态' },
      { cmd: 'plugins', desc: '显示插件列表' },
      { cmd: 'skills', desc: '显示技能列表' },
      { cmd: 'modules', desc: '显示模块列表' },
      { cmd: 'marketplace', desc: '显示插件市场' },
      { cmd: 'help', desc: '显示此帮助信息' },
    ];

    TerminalComponents.printList(
      commands.map((c) => `${c.cmd} - ${c.desc}`),
      { bullet: '►' }
    );
  }

  /**
   * 关闭应用
   */
  async shutdown(): Promise<void> {
    TerminalComponents.printInfo('正在关闭应用...');

    // 停用所有插件
    for (const plugin of this.pluginSDK.getPlugins()) {
      await this.pluginSDK.deactivatePlugin(plugin.id);
    }

    // 终端状态恢复
    if (this.terminalBackupPath) {
      await this.restoreTerminalState();
    }

    this.initialized = false;
    TerminalComponents.printSuccess('应用已关闭');
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 获取配置
   */
  getConfig(): AppCoreConfig {
    return { ...this.config };
  }
}

/**
 * 创建应用核心
 */
export function createAppCore(config: AppCoreConfig): AppCore {
  return AppCore.getInstance(config);
}
