// @ts-nocheck
/**
 * 插件组件加载器
 * 负责加载和管理插件中的各种组件
 */

import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import { logger } from '../utils/log';
import type { LoadedPlugin, CommandMetadata } from '../types/plugin';

/**
 * 插件组件类型
 */
export type PluginComponentType = 'commands' | 'agents' | 'skills' | 'outputStyles' | 'tools' | 'hooks' | 'themes' | 'languages' | 'presets';

/**
 * 插件组件信息
 */
export interface PluginComponentInfo {
  name: string;
  type: PluginComponentType;
  path: string;
  pluginName: string;
  metadata?: CommandMetadata | any;
  loaded?: boolean;
}

/**
 * 插件组件加载器
 */
export class PluginComponentLoader {
  private components: Map<string, PluginComponentInfo> = new Map();
  private pluginComponents: Map<string, PluginComponentInfo[]> = new Map();
  private lazyLoad: boolean = true; // 启用延迟加载

  /**
   * 加载插件的所有组件
   * @param plugin 已加载的插件
   */
  loadComponents(plugin: LoadedPlugin): void {
    if (!plugin.enabled) {
      return;
    }

    try {
      // 加载命令组件
      this.loadCommandComponents(plugin);

      // 加载代理组件
      this.loadAgentComponents(plugin);

      // 加载技能组件
      this.loadSkillComponents(plugin);

      // 加载输出样式组件
      this.loadOutputStyleComponents(plugin);

      // 加载工具组件
      this.loadToolComponents(plugin);

      // 加载钩子组件
      this.loadHookComponents(plugin);

      // 加载主题组件
      this.loadThemeComponents(plugin);

      // 加载语言组件
      this.loadLanguageComponents(plugin);

      // 加载预设组件
      this.loadPresetComponents(plugin);

      logger.info(`Loaded components for plugin: ${plugin.name}`);
    } catch (error) {
      logger.error(`Failed to load components for plugin ${plugin.name}:`, error);
    }
  }

  /**
   * 加载命令组件
   */
  private loadCommandComponents(plugin: LoadedPlugin): void {
    const commandPaths = this.getComponentPaths(plugin, 'commands');
    for (const path of commandPaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'commands', plugin);
      }
    }
  }

  /**
   * 加载代理组件
   */
  private loadAgentComponents(plugin: LoadedPlugin): void {
    const agentPaths = this.getComponentPaths(plugin, 'agents');
    for (const path of agentPaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'agents', plugin);
      }
    }
  }

  /**
   * 加载技能组件
   */
  private loadSkillComponents(plugin: LoadedPlugin): void {
    const skillPaths = this.getComponentPaths(plugin, 'skills');
    for (const path of skillPaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'skills', plugin);
      }
    }
  }

  /**
   * 加载输出样式组件
   */
  private loadOutputStyleComponents(plugin: LoadedPlugin): void {
    const outputStylePaths = this.getComponentPaths(plugin, 'outputStyles');
    for (const path of outputStylePaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'outputStyles', plugin);
      }
    }
  }

  /**
   * 加载工具组件
   */
  private loadToolComponents(plugin: LoadedPlugin): void {
    const toolPaths = this.getComponentPaths(plugin, 'tools');
    for (const path of toolPaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'tools', plugin);
      }
    }
  }

  /**
   * 加载钩子组件
   */
  private loadHookComponents(plugin: LoadedPlugin): void {
    const hookPaths = this.getComponentPaths(plugin, 'hooks');
    for (const path of hookPaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'hooks', plugin);
      }
    }
  }

  /**
   * 加载主题组件
   */
  private loadThemeComponents(plugin: LoadedPlugin): void {
    const themePaths = this.getComponentPaths(plugin, 'themes');
    for (const path of themePaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'themes', plugin);
      }
    }
  }

  /**
   * 加载语言组件
   */
  private loadLanguageComponents(plugin: LoadedPlugin): void {
    const languagePaths = this.getComponentPaths(plugin, 'languages');
    for (const path of languagePaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'languages', plugin);
      }
    }
  }

  /**
   * 加载预设组件
   */
  private loadPresetComponents(plugin: LoadedPlugin): void {
    const presetPaths = this.getComponentPaths(plugin, 'presets');
    for (const path of presetPaths) {
      if (existsSync(path)) {
        this.scanComponentDirectory(path, 'presets', plugin);
      }
    }
  }

  /**
   * 获取组件路径
   */
  private getComponentPaths(plugin: LoadedPlugin, componentType: PluginComponentType): string[] {
    const paths: string[] = [];
    const basePath = plugin.path;

    // 根据组件类型获取对应的路径配置
    switch (componentType) {
      case 'commands':
        if (plugin.commandsPath) paths.push(join(basePath, plugin.commandsPath));
        if (plugin.commandsPaths) {
          for (const p of plugin.commandsPaths) {
            paths.push(join(basePath, p));
          }
        }
        // 默认路径
        paths.push(join(basePath, 'commands'));
        break;

      case 'agents':
        if (plugin.agentsPath) paths.push(join(basePath, plugin.agentsPath));
        if (plugin.agentsPaths) {
          for (const p of plugin.agentsPaths) {
            paths.push(join(basePath, p));
          }
        }
        // 默认路径
        paths.push(join(basePath, 'agents'));
        break;

      case 'skills':
        if (plugin.skillsPath) paths.push(join(basePath, plugin.skillsPath));
        if (plugin.skillsPaths) {
          for (const p of plugin.skillsPaths) {
            paths.push(join(basePath, p));
          }
        }
        // 默认路径
        paths.push(join(basePath, 'skills'));
        break;

      case 'outputStyles':
        if (plugin.outputStylesPath) paths.push(join(basePath, plugin.outputStylesPath));
        if (plugin.outputStylesPaths) {
          for (const p of plugin.outputStylesPaths) {
            paths.push(join(basePath, p));
          }
        }
        // 默认路径
        paths.push(join(basePath, 'outputStyles'));
        break;

      case 'tools':
        // 默认路径
        paths.push(join(basePath, 'tools'));
        break;

      case 'hooks':
        // 默认路径
        paths.push(join(basePath, 'hooks'));
        break;

      case 'themes':
        // 默认路径
        paths.push(join(basePath, 'themes'));
        break;

      case 'languages':
        // 默认路径
        paths.push(join(basePath, 'languages'));
        break;

      case 'presets':
        // 默认路径
        paths.push(join(basePath, 'presets'));
        break;
    }

    return paths;
  }

  /**
   * 扫描组件目录
   */
  private scanComponentDirectory(directory: string, componentType: PluginComponentType, plugin: LoadedPlugin): void {
    try {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const componentName = entry.name.replace(/\.(js|ts|tsx)$/, '');
          const componentPath = join(directory, entry.name);
          const key = `${plugin.name}:${componentType}:${componentName}`;

          // 创建组件信息
          const componentInfo: PluginComponentInfo = {
            name: componentName,
            type: componentType,
            path: componentPath,
            pluginName: plugin.name,
            loaded: false // 标记为未加载
          };

          // 对于命令组件，尝试加载元数据
          if (componentType === 'commands' && plugin.commandsMetadata) {
            componentInfo.metadata = plugin.commandsMetadata[componentName];
          }

          // 注册组件
          this.components.set(key, componentInfo);

          // 添加到插件的组件列表
          if (!this.pluginComponents.has(plugin.name)) {
            this.pluginComponents.set(plugin.name, []);
          }
          this.pluginComponents.get(plugin.name)!.push(componentInfo);
        } else if (entry.isDirectory()) {
          // 递归扫描子目录
          this.scanComponentDirectory(join(directory, entry.name), componentType, plugin);
        }
      }
    } catch (error) {
      logger.error(`Failed to scan component directory ${directory}:`, error);
    }
  }

  /**
   * 获取所有组件
   */
  getAllComponents(): PluginComponentInfo[] {
    return Array.from(this.components.values());
  }

  /**
   * 根据类型获取组件
   */
  getComponentsByType(type: PluginComponentType): PluginComponentInfo[] {
    return this.getAllComponents().filter(c => c.type === type);
  }

  /**
   * 根据插件获取组件
   */
  getComponentsByPlugin(pluginName: string): PluginComponentInfo[] {
    return this.pluginComponents.get(pluginName) || [];
  }

  /**
   * 获取单个组件
   */
  getComponent(pluginName: string, type: PluginComponentType, componentName: string): PluginComponentInfo | undefined {
    const key = `${pluginName}:${type}:${componentName}`;
    return this.components.get(key);
  }

  /**
   * 加载组件（延迟加载）
   */
  async loadComponent(pluginName: string, type: PluginComponentType, componentName: string): Promise<any> {
    const component = this.getComponent(pluginName, type, componentName);
    if (!component) {
      throw new Error(`Component not found: ${pluginName}:${type}:${componentName}`);
    }

    // 如果已经加载，直接返回
    if (component.loaded) {
      return require(component.path);
    }

    // 动态加载组件
    try {
      const module = require(component.path);
      component.loaded = true;
      return module;
    } catch (error) {
      logger.error(`Failed to load component ${componentName}:`, error);
      throw error;
    }
  }

  /**
   * 卸载插件的所有组件
   */
  unloadComponents(pluginName: string): void {
    const components = this.pluginComponents.get(pluginName);
    if (components) {
      for (const component of components) {
        const key = `${pluginName}:${component.type}:${component.name}`;
        this.components.delete(key);
        // 清理模块缓存
        if (require.cache[require.resolve(component.path)]) {
          delete require.cache[require.resolve(component.path)];
        }
      }
      this.pluginComponents.delete(pluginName);
      logger.info(`Unloaded components for plugin: ${pluginName}`);
    }
  }

  /**
   * 清空所有组件
   */
  clear(): void {
    // 清理模块缓存
    for (const component of this.components.values()) {
      if (require.cache[require.resolve(component.path)]) {
        delete require.cache[require.resolve(component.path)];
      }
    }
    this.components.clear();
    this.pluginComponents.clear();
  }

  /**
   * 获取组件数量
   */
  getComponentCount(): number {
    return this.components.size;
  }

  /**
   * 获取已加载的组件数量
   */
  getLoadedComponentCount(): number {
    return Array.from(this.components.values()).filter(c => c.loaded).length;
  }

  /**
   * 设置是否启用延迟加载
   */
  setLazyLoad(enabled: boolean): void {
    this.lazyLoad = enabled;
  }

  /**
   * 预加载所有组件
   */
  async preloadAllComponents(): Promise<void> {
    const components = this.getAllComponents();
    const loadPromises = components.map(async (component) => {
      if (!component.loaded) {
        try {
          await this.loadComponent(component.pluginName, component.type, component.name);
        } catch (error) {
          logger.error(`Failed to preload component ${component.name}:`, error);
        }
      }
    });
    await Promise.all(loadPromises);
  }
}

// 导出单例
export const pluginComponentLoader = new PluginComponentLoader();