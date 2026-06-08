/**
 * 插件加载器（代理到 plugins/core/PluginLoader，消除双轨实现）
 *
 * 此文件作为兼容层提供，确保旧导入路径 @modules/plugins/PluginLoader 仍可工作。
 * 新代码请直接使用 @modules/plugins/core/PluginLoader。
 */

import { PluginLoader as RealPluginLoader } from './core/PluginLoader';
import type { PluginLoadResult } from './types/PluginTypes';

export class PluginLoader {
  private realLoader: RealPluginLoader;

  constructor(options?: ConstructorParameters<typeof RealPluginLoader>[0]) {
    this.realLoader = new RealPluginLoader(options);
  }

  async loadAll(): Promise<PluginLoadResult[]> {
    return await this.realLoader.loadAllPlugins();
  }

  clearCache(): void {
    // 由 core/PluginLoader 内部管理缓存
  }
}

export const pluginLoader = new PluginLoader();

export { loadPluginAgents } from './core/PluginLoader';
