/**
 * 插件管理器（代理到 PluginSystem，消除双轨实现）
 */

import { PluginManager as DelegatingPluginManager } from './managers/PluginManager';

const delegatingManager = DelegatingPluginManager.getInstance();

export class PluginManager {
  /**
   * 获取所有插件
   */
  getAllPlugins(): any[] {
    return delegatingManager.getAllPlugins();
  }

  /**
   * 获取启用的插件
   */
  getPlugins(): any[] {
    return delegatingManager.getAllPlugins().filter((p: any) => p.enabled);
  }

  /**
   * 获取单个插件
   */
  getPlugin(pluginId: string): any {
    return delegatingManager.getPlugin(pluginId);
  }

  /**
   * 获取插件命令
   */
  async getCommands(): Promise<any[]> {
    return [];
  }

  /**
   * 检查插件是否存在
   */
  hasPlugin(pluginId: string): boolean {
    return delegatingManager.hasPlugin(pluginId);
  }

  /**
   * 加载插件
   */
  async loadPlugin(pluginId: string): Promise<void> {
    await delegatingManager.loadPlugin(pluginId);
  }

  /**
   * 启用插件
   */
  enablePlugin(pluginId: string): void {
    delegatingManager.enablePlugin(pluginId);
  }

  /**
   * 停用插件
   */
  disablePlugin(pluginId: string): void {
    delegatingManager.disablePlugin(pluginId);
  }

  /**
   * 卸载插件
   */
  uninstallPlugin(pluginId: string): void {
    delegatingManager.uninstallPlugin(pluginId);
  }

  /**
   * 重新加载插件（用于热加载）
   * 停用后重新加载并激活
   * @param pluginId 插件 ID
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    const exists = delegatingManager.hasPlugin(pluginId);
    if (!exists) {
      return;
    }

    if (delegatingManager.isPluginEnabled(pluginId)) {
      delegatingManager.disablePlugin(pluginId);
    }

    delegatingManager.uninstallPlugin(pluginId);

    await delegatingManager.loadPlugin(pluginId);

    delegatingManager.enablePlugin(pluginId);
  }
}

export const pluginManager = new PluginManager();
