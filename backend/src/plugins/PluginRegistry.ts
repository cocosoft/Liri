/**
 * 插件注册表
 * 负责管理插件的注册和查询
 */

import type { LoadedPlugin } from '../types/plugin';

export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();

  /**
   * 注册插件
   * @param plugin 要注册的插件
   */
  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * 注销插件
   * @param pluginName 插件名称
   */
  unregister(pluginName: string): void {
    this.plugins.delete(pluginName);
  }

  /**
   * 获取插件
   * @param pluginName 插件名称
   * @returns 插件对象或undefined
   */
  get(pluginName: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginName);
  }

  /**
   * 获取所有插件
   * @returns 插件数组
   */
  getAll(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取启用的插件
   * @returns 启用的插件数组
   */
  getEnabled(): LoadedPlugin[] {
    return this.getAll().filter((plugin) => plugin.enabled);
  }

  /**
   * 获取禁用的插件
   * @returns 禁用的插件数组
   */
  getDisabled(): LoadedPlugin[] {
    return this.getAll().filter((plugin) => !plugin.enabled);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.plugins.clear();
  }

  /**
   * 检查插件是否存在
   * @param pluginName 插件名称
   * @returns 是否存在
   */
  has(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  /**
   * 获取插件数量
   * @returns 插件数量
   */
  size(): number {
    return this.plugins.size;
  }
}
