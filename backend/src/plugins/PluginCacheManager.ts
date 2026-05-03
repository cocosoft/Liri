// @ts-nocheck
/**
 * 插件缓存管理器
 * 负责管理插件的缓存，包括版本控制、缓存验证等
 */

import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'fs';
import { logger } from '../utils/log';
import type { PluginSource } from './PluginLoader';
import * as path from 'path';
import * as stream from 'stream';
import { promisify } from 'util';
import * as childProcess from 'child_process';

/**
 * 插件缓存信息
 */
export interface PluginCacheInfo {
  pluginName: string;
  source: string;
  version: string;
  branch: string;
  cachedAt: string;
  size: number;
  sha?: string;
}

/**
 * 插件缓存管理器
 */
export class PluginCacheManager {
  private cacheRoot: string;
  private versionedCacheDir: string;
  private zipCacheDir: string;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.cacheRoot = join(homeDir, '.py_app', 'plugins', 'cache');
    this.versionedCacheDir = join(this.cacheRoot, 'versioned');
    this.zipCacheDir = join(this.cacheRoot, 'zip');

    // 创建缓存目录（失败时降级到项目目录）
    try {
      this.ensureCacheDirs();
    } catch (error) {
      logger.warn(`Failed to create cache dirs at ${this.cacheRoot}, falling back to local path:`, error);
      this.cacheRoot = join(process.cwd(), 'data', 'plugins', 'cache');
      this.versionedCacheDir = join(this.cacheRoot, 'versioned');
      this.zipCacheDir = join(this.cacheRoot, 'zip');
      this.ensureCacheDirs();
    }
  }

  /**
   * 确保缓存目录存在
   */
  private ensureCacheDirs(): void {
    if (!existsSync(this.cacheRoot)) {
      mkdirSync(this.cacheRoot, { recursive: true });
    }
    if (!existsSync(this.versionedCacheDir)) {
      mkdirSync(this.versionedCacheDir, { recursive: true });
    }
    if (!existsSync(this.zipCacheDir)) {
      mkdirSync(this.zipCacheDir, { recursive: true });
    }
  }

  /**
   * 生成缓存路径
   * @param source 插件源
   * @returns 缓存路径
   */
  getCachePath(source: PluginSource): string {
    const pluginName = source.name || this.extractPluginName(source.url);
    const version = source.version || 'latest';
    const branch = source.branch || 'main';
    const sourceType = source.type;
    
    // 为不同类型的源创建不同的缓存目录
    const sanitizedSource = sourceType.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    return join(
      this.versionedCacheDir,
      sanitizedSource,
      `${sanitizedName}-${version}-${branch}`
    );
  }

  /**
   * 从URL中提取插件名称
   */
  private extractPluginName(url: string): string {
    // 从Git URL中提取
    if (url.endsWith('.git')) {
      return url.split('/').pop()!.replace('.git', '');
    }
    // 从GitHub URL中提取
    if (url.includes('github.com')) {
      const parts = url.split('/');
      return parts[parts.length - 1];
    }
    // 从NPM包名中提取
    if (url.includes('/')) {
      return url.split('/').pop()!;
    }
    return url;
  }

  /**
   * 检查缓存是否存在
   * @param source 插件源
   * @returns 是否存在
   */
  isCached(source: PluginSource): boolean {
    const cachePath = this.getCachePath(source);
    return existsSync(cachePath);
  }

  /**
   * 获取缓存信息
   * @param source 插件源
   * @returns 缓存信息或undefined
   */
  getCacheInfo(source: PluginSource): PluginCacheInfo | undefined {
    const cachePath = this.getCachePath(source);
    const infoPath = join(cachePath, '.cache-info.json');
    
    if (existsSync(infoPath)) {
      try {
        const content = readFileSync(infoPath, 'utf8');
        return JSON.parse(content) as PluginCacheInfo;
      } catch (error) {
        logger.error(`Failed to read cache info:`, error);
      }
    }
    return undefined;
  }

  /**
   * 写入缓存信息
   * @param source 插件源
   * @param info 额外信息
   */
  writeCacheInfo(source: PluginSource, info?: Partial<PluginCacheInfo>): void {
    const cachePath = this.getCachePath(source);
    const infoPath = join(cachePath, '.cache-info.json');
    
    const cacheInfo: PluginCacheInfo = {
      pluginName: source.name || this.extractPluginName(source.url),
      source: source.url,
      version: source.version || 'latest',
      branch: source.branch || 'main',
      cachedAt: new Date().toISOString(),
      size: this.getDirectorySize(cachePath),
      ...info,
    };
    
    writeFileSync(infoPath, JSON.stringify(cacheInfo, null, 2));
  }

  /**
   * 获取目录大小
   */
  private getDirectorySize(directory: string): number {
    let size = 0;
    const entries = readdirSync(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isFile()) {
        size += statSync(entryPath).size;
      } else if (entry.isDirectory()) {
        size += this.getDirectorySize(entryPath);
      }
    }
    
    return size;
  }

  /**
   * 清理指定插件的缓存
   * @param source 插件源
   */
  clearCache(source: PluginSource): void {
    const cachePath = this.getCachePath(source);
    if (existsSync(cachePath)) {
      rmSync(cachePath, { recursive: true, force: true });
      logger.info(`Cleared cache for plugin: ${source.name || source.url}`);
    }
  }

  /**
   * 清理所有缓存
   */
  clearAllCache(): void {
    if (existsSync(this.versionedCacheDir)) {
      rmSync(this.versionedCacheDir, { recursive: true, force: true });
      mkdirSync(this.versionedCacheDir, { recursive: true });
      logger.info('Cleared all plugin cache');
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    totalSize: number;
    pluginCount: number;
    caches: PluginCacheInfo[];
  } {
    const caches: PluginCacheInfo[] = [];
    let totalSize = 0;
    
    if (existsSync(this.versionedCacheDir)) {
      const sourceDirs = readdirSync(this.versionedCacheDir, { withFileTypes: true });
      
      for (const sourceDir of sourceDirs) {
        if (sourceDir.isDirectory()) {
          const sourcePath = join(this.versionedCacheDir, sourceDir.name);
          const pluginDirs = readdirSync(sourcePath, { withFileTypes: true });
          
          for (const pluginDir of pluginDirs) {
            if (pluginDir.isDirectory()) {
              const pluginPath = join(sourcePath, pluginDir.name);
              const infoPath = join(pluginPath, '.cache-info.json');
              
              if (existsSync(infoPath)) {
                try {
                  const content = readFileSync(infoPath, 'utf8');
                  const info = JSON.parse(content) as PluginCacheInfo;
                  caches.push(info);
                  totalSize += info.size;
                } catch (error) {
                  logger.error(`Failed to read cache info:`, error);
                }
              }
            }
          }
        }
      }
    }
    
    return {
      totalSize,
      pluginCount: caches.length,
      caches,
    };
  }

  /**
   * 验证缓存的有效性
   * @param source 插件源
   * @returns 是否有效
   */
  validateCache(source: PluginSource): boolean {
    const cachePath = this.getCachePath(source);
    if (!existsSync(cachePath)) {
      return false;
    }
    
    // 检查必要的文件是否存在
    const manifestPath = join(cachePath, 'manifest.json');
    if (!existsSync(manifestPath)) {
      return false;
    }
    
    // 检查缓存信息是否存在
    const infoPath = join(cachePath, '.cache-info.json');
    if (!existsSync(infoPath)) {
      return false;
    }
    
    return true;
  }

  /**
   * 清理过期的缓存
   * @param maxAgeDays 最大缓存天数
   */
  cleanupOldCache(maxAgeDays: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    // 清理版本化缓存
    if (existsSync(this.versionedCacheDir)) {
      const sourceDirs = readdirSync(this.versionedCacheDir, { withFileTypes: true });
      
      for (const sourceDir of sourceDirs) {
        if (sourceDir.isDirectory()) {
          const sourcePath = join(this.versionedCacheDir, sourceDir.name);
          const pluginDirs = readdirSync(sourcePath, { withFileTypes: true });
          
          for (const pluginDir of pluginDirs) {
            if (pluginDir.isDirectory()) {
              const pluginPath = join(sourcePath, pluginDir.name);
              const infoPath = join(pluginPath, '.cache-info.json');
              
              if (existsSync(infoPath)) {
                try {
                  const content = readFileSync(infoPath, 'utf8');
                  const info = JSON.parse(content) as PluginCacheInfo;
                  const cachedDate = new Date(info.cachedAt);
                  
                  if (cachedDate < cutoffDate) {
                    rmSync(pluginPath, { recursive: true, force: true });
                    logger.info(`Cleaned up old cache for plugin: ${info.pluginName}`);
                  }
                } catch (error) {
                  logger.error(`Failed to check cache age:`, error);
                }
              }
            }
          }
        }
      }
    }

    // 清理ZIP缓存
    if (existsSync(this.zipCacheDir)) {
      const sourceDirs = readdirSync(this.zipCacheDir, { withFileTypes: true });
      
      for (const sourceDir of sourceDirs) {
        if (sourceDir.isDirectory()) {
          const sourcePath = join(this.zipCacheDir, sourceDir.name);
          const zipFiles = readdirSync(sourcePath, { withFileTypes: true });
          
          for (const zipFile of zipFiles) {
            if (zipFile.isFile() && zipFile.name.endsWith('.zip')) {
              const zipPath = join(sourcePath, zipFile.name);
              const stat = statSync(zipPath);
              const modifiedDate = new Date(stat.mtime);
              
              if (modifiedDate < cutoffDate) {
                rmSync(zipPath, { force: true });
                logger.info(`Cleaned up old ZIP cache: ${zipPath}`);
              }
            }
          }
        }
      }
    }
  }

  /**
   * 生成ZIP缓存路径
   * @param source 插件源
   * @returns ZIP缓存路径
   */
  getZipCachePath(source: PluginSource): string {
    const pluginName = source.name || this.extractPluginName(source.url);
    const version = source.version || 'latest';
    const branch = source.branch || 'main';
    const sourceType = source.type;
    
    const sanitizedSource = sourceType.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    return join(
      this.zipCacheDir,
      sanitizedSource,
      `${sanitizedName}-${version}-${branch}.zip`
    );
  }

  /**
   * 检查ZIP缓存是否存在
   * @param source 插件源
   * @returns 是否存在
   */
  isZipCached(source: PluginSource): boolean {
    const zipPath = this.getZipCachePath(source);
    return existsSync(zipPath);
  }

  /**
   * 压缩目录为ZIP文件
   * @param directory 要压缩的目录
   * @param zipPath 输出ZIP文件路径
   */
  async compressToZip(directory: string, zipPath: string): Promise<void> {
    // 确保ZIP文件的父目录存在
    const zipDir = path.dirname(zipPath);
    if (!existsSync(zipDir)) {
      mkdirSync(zipDir, { recursive: true });
    }

    // 使用系统命令进行压缩
    try {
      if (process.platform === 'win32') {
        // Windows系统使用PowerShell
        const command = `Compress-Archive -Path "${directory}\*" -DestinationPath "${zipPath}" -Force`;
        childProcess.execSync(`powershell -Command "${command}"`, { stdio: 'inherit' });
      } else {
        // Unix系统使用zip命令
        childProcess.execSync(`zip -r "${zipPath}" "${directory}"`, { stdio: 'inherit' });
      }
      logger.info(`Compressed directory ${directory} to ${zipPath}`);
    } catch (error) {
      logger.error(`Failed to compress directory:`, error);
      throw error;
    }
  }

  /**
   * 解压ZIP文件到目录
   * @param zipPath ZIP文件路径
   * @param targetDir 目标目录
   */
  async extractFromZip(zipPath: string, targetDir: string): Promise<void> {
    // 确保目标目录存在
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // 使用系统命令进行解压
    try {
      if (process.platform === 'win32') {
        // Windows系统使用PowerShell
        const command = `Expand-Archive -Path "${zipPath}" -DestinationPath "${targetDir}" -Force`;
        childProcess.execSync(`powershell -Command "${command}"`, { stdio: 'inherit' });
      } else {
        // Unix系统使用unzip命令
        childProcess.execSync(`unzip "${zipPath}" -d "${targetDir}"`, { stdio: 'inherit' });
      }
      logger.info(`Extracted ${zipPath} to ${targetDir}`);
    } catch (error) {
      logger.error(`Failed to extract zip file:`, error);
      throw error;
    }
  }

  /**
   * 清理ZIP缓存
   * @param source 插件源
   */
  clearZipCache(source: PluginSource): void {
    const zipPath = this.getZipCachePath(source);
    if (existsSync(zipPath)) {
      rmSync(zipPath, { force: true });
      logger.info(`Cleared ZIP cache for plugin: ${source.name || source.url}`);
    }
  }

  /**
   * 清理所有ZIP缓存
   */
  clearAllZipCache(): void {
    if (existsSync(this.zipCacheDir)) {
      rmSync(this.zipCacheDir, { recursive: true, force: true });
      mkdirSync(this.zipCacheDir, { recursive: true });
      logger.info('Cleared all plugin ZIP cache');
    }
  }
}

// 导出单例
export const pluginCacheManager = new PluginCacheManager();