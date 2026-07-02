// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * PluginLoader — 插件加载器
 *
 * 负责插件的扫描、加载、卸载、激活/停用及缓存管理。
 *
 * @deprecated 请使用 plugins/ 目录下的 PluginSystem 替代。
 *   core/extensibility 中的 PluginLoader 为遗留实现，
 *   与 plugins/PluginSystem 功能重叠。
 *   此模块将在未来版本中移除。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  Plugin,
  PluginState,
  PluginType,
  PluginLoaderOptions,
} from './types.js';

const logger = new Logger({
  module: 'core:extensibility:pluginLoader',
  level: LogLevel.INFO,
});

/**
 * 插件加载器
 */
export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private pluginDirectories: string[];
  private autoLoad: boolean;
  private autoActivate: boolean;
  private validationEnabled: boolean;
  private cacheEnabled: boolean;
  private pluginCache: Map<string, Plugin> = new Map();

  constructor(options: PluginLoaderOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? ['./plugins'];
    this.autoLoad = options.autoLoad ?? true;
    this.autoActivate = options.autoActivate ?? true;
    this.validationEnabled = options.validationEnabled ?? true;
    this.cacheEnabled = options.cacheEnabled ?? true;
  }

  /**
   * 加载插件
   */
  async loadPlugin(pluginId: string): Promise<Plugin> {
    if (this.plugins.has(pluginId)) {
      return this.plugins.get(pluginId)!;
    }

    if (this.cacheEnabled && this.pluginCache.has(pluginId)) {
      const plugin = this.pluginCache.get(pluginId)!;
      this.plugins.set(pluginId, plugin);
      return plugin;
    }

    try {
      const fs = await import('fs');
      const path = await import('path');

      let pluginPath: string | undefined;
      for (const dir of this.pluginDirectories) {
        const candidatePath = path.join(dir, pluginId);
        if (
          fs.existsSync(candidatePath) &&
          fs.statSync(candidatePath).isDirectory()
        ) {
          pluginPath = candidatePath;
          break;
        }
      }

      if (!pluginPath) {
        throw new AppError(
          `Plugin directory not found for ${pluginId}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH
        );
      }

      const pluginJsonPath = path.join(pluginPath, 'plugin.json');
      if (!fs.existsSync(pluginJsonPath)) {
        throw new AppError(
          `plugin.json not found in ${pluginId}`,
          ErrorCategory.FILESYSTEM,
          ErrorSeverity.HIGH
        );
      }

      const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
      if (!pluginJson.plugin) {
        throw new AppError(
          `Invalid plugin.json format in ${pluginId}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH
        );
      }

      const metadata = pluginJson.plugin;

      const plugin: Plugin = {
        metadata: {
          id: metadata.name || pluginId,
          name: metadata.name || pluginId,
          version: metadata.version || '1.0.0',
          description: metadata.description || `Plugin ${pluginId}`,
          author: metadata.author || 'Unknown',
          type: PluginType.CUSTOM,
          dependencies: metadata.dependencies || [],
          main: metadata.main || 'src/index.ts',
          ...metadata,
        },
        state: PluginState.LOADING,
        load: async () => {
          logger.info(`Loading plugin ${pluginId}`);
          try {
            const mainPath = path.join(
              pluginPath!,
              metadata.main || 'src/index.ts'
            );
            const pluginModule = await import(`file://${mainPath}`);
            plugin.instance = pluginModule.default || pluginModule;
          } catch (error) {
            throw new AppError(
              `Failed to load plugin module: ${error instanceof Error ? error.message : String(error)}`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH
            );
          }
          plugin.state = PluginState.LOADED;
        },
        unload: async () => {
          logger.info(`Unloading plugin ${pluginId}`);
          plugin.instance = undefined;
          plugin.state = PluginState.UNLOADED;
        },
        activate: async () => {
          logger.info(`Activating plugin ${pluginId}`);
          const inst = plugin.instance as Record<string, unknown> | undefined;
          if (inst && typeof inst.activate === 'function') {
            await (inst.activate as () => Promise<void>)();
          }
          plugin.state = PluginState.ACTIVATED;
        },
        deactivate: async () => {
          logger.info(`Deactivating plugin ${pluginId}`);
          const inst = plugin.instance as Record<string, unknown> | undefined;
          if (inst && typeof inst.deactivate === 'function') {
            await (inst.deactivate as () => Promise<void>)();
          }
          plugin.state = PluginState.DEACTIVATED;
        },
      };

      await plugin.load();
      this.plugins.set(pluginId, plugin);

      if (this.autoActivate) {
        await plugin.activate();
      }

      if (this.cacheEnabled) {
        this.pluginCache.set(pluginId, plugin);
      }

      return plugin;
    } catch (error) {
      const plugin: Plugin = {
        metadata: {
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: `Plugin ${pluginId}`,
          author: 'Unknown',
          type: PluginType.CUSTOM,
        },
        state: PluginState.FAILED,
        error: error instanceof Error ? error.message : String(error),
        load: async () => {},
        unload: async () => {},
        activate: async () => {},
        deactivate: async () => {},
      };
      this.plugins.set(pluginId, plugin);
      return plugin;
    }
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    try {
      await plugin.unload();
      this.plugins.delete(pluginId);
      this.pluginCache.delete(pluginId);
      return true;
    } catch (error) {
      logger.error(`Failed to unload plugin ${pluginId}:`, error);
      return false;
    }
  }

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    try {
      await plugin.activate();
      return true;
    } catch (error) {
      logger.error(`Failed to activate plugin ${pluginId}:`, error);
      plugin.state = PluginState.FAILED;
      plugin.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    try {
      await plugin.deactivate();
      return true;
    } catch (error) {
      logger.error(`Failed to deactivate plugin ${pluginId}:`, error);
      return false;
    }
  }

  /**
   * 列出所有插件
   */
  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 扫描插件目录
   */
  async scanPlugins(): Promise<string[]> {
    const pluginIds: string[] = [];
    const fs = await import('fs');
    const path = await import('path');

    for (const pluginDir of this.pluginDirectories) {
      const fullPath = path.resolve(pluginDir);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          const entries = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pluginPath = path.join(fullPath, entry.name);
              const pluginJsonPath = path.join(pluginPath, 'plugin.json');
              if (fs.existsSync(pluginJsonPath)) {
                try {
                  const pluginJson = JSON.parse(
                    fs.readFileSync(pluginJsonPath, 'utf8')
                  );
                  if (pluginJson.plugin && pluginJson.plugin.name) {
                    pluginIds.push(pluginJson.plugin.name);
                  }
                } catch {
                  logger.warning(`Invalid plugin.json in ${entry.name}:`, null);
                }
              }
            }
          }
        }
      } catch (error) {
        logger.warning(`Error scanning plugin directory ${fullPath}:`, error);
      }
    }

    return pluginIds;
  }

  /**
   * 加载所有插件
   */
  async loadAllPlugins(): Promise<Plugin[]> {
    const pluginIds = await this.scanPlugins();
    const loadedPlugins: Plugin[] = [];

    for (const pluginId of pluginIds) {
      const plugin = await this.loadPlugin(pluginId);
      loadedPlugins.push(plugin);
    }

    return loadedPlugins;
  }

  /**
   * 清理插件缓存
   */
  clearCache(): void {
    this.pluginCache.clear();
  }

  /**
   * 销毁插件加载器，清理所有资源
   */
  async destroy(): Promise<void> {
    for (const [pluginId] of this.plugins) {
      await this.unloadPlugin(pluginId).catch(() => {});
    }
    this.plugins.clear();
    this.pluginCache.clear();
  }
}

/**
 * 创建默认的插件加载器
 */
export function createPluginLoader(
  options?: PluginLoaderOptions
): PluginLoader {
  return new PluginLoader({
    pluginDirectories: ['./plugins'],
    autoLoad: true,
    autoActivate: true,
    validationEnabled: true,
    cacheEnabled: true,
    ...options,
  });
}
