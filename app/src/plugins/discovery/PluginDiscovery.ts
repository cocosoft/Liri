/**
 * PluginDiscovery 插件自动发现系统
 * 自动扫描和发现本地已安装的插件资源
 */
import fs from 'fs';
import path from 'path';
import { resolveProjectRoot, resolvePyappHome } from '@modules/core';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'plugins:discovery:PluginDiscovery', level: LogLevel.INFO });

/**
 * 发现源类型
 */
export type DiscoverySource =
  | 'builtin'
  | 'installed'
  | 'user'
  | 'project'
  | 'global';

/**
 * 发现的插件信息
 */
export interface DiscoveredPlugin {
  name: string;
  path: string;
  source: DiscoverySource;
  manifestPath?: string;
  version?: string;
  loaded: boolean;
  loadError?: string;
}

/**
 * 发现选项
 */
export interface DiscoveryOptions {
  sources?: DiscoverySource[];
  scanDepth?: number;
  followSymlinks?: boolean;
  excludePatterns?: string[];
}

/**
 * 插件自动发现管理器
 */
export class PluginDiscovery {
  private scanPaths: Map<DiscoverySource, string[]> = new Map();
  private discovered: Map<string, DiscoveredPlugin> = new Map();

  constructor() {
    this.initDefaultScanPaths();
  }

  /**
   * 添加扫描路径
   */
  addScanPath(source: DiscoverySource, scanPath: string): void {
    const paths = this.scanPaths.get(source) || [];
    paths.push(scanPath);
    this.scanPaths.set(source, paths);
  }

  /**
   * 执行发现扫描
   */
  scan(options?: DiscoveryOptions): DiscoveredPlugin[] {
    const sources = options?.sources || Array.from(this.scanPaths.keys());
    const scanDepth = options?.scanDepth || 3;
    const excludePatterns = options?.excludePatterns || [
      'node_modules',
      '.git',
    ];

    const allDiscovered: DiscoveredPlugin[] = [];

    for (const source of sources) {
      const paths = this.scanPaths.get(source) || [];
      for (const scanPath of paths) {
        if (!fs.existsSync(scanPath)) continue;
        const found = this.scanDirectory(
          scanPath,
          source,
          scanDepth,
          0,
          excludePatterns
        );
        allDiscovered.push(...found);
      }
    }

    for (const plugin of allDiscovered) {
      this.discovered.set(plugin.name, plugin);
    }

    return allDiscovered;
  }

  /**
   * 根据名称获取已发现的插件
   */
  getDiscovered(name: string): DiscoveredPlugin | undefined {
    return this.discovered.get(name);
  }

  /**
   * 获取所有已发现插件
   */
  getAllDiscovered(): DiscoveredPlugin[] {
    return Array.from(this.discovered.values());
  }

  /**
   * 按源类型获取插件
   */
  getBySource(source: DiscoverySource): DiscoveredPlugin[] {
    return Array.from(this.discovered.values()).filter(
      (p) => p.source === source
    );
  }

  /**
   * 清除发现缓存
   */
  clearCache(): void {
    this.discovered.clear();
  }

  /**
   * 递归扫描目录
   */
  private scanDirectory(
    dirPath: string,
    source: DiscoverySource,
    maxDepth: number,
    currentDepth: number,
    excludePatterns: string[]
  ): DiscoveredPlugin[] {
    if (currentDepth >= maxDepth) return [];

    const results: DiscoveredPlugin[] = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (excludePatterns.includes(entry.name)) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const manifestPath = path.join(fullPath, 'plugin.json');
          if (fs.existsSync(manifestPath)) {
            let version: string | undefined;
            try {
              const manifest = JSON.parse(
                fs.readFileSync(manifestPath, 'utf-8')
              );
              version = manifest.version;
            } catch (err) {

              // 忽略解析错误

              logger.debug("Operation skipped", { context: "忽略解析错误", error: err instanceof Error ? err.message : String(err) });

            }

            results.push({
              name: entry.name,
              path: fullPath,
              source,
              manifestPath,
              version,
              loaded: false,
            });
          }

          const subResults = this.scanDirectory(
            fullPath,
            source,
            maxDepth,
            currentDepth + 1,
            excludePatterns
          );
          results.push(...subResults);
        }
      }
    } catch (err) {

      // 忽略扫描错误

      logger.debug("Operation skipped", { context: "忽略扫描错误", error: err instanceof Error ? err.message : String(err) });

    }

    return results;
  }

  /**
   * 初始化默认扫描路径
   */
  private initDefaultScanPaths(): void {
    const cwd = resolveProjectRoot();

    this.scanPaths.set('builtin', [path.join(cwd, 'plugins', 'builtin')]);
    this.scanPaths.set('installed', [path.join(cwd, 'plugins', 'installed')]);
    this.scanPaths.set('user', [path.join(resolvePyappHome(), 'plugins')]);
    this.scanPaths.set('project', [path.join(cwd, '.pyapp', 'plugins')]);
    this.scanPaths.set('global', [
      configManager.env('LIRI_PLUGIN_PATH') || path.join(cwd, 'plugins'),
    ]);
  }
}

export const pluginDiscovery = new PluginDiscovery();
