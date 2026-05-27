/**
 * 插件注册表
 * 负责管理插件的注册和查询
 * 支持回退加载机制（§5 向后兼容性保障 — 措施3）
 */

import type { LoadedPlugin } from '../types/plugin';

/**
 * 回退加载器类型
 * 当 get() 直接查找失败时，回调此函数尝试从其他来源加载插件
 */
export type FallbackLoader = (pluginName: string) => LoadedPlugin | undefined;

export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private fallbackLoader: FallbackLoader | null = null;

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
   * 设置回退加载器（§5 措施3）
   * 当 get() 直接查找失败时，自动从回退加载器获取并注册
   * @param fallback 回退加载函数
   */
  setFallback(fallback: FallbackLoader): void {
    this.fallbackLoader = fallback;
  }

  /**
   * 清除回退加载器
   */
  clearFallback(): void {
    this.fallbackLoader = null;
  }

  /**
   * 获取插件
   * 优先从注册表查找；如果未找到，调用回退加载器自动加载并注册
   * @param pluginName 插件名称
   * @returns 插件对象或undefined
   */
  get(pluginName: string): LoadedPlugin | undefined {
    const existing = this.plugins.get(pluginName);
    if (existing) return existing;

    if (this.fallbackLoader) {
      const fallbackPlugin = this.fallbackLoader(pluginName);
      if (fallbackPlugin) {
        this.register(fallbackPlugin);
        return fallbackPlugin;
      }
    }

    return undefined;
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
