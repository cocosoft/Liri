/**
 * PluginManager - 插件管理器
 * 代理到 PluginSystem 的单例，消除双轨实现
 */

import type { LoadedPlugin } from '../types';
import { pluginSystem } from '../index.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 插件管理器类
 */
export class PluginManager {
  private static instance: PluginManager;

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  /**
   * 加载插件
   */
  public async loadPlugin(pluginId: string): Promise<LoadedPlugin> {
    const result = await pluginSystem.loadPlugin(pluginId);
    if (result.success && result.plugin) {
      return result.plugin;
    }
    throw new AppError(
      `Failed to load plugin: ${pluginId}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  /**
   * 加载多个插件
   */
  public async loadPlugins(
    pluginIds: string[]
  ): Promise<{ enabled: LoadedPlugin[]; disabled: LoadedPlugin[]; errors: string[] }> {
    const enabled: LoadedPlugin[] = [];
    const disabled: LoadedPlugin[] = [];

    for (const id of pluginIds) {
      try {
        const result = await pluginSystem.loadPlugin(id);
        if (result.success && result.plugin) {
          enabled.push(result.plugin);
        } else {
          disabled.push({ repository: id } as LoadedPlugin);
        }
      } catch {
        disabled.push({ repository: id } as LoadedPlugin);
      }
    }

    return { enabled, disabled, errors: [] };
  }

  /**
   * 获取所有插件
   */
  public getAllPlugins(): LoadedPlugin[] {
    return pluginSystem.getLoader().getAllPlugins();
  }

  /**
   * 根据插件标识符获取插件
   */
  public getPlugin(pluginId: string): LoadedPlugin | undefined {
    return pluginSystem.getLoader().getPlugin(pluginId);
  }

  /**
   * 启用插件
   */
  public enablePlugin(pluginId: string): boolean {
    try {
      pluginSystem.getLoader().activatePlugin(pluginId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 禁用插件
   */
  public disablePlugin(pluginId: string): boolean {
    try {
      pluginSystem.getLoader().deactivatePlugin(pluginId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 卸载插件
   */
  public uninstallPlugin(pluginId: string): boolean {
    try {
      pluginSystem.getLoader().unloadPlugin(pluginId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查插件是否存在
   */
  public hasPlugin(pluginId: string): boolean {
    return pluginSystem.getLoader().getPlugin(pluginId) !== undefined;
  }

  /**
   * 重新加载插件（用于热加载）
   * 停用后重新加载并激活
   */
  public async reloadPlugin(pluginId: string): Promise<void> {
    const exists = this.hasPlugin(pluginId);
    if (!exists) return;

    if (this.isPluginEnabled(pluginId)) {
      this.disablePlugin(pluginId);
    }

    this.uninstallPlugin(pluginId);

    await this.loadPlugin(pluginId);

    this.enablePlugin(pluginId);
  }

  /**
   * 检查插件是否启用
   */
  public isPluginEnabled(pluginId: string): boolean {
    const loader = pluginSystem.getLoader();
    const plugin = loader.getPlugin(pluginId);
    if (!plugin) return false;
    return plugin.state === 'activated' || plugin.state === 'enabled';
  }

  /**
   * 清空所有插件
   */
  public clearPlugins(): void {
    const loader = pluginSystem.getLoader();
    for (const p of loader.getAllPlugins()) {
      loader.unloadPlugin(p.id);
    }
  }

  /**
   * 获取启用的插件数量
   */
  public getEnabledPluginCount(): number {
    const loader = pluginSystem.getLoader();
    return loader
      .getAllPlugins()
      .filter(
        (p) =>
          p.state === 'activated' ||
          p.state === 'enabled' ||
          p.state === 'loaded'
      ).length;
  }

  /**
   * 获取总插件数量
   */
  public getTotalPluginCount(): number {
    return pluginSystem.getLoader().getAllPlugins().length;
  }
}
