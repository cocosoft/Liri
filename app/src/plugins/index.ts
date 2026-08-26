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
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
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
  PluginDependency,
} from './types/PluginTypes';
import type { PluginInfo, SkillInfo } from './types/PluginDisplay.js';
import type { Plugin, SkillContext } from '@modules/plugin-sdk';
import { SdkPluginAdapter } from './core/SdkPluginAdapter';
import {
  PythonPluginAdapter,
  type PythonPluginConfig,
} from './core/PythonPluginAdapter';
import { resolvePythonPluginConfig } from './install/PythonPluginInstaller';
import type { ServiceRegisteredEvent } from './api/index.js';
import {
  mapPluginStateToStatus,
  PLUGIN_PENDING_STATE,
} from './core/PluginStateMapper';
const logger = getLogger('plugins:index');

/** 响应式挂起默认超时（毫秒）：超时后标记 timedOut，供 UI 展示与手动重试（4.4 死锁防护） */
const SDK_PLUGIN_PENDING_TIMEOUT_MS = 5 * 60 * 1000;

/** SDK 插件挂起队列的 contextExtras 类型 */
type PendingContextExtras = Partial<
  Pick<
    import('@modules/plugin-sdk').PluginContext,
    'log' | 'config' | 'events' | 'utils'
  >
>;

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

  /** SDK 程序化注册的插件（非文件扫描加载） */
  private _sdkPlugins = new Map<string, Plugin>();
  /** SDK 程序化注册的插件上下文（含注入的 services，生命周期使用） */
  private _sdkContexts = new Map<
    string,
    import('@modules/plugin-sdk').PluginContext
  >();
  /** SDK 程序化注册的技能 */
  private _sdkSkills = new Map<string, SkillInfo>();
  /** 响应式挂起队列：inject 必需服务缺失、等待服务注册后自动激活（4.4） */
  private _pendingSdkPlugins = new Map<
    string,
    {
      plugin: Plugin;
      contextExtras?: PendingContextExtras;
      missing: string[];
      createdAt: number;
      deadline: number;
      timedOut: boolean;
    }
  >();

  /** SDK 适配器（懒创建，依赖 kernelRegistry） */
  private _sdkAdapter: SdkPluginAdapter | null = null;

  /** Python 插件运行时（PY-3：PythonPluginAdapter 实例，key=pluginId） */
  private _pythonPlugins = new Map<string, PythonPluginAdapter>();

  /** 加载期安全降级开关（评审修订 v4：PluginSystem 级配置，默认开启） */
  private _demoteOnLoad: boolean;

  private _pluginsDiscovered = false;
  private _pluginsLoaded = false;

  /**
   * 构造函数，仅保存配置，不创建任何子系统
   * @param options 加载器配置
   * @param pluginOptions PluginSystem 级配置（评审修订 v4：demoteOnLoad 默认开启，仿 HotloadConfig 先例）
   */
  constructor(
    options: PluginLoaderOptions = {},
    pluginOptions: { demoteOnLoad?: boolean } = {}
  ) {
    this._options = {
      // 注意：pluginDirectories 不再在此处默认解析（join(resolveProjectRoot(), 'plugins')），
      // 惰性交给 PluginLoader 首次使用时兜底——模块级 `new PluginSystem()` 若在
      // 循环 import（paths→monitoring→core→plugins）期间调用 resolveProjectRoot，
      // 会触发 paths 的 TDZ（ENV_LIRI_PROJECT_DIR before initialization）。
      autoLoad: false,
      autoActivate: false,
      validationEnabled: true,
      cacheEnabled: true,
      maxConcurrentLoads: 5,
      loadTimeout: 30000,
      ...options,
    };
    this._demoteOnLoad = pluginOptions.demoteOnLoad ?? true;
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

  /** SDK 适配器（懒创建） */
  private get sdkAdapter(): SdkPluginAdapter {
    if (!this._sdkAdapter) {
      this._sdkAdapter = new SdkPluginAdapter(getKernelServiceRegistry());
    }
    return this._sdkAdapter;
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

    // 评审修订 v4（P0-2）：加载期安全降级（demoteOnLoad 默认开启，仅 loader 文件插件）
    const demoted = new Set<string>();
    if (this._demoteOnLoad) {
      const { verifyAndDemote } = await import('./utils/dependencyResolver.js');
      const result = verifyAndDemote(plugins);
      for (const id of result.demoted) demoted.add(id);
      if (result.errors.length > 0) {
        logger.error('加载期依赖校验：以下插件被降级（依赖不满足）', {
          demoted: Array.from(result.demoted),
        });
      }
    }

    for (const plugin of plugins) {
      await this.registerPlugin(plugin, !demoted.has(plugin.source));
    }

    // M1 编排层：自动发现并激活 Python 插件（plugin.json 桥接清单 type:'python' + entry.python）
    for (const plugin of plugins) {
      const manifest = plugin.manifest as
        | (Record<string, unknown> & {
            entry?: { python?: unknown };
            type?: unknown;
          })
        | undefined;
      if (
        manifest &&
        manifest.type === 'python' &&
        typeof manifest.entry?.python === 'string'
      ) {
        try {
          await this.registerPythonPluginFromDir(plugin.path);
        } catch (error) {
          // 单个 Python 插件失败不阻塞其余插件加载（venv 缺失/损坏等场景降级为日志）
          logger.error(`Python 插件自动激活失败: ${plugin.id}`, {
            path: plugin.path,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // 评审修订（P0-1）：热加载图数据源接通（过滤 demoted，key 用裸名经 normalize）
    await this.buildHotloadDependencyGraph(plugins, demoted);

    this._pluginsLoaded = true;
  }

  /**
   * 构建热加载依赖图数据源（评审修订 v4：key 统一为裸插件名，dep 经 normalize 取 name）
   * @param plugins 已加载插件
   * @param demoted 被降级插件 source 集合（建图排除）
   */
  private async buildHotloadDependencyGraph(
    plugins: LoadedPlugin[],
    demoted: Set<string>
  ): Promise<void> {
    try {
      const { normalizeDependency } =
        await import('./utils/dependencyResolver.js');
      const hotloadManager = await getHotloadManagerLazy();

      const graph: Record<string, string[]> = {};
      for (const p of plugins) {
        if (demoted.has(p.source)) continue;
        const manifest = (p.manifest ?? {}) as Record<string, unknown>;
        const deps = Array.isArray(manifest.dependencies)
          ? manifest.dependencies.filter(
              (d): d is string => typeof d === 'string'
            )
          : [];
        graph[p.name] = deps.map((d) => {
          const norm = normalizeDependency(d, p.name);
          return 'name' in norm ? norm.name : d;
        });
      }

      hotloadManager.buildDependencyGraph(graph);
      logger.info('热加载依赖图数据源已接通', {
        nodes: Object.keys(graph).length,
      });
    } catch (error) {
      logger.warn('热加载依赖图构建失败（不影响插件加载）', { error });
    }
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
    // 2026-08-06 新增：加载持久化插件配置（~/.pyapp/plugins/config/config.json）
    this.configManager.loadPersistedConfigs();
    this._kernelRegistry.register(
      KernelServiceId.EVENT_SYSTEM,
      this.eventSystem
    );

    // 4.4：订阅服务注册事件 → 转发事件系统 + 激活响应式挂起的 SDK 插件
    this._kernelRegistry.on(
      KernelServiceRegistry.SERVICE_REGISTERED,
      (data: ServiceRegisteredEvent) => {
        void this.handleServiceRegistered(data);
      }
    );

    // 配置核心 PluginRegistry 回退加载器（§5 向后兼容性保障 — 措施3）
    // 链式回退策略：先查内置插件，再查 ClawHub 已安装技能
    const bundledManager = new BundledPluginManager();
    const bundledMeta = bundledManager.scan();

    const clawhubFallback = (
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter')
    ).ClawHubAdapter.getInstance().createFallbackLoader();

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
    const { ClawHubAdapter } =
      await import('@modules/skills/loaders/adapter/clawhub/ClawHubAdapter');
    const clawhub = ClawHubAdapter.getInstance();
    clawhub.setPluginRegistry(this.registry);

    logger.info('链式回退加载器已配置', {
      bundledPlugins: bundledMeta.length,
      clawhubEnabled: true,
    });
  }

  /**
   * 发现并加载已安装的文件插件（~/.pyapp/plugins/installed/）
   * 2026-08-06 修复（Q1）：提供公开入口，供启动链与 CLI 调用，
   * 避免"插件装了但从未被发现/加载导致不可用"。幂等：仅首次执行。
   */
  async loadInstalledPlugins(): Promise<void> {
    await this.ensurePluginsLoaded();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this._isInitialized) {
      await this.initialize();
    }
  }

  private async registerPlugin(
    plugin: LoadedPlugin,
    enabled = true
  ): Promise<void> {
    try {
      // 从插件清单提取真实依赖（修复：原实现 dependencies 硬编码空数组）
      const manifest = (plugin.manifest ?? {}) as Record<string, unknown>;
      const manifestDeps = manifest.dependencies;
      const rawDeps: string[] = Array.isArray(manifestDeps)
        ? manifestDeps.filter((d): d is string => typeof d === 'string')
        : [];

      // 评审修订 v4（P1-3）：PluginRegistry 内部图喂真实依赖（原为空数组导致图恒为空）
      this.registry.registerPlugin({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        path: plugin.path,
        state: plugin.state,
        registeredAt: new Date(),
        enabled,
        dependencies: rawDeps,
        dependents: [],
      });

      this.lifecycleManager.registerPlugin(plugin);

      const dependencies: PluginDependency[] = rawDeps.map((name) => ({
        name,
        version: '*',
      }));

      const metadata: PluginMetadata = {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description:
          (typeof manifest.description === 'string' && manifest.description) ||
          'Auto-generated metadata',
        author:
          (typeof manifest.author === 'string' && manifest.author) || 'System',
        type: PluginType.TOOL,
        dependencies,
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
      // 评审修订 v4（P0-2）：loadPlugin 单独加载也过降级校验（热加载走此路径自动覆盖）
      let enabled = true;
      if (this._demoteOnLoad) {
        const { verifyAndDemote } =
          await import('./utils/dependencyResolver.js');
        const { demoted } = verifyAndDemote([result.plugin]);
        if (demoted.has(result.plugin.source)) enabled = false;
      }
      await this.registerPlugin(result.plugin, enabled);
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
      description:
        ((p.manifest as Record<string, unknown> | undefined)?.description as
          | string
          | undefined) || '',
      author:
        ((p.manifest as Record<string, unknown> | undefined)?.author as
          | string
          | undefined) || 'Unknown',
      tags:
        ((p.manifest as Record<string, unknown> | undefined)?.tags as
          | string[]
          | undefined) || [],
      category:
        ((p.manifest as Record<string, unknown> | undefined)?.category as
          | string
          | undefined) || 'uncategorized',
      installed: true,
      enabled: p.enabled,
      path: p.path,
    }));
  }

  /**
   * 搜索插件（按名称/类别/标签）
   */
  searchPlugins(
    query?: string,
    category?: string,
    tags?: string[]
  ): PluginInfo[] {
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

  // ==================== SDK 程序化注册 ====================

  /**
   * 程序化注册插件（SDK 路径）
   * 将第三方插件通过 Plugin SDK 动态注册到系统中。
   * 4.1 增强：解析声明式服务注入（inject），动态校验已注册服务目录，
   * 自动 grantAccess，并将服务实例以参数形式挂载到 context.services。
   * 4.4 增强：必需服务缺失时挂起等待（响应式加载），服务注册后自动激活；
   * 不再 fail-fast 拒绝（P1 升级）。
   * @param plugin SDK 插件
   * @param contextExtras 可选上下文（log/config/events/utils），由宿主提供
   */
  async registerPluginFromSDK(
    plugin: Plugin,
    contextExtras?: PendingContextExtras
  ): Promise<void> {
    await this.ensureInitialized();

    // 4.1：解析声明式服务注入（动态层校验）
    const { services, missingRequired } = this.sdkAdapter.resolveInject(plugin);

    // 4.4：必需服务缺失 → 挂起等待（响应式加载），不再 fail-fast 拒绝
    if (missingRequired.length > 0) {
      this._pendingSdkPlugins.set(plugin.id, {
        plugin,
        contextExtras,
        missing: missingRequired,
        createdAt: Date.now(),
        deadline: Date.now() + SDK_PLUGIN_PENDING_TIMEOUT_MS,
        timedOut: false,
      });
      logger.warn(
        `SDK plugin ${plugin.id} 等待必需服务注册（响应式挂起）: ${missingRequired.join(', ')}`
      );
      return;
    }

    await this.finalizeSdkPluginRegistration(plugin, services, contextExtras);
  }

  /**
   * 完成 SDK 插件注册（动态校验通过后执行）
   * 静态校验 → 自动授权 → 注册表 → context 构造 → initialize/activate
   * @param plugin SDK 插件
   * @param services 已解析的服务实例映射
   * @param contextExtras 可选上下文
   */
  private async finalizeSdkPluginRegistration(
    plugin: Plugin,
    services: Record<string, unknown>,
    contextExtras?: PendingContextExtras
  ): Promise<void> {
    // 4.4：静态校验层——第三方服务提供者需在 dependencies 中声明（warning，非阻断）
    this.sdkAdapter.validateProviderDependencies(plugin);

    // 4.1：自动 grantAccess（inject 声明即授权）
    this.sdkAdapter.grantInjectedAccess(plugin.id, plugin);

    // 注册到内部注册表
    try {
      this.registry.registerPlugin({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        path: '',
        state: PluginState.LOADED,
        enabled: true,
        dependencies: [],
        dependents: [],
        registeredAt: new Date(),
      });
    } catch (error) {
      logger.warn(`Plugin ${plugin.id} may already be registered`, {
        error: String(error),
      });
    }

    // 构造插件上下文并执行 initialize / activate（生命周期映射）
    const context = this.sdkAdapter.createContext(
      plugin,
      services,
      contextExtras
    );
    await this.sdkAdapter.runLifecycle('initialize', plugin, context);
    await this.sdkAdapter.runLifecycle('activate', plugin, context);

    // PY-0：注册插件声明的工具到全局单例 ToolRegistry（撞名报错，不静默覆盖）
    this.sdkAdapter.registerTools(plugin);

    // 存储技能信息（PluginSystem 本地管理技能粒度）
    if (plugin.skills) {
      for (const skill of plugin.skills) {
        this._sdkSkills.set(skill.id, {
          id: skill.id,
          name: skill.name,
          version: plugin.version,
          description: skill.description,
          author: plugin.author,
          tags: plugin.tags,
          category: plugin.category,
          pluginId: plugin.id,
        });
      }
    }

    this._sdkContexts.set(plugin.id, context);
    this._sdkPlugins.set(plugin.id, plugin);

    logger.info(
      `Registered plugin via SDK: ${plugin.name} v${plugin.version}` +
        (Object.keys(services).length > 0
          ? ` with injected services: ${Object.keys(services).join(', ')}`
          : '')
    );
  }

  /**
   * 服务注册事件处理（4.4 响应式加载）
   * ① 转发到插件事件系统；② 尝试激活响应式挂起的 SDK 插件。
   * @param data 服务注册事件数据
   */
  private async handleServiceRegistered(
    data: ServiceRegisteredEvent
  ): Promise<void> {
    // ① 转发到事件系统（事件链：kernelRegistry → eventSystem）
    try {
      await this.eventSystem.publishEvent({
        type: PluginEventType.SERVICE_REGISTERED,
        pluginId: '',
        data,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Forward serviceRegistered event failed:', { error });
    }

    // ② 激活挂起插件（重新解析 inject）
    for (const [pluginId, entry] of this._pendingSdkPlugins) {
      if (entry.timedOut) continue;

      const { services, missingRequired } = this.sdkAdapter.resolveInject(
        entry.plugin
      );
      if (missingRequired.length === 0) {
        this._pendingSdkPlugins.delete(pluginId);
        try {
          await this.finalizeSdkPluginRegistration(
            entry.plugin,
            services,
            entry.contextExtras
          );
          logger.info(
            `✅ SDK plugin ${pluginId} 服务就绪，已自动激活（响应式加载）`
          );
        } catch (error) {
          logger.error(`SDK plugin ${pluginId} 响应式激活失败`, { error });
          this._pendingSdkPlugins.set(pluginId, {
            ...entry,
            timedOut: true,
          });
        }
      }
    }
  }

  /**
   * 检查挂起插件是否超时（4.4 死锁防护）
   * 超时的插件标记 timedOut，供管理 UI 展示与手动重试。
   */
  checkPendingSdkTimeouts(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [pluginId, entry] of this._pendingSdkPlugins) {
      if (!entry.timedOut && now > entry.deadline) {
        entry.timedOut = true;
        timedOut.push(pluginId);
        logger.error(
          `SDK plugin ${pluginId} 响应式挂起超时（可能服务级依赖死锁），缺失服务: ${entry.missing.join(', ')}`
        );
      }
    }

    return timedOut;
  }

  /**
   * 获取挂起中的 SDK 插件快照（含状态机映射后的状态，供管理 UI 展示）
   */
  getPendingSdkPlugins(): Array<{
    pluginId: string;
    pluginName: string;
    missing: string[];
    createdAt: number;
    timedOut: boolean;
    state: string;
  }> {
    const result: Array<{
      pluginId: string;
      pluginName: string;
      missing: string[];
      createdAt: number;
      timedOut: boolean;
      state: string;
    }> = [];

    for (const [pluginId, entry] of this._pendingSdkPlugins) {
      result.push({
        pluginId,
        pluginName: entry.plugin.name,
        missing: entry.missing,
        createdAt: entry.createdAt,
        timedOut: entry.timedOut,
        state: mapPluginStateToStatus(PLUGIN_PENDING_STATE) as string,
      });
    }

    return result;
  }

  /**
   * 手动重试挂起的 SDK 插件（4.4 死锁防护：超时后由用户触发）
   * @param pluginId 插件 ID
   * @returns 是否已成功激活
   */
  async retryPendingSdkPlugin(pluginId: string): Promise<boolean> {
    const entry = this._pendingSdkPlugins.get(pluginId);
    if (!entry) return false;

    const { services, missingRequired } = this.sdkAdapter.resolveInject(
      entry.plugin
    );
    if (missingRequired.length > 0) {
      logger.warn(
        `SDK plugin ${pluginId} 重试仍缺服务: ${missingRequired.join(', ')}`
      );
      return false;
    }

    this._pendingSdkPlugins.delete(pluginId);
    await this.finalizeSdkPluginRegistration(
      entry.plugin,
      services,
      entry.contextExtras
    );
    return true;
  }

  /**
   * 程序化注销插件（SDK 路径）
   */
  async unregisterPluginFromSDK(pluginId: string): Promise<void> {
    const plugin = this._sdkPlugins.get(pluginId);
    if (!plugin) return;

    // 生命周期逆序：deactivate → 释放可逆副作用(LIFO) → destroy
    const context = this._sdkContexts.get(pluginId);
    if (context) {
      try {
        await this.sdkAdapter.runLifecycle('deactivate', plugin, context);
      } catch (error) {
        logger.warn(`SDK plugin ${pluginId} deactivate failed`, { error });
      }
      // 4.3：可逆副作用按 LIFO 释放（ctx.effect 逆序撤销）
      await this.sdkAdapter.releaseDisposers(pluginId);
      try {
        await this.sdkAdapter.runLifecycle('destroy', plugin, context);
      } catch (error) {
        logger.warn(`SDK plugin ${pluginId} destroy failed`, { error });
      }
      this._sdkContexts.delete(pluginId);
    }

    try {
      this.registry.unregisterPlugin(pluginId);
    } catch (err) {
      // 注册表中不存在则忽略
    }

    // PY-0：注销插件注册的工具
    this.sdkAdapter.unregisterTools(plugin);

    // 清理技能
    for (const [id, skill] of this._sdkSkills) {
      if (skill.pluginId === pluginId) this._sdkSkills.delete(id);
    }

    this._sdkPlugins.delete(pluginId);

    logger.info(`Unregistered plugin via SDK: ${pluginId}`);
  }

  // ==================== Python 插件管理（PY-3/PY-5） ====================

  /**
   * 注册并激活 Python 插件
   * @param config Python 插件配置（venv 解释器、入口脚本、注入白名单等）
   * @returns 已激活的 PythonPluginAdapter
   */
  async registerPythonPlugin(
    config: PythonPluginConfig
  ): Promise<PythonPluginAdapter> {
    const adapter = new PythonPluginAdapter(config, getKernelServiceRegistry());
    await adapter.initialize();
    await adapter.activate();
    this._pythonPlugins.set(config.pluginId, adapter);
    logger.info(`Python plugin registered: ${config.pluginId}`);
    return adapter;
  }

  /** 注销 Python 插件（destroy：shutdown RPC + 注销工具） */
  async unregisterPythonPlugin(pluginId: string): Promise<void> {
    const adapter = this._pythonPlugins.get(pluginId);
    if (!adapter) return;
    await adapter.destroy();
    this._pythonPlugins.delete(pluginId);
    logger.info(`Python plugin unregistered: ${pluginId}`);
  }

  /** 获取全部已注册 Python 插件 */
  getPythonPlugins(): PythonPluginAdapter[] {
    return Array.from(this._pythonPlugins.values());
  }

  /** 获取指定 Python 插件 */
  getPythonPlugin(pluginId: string): PythonPluginAdapter | undefined {
    return this._pythonPlugins.get(pluginId);
  }

  /**
   * 从插件安装目录发现并激活 Python 插件（M1 编排层）
   * 解析 plugin.json（type:'python' + entry.python）→ venv 解释器 → 注册激活。
   * @param pluginDir 插件安装目录（含 PythonPluginInstaller 生成的桥接清单）
   * @returns 已激活适配器；非 Python 插件返回 undefined
   */
  async registerPythonPluginFromDir(
    pluginDir: string
  ): Promise<PythonPluginAdapter | undefined> {
    const config = resolvePythonPluginConfig(pluginDir);
    if (!config) return undefined;
    if (this._pythonPlugins.has(config.pluginId)) {
      logger.warn(`Python plugin 已注册，跳过: ${config.pluginId}`);
      return this._pythonPlugins.get(config.pluginId);
    }
    return this.registerPythonPlugin(config);
  }

  // ==================== 技能管理 ====================

  /**
   * 获取所有已注册的技能（含 SDK 程序化注册）
   */
  getAllSkills(): SkillInfo[] {
    return Array.from(this._sdkSkills.values());
  }

  /**
   * 获取指定插件的所有技能
   */
  getPluginSkills(pluginId: string): SkillInfo[] {
    return Array.from(this._sdkSkills.values()).filter(
      (skill) => skill.pluginId === pluginId
    );
  }

  /**
   * 执行插件技能
   * 查找指定插件下的技能定义并执行
   */
  async executeSkill(
    pluginId: string,
    skillId: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const plugin = this._sdkPlugins.get(pluginId);
    if (!plugin) {
      throw new AppError(
        `Plugin ${pluginId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    const skill = plugin.skills?.find((s) => s.id === skillId);
    if (!skill) {
      throw new AppError(
        `Skill ${skillId} not found in plugin ${pluginId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    const skillContext: SkillContext = {
      pluginId,
      skillId,
      log: {
        debug: (message: string, ...args: unknown[]) =>
          logger.debug(
            `[${pluginId}:${skillId}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        info: (message: string, ...args: unknown[]) =>
          logger.info(
            `[${pluginId}:${skillId}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        warn: (message: string, ...args: unknown[]) =>
          logger.warn(
            `[${pluginId}:${skillId}] ${message}`,
            args[0] as Record<string, unknown> | undefined
          ),
        error: (message: string, ...args: unknown[]) => {
          const fullMsg = `[${pluginId}:${skillId}] ${message}${args[0] ? ' ' + String(args[0]) : ''}`;
          logger.error(fullMsg, args[1] as Record<string, unknown> | undefined);
        },
      },
    };

    return skill.execute(skillContext, args);
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
      this._pendingSdkPlugins.clear();
      this._sdkPlugins.clear();
      this._sdkContexts.clear();
      this._sdkSkills.clear();
      this._sdkAdapter = null;
      // PY-3：销毁全部 Python 插件子进程（shutdown RPC + 注销工具 + 进程回收）
      for (const adapter of this._pythonPlugins.values()) {
        try {
          await adapter.destroy();
        } catch (error) {
          logger.warn(`Python plugin ${adapter.getState()} destroy failed`, {
            error,
          });
        }
      }
      this._pythonPlugins.clear();

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

// 将自身注入 PluginManager（DI 模式，避免循环依赖）
import('./managers/PluginManager')
  .then(({ setPluginSystem }) => {
    setPluginSystem(pluginSystem);
  })
  .catch((err) => {
    logger.warning('PluginManager 动态加载失败', { error: String(err) });
  });

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
