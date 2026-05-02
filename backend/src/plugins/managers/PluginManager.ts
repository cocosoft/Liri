/**
 * PluginManager - 插件管理器
 * 负责插件的注册、管理和执行
 */

import { LoadedPlugin, PluginLoadResult } from '../types';
import { PluginLoader } from '../loaders/PluginLoader';

/**
 * 插件管理器类
 */
export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginLoader: PluginLoader = PluginLoader.getInstance();

  private constructor() {}

  /**
   * 获取单例实例
   * @returns PluginManager实例
   */
  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  /**
   * 加载插件
   * @param pluginId 插件标识符
   * @returns 加载的插件
   */
  public async loadPlugin(pluginId: string): Promise<LoadedPlugin> {
    // 这里应该从配置中获取插件来源
    // 简化实现，实际项目中可能需要从配置或市场中获取
    const source = 'local'; // 临时实现
    const plugin = await this.pluginLoader.loadPlugin(pluginId, source);
    this.plugins.set(pluginId, plugin);
    return plugin;
  }

  /**
   * 加载多个插件
   * @param pluginIds 插件标识符列表
   * @returns 插件加载结果
   */
  public async loadPlugins(pluginIds: string[]): Promise<PluginLoadResult> {
    const result = await this.pluginLoader.loadPlugins(pluginIds);

    // 注册加载成功的插件
    for (const plugin of result.enabled) {
      this.plugins.set(plugin.repository, plugin);
    }

    return result;
  }

  /**
   * 获取所有插件
   * @returns 插件列表
   */
  public getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 根据插件标识符获取插件
   * @param pluginId 插件标识符
   * @returns 插件
   */
  public getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 启用插件
   * @param pluginId 插件标识符
   * @returns 是否成功
   */
  public enablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * 禁用插件
   * @param pluginId 插件标识符
   * @returns 是否成功
   */
  public disablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * 卸载插件
   * @param pluginId 插件标识符
   * @returns 是否成功
   */
  public uninstallPlugin(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  /**
   * 执行插件命令
   * @param pluginId 插件标识符
   * @param commandName 命令名称
   * @param args 命令参数
   * @returns 命令执行结果
   */
  public async executeCommand(
    pluginId: string,
    commandName: string,
    args: any[]
  ): Promise<any> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.enabled) {
      throw new Error(`Plugin ${pluginId} is not enabled`);
    }

    // 检查命令路径是否存在
    if (!plugin.commandsPaths) {
      throw new Error(`Plugin ${pluginId} has no commands`);
    }

    // 简单的命令执行逻辑
    // 实际项目中可能需要更复杂的命令执行机制
    return {
      success: true,
      message: `Command ${commandName} executed successfully`,
      args: args,
      plugin: pluginId,
    };
  }

  /**
   * 获取插件的命令列表
   * @param pluginId 插件标识符
   * @returns 命令列表
   */
  public getPluginCommands(pluginId: string): string[] {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.commandsPaths) {
      return [];
    }

    // 从命令路径中提取命令名称
    return plugin.commandsPaths.map((path: string) => {
      const parts = path.split('/');
      return parts[parts.length - 1].replace('.js', '').replace('.ts', '');
    });
  }

  /**
   * 获取插件的代理列表
   * @param pluginId 插件标识符
   * @returns 代理列表
   */
  public getPluginAgents(pluginId: string): string[] {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.agentsPaths) {
      return [];
    }

    // 从代理路径中提取代理名称
    return plugin.agentsPaths.map((path: string) => {
      const parts = path.split('/');
      return parts[parts.length - 1].replace('.js', '').replace('.ts', '');
    });
  }

  /**
   * 获取插件的技能列表
   * @param pluginId 插件标识符
   * @returns 技能列表
   */
  public getPluginSkills(pluginId: string): string[] {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.skillsPaths) {
      return [];
    }

    // 从技能路径中提取技能名称
    return plugin.skillsPaths.map((path: string) => {
      const parts = path.split('/');
      return parts[parts.length - 1].replace('.js', '').replace('.ts', '');
    });
  }

  /**
   * 检查插件是否存在
   * @param pluginId 插件标识符
   * @returns 是否存在
   */
  public hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * 检查插件是否启用
   * @param pluginId 插件标识符
   * @returns 是否启用
   */
  public isPluginEnabled(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    return plugin?.enabled ?? false;
  }

  /**
   * 清空所有插件
   */
  public clearPlugins(): void {
    this.plugins.clear();
  }

  /**
   * 获取启用的插件数量
   * @returns 启用的插件数量
   */
  public getEnabledPluginCount(): number {
    return Array.from(this.plugins.values()).filter((plugin) => plugin.enabled)
      .length;
  }

  /**
   * 获取总插件数量
   * @returns 总插件数量
   */
  public getTotalPluginCount(): number {
    return this.plugins.size;
  }
}
