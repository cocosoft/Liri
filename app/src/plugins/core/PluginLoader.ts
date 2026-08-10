/**
 * 负责插件的发现、加载、验证和生命周期管理
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { resolvePluginsInstalledDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  PluginState,
  PluginType,
  PluginMetadata,
  PluginConfig,
  LoadedPlugin,
  PluginLoaderOptions,
  PluginLoadResult,
  PluginValidationResult,
  PluginEventType,
  PluginEvent,
} from '../types/PluginTypes';

const logger = getLogger('plugins:core:pluginLoader');

/**
 * 插件加载器
 */
export class PluginLoader extends EventEmitter {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private options: PluginLoaderOptions;
  private isInitialized = false;

  /**
   * 构造函数
   */
  constructor(options: PluginLoaderOptions = {}) {
    super();

    this.options = {
      // 2026-08-06 路径收敛：默认插件目录统一为 ~/.pyapp/plugins/installed（原项目根 plugins/ 双基地已废弃）
      pluginDirectories: [resolvePluginsInstalledDir()],
      autoLoad: true,
      autoActivate: false,
      validationEnabled: true,
      cacheEnabled: true,
      maxConcurrentLoads: 5,
      loadTimeout: 30000,
      ...options,
    };
  }

  /**
   * 初始化插件加载器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.emit('initializing');

    try {
      // 创建插件目录
      await this.createPluginDirectories();

      // 发现插件
      await this.discoverPlugins();

      // 自动加载插件
      if (this.options.autoLoad) {
        await this.loadAllPlugins();
      }

      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      this.emit('error', {
        type: 'initialization',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * 创建插件目录
   * 2026-08-06 修复：真实创建目录（原实现仅打 warning 不建目录）
   */
  private async createPluginDirectories(): Promise<void> {
    for (const dir of this.options.pluginDirectories || []) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        logger.info(`Created plugin directory: ${dir}`);
      }
    }
  }

  /**
   * 发现插件
   */
  private async discoverPlugins(): Promise<void> {
    this.emit('discovering');

    for (const dir of this.options.pluginDirectories || []) {
      if (!existsSync(dir)) {
        continue;
      }

      try {
        const items = readdirSync(dir, { withFileTypes: true });

        for (const item of items) {
          if (!item.isDirectory()) {
            continue;
          }

          const pluginPath = join(dir, item.name);
          const manifestPath = join(pluginPath, 'plugin.json');

          if (existsSync(manifestPath)) {
            await this.registerPlugin(pluginPath);
          }
        }
      } catch (error) {
        this.emit('error', {
          type: 'discovery',
          pluginPath: dir,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    this.emit('discovered', { count: this.plugins.size });
  }

  /**
   * 注册插件
   */
  private async registerPlugin(pluginPath: string): Promise<void> {
    try {
      // 读取插件清单
      const manifest = await this.loadManifest(pluginPath);

      // 验证插件
      const validationResult = await this.validatePlugin(manifest, pluginPath);

      if (!validationResult.valid) {
        this.emit('validationFailed', {
          pluginPath,
          errors: validationResult.errors,
        });
        return;
      }

      // 创建插件实例
      const plugin: LoadedPlugin = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        state: PluginState.UNLOADED,
        path: pluginPath,
        source: manifest.id,
        enabled: false,
        config: {},
        // 2026-08-06 修复：发现时即填充 manifest，供展示层（getPluginInfoList）读取
        manifest: manifest as unknown as NonNullable<LoadedPlugin['manifest']>,
        stats: {
          loadCount: 0,
          activateCount: 0,
          errorCount: 0,
        },
      };

      this.plugins.set(manifest.id, plugin);

      this.emit('registered', { plugin });
    } catch (error) {
      this.emit('error', {
        type: 'registration',
        pluginPath,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * 加载插件清单
   * 2026-08-06 修复：真实读取并解析 plugin.json（原实现返回硬编码 Mock 清单，违反 CS04）
   */
  private async loadManifest(pluginPath: string): Promise<PluginMetadata> {
    const manifestPath = join(pluginPath, 'plugin.json');

    if (!existsSync(manifestPath)) {
      throw new Error(`plugin.json not found: ${manifestPath}`);
    }

    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // 2026-08-06 修复（Q2）：兼容 { plugin: {...} } 包裹格式（npm 包/example-plugin），
    // 以及 main 作为 entryPoint 的别名（npm 包通常用 main 字段声明入口）
    const base =
      parsed && typeof parsed.plugin === 'object' && parsed.plugin !== null
        ? (parsed.plugin as Record<string, unknown>)
        : parsed;

    const entryPoint =
      typeof base.entryPoint === 'string'
        ? base.entryPoint
        : typeof base.main === 'string'
          ? base.main
          : undefined;

    return {
      id: typeof base.id === 'string' ? base.id : '',
      name: typeof base.name === 'string' ? base.name : '',
      version: typeof base.version === 'string' ? base.version : '',
      description: typeof base.description === 'string' ? base.description : '',
      author: typeof base.author === 'string' ? base.author : '',
      type:
        base.type === PluginType.THEME ||
        base.type === PluginType.LANGUAGE ||
        base.type === PluginType.INTEGRATION ||
        base.type === PluginType.UTILITY ||
        base.type === PluginType.CUSTOM
          ? (base.type as PluginType)
          : PluginType.TOOL,
      main: typeof base.main === 'string' ? base.main : undefined,
      entryPoint,
      ...base,
    };
  }

  /**
   * 验证插件
   */
  private async validatePlugin(
    manifest: PluginMetadata,
    pluginPath: string
  ): Promise<PluginValidationResult> {
    if (!this.options.validationEnabled) {
      return { valid: true, errors: [], warnings: [] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证必需字段
    if (!manifest.id) {
      errors.push('Plugin ID is required');
    }

    if (!manifest.name) {
      errors.push('Plugin name is required');
    }

    if (!manifest.version) {
      errors.push('Plugin version is required');
    }

    if (!manifest.description) {
      warnings.push('Plugin description is recommended');
    }

    // 验证ID格式
    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push(
        'Plugin ID must contain only lowercase letters, numbers, and hyphens'
      );
    }

    // 验证版本格式
    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      warnings.push('Plugin version should follow semantic versioning');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 加载所有插件
   */
  async loadAllPlugins(): Promise<PluginLoadResult[]> {
    this.emit('loadingAll');

    const results: PluginLoadResult[] = [];

    for (const plugin of this.plugins.values()) {
      if (plugin.state === PluginState.UNLOADED) {
        const result = await this.loadPlugin(plugin.id);
        results.push(result);
      }
    }

    this.emit('loadedAll', { results });

    return results;
  }

  /**
   * 加载插件
   */
  async loadPlugin(pluginId: string): Promise<PluginLoadResult> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return {
        success: false,
        error: `Plugin not found: ${pluginId}`,
      };
    }

    if (plugin.state !== PluginState.UNLOADED) {
      return {
        success: false,
        error: `Plugin is already in state: ${plugin.state}`,
      };
    }

    this.emitPluginEvent(PluginEventType.BEFORE_LOAD, pluginId);

    try {
      // 更新插件状态
      plugin.state = PluginState.LOADING;

      // 2026-08-06 修复：真实解析清单并动态加载插件入口（原实现 setTimeout(100ms) 模拟，违反 CS04）
      const manifest = await this.loadManifest(plugin.path);
      plugin.manifest = {
        ...(plugin.manifest ?? {}),
        ...manifest,
      } as unknown as NonNullable<LoadedPlugin['manifest']>;
      // 同步清单中声明的 paths 字段（Agent/命令/技能）
      const strArray = (v: unknown): string[] | undefined =>
        Array.isArray(v)
          ? v.filter((x): x is string => typeof x === 'string')
          : undefined;
      plugin.agentsPaths = strArray(manifest.agentsPaths);
      plugin.commandsPaths = strArray(manifest.commandsPaths);
      plugin.skillsPaths = strArray(manifest.skillsPaths);
      // 2026-08-06 同步 manifest 声明的外部服务（mcpServers），供 EnhancedMCPConfigManager 接线（J-22）
      plugin.mcpServers = Array.isArray(manifest.mcpServers)
        ? (manifest.mcpServers as Array<Record<string, unknown>>)
        : undefined;

      const entryPoint = manifest.entryPoint || manifest.main;
      if (entryPoint) {
        const entryPath = join(plugin.path, entryPoint);
        plugin.instance = await import(entryPath);
      }

      // 更新插件状态和统计信息
      plugin.state = PluginState.LOADED;
      plugin.loadedAt = new Date();
      if (plugin.stats) plugin.stats.loadCount++;

      this.emitPluginEvent(PluginEventType.AFTER_LOAD, pluginId);

      return {
        success: true,
        plugin,
      };
    } catch (error) {
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      if (plugin.stats) plugin.stats.errorCount++;

      this.emitPluginEvent(PluginEventType.ERROR, pluginId, { error });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(pluginId: string): Promise<PluginLoadResult> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return {
        success: false,
        error: `Plugin not found: ${pluginId}`,
      };
    }

    if (plugin.state === PluginState.UNLOADED) {
      return {
        success: false,
        error: `Plugin is already unloaded`,
      };
    }

    this.emitPluginEvent(PluginEventType.BEFORE_UNLOAD, pluginId);

    try {
      // 更新插件状态
      plugin.state = PluginState.UNLOADED;
      plugin.instance = undefined;
      plugin.error = undefined;

      this.emitPluginEvent(PluginEventType.AFTER_UNLOAD, pluginId);

      return {
        success: true,
        plugin,
      };
    } catch (error) {
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      if (plugin.stats) plugin.stats.errorCount++;

      this.emitPluginEvent(PluginEventType.ERROR, pluginId, { error });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<PluginLoadResult> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return {
        success: false,
        error: `Plugin not found: ${pluginId}`,
      };
    }

    if (plugin.state !== PluginState.LOADED) {
      return {
        success: false,
        error: `Plugin must be loaded before activation, current state: ${plugin.state}`,
      };
    }

    this.emitPluginEvent(PluginEventType.BEFORE_ACTIVATE, pluginId);

    try {
      // 更新插件状态
      plugin.state = PluginState.ACTIVATED;
      plugin.activatedAt = new Date();
      if (plugin.stats) plugin.stats.activateCount++;

      this.emitPluginEvent(PluginEventType.AFTER_ACTIVATE, pluginId);

      return {
        success: true,
        plugin,
      };
    } catch (error) {
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      if (plugin.stats) plugin.stats.errorCount++;

      this.emitPluginEvent(PluginEventType.ERROR, pluginId, { error });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<PluginLoadResult> {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      return {
        success: false,
        error: `Plugin not found: ${pluginId}`,
      };
    }

    if (plugin.state !== PluginState.ACTIVATED) {
      return {
        success: false,
        error: `Plugin is not activated, current state: ${plugin.state}`,
      };
    }

    this.emitPluginEvent(PluginEventType.BEFORE_DEACTIVATE, pluginId);

    try {
      // 更新插件状态
      plugin.state = PluginState.DEACTIVATED;
      plugin.deactivatedAt = new Date();

      this.emitPluginEvent(PluginEventType.AFTER_DEACTIVATE, pluginId);

      return {
        success: true,
        plugin,
      };
    } catch (error) {
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      if (plugin.stats) plugin.stats.errorCount++;

      this.emitPluginEvent(PluginEventType.ERROR, pluginId, { error });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已加载插件
   */
  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) =>
        plugin.state === PluginState.LOADED ||
        plugin.state === PluginState.ACTIVATED
    );
  }

  /**
   * 获取已激活插件
   */
  getActivatedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (plugin) => plugin.state === PluginState.ACTIVATED
    );
  }

  /**
   * 获取插件数量
   */
  getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * 发射插件事件
   */
  private emitPluginEvent(
    type: PluginEventType,
    pluginId: string,
    data?: any
  ): void {
    const event: PluginEvent = {
      type,
      pluginId,
      data,
      timestamp: new Date(),
    };

    this.emit('pluginEvent', event);
    this.emit(type, event);
  }

  /**
   * 销毁插件加载器
   */
  async destroy(): Promise<void> {
    this.emit('destroying');

    // 卸载所有插件
    for (const plugin of this.plugins.values()) {
      if (plugin.state !== PluginState.UNLOADED) {
        await this.unloadPlugin(plugin.id);
      }
    }

    this.plugins.clear();
    this.isInitialized = false;

    this.emit('destroyed');
  }
}

export default PluginLoader;
