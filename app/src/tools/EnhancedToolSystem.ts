/**
 * EnhancedToolSystem - 增强工具系统
 *
 * 整合EnhancedQueryEngine、EnhancedMessage、EnhancedError、EnhancedPerformance、EnhancedExtensibility等功能
 */

import { ChatManagerImpl } from '../chat/ChatManager.js';
import { QueryEngine, type QueryEngineConfig } from '@modules/query';
import { MessageServiceImpl } from '../chat/services/MessageService.js';
import { ErrorHandler } from '../core/utils/ErrorHandler.js';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:enhancedSystem');
import {
  PerformanceProfiler,
  createPerformanceProfiler,
  MemoryCache,
  createMemoryCache,
} from '../core/utils/Performance.js';
import {
  PluginLoader,
  createPluginLoader,
  ModuleManager,
  createModuleManager,
  ConfigManager,
  createConfigManager,
  EventBus,
  createEventBus,
  EventType,
} from '../core/extensibility/index.js';
import {
  ToolManager,
  createToolManager,
  type ToolManagerOptions,
} from './ToolManager.js';
import { ToolRegistry, createToolRegistry } from './ToolRegistry.js';

/**
 * 增强工具系统选项
 */
export interface EnhancedToolSystemOptions {
  queryEngineConfig?: QueryEngineConfig;
  toolManagerOptions?: ToolManagerOptions;
  performanceProfilerOptions?: any;
  pluginLoaderOptions?: any;
  moduleManagerOptions?: any;
  configManagerOptions?: any;
  eventBusOptions?: any;
}

/**
 * 增强工具系统
 */
export class EnhancedToolSystem {
  private chatManager: ChatManagerImpl;
  private queryEngine: QueryEngine;
  private messageService: MessageServiceImpl;
  private performanceProfiler: PerformanceProfiler;
  private memoryCache: MemoryCache<any>;
  private pluginLoader: PluginLoader;
  private moduleManager: ModuleManager;
  private configManager: ConfigManager;
  private eventBus: EventBus;
  private toolManager: ToolManager;
  private toolRegistry: ToolRegistry;

  constructor(
    chatManager: ChatManagerImpl,
    options: EnhancedToolSystemOptions = {}
  ) {
    this.chatManager = chatManager;
    this.queryEngine = new QueryEngine(chatManager, options.queryEngineConfig);
    this.messageService = new MessageServiceImpl();
    this.performanceProfiler = createPerformanceProfiler();
    this.memoryCache = createMemoryCache<any>();
    this.pluginLoader = createPluginLoader();
    this.moduleManager = createModuleManager();
    this.configManager = createConfigManager();
    this.eventBus = createEventBus();
    this.toolRegistry = createToolRegistry();
    this.toolManager = createToolManager({
      registry: this.toolRegistry,
      ...options.toolManagerOptions,
    });

    this.initialize();
  }

  /**
   * 初始化增强工具系统
   */
  private initialize(): void {
    // 注册事件监听器
    this.registerEventListeners();

    // 注册模块
    this.registerModules();

    // 加载插件
    this.loadPlugins();
  }

  /**
   * 注册事件监听器
   */
  private registerEventListeners(): void {
    // 监听系统事件
    this.eventBus.subscribe(EventType.SYSTEM_START, (event) => {
      logger.info('Enhanced tool system started');
    });

    this.eventBus.subscribe(EventType.SYSTEM_STOP, (event) => {
      logger.info('Enhanced tool system stopped');
    });

    // 监听错误事件
    this.eventBus.subscribe(EventType.ERROR, (event) => {
      logger.error('Enhanced tool system error', event.data);
    });
  }

  /**
   * 注册模块
   */
  private async registerModules(): Promise<void> {
    // 实际实现中应该注册各个模块
  }

  /**
   * 加载插件
   */
  private async loadPlugins(): Promise<void> {
    // 实际实现中应该加载插件
  }

  /**
   * 获取查询引擎
   */
  getQueryEngine(): QueryEngine {
    return this.queryEngine;
  }

  /**
   * 获取消息服务
   */
  getMessageService(): MessageServiceImpl {
    return this.messageService;
  }

  /**
   * 获取性能分析器
   */
  getPerformanceProfiler(): PerformanceProfiler {
    return this.performanceProfiler;
  }

  /**
   * 获取内存缓存
   */
  getMemoryCache(): MemoryCache<any> {
    return this.memoryCache;
  }

  /**
   * 获取插件加载器
   */
  getPluginLoader(): PluginLoader {
    return this.pluginLoader;
  }

  /**
   * 获取模块管理器
   */
  getModuleManager(): ModuleManager {
    return this.moduleManager;
  }

  /**
   * 获取配置管理器
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * 获取事件总线
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * 获取工具管理器
   */
  getToolManager(): ToolManager {
    return this.toolManager;
  }

  /**
   * 获取工具注册表
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 启动增强工具系统
   */
  start(): void {
    this.eventBus.publish(EventType.SYSTEM_START);
    logger.info('Enhanced tool system started');
  }

  /**
   * 停止增强工具系统
   */
  async stop(): Promise<void> {
    this.eventBus.publish(EventType.SYSTEM_STOP);

    // 清理资源
    await this.pluginLoader.destroy();
    await this.moduleManager.destroy();
    await this.configManager.destroy();
    this.eventBus.unsubscribeAll();
    this.performanceProfiler.destroy();
    this.memoryCache.destroy();

    logger.info('Enhanced tool system stopped');
  }
}

/**
 * 创建增强工具系统
 */
export function createEnhancedToolSystem(
  chatManager: ChatManagerImpl,
  options: EnhancedToolSystemOptions = {}
): EnhancedToolSystem {
  return new EnhancedToolSystem(chatManager, options);
}
