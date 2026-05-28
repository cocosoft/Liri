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
 * 核心可扩展性系统
 * 提供插件系统、模块化架构、配置管理和事件总线等功能
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  EventBus as CoreEventBus,
  EventBusImpl,
} from '@modules/core/events/EventBus';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件生命周期状态
 */
export enum PluginState {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ACTIVATED = 'activated',
  DEACTIVATED = 'deactivated',
  FAILED = 'failed',
}

/**
 * 插件类型
 */
export enum PluginType {
  TOOL = 'tool',
  THEME = 'theme',
  LANGUAGE = 'language',
  INTEGRATION = 'integration',
  UTILITY = 'utility',
  CUSTOM = 'custom',
}

/**
 * 插件元数据
 */
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: PluginType;
  dependencies?: string[];
  main?: string;
  entryPoint?: string;
  icon?: string;
  homepage?: string;
  license?: string;
  keywords?: string[];
  [key: string]: unknown;
}

/**
 * 插件接口
 */
export interface Plugin {
  metadata: PluginMetadata;
  state: PluginState;
  instance?: unknown;
  error?: string;
  load(): Promise<void>;
  unload(): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
}

/**
 * 插件加载器选项
 */
export interface PluginLoaderOptions {
  pluginDirectories?: string[];
  autoLoad?: boolean;
  autoActivate?: boolean;
  validationEnabled?: boolean;
  cacheEnabled?: boolean;
}

/**
 * 插件加载器
 */
export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private pluginDirectories: string[];
  private autoLoad: boolean;
  private autoActivate: boolean;
  private validationEnabled: boolean;
  private cacheEnabled: boolean;
  private pluginCache: Map<string, Plugin> = new Map();

  constructor(options: PluginLoaderOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? ['./plugins'];
    this.autoLoad = options.autoLoad ?? true;
    this.autoActivate = options.autoActivate ?? true;
    this.validationEnabled = options.validationEnabled ?? true;
    this.cacheEnabled = options.cacheEnabled ?? true;
  }

  /**
   * 加载插件
   */
  async loadPlugin(pluginId: string): Promise<Plugin> {
    // 检查是否已加载
    if (this.plugins.has(pluginId)) {
      return this.plugins.get(pluginId)!;
    }

    // 检查缓存
    if (this.cacheEnabled && this.pluginCache.has(pluginId)) {
      const plugin = this.pluginCache.get(pluginId)!;
      this.plugins.set(pluginId, plugin);
      return plugin;
    }

    try {
      const fs = await import('fs');
      const path = await import('path');

      // 查找插件目录
      let pluginPath: string | undefined;
      for (const dir of this.pluginDirectories) {
        const candidatePath = path.join(dir, pluginId);
        if (
          fs.existsSync(candidatePath) &&
          fs.statSync(candidatePath).isDirectory()
        ) {
          pluginPath = candidatePath;
          break;
        }
      }

      if (!pluginPath) {
        throw new AppError(
          `Plugin directory not found for ${pluginId}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }

      // 读取plugin.json
      const pluginJsonPath = path.join(pluginPath, 'plugin.json');
      if (!fs.existsSync(pluginJsonPath)) {
        throw new AppError(
          `plugin.json not found in ${pluginId}`,
          ErrorCategory.FILESYSTEM,
          ErrorSeverity.HIGH
        );
      }

      const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
      if (!pluginJson.plugin) {
        throw new AppError(
          `Invalid plugin.json format in ${pluginId}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH
        );
      }

      const metadata = pluginJson.plugin;

      // 构建插件对象
      const plugin: Plugin = {
        metadata: {
          id: metadata.name || pluginId,
          name: metadata.name || pluginId,
          version: metadata.version || '1.0.0',
          description: metadata.description || `Plugin ${pluginId}`,
          author: metadata.author || 'Unknown',
          type: PluginType.CUSTOM,
          dependencies: metadata.dependencies || [],
          main: metadata.main || 'src/index.ts',
          ...metadata,
        },
        state: PluginState.LOADING,
        load: async () => {
          logger.info(`Loading plugin ${pluginId}`);
          // 动态导入插件主模块
          try {
            const mainPath = path.join(
              pluginPath!,
              metadata.main || 'src/index.ts'
            );
            const pluginModule = await import(`file://${mainPath}`);
            plugin.instance = pluginModule.default || pluginModule;
          } catch (error) {
            throw new AppError(
              `Failed to load plugin module: ${error instanceof Error ? error.message : String(error)}`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH
            );
          }
          plugin.state = PluginState.LOADED;
        },
        unload: async () => {
          logger.info(`Unloading plugin ${pluginId}`);
          plugin.instance = undefined;
          plugin.state = PluginState.UNLOADED;
        },
        activate: async () => {
          logger.info(`Activating plugin ${pluginId}`);
          const inst = plugin.instance as Record<string, unknown> | undefined;
          if (inst && typeof inst.activate === 'function') {
            await (inst.activate as () => Promise<void>)();
          }
          plugin.state = PluginState.ACTIVATED;
        },
        deactivate: async () => {
          logger.info(`Deactivating plugin ${pluginId}`);
          const inst = plugin.instance as Record<string, unknown> | undefined;
          if (inst && typeof inst.deactivate === 'function') {
            await (inst.deactivate as () => Promise<void>)();
          }
          plugin.state = PluginState.DEACTIVATED;
        },
      };

      await plugin.load();
      this.plugins.set(pluginId, plugin);

      if (this.autoActivate) {
        await plugin.activate();
      }

      if (this.cacheEnabled) {
        this.pluginCache.set(pluginId, plugin);
      }

      return plugin;
    } catch (error) {
      const plugin: Plugin = {
        metadata: {
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: `Plugin ${pluginId}`,
          author: 'Unknown',
          type: PluginType.CUSTOM,
        },
        state: PluginState.FAILED,
        error: error instanceof Error ? error.message : String(error),
        load: async () => {},
        unload: async () => {},
        activate: async () => {},
        deactivate: async () => {},
      };
      this.plugins.set(pluginId, plugin);
      return plugin;
    }
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    try {
      await plugin.unload();
      this.plugins.delete(pluginId);
      this.pluginCache.delete(pluginId);
      return true;
    } catch (error) {
      logger.error(`Failed to unload plugin ${pluginId}:`, error);
      return false;
    }
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    try {
      await plugin.activate();
      return true;
    } catch (error) {
      logger.error(`Failed to activate plugin ${pluginId}:`, error);
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    try {
      await plugin.deactivate();
      return true;
    } catch (error) {
      logger.error(`Failed to deactivate plugin ${pluginId}:`, error);
      return false;
    }
  }

  /**
   * 列出所有插件
   */
  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 扫描插件目录
   */
  async scanPlugins(): Promise<string[]> {
    const pluginIds: string[] = [];
    const fs = await import('fs');
    const path = await import('path');

    for (const pluginDir of this.pluginDirectories) {
      const fullPath = path.resolve(pluginDir);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          const entries = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pluginPath = path.join(fullPath, entry.name);
              const pluginJsonPath = path.join(pluginPath, 'plugin.json');
              if (fs.existsSync(pluginJsonPath)) {
                try {
                  const pluginJson = JSON.parse(
                    fs.readFileSync(pluginJsonPath, 'utf8')
                  );
                  if (pluginJson.plugin && pluginJson.plugin.name) {
                    pluginIds.push(pluginJson.plugin.name);
                  }
                } catch (error) {
                  logger.warning(
                    `Invalid plugin.json in ${entry.name}:`,
                    error
                  );
                }
              }
            }
          }
        }
      } catch (error) {
        logger.warning(`Error scanning plugin directory ${fullPath}:`, error);
      }
    }

    return pluginIds;
  }

  /**
   * 加载所有插件
   */
  async loadAllPlugins(): Promise<Plugin[]> {
    const pluginIds = await this.scanPlugins();
    const loadedPlugins: Plugin[] = [];

    for (const pluginId of pluginIds) {
      const plugin = await this.loadPlugin(pluginId);
      loadedPlugins.push(plugin);
    }

    return loadedPlugins;
  }

  /**
   * 清理插件缓存
   */
  clearCache(): void {
    this.pluginCache.clear();
  }

  /**
   * 销毁插件加载器
   */
  async destroy(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.unload();
      } catch (error) {
        logger.error(`Failed to unload plugin ${plugin.metadata.id}:`, error);
      }
    }
    this.plugins.clear();
    this.pluginCache.clear();
  }
}

/**
 * 模块类型
 */
export enum ModuleType {
  CORE = 'core',
  PLUGIN = 'plugin',
  EXTENSION = 'extension',
  SERVICE = 'service',
  COMPONENT = 'component',
  UTILITY = 'utility',
  CUSTOM = 'custom',
}

/**
 * 模块元数据
 */
export interface ModuleMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  type: ModuleType;
  dependencies?: string[];
  providers?: string[];
  exports?: string[];
  [key: string]: unknown;
}

/**
 * 模块接口
 */
export enum ModuleState {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ACTIVATED = 'activated',
  DEACTIVATED = 'deactivated',
  FAILED = 'failed',
}

export interface Module {
  metadata: ModuleMetadata;
  state: ModuleState;
  providers: Map<string, any>;
  init(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  getProvider<T>(name: string): T | undefined;
  registerProvider(name: string, provider: unknown): void;
  unregisterProvider(name: string): void;
}

/**
 * 模块管理器
 */
export class ModuleManager {
  private modules: Map<string, Module> = new Map();
  private dependencyGraph: Map<string, string[]> = new Map();
  private lazyModules: Map<
    string,
    { loader: () => Promise<Module>; loaded: boolean }
  > = new Map();

  /**
   * 注册模块
   */
  async registerModule(module: Module): Promise<void> {
    if (this.modules.has(module.metadata.id)) {
      throw new AppError(
        `Module ${module.metadata.id} already registered`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    // 解析依赖
    const dependencies = module.metadata.dependencies || [];
    for (const dependency of dependencies) {
      if (!this.modules.has(dependency) && !this.lazyModules.has(dependency)) {
        throw new AppError(
          `Dependency ${dependency} not found for module ${module.metadata.id}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }

      // 如果依赖是懒加载模块，先加载它
      if (
        this.lazyModules.has(dependency) &&
        !this.lazyModules.get(dependency)!.loaded
      ) {
        await this.loadLazyModule(dependency);
      }
    }

    // 初始化模块
    module.state = ModuleState.LOADING;
    try {
      await module.init();
      module.state = ModuleState.LOADED;
      this.modules.set(module.metadata.id, module);
      this.dependencyGraph.set(module.metadata.id, dependencies);
    } catch (error) {
      module.state = ModuleState.FAILED;
      throw error;
    }
  }

  /**
   * 注册懒加载模块
   */
  registerLazyModule(moduleId: string, loader: () => Promise<Module>): void {
    if (this.modules.has(moduleId) || this.lazyModules.has(moduleId)) {
      throw new AppError(
        `Module ${moduleId} already registered`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    this.lazyModules.set(moduleId, { loader, loaded: false });
  }

  /**
   * 加载懒加载模块
   */
  private async loadLazyModule(moduleId: string): Promise<Module> {
    const lazyModule = this.lazyModules.get(moduleId);
    if (!lazyModule) {
      throw new AppError(
        `Lazy module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (lazyModule.loaded) {
      const module = this.modules.get(moduleId);
      if (!module) {
        throw new AppError(
          `Module ${moduleId} not found after loading`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }
      return module;
    }

    const module = await lazyModule.loader();
    await this.registerModule(module);
    lazyModule.loaded = true;
    return module;
  }

  /**
   * 启动模块
   */
  async startModule(moduleId: string): Promise<void> {
    const module = await this.getModule(moduleId);
    if (!module) {
      throw new AppError(
        `Module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (module.state === ModuleState.ACTIVATED) {
      return; // 模块已经激活
    }

    if (module.state === ModuleState.FAILED) {
      throw new AppError(
        `Module ${moduleId} is in failed state`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    try {
      await module.start();
      module.state = ModuleState.ACTIVATED;
    } catch (error) {
      module.state = ModuleState.FAILED;
      throw error;
    }
  }

  /**
   * 停止模块
   */
  async stopModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) {
      throw new AppError(
        `Module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    if (module.state !== ModuleState.ACTIVATED) {
      return; // 模块未激活
    }

    try {
      await module.stop();
      module.state = ModuleState.DEACTIVATED;
    } catch (error) {
      module.state = ModuleState.FAILED;
      throw error;
    }
  }

  /**
   * 卸载模块
   */
  async unregisterModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) {
      throw new AppError(
        `Module ${moduleId} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }

    // 检查是否有其他模块依赖此模块
    for (const [id, dependencies] of this.dependencyGraph.entries()) {
      if (dependencies.includes(moduleId)) {
        throw new AppError(
          `Module ${moduleId} is required by ${id}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }
    }

    // 停止模块
    if (module.state === ModuleState.ACTIVATED) {
      await this.stopModule(moduleId);
    }

    // 销毁模块
    try {
      await module.destroy();
    } catch (error) {
      logger.error(`Failed to destroy module ${moduleId}:`, error);
    }

    this.modules.delete(moduleId);
    this.dependencyGraph.delete(moduleId);

    // 如果是懒加载模块，重置状态
    if (this.lazyModules.has(moduleId)) {
      this.lazyModules.get(moduleId)!.loaded = false;
    }
  }

  /**
   * 获取模块
   */
  async getModule(moduleId: string): Promise<Module | undefined> {
    // 如果模块已经加载，直接返回
    if (this.modules.has(moduleId)) {
      return this.modules.get(moduleId);
    }

    // 如果是懒加载模块，加载它
    if (this.lazyModules.has(moduleId)) {
      try {
        return await this.loadLazyModule(moduleId);
      } catch (error) {
        logger.error(`Failed to load lazy module ${moduleId}:`, error);
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * 列出所有模块
   */
  listModules(): Module[] {
    return Array.from(this.modules.values());
  }

  /**
   * 列出所有懒加载模块
   */
  listLazyModules(): string[] {
    return Array.from(this.lazyModules.keys());
  }

  /**
   * 获取提供者
   */
  async getProvider<T>(name: string): Promise<T | undefined> {
    // 先检查已加载的模块
    for (const module of this.modules.values()) {
      const provider = module.getProvider<T>(name);
      if (provider) {
        return provider;
      }
    }

    // 检查懒加载模块
    for (const [moduleId, lazyModule] of this.lazyModules.entries()) {
      if (!lazyModule.loaded) {
        try {
          const module = await this.loadLazyModule(moduleId);
          const provider = module.getProvider<T>(name);
          if (provider) {
            return provider;
          }
        } catch (error) {
          // 忽略懒加载失败的模块
          continue;
        }
      }
    }

    return undefined;
  }

  /**
   * 注册全局提供者
   */
  registerGlobalProvider(name: string, provider: unknown): void {
    // 实际实现中应该有一个全局模块来管理全局提供者
    logger.info(`Registered global provider: ${name}`);
  }

  /**
   * 销毁模块管理器
   */
  async destroy(): Promise<void> {
    for (const module of this.modules.values()) {
      try {
        await module.destroy();
      } catch (error) {
        logger.error(`Failed to destroy module ${module.metadata.id}:`, error);
      }
    }
    this.modules.clear();
    this.dependencyGraph.clear();
    this.lazyModules.clear();
  }
}

/**
 * 配置项类型
 */
export type ConfigValue = string | number | boolean | object | null | undefined;

/**
 * 配置接口
 */
export interface Config {
  get<T extends ConfigValue>(key: string, defaultValue?: T): T;
  set(key: string, value: ConfigValue): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  toObject(): Record<string, ConfigValue>;
  fromObject(config: Record<string, ConfigValue>): void;
  load(): Promise<void>;
  save(): Promise<void>;
}

/**
 * 内存配置
 */
export class MemoryConfig implements Config {
  private config: Record<string, ConfigValue> = {};

  get<T extends ConfigValue>(key: string, defaultValue?: T): T {
    const value = this.config[key];
    return (value !== undefined ? value : defaultValue) as T;
  }

  set(key: string, value: ConfigValue): void {
    this.config[key] = value;
  }

  has(key: string): boolean {
    return key in this.config;
  }

  delete(key: string): boolean {
    return delete this.config[key];
  }

  clear(): void {
    this.config = {};
  }

  toObject(): Record<string, ConfigValue> {
    return { ...this.config };
  }

  fromObject(config: Record<string, ConfigValue>): void {
    this.config = { ...config };
  }

  async load(): Promise<void> {
    // 实际实现中应该从文件或其他存储加载
  }

  async save(): Promise<void> {
    // 实际实现中应该保存到文件或其他存储
  }
}

/**
 * 配置管理器
 */
export class ConfigManager {
  private configs: Map<string, Config> = new Map();
  private defaultConfig: Config;

  constructor(defaultConfig: Config = new MemoryConfig()) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * 获取配置
   */
  getConfig(name: string): Config {
    if (!this.configs.has(name)) {
      this.configs.set(name, new MemoryConfig());
    }
    return this.configs.get(name)!;
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig(): Config {
    return this.defaultConfig;
  }

  /**
   * 注册配置
   */
  registerConfig(name: string, config: Config): void {
    this.configs.set(name, config);
  }

  /**
   * 移除配置
   */
  removeConfig(name: string): boolean {
    return this.configs.delete(name);
  }

  /**
   * 列出所有配置
   */
  listConfigs(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * 加载所有配置
   */
  async loadAllConfigs(): Promise<void> {
    await this.defaultConfig.load();
    for (const config of this.configs.values()) {
      await config.load();
    }
  }

  /**
   * 保存所有配置
   */
  async saveAllConfigs(): Promise<void> {
    await this.defaultConfig.save();
    for (const config of this.configs.values()) {
      await config.save();
    }
  }

  /**
   * 销毁配置管理器
   */
  async destroy(): Promise<void> {
    await this.saveAllConfigs();
    this.configs.clear();
  }
}

/**
 * 事件类型
 */
export enum EventType {
  PLUGIN_LOADED = 'plugin_loaded',
  PLUGIN_UNLOADED = 'plugin_unloaded',
  PLUGIN_ACTIVATED = 'plugin_activated',
  PLUGIN_DEACTIVATED = 'plugin_deactivated',
  MODULE_REGISTERED = 'module_registered',
  MODULE_UNREGISTERED = 'module_unregistered',
  CONFIG_CHANGED = 'config_changed',
  SYSTEM_START = 'system_start',
  SYSTEM_STOP = 'system_stop',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  DEBUG = 'debug',
  CUSTOM = 'custom',
}

/**
 * 事件数据
 */
export interface EventData {
  type: EventType;
  timestamp: number;
  data?: unknown;
  source?: string;
  [key: string]: unknown;
}

/**
 * 事件监听器
 */
export type EventListener = (event: EventData) => void;

/**
 * 事件总线（基于核心 EventBus 的封装）
 */
export class EventBus {
  private coreBus: CoreEventBus;

  constructor(bus?: CoreEventBus) {
    this.coreBus = bus || new EventBusImpl();
  }

  /**
   * 注册事件监听器
   */
  on(type: EventType, listener: EventListener): void {
    this.coreBus.subscribe(type, listener);
  }

  /**
   * 移除事件监听器
   */
  off(type: EventType, listener: EventListener): void {
    this.coreBus.unsubscribe(type, listener);
  }

  /**
   * 触发事件
   */
  emit(type: EventType, data?: unknown, source?: string): void {
    const event: EventData = {
      type,
      timestamp: Date.now(),
      data,
      source,
    };
    this.coreBus.publish(type, event);
  }

  /**
   * 触发一次性事件
   */
  once(type: EventType, listener: EventListener): void {
    this.coreBus.once(type, listener);
  }

  /**
   * 移除所有事件监听器
   */
  removeAllListeners(type?: EventType): void {
    this.coreBus.unsubscribeAll(type);
  }

  /**
   * 获取事件监听器数量
   */
  listenerCount(type: EventType): number {
    return this.coreBus.listenerCount(type);
  }

  /**
   * 销毁事件总线
   */
  destroy(): void {
    this.coreBus.unsubscribeAll();
  }
}

/**
 * 可扩展性工具函数
 */
export const extensibilityUtils = {
  /**
   * 深度合并对象
   */
  deepMerge: (target: unknown, source: unknown): unknown => {
    if (target === null || typeof target !== 'object') {
      return source;
    }
    if (source === null || typeof source !== 'object') {
      return source;
    }
    if (Array.isArray(target) && Array.isArray(source)) {
      return [...target, ...source];
    }
    if (Array.isArray(target) || Array.isArray(source)) {
      return source;
    }

    const merged = { ...(target as Record<string, unknown>) };
    for (const key in source as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        merged[key] = extensibilityUtils.deepMerge(
          (target as Record<string, unknown>)[key],
          (source as Record<string, unknown>)[key]
        );
      }
    }
    return merged;
  },

  /**
   * 延迟加载模块
   */
  lazyLoad: async <T>(loader: () => Promise<T>): Promise<T> => {
    return await loader();
  },

  /**
   * 动态导入模块
   */
  dynamicImport: async <T>(path: string): Promise<T> => {
    const module = await import(path);
    return module.default || module;
  },

  /**
   * 验证插件元数据
   */
  validatePluginMetadata: (metadata: unknown): boolean => {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      typeof (metadata as Record<string, unknown>).id === 'string' &&
      typeof (metadata as Record<string, unknown>).name === 'string' &&
      typeof (metadata as Record<string, unknown>).version === 'string' &&
      typeof (metadata as Record<string, unknown>).description === 'string' &&
      typeof (metadata as Record<string, unknown>).author === 'string' &&
      Object.values(PluginType).includes(
        (metadata as Record<string, unknown>).type as PluginType
      )
    );
  },

  /**
   * 验证模块元数据
   */
  validateModuleMetadata: (metadata: unknown): boolean => {
    return (
      typeof metadata === 'object' &&
      metadata !== null &&
      typeof (metadata as Record<string, unknown>).id === 'string' &&
      typeof (metadata as Record<string, unknown>).name === 'string' &&
      typeof (metadata as Record<string, unknown>).version === 'string' &&
      typeof (metadata as Record<string, unknown>).description === 'string' &&
      Object.values(ModuleType).includes(
        (metadata as Record<string, unknown>).type as ModuleType
      )
    );
  },
};

/**
 * 创建默认的插件加载器
 */
export function createPluginLoader(
  options?: PluginLoaderOptions
): PluginLoader {
  return new PluginLoader({
    pluginDirectories: ['./plugins'],
    autoLoad: true,
    autoActivate: true,
    validationEnabled: true,
    cacheEnabled: true,
    ...options,
  });
}

/**
 * 创建默认的模块管理器
 */
export function createModuleManager(): ModuleManager {
  return new ModuleManager();
}

/**
 * 创建默认的配置管理器
 */
export function createConfigManager(defaultConfig?: Config): ConfigManager {
  return new ConfigManager(defaultConfig || new MemoryConfig());
}

/**
 * 创建默认的事件总线
 */
export function createEventBus(): EventBus {
  return new EventBus();
}

/**
 * 全局可扩展性服务
 */
export class ExtensibilityService {
  private pluginLoader: PluginLoader;
  private moduleManager: ModuleManager;
  private configManager: ConfigManager;
  private eventBus: EventBus;

  constructor() {
    this.pluginLoader = createPluginLoader();
    this.moduleManager = createModuleManager();
    this.configManager = createConfigManager();
    this.eventBus = createEventBus();
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
   * 初始化可扩展性服务
   */
  async init(): Promise<void> {
    await this.configManager.loadAllConfigs();

    // 注册核心模块为懒加载模块
    this.registerCoreModules();

    await this.pluginLoader.loadAllPlugins();
    this.eventBus.emit(EventType.SYSTEM_START);
  }

  /**
   * 注册核心模块
   */
  private registerCoreModules(): void {
    // 注册配置模块
    this.moduleManager.registerLazyModule('config', async () => ({
      metadata: {
        id: 'config',
        name: 'Config Module',
        version: '1.0.0',
        description: 'Configuration management module',
        type: ModuleType.CORE,
      },
      state: ModuleState.UNLOADED,
      providers: new Map(),
      async init() {
        logger.info('Config module initialized');
      },
      async start() {
        logger.info('Config module started');
      },
      async stop() {
        logger.info('Config module stopped');
      },
      async destroy() {
        logger.info('Config module destroyed');
      },
      getProvider: <T>(name: string): T | undefined =>
        this.configManager.getConfig(name) as T,
      registerProvider: (name: string, provider: unknown): void => {
        this.configManager.registerConfig(name, provider as Config);
      },
      unregisterProvider: (name: string): void => {
        this.configManager.removeConfig(name);
      },
    }));

    // 注册插件模块
    this.moduleManager.registerLazyModule('plugin', async () => ({
      metadata: {
        id: 'plugin',
        name: 'Plugin Module',
        version: '1.0.0',
        description: 'Plugin management module',
        type: ModuleType.CORE,
      },
      state: ModuleState.UNLOADED,
      providers: new Map(),
      async init() {
        logger.info('Plugin module initialized');
      },
      async start() {
        logger.info('Plugin module started');
      },
      async stop() {
        logger.info('Plugin module stopped');
      },
      async destroy() {
        logger.info('Plugin module destroyed');
      },
      getProvider: <T>(name: string): T | undefined => undefined,
      registerProvider: (name: string, provider: unknown): void => {},
      unregisterProvider: (name: string): void => {},
    }));

    // 注册事件模块
    this.moduleManager.registerLazyModule('event', async () => ({
      metadata: {
        id: 'event',
        name: 'Event Module',
        version: '1.0.0',
        description: 'Event bus module',
        type: ModuleType.CORE,
      },
      state: ModuleState.UNLOADED,
      providers: new Map(),
      async init() {
        logger.info('Event module initialized');
      },
      async start() {
        logger.info('Event module started');
      },
      async stop() {
        logger.info('Event module stopped');
      },
      async destroy() {
        logger.info('Event module destroyed');
      },
      getProvider: <T>(name: string): T | undefined => this.eventBus as T,
      registerProvider: (name: string, provider: unknown): void => {},
      unregisterProvider: (name: string): void => {},
    }));

    // 注册技能系统模块
    this.moduleManager.registerLazyModule('skills', async () => {
      const { SkillManager } = await import('../../skills/SkillManager.js');
      const skillManager = new SkillManager();
      return {
        metadata: {
          id: 'skills',
          name: 'Skills Module',
          version: '1.0.0',
          description: 'Skills management module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Skills module initialized');
        },
        async start() {
          logger.info('Skills module started');
        },
        async stop() {
          logger.info('Skills module stopped');
        },
        async destroy() {
          logger.info('Skills module destroyed');
        },
        getProvider: <T>(name: string): T | undefined =>
          name === 'skillManager' ? (skillManager as T) : undefined,
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });

    // 注册远程功能模块
    this.moduleManager.registerLazyModule('remote', async () => {
      const { RemoteSessionManager, createRemoteSessionManager } =
        await import('../../remote/RemoteSessionManager.js');
      return {
        metadata: {
          id: 'remote',
          name: 'Remote Module',
          version: '1.0.0',
          description: 'Remote connection management module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Remote module initialized');
        },
        async start() {
          logger.info('Remote module started');
        },
        async stop() {
          logger.info('Remote module stopped');
        },
        async destroy() {
          logger.info('Remote module destroyed');
        },
        getProvider: <T>(name: string): T | undefined =>
          name === 'createRemoteSessionManager'
            ? (createRemoteSessionManager as T)
            : undefined,
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });

    // 注册安全性模块
    this.moduleManager.registerLazyModule('security', async () => {
      const { SandboxManager, PermissionManager, SecurityAudit } =
        await import('../../security/index.js');
      const sandboxManager = new SandboxManager();
      const permissionManager = new PermissionManager();
      const securityAudit = new SecurityAudit();
      return {
        metadata: {
          id: 'security',
          name: 'Security Module',
          version: '1.0.0',
          description: 'Security management module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Security module initialized');
        },
        async start() {
          logger.info('Security module started');
        },
        async stop() {
          logger.info('Security module stopped');
        },
        async destroy() {
          logger.info('Security module destroyed');
        },
        getProvider: <T>(name: string): T | undefined => {
          if (name === 'sandboxManager') return sandboxManager as T;
          if (name === 'permissionManager') return permissionManager as T;
          if (name === 'securityAudit') return securityAudit as T;
          return undefined;
        },
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });

    // 注册性能优化模块
    this.moduleManager.registerLazyModule('performance', async () => {
      const { PerformanceOptimizer, performanceOptimizer } =
        await import('../../performance/PerformanceOptimizer.js');
      const { PerformanceProfiler, MemoryManager, MemoryCache } =
        await import('../../core/utils/Performance.js');
      const performanceProfiler = new PerformanceProfiler();
      const memoryManager = new MemoryManager();
      return {
        metadata: {
          id: 'performance',
          name: 'Performance Module',
          version: '1.0.0',
          description: 'Performance optimization module',
          type: ModuleType.CORE,
        },
        state: ModuleState.UNLOADED,
        providers: new Map(),
        async init() {
          logger.info('Performance module initialized');
        },
        async start() {
          logger.info('Performance module started');
        },
        async stop() {
          logger.info('Performance module stopped');
        },
        async destroy() {
          logger.info('Performance module destroyed');
        },
        getProvider: <T>(name: string): T | undefined => {
          if (name === 'performanceOptimizer') return performanceOptimizer as T;
          if (name === 'performanceProfiler') return performanceProfiler as T;
          if (name === 'memoryManager') return memoryManager as T;
          if (name === 'MemoryCache') return MemoryCache as T;
          return undefined;
        },
        registerProvider: (name: string, provider: unknown): void => {},
        unregisterProvider: (name: string): void => {},
      };
    });
  }

  /**
   * 启动所有模块
   */
  async startAllModules(): Promise<void> {
    for (const module of this.moduleManager.listModules()) {
      if (module.state === ModuleState.LOADED) {
        await this.moduleManager.startModule(module.metadata.id);
      }
    }
  }

  /**
   * 停止所有模块
   */
  async stopAllModules(): Promise<void> {
    for (const module of this.moduleManager.listModules()) {
      if (module.state === ModuleState.ACTIVATED) {
        await this.moduleManager.stopModule(module.metadata.id);
      }
    }
  }

  /**
   * 销毁可扩展性服务
   */
  async destroy(): Promise<void> {
    this.eventBus.emit(EventType.SYSTEM_STOP);
    await this.stopAllModules();
    await this.pluginLoader.destroy();
    await this.moduleManager.destroy();
    await this.configManager.destroy();
    this.eventBus.destroy();
  }

  /**
   * 关闭可扩展性服务
   */
  async shutdown(): Promise<void> {
    await this.destroy();
  }
}

/**
 * 全局可扩展性服务实例
 */
let globalExtensibilityService: ExtensibilityService | null = null;

/**
 * 获取全局可扩展性服务
 */
export function getExtensibilityService(): ExtensibilityService {
  if (!globalExtensibilityService) {
    globalExtensibilityService = new ExtensibilityService();
  }
  return globalExtensibilityService;
}

export default {
  PluginState,
  PluginType,
  ModuleType,
  ModuleManager,
  ConfigManager,
  EventType,
  EventBus,
  extensibilityUtils,
  createPluginLoader,
  createModuleManager,
  createConfigManager,
  createEventBus,
  ExtensibilityService,
  getExtensibilityService,
};
