/**
 * PluginLoader - 插件加载器
 * 负责从不同来源加载和安装插件
 */

import { join, dirname } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
  readdirSync,
  statSync,
} from 'fs';
import {
  PluginManifest,
  PluginSource,
  LoadedPlugin,
  PluginError,
  PluginLoadResult,
} from '../types';
import {
  getPluginCachePath,
  getVersionedCachePath,
  getVersionedZipCachePath,
  getPluginSeedDirs,
} from '../utils/pluginDirectories';
import { parsePluginIdentifier } from '../utils/pluginIdentifier';
import { calculatePluginVersion } from '../utils/pluginVersioning';
import { PluginManifestSchema, PluginHooksSchema } from '../utils/schemas';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件加载器类
 */
export class PluginLoader {
  private static instance: PluginLoader;

  private constructor() {}

  /**
   * 获取单例实例
   * @returns PluginLoader实例
   */
  public static getInstance(): PluginLoader {
    if (!PluginLoader.instance) {
      PluginLoader.instance = new PluginLoader();
    }
    return PluginLoader.instance;
  }

  /**
   * 加载插件
   * @param pluginId 插件标识符
   * @param source 插件来源
   * @returns 加载的插件
   */
  public async loadPlugin(
    pluginId: string,
    source: PluginSource
  ): Promise<LoadedPlugin> {
    try {
      // 缓存插件
      const { path, manifest, gitCommitSha } = await this.cachePlugin(source);

      // 加载插件组件
      const loadedPlugin = await this.loadPluginComponents({
        name: manifest.name,
        manifest,
        path,
        source: typeof source === 'string' ? source : JSON.stringify(source),
        repository: pluginId,
        enabled: true,
        sha: gitCommitSha,
      });

      return loadedPlugin;
    } catch (error) {
      throw this.createPluginError(
        'generic-error',
        pluginId,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * 缓存插件
   * @param source 插件来源
   * @returns 缓存结果
   */
  public async cachePlugin(source: PluginSource): Promise<{
    path: string;
    manifest: PluginManifest;
    gitCommitSha?: string;
  }> {
    const cachePath = getPluginCachePath();

    // 生成临时缓存名称
    const tempName = this.generateTemporaryCacheNameForPlugin(source);
    const tempPath = join(cachePath, tempName);

    let shouldCleanup = false;
    let gitCommitSha: string | undefined;

    try {
      // 确保缓存目录存在
      mkdirSync(cachePath, { recursive: true });
      shouldCleanup = true;

      // 根据来源类型安装插件
      if (typeof source === 'string') {
        await this.installFromLocal(source, tempPath);
      } else {
        switch (source.source) {
          case 'npm':
            await this.installFromNpm((source as any).package, tempPath, {
              registry: source.registry || '',
              version: source.version || '',
            });
            break;
          case 'github':
            await this.installFromGitHub(
              (source as any).repo,
              tempPath,
              source.ref || '',
              source.sha || ''
            );
            break;
          case 'url':
            await this.installFromGit(
              (source as any).url,
              tempPath,
              source.ref || '',
              source.sha || ''
            );
            break;
          case 'git-subdir':
            gitCommitSha = await this.installFromGitSubdir(
              (source as any).url,
              tempPath,
              (source as any).path || '',
              source.ref || '',
              source.sha || ''
            );
            break;
          default:
            throw new Error(`Unsupported plugin source type: ${source.source}`);
        }
      }

      // 加载插件清单
      const manifest = await this.loadPluginManifest(
        tempPath,
        tempName,
        typeof source === 'string' ? source : source.source
      );

      // 确定最终路径
      const finalName = manifest.name.replace(/[^a-zA-Z0-9\-_]/g, '-');
      const finalPath = join(cachePath, finalName);

      // 移除旧的缓存版本
      if (existsSync(finalPath)) {
        rmSync(finalPath, { recursive: true, force: true });
      }

      // 重命名临时目录
      renameSync(tempPath, finalPath);

      return {
        path: finalPath,
        manifest,
        gitCommitSha,
      };
    } catch (error) {
      if (shouldCleanup && existsSync(tempPath)) {
        try {
          rmSync(tempPath, { recursive: true, force: true });
        } catch (cleanupError) {
          logger.error('Failed to cleanup installation:', {
            error: cleanupError,
          });
        }
      }
      throw error;
    }
  }

  /**
   * 从本地路径安装插件
   * @param sourcePath 源路径
   * @param targetPath 目标路径
   */
  private async installFromLocal(
    sourcePath: string,
    targetPath: string
  ): Promise<void> {
    if (!existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    // 确保目标目录存在
    mkdirSync(targetPath, { recursive: true });

    // 复制目录内容
    this.copyDirectory(sourcePath, targetPath);
  }

  /**
   * 复制目录
   * @param source 源目录
   * @param target 目标目录
   */
  private copyDirectory(source: string, target: string): void {
    const items = readdirSync(source);

    for (const item of items) {
      const sourceItem = join(source, item);
      const targetItem = join(target, item);
      const stats = statSync(sourceItem);

      if (stats.isDirectory()) {
        // 跳过node_modules和.git目录
        if (item === 'node_modules' || item === '.git') {
          continue;
        }
        mkdirSync(targetItem, { recursive: true });
        this.copyDirectory(sourceItem, targetItem);
      } else if (stats.isFile()) {
        // 复制文件
        const content = readFileSync(sourceItem, 'utf-8');
        writeFileSync(targetItem, content, 'utf-8');
      }
    }
  }

  /**
   * 从NPM安装插件
   * @param packageName 包名
   * @param targetPath 目标路径
   * @param options 选项
   */
  private async installFromNpm(
    packageName: string,
    targetPath: string,
    options: { registry?: string; version?: string } = {}
  ): Promise<void> {
    // 这里应该实现NPM安装逻辑
    throw new Error('NPM plugin installation not yet implemented');
  }

  /**
   * 从GitHub安装插件
   * @param repo 仓库
   * @param targetPath 目标路径
   * @param ref 引用
   * @param sha SHA
   */
  private async installFromGitHub(
    repo: string,
    targetPath: string,
    ref: string,
    sha: string
  ): Promise<void> {
    // 这里应该实现GitHub克隆逻辑
    throw new Error('GitHub plugin installation not yet implemented');
  }

  /**
   * 从Git安装插件
   * @param gitUrl Git URL
   * @param targetPath 目标路径
   * @param ref 引用
   * @param sha SHA
   */
  private async installFromGit(
    gitUrl: string,
    targetPath: string,
    ref: string,
    sha: string
  ): Promise<void> {
    // 这里应该实现Git克隆逻辑
    throw new Error('Git plugin installation not yet implemented');
  }

  /**
   * 从Git子目录安装插件
   * @param url URL
   * @param targetPath 目标路径
   * @param subdirPath 子目录路径
   * @param ref 引用
   * @param sha SHA
   * @returns Git提交SHA
   */
  private async installFromGitSubdir(
    url: string,
    targetPath: string,
    subdirPath: string,
    ref: string,
    sha: string
  ): Promise<string | undefined> {
    // 这里应该实现Git子目录克隆逻辑
    throw new Error('Git subdir plugin installation not yet implemented');
  }

  /**
   * 加载插件清单
   * @param pluginPath 插件路径
   * @param pluginName 插件名称
   * @param source 来源
   * @returns 插件清单
   */
  private async loadPluginManifest(
    pluginPath: string,
    pluginName: string,
    source: string
  ): Promise<PluginManifest> {
    const manifestPath = join(pluginPath, '.claude-plugin', 'plugin.json');
    const legacyManifestPath = join(pluginPath, 'plugin.json');

    if (existsSync(manifestPath)) {
      try {
        const content = readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = PluginManifestSchema.safeParse(parsed);

        if (result.success) {
          return result.data;
        } else {
          const errors = result.error.issues
            .map((err) => `${err.path.join('.')}: ${err.message}`)
            .join(', ');
          throw new Error(`Invalid manifest: ${errors}`);
        }
      } catch (error) {
        throw new Error(
          `Failed to load manifest: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } else if (existsSync(legacyManifestPath)) {
      try {
        const content = readFileSync(legacyManifestPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = PluginManifestSchema.safeParse(parsed);

        if (result.success) {
          return result.data;
        } else {
          const errors = result.error.issues
            .map((err) => `${err.path.join('.')}: ${err.message}`)
            .join(', ');
          throw new Error(`Invalid legacy manifest: ${errors}`);
        }
      } catch (error) {
        throw new Error(
          `Failed to load legacy manifest: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } else {
      // 创建默认清单
      return {
        name: pluginName,
        version: '1.0.0',
        description: `Plugin from ${source}`,
      };
    }
  }

  /**
   * 加载插件组件
   * @param plugin 插件
   * @returns 加载的插件
   */
  private async loadPluginComponents(
    plugin: LoadedPlugin
  ): Promise<LoadedPlugin> {
    // 加载命令
    if (plugin.manifest.commands) {
      plugin.commandsPaths = plugin.manifest.commands;
    }

    // 加载代理
    if (plugin.manifest.agents) {
      plugin.agentsPaths = plugin.manifest.agents;
    }

    // 加载技能
    if (plugin.manifest.skills) {
      plugin.skillsPaths = plugin.manifest.skills;
    }

    // 加载钩子
    if (plugin.manifest.hooks) {
      const hooksPath = join(plugin.path, plugin.manifest.hooks);
      if (existsSync(hooksPath)) {
        try {
          const content = readFileSync(hooksPath, 'utf-8');
          const parsed = JSON.parse(content);
          const result = PluginHooksSchema.safeParse(parsed);
          if (result.success) {
            plugin.hooksConfig = result.data.hooks;
          }
        } catch (error) {
          logger.error('Failed to load hooks config:', { error });
        }
      }
    }

    return plugin;
  }

  /**
   * 生成临时缓存名称
   * @param source 插件来源
   * @returns 临时缓存名称
   */
  private generateTemporaryCacheNameForPlugin(source: PluginSource): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    let prefix: string;

    if (typeof source === 'string') {
      prefix = 'local';
    } else {
      switch (source.source) {
        case 'npm':
          prefix = 'npm';
          break;
        case 'github':
          prefix = 'github';
          break;
        case 'url':
          prefix = 'git';
          break;
        case 'git-subdir':
          prefix = 'subdir';
          break;
        default:
          prefix = 'unknown';
      }
    }

    return `temp_${prefix}_${timestamp}_${random}`;
  }

  /**
   * 创建插件错误
   * @param type 错误类型
   * @param plugin 插件名称
   * @param error 错误信息
   * @returns 插件错误
   */
  private createPluginError(
    type: 'generic-error',
    plugin: string,
    error: string
  ): PluginError {
    return {
      type,
      source: 'plugin-loader',
      plugin,
      error,
    };
  }

  /**
   * 加载所有插件
   * @param pluginIds 插件标识符列表
   * @returns 插件加载结果
   */
  public async loadPlugins(pluginIds: string[]): Promise<PluginLoadResult> {
    const enabled: LoadedPlugin[] = [];
    const disabled: LoadedPlugin[] = [];
    const errors: PluginError[] = [];

    for (const pluginId of pluginIds) {
      try {
        // 这里应该从配置中获取插件来源
        // 简化实现，实际项目中可能需要从配置或市场中获取
        const source: PluginSource = 'local'; // 临时实现
        const plugin = await this.loadPlugin(pluginId, source);
        enabled.push(plugin);
      } catch (error) {
        errors.push(
          this.createPluginError(
            'generic-error',
            pluginId,
            error instanceof Error ? error.message : 'Unknown error'
          )
        );
      }
    }

    return {
      enabled,
      disabled,
      errors,
    };
  }
}
