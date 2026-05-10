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
}

export const pluginManager = new PluginManager();
