/**
 * 插件系统主入口（基于CC源码实现）
 * 整合插件加载器、注册器、生命周期管理器、依赖管理器、配置管理器和事件系统
 */

import PluginLoader from './core/PluginLoader';
import PluginRegistry from './core/PluginRegistry';
import PluginLifecycleManager from './core/PluginLifecycleManager';
import PluginDependencyManager from './management/PluginDependencyManager';
import PluginConfigManager from './management/PluginConfigManager';
import PluginEventSystem from './core/PluginEventSystem';
import {
  PluginState,
  PluginType,
  PluginMetadata,
  PluginConfig,
  LoadedPlugin,
  PluginLoaderOptions,
  PluginLoadResult,
  PluginEventType,
  PluginEvent,
} from './types/PluginTypes';

/**
 * 插件系统（基于CC源码）
 */
export class PluginSystem {
  private loader: PluginLoader;
  private registry: PluginRegistry;
  private lifecycleManager: PluginLifecycleManager;
  private dependencyManager: PluginDependencyManager;
  private configManager: PluginConfigManager;
  private eventSystem: PluginEventSystem;
  private isInitialized = false;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: PluginLoaderOptions = {}) {
    this.loader = new PluginLoader(options);
    this.registry = new PluginRegistry();
    this.lifecycleManager = new PluginLifecycleManager();
    this.dependencyManager = new PluginDependencyManager();
    this.configManager = new PluginConfigManager();
    this.eventSystem = new PluginEventSystem();

    this.setupEventForwarding();
  }

  /**
   * 设置事件转发（基于CC源码）
   */
  private setupEventForwarding(): void {
    // 加载器事件转发
    this.loader.on('pluginEvent', (event: PluginEvent) => {
      this.eventSystem.publishEvent(event);
    });

    // 注册器事件转发
    this.registry.on('pluginEvent', (event: PluginEvent) => {
      this.eventSystem.publishEvent(event);
    });

    // 生命周期管理器事件转发
    this.lifecycleManager.on('lifecycleEvent', (data: any) => {
      const event: PluginEvent = {
        type: PluginEventType.STATE_CHANGED,
        pluginId: data.context.plugin?.id,
        data: data,
        timestamp: new Date(),
      };
      this.eventSystem.publishEvent(event);
    });

    // 配置管理器事件转发
    this.configManager.on('configUpdated', (data: any) => {
      const event: PluginEvent = {
        type: PluginEventType.CONFIG_UPDATED,
        pluginId: data.pluginId,
        data: data,
        timestamp: new Date(),
      };
      this.eventSystem.publishEvent(event);
    });

    // 事件系统错误处理
    this.eventSystem.on('handlerError', (data: any) => {
      console.error('Event handler error:', data);
    });
  }

  /**
   * 初始化插件系统（基于CC源码）
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('🚀 Initializing plugin system...');

    try {
      // 初始化加载器
      await this.loader.initialize();

      // 注册已加载的插件
      const plugins = this.loader.getAllPlugins();

      for (const plugin of plugins) {
        await this.registerPlugin(plugin);
      }

      this.isInitialized = true;

      console.log(
        `✅ Plugin system initialized with ${plugins.length} plugins`
      );
    } catch (error) {
      console.error('❌ Failed to initialize plugin system:', error);
      throw error;
    }
  }

  /**
   * 注册插件（基于CC源码）
   */
  private async registerPlugin(plugin: LoadedPlugin): Promise<void> {
    try {
      // 添加到注册器
      this.registry.registerPlugin({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        path: plugin.path,
        state: plugin.state,
        registeredAt: new Date(),
        enabled: true,
        dependencies: [],
        dependents: [],
      });

      // 添加到生命周期管理器
      this.lifecycleManager.registerPlugin(plugin);

      // 添加到依赖管理器
      const metadata: PluginMetadata = {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: 'Auto-generated metadata',
        author: 'System',
        type: PluginType.TOOL,
      };
      this.dependencyManager.addPlugin(metadata);

      console.log(`✅ Plugin registered: ${plugin.id}`);
    } catch (error) {
      console.error(`❌ Failed to register plugin ${plugin.id}:`, error);
      throw error;
    }
  }

  /**
   * 加载插件（基于CC源码）
   */
  async loadPlugin(pluginId: string): Promise<PluginLoadResult> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    const result = await this.loader.loadPlugin(pluginId);

    if (result.success && result.plugin) {
      await this.registerPlugin(result.plugin);
    }

    return result;
  }

  /**
   * 卸载插件（基于CC源码）
   */
  async unloadPlugin(pluginId: string): Promise<PluginLoadResult> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    // 先停止插件
    await this.lifecycleManager.stopPlugin(pluginId);

    // 然后卸载
    const result = await this.loader.unloadPlugin(pluginId);

    if (result.success) {
      this.registry.unregisterPlugin(pluginId);
      this.lifecycleManager.unregisterPlugin(pluginId);
      this.dependencyManager.removePlugin(pluginId);
    }

    return result;
  }

  /**
   * 启动插件（基于CC源码）
   */
  async startPlugin(pluginId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    await this.lifecycleManager.startPlugin(pluginId);
  }

  /**
   * 停止插件（基于CC源码）
   */
  async stopPlugin(pluginId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    await this.lifecycleManager.stopPlugin(pluginId);
  }

  /**
   * 重新启动插件（基于CC源码）
   */
  async restartPlugin(pluginId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    await this.lifecycleManager.restartPlugin(pluginId);
  }

  /**
   * 启动所有插件（基于CC源码）
   */
  async startAllPlugins(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    await this.lifecycleManager.startAllPlugins();
  }

  /**
   * 停止所有插件（基于CC源码）
   */
  async stopAllPlugins(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Plugin system not initialized');
    }

    await this.lifecycleManager.stopAllPlugins();
  }

  /**
   * 获取插件（基于CC源码）
   */
  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.loader.getPlugin(pluginId);
  }

  /**
   * 获取所有插件（基于CC源码）
   */
  getAllPlugins(): LoadedPlugin[] {
    return this.loader.getAllPlugins();
  }

  /**
   * 获取已激活插件（基于CC源码）
   */
  getActivatedPlugins(): LoadedPlugin[] {
    return this.lifecycleManager.getActivatedPlugins();
  }

  /**
   * 获取插件配置（基于CC源码）
   */
  getPluginConfig(pluginId: string): PluginConfig {
    return this.configManager.getConfig(pluginId);
  }

  /**
   * 设置插件配置（基于CC源码）
   */
  setPluginConfig(pluginId: string, config: PluginConfig): any {
    return this.configManager.setConfig(pluginId, config);
  }

  /**
   * 注册事件处理器（基于CC源码）
   */
  registerEventHandler(handler: any): void {
    this.eventSystem.registerHandler(handler);
  }

  /**
   * 注销事件处理器（基于CC源码）
   */
  unregisterEventHandler(handlerId: string, eventType?: string): boolean {
    return this.eventSystem.unregisterHandler(handlerId, eventType);
  }

  /**
   * 发布事件（基于CC源码）
   */
  async publishEvent(event: PluginEvent): Promise<void> {
    await this.eventSystem.publishEvent(event);
  }

  /**
   * 获取插件系统统计信息（基于CC源码）
   */
  getStats(): {
    plugins: {
      total: number;
      activated: number;
      deactivated: number;
      failed: number;
    };
    events: {
      total: number;
      recent: number;
    };
    configs: {
      configured: number;
      total: number;
    };
  } {
    const pluginStats = this.lifecycleManager.getPluginStats();
    const eventStats = this.eventSystem.getEventStats();
    const configStats = this.configManager.getConfigStats();

    return {
      plugins: {
        total: pluginStats.total,
        activated: pluginStats.activated,
        deactivated: pluginStats.deactivated,
        failed: pluginStats.failed,
      },
      events: {
        total: eventStats.totalEvents,
        recent: eventStats.recentEvents,
      },
      configs: {
        configured: configStats.configuredPlugins,
        total: configStats.totalPlugins,
      },
    };
  }

  /**
   * 销毁插件系统（基于CC源码）
   */
  async destroy(): Promise<void> {
    console.log('🛑 Destroying plugin system...');

    try {
      // 停止所有插件
      await this.stopAllPlugins();

      // 销毁所有组件
      await this.loader.destroy();
      this.registry.clear();
      await this.lifecycleManager.destroy();
      this.dependencyManager.clear();
      this.configManager.clear();
      this.eventSystem.destroy();

      this.isInitialized = false;

      console.log('✅ Plugin system destroyed');
    } catch (error) {
      console.error('❌ Failed to destroy plugin system:', error);
      throw error;
    }
  }

  /**
   * 获取插件加载器实例（基于CC源码）
   */
  getLoader(): PluginLoader {
    return this.loader;
  }

  /**
   * 获取插件注册器实例（基于CC源码）
   */
  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /**
   * 获取生命周期管理器实例（基于CC源码）
   */
  getLifecycleManager(): PluginLifecycleManager {
    return this.lifecycleManager;
  }

  /**
   * 获取依赖管理器实例（基于CC源码）
   */
  getDependencyManager(): PluginDependencyManager {
    return this.dependencyManager;
  }

  /**
   * 获取配置管理器实例（基于CC源码）
   */
  getConfigManager(): PluginConfigManager {
    return this.configManager;
  }

  /**
   * 获取事件系统实例（基于CC源码）
   */
  getEventSystem(): PluginEventSystem {
    return this.eventSystem;
  }
}

// 创建全局插件系统实例
export const pluginSystem = new PluginSystem();

// 导出类型
export type {
  PluginState,
  PluginType,
  PluginMetadata,
  PluginConfig,
  LoadedPlugin,
  PluginLoaderOptions,
  PluginLoadResult,
  PluginEventType,
  PluginEvent,
} from './types/PluginTypes';
export { default as PluginLoader } from './core/PluginLoader';
export { default as PluginRegistry } from './core/PluginRegistry';
export { default as PluginLifecycleManager } from './core/PluginLifecycleManager';
export { default as PluginDependencyManager } from './management/PluginDependencyManager';
export { default as PluginConfigManager } from './management/PluginConfigManager';
export { default as PluginEventSystem } from './core/PluginEventSystem';

// 导出增强功能
export { EnhancedPluginManager } from './EnhancedPluginManager.js';
export { IntelligentPluginAnalyzer } from './IntelligentPluginAnalyzer.js';

// 导出内置插件
export { bundledPlugins } from './bundled/index.js';

export default PluginSystem;
