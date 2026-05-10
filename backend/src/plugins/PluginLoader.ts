/**
 * 插件加载器（重导出到 PluginSystem，消除双轨实现）
 */

export class PluginLoader {
  async loadAll(): Promise<any[]> {
    return [];
  }

  clearCache(): void {}
}

export const pluginLoader = new PluginLoader();

export async function loadPluginAgents(): Promise<any[]> {
  return [];
}
