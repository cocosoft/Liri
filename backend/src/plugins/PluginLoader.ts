//
/**
 * 插件加载器
 * 负责加载和解析插件
 */

import type { LoadedPlugin, PluginManifest } from '../types/plugin';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/log';
import { pluginCacheManager } from './PluginCacheManager';
import { pluginDependencyManager } from './PluginDependencyManager';
import { PluginErrorFactory, PluginErrorHandler } from './PluginErrorHandler';

/**
 * 插件来源类型
 */
export type PluginSourceType =
  | 'local'
  | 'git'
  | 'github'
  | 'npm'
  | 'git-subdir'
  | 'url';

/**
 * 插件源配置
 */
export interface PluginSource {
  type: PluginSourceType;
  url: string;
  version?: string;
  branch?: string;
  name?: string;
  path?: string; // 用于git-subdir
  sha?: string; // 特定提交
  registry?: string; // NPM注册表
}

/**
 * 插件加载器
 */
export class PluginLoader {
  private cacheDir: string;

  constructor() {
    this.cacheDir = join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.py_app',
      'plugins',
      'cache'
    );
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 加载单个插件
   * @param pluginPath 插件路径或源配置
   * @returns 加载的插件
   */
  async load(pluginPath: string | PluginSource): Promise<LoadedPlugin> {
    try {
      let actualPath: string;
      let source: string;
      let pluginName: string | undefined;

      if (typeof pluginPath === 'string') {
        actualPath = pluginPath;
        source = pluginPath;
      } else {
        pluginName = pluginPath.name;
        actualPath = await this.fetchPlugin(pluginPath);
        source = pluginPath.url;
      }

      // 读取插件manifest
      const manifestPath = join(actualPath, 'manifest.json');
      if (!existsSync(manifestPath)) {
        throw PluginErrorFactory.createManifestNotFoundError(manifestPath, {
          pluginName,
          source,
        });
      }

      try {
        const manifestContent = readFileSync(manifestPath, 'utf8');
        const manifest: PluginManifest = JSON.parse(manifestContent);

        // 构建插件对象
        const plugin: LoadedPlugin = {
          name: manifest.name,
          manifest,
          path: actualPath,
          source: source,
          repository: source,
          enabled: true,
          isBuiltin: false,
          // 从manifest中读取额外信息
          commandsPath: manifest.commandsPath,
          commandsPaths: manifest.commandsPaths,
          agentsPath: manifest.agentsPath,
          agentsPaths: manifest.agentsPaths,
          skillsPath: manifest.skillsPath,
          skillsPaths: manifest.skillsPaths,
          outputStylesPath: manifest.outputStylesPath,
          outputStylesPaths: manifest.outputStylesPaths,
          hooksConfig: manifest.hooksConfig,
          mcpServers: manifest.mcpServers,
          settings: manifest.settings,
        };

        // 解析插件依赖
        const dependencyResult =
          await pluginDependencyManager.resolveDependencies(plugin);

        // 处理依赖解析结果
        if (dependencyResult.errors.length > 0) {
          logger.error(`Dependency resolution errors for ${plugin.name}:`);
          dependencyResult.errors.forEach((error) =>
            logger.error(`- ${error}`)
          );
          // 对于必需依赖的错误，抛出异常
          throw PluginErrorFactory.createDependencyNotFoundError(
            'Dependencies',
            {
              pluginName: plugin.name,
              cause: new Error(dependencyResult.errors[0]),
            }
          );
        }

        if (dependencyResult.warnings.length > 0) {
          logger.warn(`Dependency resolution warnings for ${plugin.name}:`);
          dependencyResult.warnings.forEach((warning) =>
            logger.warn(`- ${warning}`)
          );
        }

        return plugin;
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw PluginErrorFactory.createManifestInvalidError(
            'Invalid JSON in manifest',
            {
              pluginName,
              source,
              details: error,
            }
          );
        }
        throw error;
      }
    } catch (error) {
      PluginErrorHandler.logError(error, logger);
      throw error;
    }
  }

  /**
   * 加载多个插件
   * @param pluginPaths 插件路径或源配置数组
   * @returns 加载的插件数组
   */
  async loadAll(
    pluginPaths: Array<string | PluginSource>
  ): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];
    const errors: Error[] = [];

    // 使用并行操作加载插件
    const loadPromises = pluginPaths.map(async (path) => {
      try {
        const plugin = await this.load(path);
        plugins.push(plugin);
      } catch (error) {
        logger.error(
          `Error loading plugin:`,
          error instanceof Error ? error : undefined
        );
        errors.push(error as Error);
      }
    });

    // 等待所有加载操作完成
    await Promise.all(loadPromises);

    return plugins;
  }

  /**
   * 从不同来源获取插件
   * @param source 插件源配置
   * @returns 插件本地路径
   */
  private async fetchPlugin(source: PluginSource): Promise<string> {
    switch (source.type) {
      case 'local':
        return source.url;

      case 'git':
      case 'github':
      case 'npm':
      case 'git-subdir':
      case 'url':
        return this.fetchFromExternalSource(source);

      default:
        throw new Error(`Unsupported plugin source type: ${source.type}`);
    }
  }

  /**
   * 从外部源获取插件
   */
  private async fetchFromExternalSource(source: PluginSource): Promise<string> {
    // 检查ZIP缓存是否有效
    if (pluginCacheManager.isZipCached(source)) {
      const zipPath = pluginCacheManager.getZipCachePath(source);
      const cachePath = pluginCacheManager.getCachePath(source);

      // 解压ZIP到缓存目录
      await pluginCacheManager.extractFromZip(zipPath, cachePath);
      logger.info(`Using ZIP cached plugin: ${source.url}`);
      return cachePath;
    }

    // 检查普通缓存是否有效
    if (
      pluginCacheManager.isCached(source) &&
      pluginCacheManager.validateCache(source)
    ) {
      const cachePath = pluginCacheManager.getCachePath(source);
      const cacheInfo = pluginCacheManager.getCacheInfo(source);
      logger.info(
        `Using cached plugin: ${cacheInfo?.pluginName || source.url}`
      );
      return cachePath;
    }

    let cachePath: string;

    switch (source.type) {
      case 'git':
        cachePath = this.fetchFromGit(source);
        break;
      case 'github':
        cachePath = this.fetchFromGitHub(source);
        break;
      case 'npm':
        cachePath = this.fetchFromNPM(source);
        break;
      case 'git-subdir':
        cachePath = this.fetchFromGitSubdir(source);
        break;
      case 'url':
        cachePath = this.fetchFromGit(source); // url类型使用git处理
        break;
      default:
        throw new Error(`Unsupported plugin source type: ${source.type}`);
    }

    // 写入缓存信息
    pluginCacheManager.writeCacheInfo(source);

    // 创建ZIP缓存
    const zipPath = pluginCacheManager.getZipCachePath(source);
    await pluginCacheManager.compressToZip(cachePath, zipPath);

    return cachePath;
  }

  /**
   * 从Git仓库获取插件
   */
  private fetchFromGit(source: PluginSource): string {
    const pluginName =
      source.name || basename(source.url).replace(/\.git$/, '');
    const cachePath = pluginCacheManager.getCachePath(source);

    logger.info(`Cloning git plugin: ${source.url}`);

    // 克隆仓库
    const tempPath = join(this.cacheDir, `${pluginName}_temp`);
    if (existsSync(tempPath)) {
      execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });
    }

    try {
      // 使用浅克隆减少下载时间
      execSync(`git clone --depth 1 "${source.url}" "${tempPath}"`, {
        stdio: 'inherit',
      });

      if (source.branch) {
        execSync(`git -C "${tempPath}" checkout "${source.branch}"`, {
          stdio: 'inherit',
        });
      }

      if (source.version) {
        execSync(`git -C "${tempPath}" checkout "${source.version}"`, {
          stdio: 'inherit',
        });
      }

      if (source.sha) {
        execSync(`git -C "${tempPath}" checkout "${source.sha}"`, {
          stdio: 'inherit',
        });
      }

      // 移动到缓存路径
      if (existsSync(cachePath)) {
        execSync(`rm -rf "${cachePath}"`, { stdio: 'ignore' });
      }

      // 确保父目录存在
      const parentDir = dirname(cachePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      execSync(`mv "${tempPath}" "${cachePath}"`, { stdio: 'ignore' });

      return cachePath;
    } catch (error) {
      if (existsSync(tempPath)) {
        execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });
      }
      throw error;
    }
  }

  /**
   * 从GitHub获取插件
   */
  private fetchFromGitHub(source: PluginSource): string {
    // 转换GitHub URL为Git URL
    let gitUrl = source.url;
    if (gitUrl.startsWith('https://github.com/')) {
      gitUrl =
        gitUrl.replace('https://github.com/', 'git@github.com:') + '.git';
    }

    return this.fetchFromGit({ ...source, url: gitUrl, type: 'git' });
  }

  /**
   * 从NPM获取插件
   */
  private fetchFromNPM(source: PluginSource): string {
    const pluginName = source.name || source.url;
    const cachePath = pluginCacheManager.getCachePath(source);

    logger.info(`Installing NPM plugin: ${pluginName}`);

    // 使用npm install安装到临时目录
    const tempPath = join(this.cacheDir, `${pluginName}_temp`);
    if (existsSync(tempPath)) {
      execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });
    }

    try {
      mkdirSync(tempPath, { recursive: true });

      const versionSpec = source.version ? `@${source.version}` : '';
      const registryFlag = source.registry
        ? `--registry ${source.registry}`
        : '';
      execSync(
        `npm install "${pluginName}${versionSpec}" ${registryFlag} --prefix "${tempPath}"`,
        {
          stdio: 'inherit',
          cwd: tempPath,
        }
      );

      // 找到实际的插件目录
      const nodeModulesPath = join(tempPath, 'node_modules', pluginName);
      if (!existsSync(nodeModulesPath)) {
        throw new Error(`NPM package not found: ${pluginName}`);
      }

      // 移动到缓存路径
      if (existsSync(cachePath)) {
        execSync(`rm -rf "${cachePath}"`, { stdio: 'ignore' });
      }

      // 确保父目录存在
      const parentDir = dirname(cachePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      execSync(`mv "${nodeModulesPath}" "${cachePath}"`, { stdio: 'ignore' });

      // 清理临时目录
      execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });

      return cachePath;
    } catch (error) {
      if (existsSync(tempPath)) {
        execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });
      }
      throw error;
    }
  }

  /**
   * 从Git仓库的子目录获取插件
   */
  private fetchFromGitSubdir(source: PluginSource): string {
    if (!source.path) {
      throw new Error('Git subdir source requires a path');
    }

    const pluginName =
      source.name || basename(source.url).replace(/\.git$/, '');
    const cachePath = pluginCacheManager.getCachePath(source);

    logger.info(`Cloning git subdir plugin: ${source.url}#${source.path}`);

    // 克隆仓库到临时目录
    const tempPath = join(this.cacheDir, `${pluginName}_temp`);
    const subdirTempPath = join(tempPath, source.path);

    if (existsSync(tempPath)) {
      execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });
    }

    try {
      // 克隆仓库
      execSync(`git clone "${source.url}" "${tempPath}"`, { stdio: 'inherit' });

      if (source.branch) {
        execSync(`git -C "${tempPath}" checkout "${source.branch}"`, {
          stdio: 'inherit',
        });
      }

      if (source.sha) {
        execSync(`git -C "${tempPath}" checkout "${source.sha}"`, {
          stdio: 'inherit',
        });
      }

      // 检查子目录是否存在
      if (!existsSync(subdirTempPath)) {
        throw new Error(`Subdirectory not found: ${source.path}`);
      }

      // 移动子目录到缓存路径
      if (existsSync(cachePath)) {
        execSync(`rm -rf "${cachePath}"`, { stdio: 'ignore' });
      }

      // 确保父目录存在
      const parentDir = dirname(cachePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      execSync(`mv "${subdirTempPath}" "${cachePath}"`, { stdio: 'ignore' });

      // 清理临时目录
      execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });

      return cachePath;
    } catch (error) {
      if (existsSync(tempPath)) {
        execSync(`rm -rf "${tempPath}"`, { stdio: 'ignore' });
      }
      throw error;
    }
  }

  /**
   * 清理插件缓存
   */
  clearCache(): void {
    pluginCacheManager.clearAllCache();
  }

  /**
   * 清理指定插件的缓存
   * @param source 插件源
   */
  clearPluginCache(source: PluginSource): void {
    pluginCacheManager.clearCache(source);
  }

  /**
   * 清理过期的缓存
   * @param maxAgeDays 最大缓存天数
   */
  cleanupOldCache(maxAgeDays: number = 30): void {
    pluginCacheManager.cleanupOldCache(maxAgeDays);
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return pluginCacheManager.getCacheStats();
  }
}

/**
 * 加载插件中的Agent定义
 * @returns 插件Agent定义数组
 */
export async function loadPluginAgents(): Promise<any[]> {
  return [];
}

// 导出单例
export const pluginLoader = new PluginLoader();
