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
 * 整合插件加载器、注册器、生命周期管理器、依赖管理器、配置管理器和事件系统
 * 采用懒加载模式：子系统在首次访问时按需创建
 */

import PluginLoader from './core/PluginLoader';
import PluginRegistry from './core/PluginRegistry';
import PluginLifecycleManager from './core/PluginLifecycleManager';
import PluginDependencyManager from './management/PluginDependencyManager';
import PluginConfigManager from './management/PluginConfigManager';
import { join } from 'path';
import PluginEventSystem from './core/PluginEventSystem';
import {
  KernelServiceRegistry,
  KernelServiceId,
  getKernelServiceRegistry,
  createPluginAPI,
} from './api/index.js';
import type { IPluginAPI } from './api/index.js';
import { BundledPluginManager } from './bundled/BundledPluginManager';
import { RegistrationStub } from './stub/RegistrationStub';
import { ClawHubAdapter } from '@modules/skills/loaders/adapter/clawhub/ClawHubAdapter';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
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
import type { PluginInfo } from './types/PluginDisplay.js';
import { resolveProjectRoot } from '@modules/core/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 热加载管理器实例缓存（惰性加载，避免模块加载时的循环依赖）
 * index.ts → PluginHotloadManager → PluginManager → managers/PluginManager → index.ts
 * 使用动态 import() 在运行时解析，而非模块顶层静态导入
 */
let _hotloadManager:
  | import('./hotload/PluginHotloadManager').PluginHotloadManager
  | null = null;

/**
 * 获取热加载管理器实例（惰性加载）
 */
async function getHotloadManagerLazy(): Promise<
  import('./hotload/PluginHotloadManager').PluginHotloadManager
> {
  if (!_hotloadManager) {
    const { getHotloadManager } =
      await import('./hotload/PluginHotloadManager');
    _hotloadManager = getHotloadManager();
  }
  return _hotloadManager;
}

/**
 * 插件系统
 * 所有子系统通过懒加载方式创建，构造函数仅保存配置
 */
export class PluginSystem {
  private _options: PluginLoaderOptions;
  private _isInitialized = false;

  private _loader: PluginLoader | null = null;
  private _registry: PluginRegistry | null = null;
  private _lifecycleManager: PluginLifecycleManager | null = null;
  private _dependencyManager: PluginDependencyManager | null = null;
  private _configManager: PluginConfigManager | null = null;
  private _eventSystem: PluginEventSystem | null = null;
  private _kernelRegistry: KernelServiceRegistry | null = null;

  private _pluginsDiscovered = false;
  private _pluginsLoaded = false;

  /**
   * 构造函数，仅保存配置，不创建任何子系统
   */
  constructor(options: PluginLoaderOptions = {}) {
    this._options = {
      pluginDirectories: [join(resolveProjectRoot(), 'plugins')],
      autoLoad: false,
      autoActivate: false,
      validationEnabled: true,
      cacheEnabled: true,
      maxConcurrentLoads: 5,
      loadTimeout: 30000,
      ...options,
    };
  }

  private get loader(): PluginLoader {
    if (!this._loader) {
      this._loader = new PluginLoader(this._options);
    }
    return this._loader;
  }

  private get registry(): PluginRegistry {
    if (!this._registry) {
      this._registry = new PluginRegistry();
    }
    return this._registry;
  }

  private get lifecycleManager(): PluginLifecycleManager {
    if (!this._lifecycleManager) {
      this._lifecycleManager = new PluginLifecycleManager();
    }
    return this._lifecycleManager;
  }

  private get dependencyManager(): PluginDependencyManager {
    if (!this._dependencyManager) {
      this._dependencyManager = new PluginDependencyManager();
    }
    return this._dependencyManager;
  }

  private get configManager(): PluginConfigManager {
    if (!this._configManager) {
      this._configManager = new PluginConfigManager();
    }
    return this._configManager;
  }

  private get eventSystem(): PluginEventSystem {
    if (!this._eventSystem) {
      this._eventSystem = new PluginEventSystem();
    }
    return this._eventSystem;
  }

  private setupEventForwarding(): void {
    this.loader.on('pluginEvent', (event: PluginEvent) => {
      this.eventSystem.publishEvent(event);
    });
    this.registry.on('pluginEvent', (event: PluginEvent) => {
      this.eventSystem.publishEvent(event);
    });
    this.lifecycleManager.on('lifecycleEvent', (data: any) => {
      const event: PluginEvent = {
        type: PluginEventType.STATE_CHANGED,
        pluginId: data.context.plugin?.id,
        data: data,
        timestamp: new Date(),
      };
      this.eventSystem.publishEvent(event);
    });
    this.configManager.on('configUpdated', (data: any) => {
      const event: PluginEvent = {
        type: PluginEventType.CONFIG_UPDATED,
        pluginId: data.pluginId,
        data: data,
        timestamp: new Date(),
      };
      this.eventSystem.publishEvent(event);
    });
    this.eventSystem.on('handlerError', (data: any) => {
      logger.error('Event handler error:', { data });
    });
  }

  /**
   * 确保插件已发现（扫描目录收集元信息）
   * 仅收集插件路径和元数据，不加载插件代码
   */
  private async ensurePluginsDiscovered(): Promise<void> {
    if (this._pluginsDiscovered) return;

    await this.loader.initialize();

    this._pluginsDiscovered = true;
  }

  /**
   * 确保插件已加载（首次实际使用时才加载插件代码）
   */
  private async ensurePluginsLoaded(): Promise<void> {
    if (this._pluginsLoaded) return;

    await this.ensurePluginsDiscovered();

    await this.loader.loadAllPlugins();
    this.setupEventForwarding();

    const plugins = this.loader.getAllPlugins();
    for (const plugin of plugins) {
      await this.registerPlugin(plugin);
    }

    this._pluginsLoaded = true;
  }

  /**
   * 初始化插件系统
   * 轻量级操作，仅标记初始化状态，不加载任何插件代码
   * 注册所有内核子系统到 KernelServiceRegistry
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    this._isInitialized = true;

    // 初始化内核服务注册表，注册所有子系统
    this._kernelRegistry = getKernelServiceRegistry();
    this._kernelRegistry.register(KernelServiceId.PLUGIN_LOADER, this.loader);
    this._kernelRegistry.register(
      KernelServiceId.PLUGIN_REGISTRY,
      this.registry
    );
    this._kernelRegistry.register(
      KernelServiceId.LIFECYCLE_MANAGER,
      this.lifecycleManager
    );
    this._kernelRegistry.register(
      KernelServiceId.DEPENDENCY_MANAGER,
      this.dependencyManager
    );
    this._kernelRegistry.register(
      KernelServiceId.CONFIG_MANAGER,
      this.configManager
    );
    this._kernelRegistry.register(
      KernelServiceId.EVENT_SYSTEM,
      this.eventSystem
    );

    // 配置核心 PluginRegistry 回退加载器（§5 向后兼容性保障 — 措施3）
    // 链式回退策略：先查内置插件，再查 ClawHub 已安装技能
    const bundledManager = new BundledPluginManager();
    const bundledMeta = bundledManager.scan();

    const clawhubFallback = ClawHubAdapter.getInstance().createFallbackLoader();

    this.registry.setFallback((pluginId: string) => {
      // 第一级：内置插件回退
      const match = bundledMeta.find((p) => p.name === pluginId);
      if (match) {
        return {
          id: pluginId,
          name: match.name,
          version: match.version,
          path: match.entryPoint,
          state: PluginState.LOADED,
          registeredAt: new Date(),
          enabled: match.enabled,
          dependencies: [],
          dependents: [],
        };
      }

      // 第二级：ClawHub 已安装技能回退
      return clawhubFallback(pluginId);
    });

    logger.info('插件系统已就绪（延迟加载模式）');
    logger.info('内核服务注册完成', {
      services: this._kernelRegistry.getRegisteredServices().length,
    });
    // 将 PluginRegistry 注入 ClawHubAdapter，使已安装技能注册到插件系统
    const clawhub = ClawHubAdapter.getInstance();
    clawhub.setPluginRegistry(this.registry);

    logger.info('链式回退加载器已配置', {
      bundledPlugins: bundledMeta.length,
      clawhubEnabled: true,
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this._isInitialized) {
      await this.initialize();
    }
  }

  private async registerPlugin(plugin: LoadedPlugin): Promise<void> {
    try {
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

      this.lifecycleManager.registerPlugin(plugin);

      const metadata: PluginMetadata = {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: 'Auto-generated metadata',
        author: 'System',
        type: PluginType.TOOL,
      };
      this.dependencyManager.addPlugin(metadata);

      // 授予插件对受控内核服务和API的访问权限
      if (this._kernelRegistry) {
        this._kernelRegistry.grantAccess(plugin.id, [
          KernelServiceId.PLUGIN_LOADER,
          KernelServiceId.PLUGIN_REGISTRY,
          KernelServiceId.LIFECYCLE_MANAGER,
          KernelServiceId.EVENT_SYSTEM,
          KernelServiceId.CONFIG_MANAGER,
          KernelServiceId.COMMAND_API,
          KernelServiceId.TOOL_API,
          KernelServiceId.SETTINGS_API,
          KernelServiceId.RESOURCE_API,
        ]);
      }

      logger.info(`✅ Plugin registered: ${plugin.id}`);
    } catch (error) {
      logger.error(`❌ Failed to register plugin ${plugin.id}:`, { error });
      throw error;
    }
  }

  async loadPlugin(pluginId: string): Promise<PluginLoadResult> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    const result = await this.loader.loadPlugin(pluginId);

    if (result.success && result.plugin) {
      await this.registerPlugin(result.plugin);
    }

    return result;
  }

  async unloadPlugin(pluginId: string): Promise<PluginLoadResult> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    await this.lifecycleManager.stopPlugin(pluginId);

    const result = await this.loader.unloadPlugin(pluginId);

    if (result.success) {
      this.registry.unregisterPlugin(pluginId);
      this.lifecycleManager.unregisterPlugin(pluginId);
      this.dependencyManager.removePlugin(pluginId);
    }

    return result;
  }

  async startPlugin(pluginId: string): Promise<void> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    await this.lifecycleManager.startPlugin(pluginId);
  }

  async stopPlugin(pluginId: string): Promise<void> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    await this.lifecycleManager.stopPlugin(pluginId);
  }

  async restartPlugin(pluginId: string): Promise<void> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    await this.lifecycleManager.restartPlugin(pluginId);
  }

  /**
   * 热加载插件：通过 PluginHotloadManager 执行优雅卸载 → 加载流程
   * 支持依赖图感知的卸载顺序和激活上下文持久化
   * @param pluginId 插件 ID
   */
  async hotloadPlugin(pluginId: string): Promise<boolean> {
    await this.ensureInitialized();

    const hotloadManager = await getHotloadManagerLazy();

    try {
      await hotloadManager.gracefulUnload(pluginId);

      const result = await this.loadPlugin(pluginId);

      if (result.success) {
        logger.info(`✅ Plugin hotloaded: ${pluginId}`);
        return true;
      }

      logger.warning(`Hotload load failed: ${pluginId}`);
      return false;
    } catch (error) {
      logger.error(`Hotload failed: ${pluginId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 重载插件：使用 PluginHotloadManager 的依赖感知重载流程
   * 先卸载所有依赖方，重载目标插件，再按逆序重新加载
   * @param pluginId 插件 ID
   */
  async reloadPlugin(pluginId: string): Promise<boolean> {
    await this.ensureInitialized();

    const hotloadManager = await getHotloadManagerLazy();

    try {
      await hotloadManager.reloadPluginWithDeps(pluginId);
      logger.info(`✅ Plugin reloaded: ${pluginId}`);
      return true;
    } catch (error) {
      logger.error(`Reload failed: ${pluginId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 手动触发插件热部署
   * 通过 PluginHotloadManager 执行依赖感知的完整重载流程
   * @param pluginId 插件 ID
   */
  async triggerHotload(pluginId: string): Promise<boolean> {
    await this.ensureInitialized();

    const hotloadManager = await getHotloadManagerLazy();

    return hotloadManager.triggerHotload(pluginId);
  }

  /**
   * 批量手动触发热部署
   * @param pluginIds 插件 ID 列表
   */
  async triggerBatchHotload(pluginIds: string[]): Promise<{
    succeeded: string[];
    failed: { name: string; error: string }[];
  }> {
    await this.ensureInitialized();

    const hotloadManager = await getHotloadManagerLazy();

    return hotloadManager.triggerBatchHotload(pluginIds);
  }

  /**
   * 获取热部署历史记录
   */
  async getHotloadHistory(
    limit = 0
  ): Promise<import('./hotload/PluginHotloadManager').HotloadRecord[]> {
    const hm = await getHotloadManagerLazy();
    return hm.getHotloadHistory(limit);
  }

  /**
   * 清除热部署历史记录
   */
  async clearHotloadHistory(): Promise<void> {
    const hm = await getHotloadManagerLazy();
    hm.clearHotloadHistory();
  }

  async startAllPlugins(): Promise<void> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    await this.lifecycleManager.startAllPlugins();
  }

  async stopAllPlugins(): Promise<void> {
    await this.ensureInitialized();
    await this.ensurePluginsLoaded();

    await this.lifecycleManager.stopAllPlugins();
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    if (!this._loader) return undefined;
    return this.loader.getPlugin(pluginId);
  }

  getAllPlugins(): LoadedPlugin[] {
    if (!this._loader) return [];
    return this.loader.getAllPlugins();
  }

  /**
   * 获取插件信息列表（展示层）
   * 将 LoadedPlugin 转换为轻量级 PluginInfo 用于 UI 展示
   */
  getPluginInfoList(): PluginInfo[] {
    const plugins = this.getAllPlugins();
    return plugins.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: (p.manifest as Record<string, unknown> | undefined)
        ?.description as string | undefined || '',
      author: (p.manifest as Record<string, unknown> | undefined)
        ?.author as string | undefined || 'Unknown',
      tags: (p.manifest as Record<string, unknown> | undefined)
        ?.tags as string[] | undefined || [],
      category: (p.manifest as Record<string, unknown> | undefined)
        ?.category as string | undefined || 'uncategorized',
      installed: true,
      enabled: p.enabled,
      path: p.path,
    }));
  }

  /**
   * 搜索插件（按名称/类别/标签）
   */
  searchPlugins(query?: string, category?: string, tags?: string[]): PluginInfo[] {
    let results = this.getPluginInfoList();

    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) ||
          p.description.toLowerCase().includes(lowerQuery) ||
          p.id.toLowerCase().includes(lowerQuery)
      );
    }

    if (category) {
      results = results.filter((p) => p.category === category);
    }

    if (tags && tags.length > 0) {
      results = results.filter((p) => tags.some((tag) => p.tags.includes(tag)));
    }

    return results;
  }

  getActivatedPlugins(): LoadedPlugin[] {
    if (!this._lifecycleManager) return [];
    return this.lifecycleManager.getActivatedPlugins();
  }

  getPluginConfig(pluginId: string): PluginConfig {
    this.ensureInitialized();
    return this.configManager.getConfig(pluginId);
  }

  setPluginConfig(pluginId: string, config: PluginConfig): any {
    this.ensureInitialized();
    return this.configManager.setConfig(pluginId, config);
  }

  registerEventHandler(handler: any): void {
    this.eventSystem.registerHandler(handler);
  }

  unregisterEventHandler(handlerId: string, eventType?: string): boolean {
    return this.eventSystem.unregisterHandler(handlerId, eventType);
  }

  async publishEvent(event: PluginEvent): Promise<void> {
    this.ensureInitialized();
    await this.eventSystem.publishEvent(event);
  }

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
    const emptyStats = {
      plugins: { total: 0, activated: 0, deactivated: 0, failed: 0 },
      events: { total: 0, recent: 0 },
      configs: { configured: 0, total: 0 },
    };

    if (!this._lifecycleManager && !this._eventSystem && !this._configManager) {
      return emptyStats;
    }

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

  async destroy(): Promise<void> {
    logger.info('Destroying plugin system...');

    try {
      if (this._pluginsLoaded) {
        await this.stopAllPlugins();
        await this.loader.destroy();
        this.registry.clear();
        await this.lifecycleManager.destroy();
        this.dependencyManager.clear();
        this.configManager.clear();
        this.eventSystem.destroy();
      }

      this._kernelRegistry?.clear();
      this._kernelRegistry = null;
      this._loader = null;
      this._registry = null;
      this._lifecycleManager = null;
      this._dependencyManager = null;
      this._configManager = null;
      this._eventSystem = null;
      this._pluginsDiscovered = false;
      this._pluginsLoaded = false;
      this._isInitialized = false;

      logger.info('Plugin system destroyed');
    } catch (error) {
      logger.error('Failed to destroy plugin system:', { error });
      throw error;
    }
  }

  getLoader(): PluginLoader {
    return this.loader;
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }

  getLifecycleManager(): PluginLifecycleManager {
    return this.lifecycleManager;
  }

  getDependencyManager(): PluginDependencyManager {
    return this.dependencyManager;
  }

  getConfigManager(): PluginConfigManager {
    return this.configManager;
  }

  getEventSystem(): PluginEventSystem {
    return this.eventSystem;
  }

  /**
   * 获取内核服务注册表
   * @returns 内核服务注册表实例
   */
  getKernelRegistry(): KernelServiceRegistry | null {
    return this._kernelRegistry;
  }

  /**
   * 为指定插件创建受控的 PluginAPI 实例
   * @param pluginId 插件 ID
   * @returns IPluginAPI 实例，通过 KernelServiceRegistry 访问内核服务
   */
  createPluginAPI(pluginId: string): IPluginAPI {
    if (!this._kernelRegistry) {
      throw new AppError(
        'PluginSystem not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PLUGIN_SYSTEM_NOT_INITIALIZED'
      );
    }
    // 将内核事件系统注入到 PluginAPI 中，使 events API 连接到全局事件系统
    return createPluginAPI(pluginId, this._kernelRegistry, this._eventSystem!);
  }
}

// 创建全局插件系统实例（构造函数轻量，不创建任何子系统）
export const pluginSystem = new PluginSystem();

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
