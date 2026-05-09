/**
 * 插件安装管理器
 * 负责插件的安装、卸载、更新等操作
 */

import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { logger } from '../utils/log';
import { pluginLoader } from './PluginLoader';
import { pluginCacheManager } from './PluginCacheManager';
import { pluginDependencyManager } from './PluginDependencyManager';
import { PluginErrorFactory, PluginErrorHandler } from './PluginErrorHandler';
import type { PluginSource } from './PluginLoader';
import type { LoadedPlugin } from '../types/plugin';

/**
 * 插件安装选项
 */
export interface PluginInstallOptions {
  force?: boolean; // 强制安装，覆盖现有插件
  skipDependencies?: boolean; // 跳过依赖安装
  save?: boolean; // 保存到配置文件
  version?: string; // 插件版本
  branch?: string; // Git分支
  path?: string; // Git子目录路径
}

/**
 * 插件安装结果
 */
export interface PluginInstallResult {
  success: boolean;
  plugin?: LoadedPlugin;
  error?: string;
  dependencies?: LoadedPlugin[];
}

/**
 * 插件安装管理器
 */
export class PluginInstallManager {
  private pluginsDir: string;
  private configFile: string;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.pluginsDir = join(homeDir, '.py_app', 'plugins', 'installed');
    this.configFile = join(homeDir, '.py_app', 'plugins', 'config.json');

    // 确保目录存在
    this.ensureDirectories();
  }

  /**
   * 确保目录存在
   */
  private ensureDirectories(): void {
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true });
    }

    const configDir = join(this.pluginsDir, '..');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
  }

  /**
   * 安装插件
   * @param source 插件源
   * @param options 安装选项
   * @returns 安装结果
   */
  async install(
    source: string | PluginSource,
    options: PluginInstallOptions = {}
  ): Promise<PluginInstallResult> {
    try {
      // 标准化插件源
      const pluginSource = this.normalizePluginSource(source, options);

      // 检查是否已安装
      const existingPlugin = await this.getInstalledPlugin(pluginSource);
      if (existingPlugin && !options.force) {
        return {
          success: false,
          error: `Plugin already installed: ${existingPlugin.name}`,
        };
      }

      // 加载插件
      const plugin = await pluginLoader.load(pluginSource);

      // 保存插件信息
      if (options.save) {
        await this.savePluginConfig(plugin, pluginSource);
      }

      // 安装到插件目录
      await this.installPluginToDirectory(plugin);

      // 获取依赖
      const dependencies = Array.from(
        pluginDependencyManager.getResolvedDependencies().values()
      );

      logger.info(`Successfully installed plugin: ${plugin.name}`);

      return {
        success: true,
        plugin,
        dependencies,
      };
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to install plugin',
      };
    }
  }

  /**
   * 卸载插件
   * @param pluginName 插件名称
   * @returns 是否成功
   */
  async uninstall(pluginName: string): Promise<boolean> {
    try {
      // 查找插件
      const pluginConfig = this.getPluginConfig(pluginName);
      if (!pluginConfig) {
        throw PluginErrorFactory.createLoadError(
          `Plugin not found: ${pluginName}`
        );
      }

      // 删除插件目录
      const pluginDir = join(this.pluginsDir, pluginName);
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
      }

      // 从配置中移除
      this.removePluginConfig(pluginName);

      // 清理缓存
      const source: PluginSource = {
        type: pluginConfig.type,
        url: pluginConfig.url,
        version: pluginConfig.version,
        branch: pluginConfig.branch,
      };
      pluginCacheManager.clearCache(source);
      pluginCacheManager.clearZipCache(source);

      logger.info(`Successfully uninstalled plugin: ${pluginName}`);
      return true;
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      return false;
    }
  }

  /**
   * 更新插件
   * @param pluginName 插件名称
   * @param options 更新选项
   * @returns 更新结果
   */
  async update(
    pluginName: string,
    options: PluginInstallOptions = {}
  ): Promise<PluginInstallResult> {
    try {
      // 查找插件配置
      const pluginConfig = this.getPluginConfig(pluginName);
      if (!pluginConfig) {
        throw PluginErrorFactory.createLoadError(
          `Plugin not found: ${pluginName}`
        );
      }

      // 构建更新源
      const source: PluginSource = {
        type: pluginConfig.type,
        url: pluginConfig.url,
        version: options.version || pluginConfig.version,
        branch: options.branch || pluginConfig.branch,
      };

      // 强制安装
      return await this.install(source, {
        ...options,
        force: true,
        save: true,
      });
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to update plugin',
      };
    }
  }

  /**
   * 从市场安装插件
   * @param pluginId 插件ID
   * @param options 安装选项
   * @returns 安装结果
   */
  async installFromMarketplace(
    pluginId: string,
    options: PluginInstallOptions = {}
  ): Promise<PluginInstallResult> {
    try {
      // 延迟导入以避免循环依赖
      const { pluginMarketplace } = await import('./PluginMarketplace');
      return await pluginMarketplace.installFromMarketplace(pluginId, options);
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to install plugin from marketplace',
      };
    }
  }

  /**
   * 列出已安装的插件
   * @returns 已安装的插件列表
   */
  async listInstalledPlugins(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];

    try {
      if (existsSync(this.pluginsDir)) {
        const pluginDirs = readdirSync(this.pluginsDir, {
          withFileTypes: true,
        });

        for (const dir of pluginDirs) {
          if (dir.isDirectory()) {
            const pluginPath = join(this.pluginsDir, dir.name);
            try {
              const plugin = await pluginLoader.load(pluginPath);
              plugins.push(plugin);
            } catch (error) {
              logger.warn(
                `Failed to load installed plugin ${dir.name}:`,
                error
              );
            }
          }
        }
      }
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
    }

    return plugins;
  }

  /**
   * 获取插件信息
   * @param pluginName 插件名称
   * @returns 插件信息
   */
  async getPluginInfo(pluginName: string): Promise<LoadedPlugin | null> {
    try {
      const pluginDir = join(this.pluginsDir, pluginName);
      if (existsSync(pluginDir)) {
        return await pluginLoader.load(pluginDir);
      }
      return null;
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      return null;
    }
  }

  /**
   * 标准化插件源
   */
  private normalizePluginSource(
    source: string | PluginSource,
    options: PluginInstallOptions
  ): PluginSource {
    if (typeof source === 'string') {
      // 从字符串解析插件源
      if (source.startsWith('git@') || source.endsWith('.git')) {
        return {
          type: 'git',
          url: source,
          version: options.version,
          branch: options.branch,
          path: options.path,
        };
      } else if (source.includes('github.com')) {
        return {
          type: 'github',
          url: source,
          version: options.version,
          branch: options.branch,
          path: options.path,
        };
      } else if (source.startsWith('http')) {
        return {
          type: 'url',
          url: source,
          version: options.version,
          branch: options.branch,
          path: options.path,
        };
      } else {
        // 默认为npm
        return {
          type: 'npm',
          url: source,
          version: options.version,
        };
      }
    }
    return source;
  }

  /**
   * 获取已安装的插件
   */
  private async getInstalledPlugin(
    source: PluginSource
  ): Promise<LoadedPlugin | null> {
    try {
      // 尝试从插件目录加载
      const pluginName = source.name || this.extractPluginName(source.url);
      const pluginDir = join(this.pluginsDir, pluginName);

      if (existsSync(pluginDir)) {
        return await pluginLoader.load(pluginDir);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 从URL提取插件名称
   */
  private extractPluginName(url: string): string {
    if (url.endsWith('.git')) {
      return url.split('/').pop()!.replace('.git', '');
    }
    if (url.includes('github.com')) {
      const parts = url.split('/');
      return parts[parts.length - 1];
    }
    if (url.includes('/')) {
      return url.split('/').pop()!;
    }
    return url;
  }

  /**
   * 保存插件配置
   */
  private async savePluginConfig(
    plugin: LoadedPlugin,
    source: PluginSource
  ): Promise<void> {
    const config = this.loadConfig();

    config.plugins = config.plugins || {};
    config.plugins[plugin.name] = {
      name: plugin.name,
      type: source.type,
      url: source.url,
      version: source.version || plugin.manifest.version,
      branch: source.branch,
      installedAt: new Date().toISOString(),
    };

    this.saveConfig(config);
  }

  /**
   * 从配置中移除插件
   */
  private removePluginConfig(pluginName: string): void {
    const config = this.loadConfig();

    if (config.plugins && config.plugins[pluginName]) {
      delete config.plugins[pluginName];
      this.saveConfig(config);
    }
  }

  /**
   * 获取插件配置
   */
  private getPluginConfig(pluginName: string): any {
    const config = this.loadConfig();
    return config.plugins?.[pluginName];
  }

  /**
   * 加载配置文件
   */
  private loadConfig(): any {
    if (existsSync(this.configFile)) {
      try {
        const content = readFileSync(this.configFile, 'utf8');
        return JSON.parse(content);
      } catch (error) {
        logger.error(`Failed to load plugin config:`, error);
      }
    }
    return {};
  }

  /**
   * 保存配置文件
   */
  private saveConfig(config: any): void {
    writeFileSync(this.configFile, JSON.stringify(config, null, 2));
  }

  /**
   * 安装插件到目录
   */
  private async installPluginToDirectory(plugin: LoadedPlugin): Promise<void> {
    const pluginDir = join(this.pluginsDir, plugin.name);

    // 清理现有目录
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true, force: true });
    }

    // 创建目录
    mkdirSync(pluginDir, { recursive: true });

    // 这里可以实现复制插件文件的逻辑
    // 目前简化处理，直接使用缓存中的文件
    logger.info(`Installed plugin ${plugin.name} to ${pluginDir}`);
  }

  /**
   * 清理插件缓存
   */
  clearCache(): void {
    pluginCacheManager.clearAllCache();
    pluginCacheManager.clearAllZipCache();
    logger.info('Cleared all plugin caches');
  }

  /**
   * 获取安装统计信息
   */
  getInstallationStats(): {
    installedPlugins: number;
    cacheSize: number;
    zipCacheSize: number;
  } {
    const stats = pluginCacheManager.getCacheStats();
    const installedCount = Object.keys(this.loadConfig().plugins || {}).length;

    return {
      installedPlugins: installedCount,
      cacheSize: stats.totalSize,
      zipCacheSize: 0, // 可以添加ZIP缓存大小计算
    };
  }
}

// 导出单例
export const pluginInstallManager = new PluginInstallManager();
