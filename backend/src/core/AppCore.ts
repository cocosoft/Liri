/**
 * 应用核心类
 * 整合所有子系统，提供统一的入口和管理接口
 */

import { logger } from '../utils/log.js';
import { TerminalComponents } from '../ui/TerminalComponents.js';
import { TerminalUIIntegration } from '../ui/TerminalUIIntegration.js';
import { ModuleDependencyManager, ModuleDefinition } from './ModuleDependencyManager.js';
import { PluginEcosystem, EcosystemConfig } from './PluginEcosystem.js';
import { PluginSDK, Plugin, PluginSDKConfig } from './PluginSDK.js';
import { StartupProfiler } from '../utils/StartupProfiler.js';
import { StartupPreloader, initializeAndStartPreloading } from './performance/StartupPreloader.js';

/**
 * 应用配置
 */
export interface AppCoreConfig {
  name: string;
  version: string;
  debug?: boolean;
  ecosystem?: EcosystemConfig;
}

/**
 * 应用核心
 */
export class AppCore {
  private static instance: AppCore;
  private config: AppCoreConfig;
  private profiler: StartupProfiler;
  private moduleManager: ModuleDependencyManager;
  private ecosystem: PluginEcosystem;
  private pluginSDK: PluginSDK;
  private terminalUI: TerminalUIIntegration;
  private initialized: boolean = false;

  constructor(config: AppCoreConfig) {
    this.config = {
      debug: false,
      ...config,
    };

    this.profiler = new StartupProfiler();
    this.moduleManager = new ModuleDependencyManager();
    this.ecosystem = new PluginEcosystem(this.config.ecosystem);
    this.terminalUI = TerminalUIIntegration.getInstance();

    const sdkConfig: PluginSDKConfig = {
      ecosystem: this.ecosystem,
      moduleManager: this.moduleManager,
    };

    this.pluginSDK = new PluginSDK(sdkConfig);
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: AppCoreConfig): AppCore {
    if (!AppCore.instance) {
      if (!config) {
        throw new Error('AppCore must be initialized with config first');
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
      TerminalComponents.printHeader(`初始化 ${this.config.name} v${this.config.version}`);

      // T1: 并行预加载（参考CC源码模式）
      const preloader = initializeAndStartPreloading();
      this.profiler.checkpoint('preload_started');

      // 初始化核心模块
      await this.initializeCoreModules();
      this.profiler.checkpoint('core_modules_initialized');

      // 等待预加载完成
      const preloadResult = await preloader.ensureAllCompleted();
      this.profiler.checkpoint('preload_completed');

      if (!preloadResult.success) {
        logger.warn(`${preloadResult.failedTasks.length} preload tasks failed`);
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
      logger.info(`${this.config.name} v${this.config.version} initialized successfully`);
    } catch (error) {
      logger.error('Failed to initialize AppCore:', error);
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
   * 显示启动报告
   */
  private showStartupReport(): void {
    this.profiler.stop();
    const report = this.profiler.generateReport();

    TerminalComponents.printHeader('启动报告');

    const stats = [
      ['应用名称', this.config.name],
      ['版本', this.config.version],
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
    args: Record<string, any>
  ): Promise<any> {
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

    const status = [
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
      commands.map(c => `${c.cmd} - ${c.desc}`),
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
