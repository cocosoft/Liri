/**
 * BundledPluginManager 内置插件管理器
 * 对标 CC 的 bundled 插件管理
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 内置插件
 */
export interface BundledPlugin {
  name: string;
  version: string;
  description: string;
  entryPoint: string;
  enabled: boolean;
  builtin: boolean;
}

/**
 * 内置插件配置
 */
export interface BundledPluginConfig {
  dir: string;
  autoEnable: boolean;
}

/**
 * 内置插件管理器
 */
export class BundledPluginManager {
  private config: BundledPluginConfig;
  private plugins: Map<string, BundledPlugin> = new Map();

  constructor(config?: Partial<BundledPluginConfig>) {
    this.config = {
      dir: config?.dir || '',
      autoEnable: config?.autoEnable !== false,
    };
  }

  /**
   * 扫描内置插件
   */
  scan(): BundledPlugin[] {
    this.plugins.clear();

    const builtinPlugins: BundledPlugin[] = [
      { name: 'gateway', version: '1.0.0', description: 'API 网关插件', entryPoint: 'gateway/index.js', enabled: this.config.autoEnable, builtin: true },
      { name: 'terminal', version: '1.0.0', description: '终端交互插件', entryPoint: 'terminal/index.js', enabled: this.config.autoEnable, builtin: true },
      { name: 'filesystem', version: '1.0.0', description: '文件系统工具', entryPoint: 'filesystem/index.js', enabled: this.config.autoEnable, builtin: true },
      { name: 'network', version: '1.0.0', description: '网络请求工具', entryPoint: 'network/index.js', enabled: true, builtin: true },
      { name: 'analytics', version: '1.0.0', description: '使用分析', entryPoint: 'analytics/index.js', enabled: false, builtin: true },
      { name: 'telemetry', version: '1.0.0', description: '遥测数据收集', entryPoint: 'telemetry/index.js', enabled: false, builtin: true },
    ];

    for (const plugin of builtinPlugins) {
      this.plugins.set(plugin.name, plugin);
    }

    if (this.config.dir && fs.existsSync(this.config.dir)) {
      this.scanDirectory();
    }

    return this.getPlugins();
  }

  /**
   * 扫描插件目录
   */
  private scanDirectory(): void {
    try {
      const entries = fs.readdirSync(this.config.dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginDir = path.join(this.config.dir, entry.name);
          const metaPath = path.join(pluginDir, 'plugin.json');

          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

              if (meta.name) {
                this.plugins.set(meta.name as string, {
                  name: meta.name as string,
                  version: (meta.version as string) || '1.0.0',
                  description: (meta.description as string) || '',
                  entryPoint: path.join(entry.name, 'index.js'),
                  enabled: this.config.autoEnable,
                  builtin: false,
                });
              }
            } catch {
            }
          }
        }
      }
    } catch {
    }
  }

  /**
   * 启用插件
   */
  enable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    plugin.enabled = true;

    return true;
  }

  /**
   * 禁用插件
   */
  disable(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    plugin.enabled = false;

    return true;
  }

  /**
   * 获取插件
   */
  get(name: string): BundledPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * 获取所有插件
   */
  getPlugins(): BundledPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已启用插件
   */
  getEnabled(): BundledPlugin[] {
    return Array.from(this.plugins.values()).filter((p) => p.enabled);
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; builtin: number; enabled: number } {
    const plugins = Array.from(this.plugins.values());

    return {
      total: plugins.length,
      builtin: plugins.filter((p) => p.builtin).length,
      enabled: plugins.filter((p) => p.enabled).length,
    };
  }
}

export const bundledPluginManager = new BundledPluginManager();
