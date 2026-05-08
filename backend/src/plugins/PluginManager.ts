//
/**
 * 插件管理器
 * 负责管理插件的生命周期和整体操作
 */

import type { LoadedPlugin } from '../types/plugin';
import type { Command } from '../commands/types/index.js';
import { PluginLoader, PluginSource } from './PluginLoader';
import { PluginRegistry } from './PluginRegistry';
import { PluginComponentLoader } from './PluginComponentLoader';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { logger } from '../utils/log';

export class PluginManager {
  private loader: PluginLoader;
  private registry: PluginRegistry;
  private componentLoader: PluginComponentLoader;
  private pluginDirs: string[];
  private pluginSources: PluginSource[];

  constructor() {
    this.loader = new PluginLoader();
    this.registry = new PluginRegistry();
    this.componentLoader = new PluginComponentLoader();
    this.pluginDirs = [
      join(process.cwd(), 'plugins'),
      join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.py_app',
        'plugins'
      ),
    ];
    this.pluginSources = [];
  }

  /**
   * 添加插件源
   * @param source 插件源配置
   */
  addPluginSource(source: PluginSource): void {
    this.pluginSources.push(source);
  }

  /**
   * 加载插件
   */
  async loadPlugins(): Promise<void> {
    try {
      // 清空现有插件和组件
      this.registry.clear();
      this.componentLoader.clear();

      // 收集所有插件路径和源
      const pluginPaths: Array<string | PluginSource> = [];

      // 扫描本地插件目录
      for (const dir of this.pluginDirs) {
        if (existsSync(dir)) {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              pluginPaths.push(join(dir, entry.name));
            }
          }
        }
      }

      // 添加外部插件源
      pluginPaths.push(...this.pluginSources);

      // 加载插件
      const plugins = await this.loader.loadAll(pluginPaths);

      // 注册插件并加载组件
      for (const plugin of plugins) {
        this.registry.register(plugin);
        if (plugin.enabled) {
          this.componentLoader.loadComponents(plugin);
        }
      }

      logger.info(`Loaded ${plugins.length} plugins with ${this.componentLoader.getComponentCount()} components`);
    } catch (error) {
      logger.error('Failed to load plugins:', error);
    }
  }

  /**
   * 启用插件
   * @param pluginName 插件名称
   */
  async enablePlugin(pluginName: string): Promise<void> {
    const plugin = this.registry.get(pluginName);
    if (plugin) {
      // 这里可以添加启用插件的逻辑
      plugin.enabled = true;
      this.componentLoader.loadComponents(plugin);
      logger.info(`Enabled plugin: ${pluginName}`);
    } else {
      throw new Error(`Plugin ${pluginName} not found`);
    }
  }

  /**
   * 禁用插件
   * @param pluginName 插件名称
   */
  async disablePlugin(pluginName: string): Promise<void> {
    const plugin = this.registry.get(pluginName);
    if (plugin) {
      // 这里可以添加禁用插件的逻辑
      plugin.enabled = false;
      this.componentLoader.unloadComponents(pluginName);
      logger.info(`Disabled plugin: ${pluginName}`);
    } else {
      throw new Error(`Plugin ${pluginName} not found`);
    }
  }

  /**
   * 获取插件
   * @returns 启用和禁用的插件
   */
  getPlugins(): { enabled: LoadedPlugin[]; disabled: LoadedPlugin[] } {
    return {
      enabled: this.registry.getEnabled(),
      disabled: this.registry.getDisabled(),
    };
  }

  /**
   * 获取单个插件
   * @param pluginName 插件名称
   * @returns 插件对象或undefined
   */
  getPlugin(pluginName: string): LoadedPlugin | undefined {
    return this.registry.get(pluginName);
  }

  /**
   * 获取所有插件
   * @returns 插件数组
   */
  getAllPlugins(): LoadedPlugin[] {
    return this.registry.getAll();
  }

  /**
   * 注册内置插件
   * @param plugin 内置插件
   */
  registerBuiltinPlugin(plugin: LoadedPlugin): void {
    plugin.isBuiltin = true;
    this.registry.register(plugin);
    if (plugin.enabled) {
      this.componentLoader.loadComponents(plugin);
    }
  }

  /**
   * 清理插件缓存
   */
  clearCache(): void {
    this.loader.clearCache();
  }

  /**
   * 获取插件组件加载器
   */
  getComponentLoader(): PluginComponentLoader {
    return this.componentLoader;
  }

  /**
   * 获取所有插件命令
   * 从插件组件加载器中获取命令组件并包装为 Command 对象
   * @returns 命令列表
   */
  async getCommands(): Promise<Command[]> {
    const commands: Command[] = [];
    const commandComponents = this.componentLoader.getComponentsByType('commands');

    for (const component of commandComponents) {
      const plugin = this.registry.get(component.pluginName);
      if (!plugin || !plugin.enabled) continue;

      const command: Command = {
        type: 'prompt',
        name: component.name,
        description: component.metadata?.description || `Plugin command from ${component.pluginName}`,
        aliases: component.metadata?.aliases || [],
        loadedFrom: 'plugin',
        isHidden: false,
        load: async () => {
          try {
            const module = await import(/* @vite-ignore */ component.path);
            const impl = module.default || module;
            return {
              getPromptForCommand: impl.getPromptForCommand,
              execute: impl.execute,
              call: impl.call,
              validate: impl.validate,
            };
          } catch (err) {
            logger.error(`Failed to load plugin command ${component.name}:`, err);
            return {};
          }
        },
      };
      commands.push(command);
    }

    return commands;
  }
}

// 导出单例
export const pluginManager = new PluginManager();
