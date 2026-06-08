/**
 * 插件注册表（兼容层，委派至 core/PluginRegistry）
 *
 * 保持与旧导入路径 @modules/plugins/PluginRegistry 的兼容性。
 * 新代码请直接使用 @modules/plugins/core/PluginRegistry。
 */

import { PluginRegistry as CorePluginRegistry } from './core/PluginRegistry';
import type { PluginRegistration } from './types/PluginTypes';
import type { LoadedPlugin } from './types/PluginTypes';

/**
 * 将 PluginRegistration 转为 LoadedPlugin
 */
function toLoadedPlugin(reg: PluginRegistration): LoadedPlugin {
  return {
    id: reg.id,
    name: reg.name,
    version: reg.version,
    path: reg.path,
    state: reg.state,
    enabled: reg.enabled,
    dependencies: reg.dependencies,
    dependents: reg.dependents,
  };
}

export class PluginRegistry {
  private core: CorePluginRegistry;

  constructor() {
    this.core = new CorePluginRegistry();
  }

  /**
   * 获取核心注册表实例
   */
  getCore(): CorePluginRegistry {
    return this.core;
  }

  /**
   * 注册插件
   */
  register(plugin: LoadedPlugin): void {
    this.core.registerPlugin({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      path: plugin.path,
      state: plugin.state,
      registeredAt: new Date(),
      enabled: plugin.enabled,
      dependencies: plugin.dependencies ?? [],
      dependents: plugin.dependents ?? [],
    });
  }

  /**
   * 注销插件
   */
  unregister(pluginName: string): void {
    this.core.unregisterPlugin(pluginName);
  }

  /**
   * 设置回退加载器
   */
  setFallback(fallback: (pluginName: string) => LoadedPlugin | undefined): void {
    this.core.setFallback((pluginId: string) => {
      const result = fallback(pluginId);
      if (!result) return undefined;

      return {
        id: result.id,
        name: result.name,
        version: result.version,
        path: result.path,
        state: result.state,
        registeredAt: new Date(),
        enabled: result.enabled,
        dependencies: result.dependencies ?? [],
        dependents: result.dependents ?? [],
      };
    });
  }

  /**
   * 清除回退加载器
   */
  clearFallback(): void {
    this.core.clearFallback();
  }

  /**
   * 获取插件
   */
  get(pluginName: string): LoadedPlugin | undefined {
    const reg = this.core.getPlugin(pluginName);
    if (!reg) return undefined;

    return toLoadedPlugin(reg);
  }

  /**
   * 获取所有插件
   */
  getAll(): LoadedPlugin[] {
    return this.core.getAllPlugins().map(toLoadedPlugin);
  }

  /**
   * 获取已启用插件
   */
  getEnabled(): LoadedPlugin[] {
    return this.core.getEnabled().map(toLoadedPlugin);
  }

  /**
   * 获取已禁用插件
   */
  getDisabled(): LoadedPlugin[] {
    return this.core.getDisabled().map(toLoadedPlugin);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    for (const plugin of this.core.getAllPlugins()) {
      this.core.unregisterPlugin(plugin.id);
    }
  }

  /**
   * 检查插件是否存在
   */
  has(pluginName: string): boolean {
    return this.core.getPlugin(pluginName) !== undefined;
  }

  /**
   * 获取插件数量
   */
  size(): number {
    return this.core.getPluginCount();
  }
}
